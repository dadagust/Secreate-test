package ru.secreate.exchange;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Set;

@Component
@EnableScheduling
public class DeliveryWorker {
    private static final System.Logger LOG = System.getLogger(DeliveryWorker.class.getName());

    private record ExternalResult(long version, String status) {}

    private final ExchangeService service;
    private final String endpoint;
    private final boolean enabled;
    private final int maxItemsPerTick;
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();

    @Autowired
    public DeliveryWorker(ExchangeService service,
                          @Value("${exchange.executor:http://localhost:9090}") String endpoint,
                          @Value("${exchange.worker.enabled:true}") boolean enabled,
                          @Value("${exchange.worker.max-items-per-tick:16}") int maxItemsPerTick) {
        if (maxItemsPerTick < 1 || maxItemsPerTick > 256) {
            throw new IllegalArgumentException("exchange.worker.max-items-per-tick must be between 1 and 256");
        }
        this.service = service;
        this.endpoint = endpoint;
        this.enabled = enabled;
        this.maxItemsPerTick = maxItemsPerTick;
    }

    /** Used by focused integration tests; production receives the batch limit from configuration. */
    public DeliveryWorker(ExchangeService service, String endpoint, boolean enabled) {
        this(service, endpoint, enabled, 16);
    }

    @Scheduled(fixedDelayString = "${exchange.worker.fixed-delay-ms:1000}")
    public void tick() {
        if (!enabled || Thread.currentThread().isInterrupted()) return;
        for (int processed = 0; processed < maxItemsPerTick; processed++) {
            if (Thread.currentThread().isInterrupted()) return;
            // Claim just before each synchronous HTTP call. If the queue is empty, this tick
            // ends immediately and fixedDelay provides the idle pause.
            if (!deliverOne()) return;
            if (Thread.currentThread().isInterrupted()) return;
        }
    }

    public boolean deliverOne() {
        if (Thread.currentThread().isInterrupted()) return false;
        long claimStarted = System.nanoTime();
        var lease = service.claim();
        long claimMicros = elapsedMicros(claimStarted);
        if (lease == null) {
            logTiming("none", 0, "QUEUE_EMPTY", claimMicros, 0, 0);
            return false;
        }

        LOG.log(System.Logger.Level.INFO, "delivery operationId={0} attempt={1} outcome=ATTEMPT_STARTED", lease.id(), lease.attempts());
        long httpMicros = 0;
        long applyMicros = 0;
        String outcome = "UNEXPECTED";
        try {
            var request = HttpRequest.newBuilder(URI.create(endpoint + "/operations/" + lease.id()))
                    .timeout(Duration.ofSeconds(3))
                    .POST(HttpRequest.BodyPublishers.ofString(lease.title(), StandardCharsets.UTF_8))
                    .build();
            long httpStarted = System.nanoTime();
            HttpResponse<String> response;
            try {
                response = client.send(request, HttpResponse.BodyHandlers.ofString());
            } finally {
                httpMicros = elapsedMicros(httpStarted);
            }

            if (response.statusCode() >= 400 && response.statusCode() < 500) {
                throw new IllegalArgumentException("Executor rejected operation");
            }
            if (response.statusCode() != 200) throw new IllegalStateException("Executor HTTP " + response.statusCode());

            String body = response.body();
            if (body.endsWith("\r\n")) body = body.substring(0, body.length() - 2);
            else if (body.endsWith("\n") || body.endsWith("\r")) body = body.substring(0, body.length() - 1);
            String[] lines = body.split("\\R", -1);
            if (lines.length < 1 || lines.length > 2 || lines[0].isBlank() || lines[lines.length - 1].isBlank()) {
                throw new IllegalArgumentException("Invalid result batch");
            }
            var results = new java.util.ArrayList<ExternalResult>(lines.length);
            for (String line : lines) {
                String[] fields = line.split("\\|", -1);
                if (fields.length != 3 || !lease.id().toString().equals(fields[0])) {
                    throw new IllegalArgumentException("Mismatched result");
                }
                long version = Long.parseLong(fields[1]);
                if (version < 1 || !Set.of("SUCCEEDED", "FAILED").contains(fields[2])) {
                    throw new IllegalArgumentException("Invalid result");
                }
                results.add(new ExternalResult(version, fields[2]));
            }

            ExternalResult result = results.getFirst();
            if (results.size() == 2 && !results.get(0).equals(results.get(1))) {
                ExternalResult duplicate = results.get(1);
                long applyStarted = System.nanoTime();
                if (result.version() == duplicate.version() && !result.status().equals(duplicate.status())) {
                    boolean recorded = service.rejectContradictoryBatch(lease, result.version(), result.status(), duplicate.status());
                    outcome = recorded ? "CONTRADICTORY_RESULT_BATCH_REQUIRES_REVIEW" : "STALE_LEASE_IGNORED";
                } else {
                    service.reject(lease);
                    outcome = "INVALID_RESULT_REQUIRES_REVIEW";
                }
                applyMicros = elapsedMicros(applyStarted);
                return true;
            }

            long applyStarted = System.nanoTime();
            boolean accepted = service.complete(lease, result.version(), result.status());
            applyMicros = elapsedMicros(applyStarted);
            outcome = accepted ? "RESULT_ACCEPTED" : "STALE_LEASE_IGNORED";
        } catch (IllegalArgumentException exception) {
            long applyStarted = System.nanoTime();
            service.reject(lease);
            applyMicros = elapsedMicros(applyStarted);
            outcome = "INVALID_RESULT_REQUIRES_REVIEW";
        } catch (Exception exception) {
            Thread currentThread = Thread.currentThread();
            boolean interrupted = exception instanceof InterruptedException || currentThread.isInterrupted();
            if (interrupted) Thread.interrupted();
            long applyStarted = System.nanoTime();
            try {
                service.finish(lease, false);
            } finally {
                applyMicros = elapsedMicros(applyStarted);
                if (interrupted) currentThread.interrupt();
            }
            outcome = "TEMPORARY_RETRY";
            LOG.log(System.Logger.Level.WARNING,
                    "delivery operationId={0} attempt={1} outcome={2} error={3}",
                    lease.id(), lease.attempts(), outcome, exception.getClass().getSimpleName());
        } finally {
            logTiming(lease.id().toString(), lease.attempts(), outcome, claimMicros, httpMicros, applyMicros);
        }
        return true;
    }

    private static long elapsedMicros(long startedAt) {
        return (System.nanoTime() - startedAt) / 1_000;
    }

    private static void logTiming(String operationId, int attempt, String outcome,
                                  long claimMicros, long httpMicros, long applyMicros) {
        LOG.log(System.Logger.Level.INFO,
                "delivery_timing operationId={0} attempt={1} outcome={2} claim_us={3} http_us={4} apply_us={5}",
                operationId, attempt, outcome, Long.toString(claimMicros), Long.toString(httpMicros), Long.toString(applyMicros));
    }
}
