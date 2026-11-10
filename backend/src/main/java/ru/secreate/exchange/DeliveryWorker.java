package ru.secreate.exchange;

import org.springframework.stereotype.Component;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.*;
import java.net.*;
import java.net.http.*;
import java.time.Duration;
import java.nio.charset.StandardCharsets;

@Component
@EnableScheduling
public class DeliveryWorker {
    private static final System.Logger LOG = System.getLogger(DeliveryWorker.class.getName());
    private record ExternalResult(long version,String status) {}
    private final ExchangeService service;
    private final String endpoint;
    private final boolean enabled;
    private final HttpClient client=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();
    public DeliveryWorker(ExchangeService service,@Value("${exchange.executor:http://localhost:9090}") String endpoint,
                          @Value("${exchange.worker.enabled:true}") boolean enabled) { this.service=service;this.endpoint=endpoint;this.enabled=enabled; }
    @Scheduled(fixedDelayString="${exchange.worker.fixed-delay-ms:1000}") public void tick() { if(enabled) deliverOne(); }
    public boolean deliverOne() {
        var lease=service.claim(); if(lease==null) return false;
        LOG.log(System.Logger.Level.INFO,"delivery operationId={0} attempt={1} outcome=ATTEMPT_STARTED",lease.id(),lease.attempts());
        try {
            var request=HttpRequest.newBuilder(URI.create(endpoint+"/operations/"+lease.id())).timeout(Duration.ofSeconds(3))
                    .POST(HttpRequest.BodyPublishers.ofString(lease.title(),StandardCharsets.UTF_8)).build();
            var response=client.send(request,HttpResponse.BodyHandlers.ofString());
            if(response.statusCode()>=400 && response.statusCode()<500) throw new IllegalArgumentException("Executor rejected operation");
            if(response.statusCode()!=200) throw new IllegalStateException("Executor HTTP "+response.statusCode());
            String body=response.body();
            if(body.endsWith("\r\n")) body=body.substring(0,body.length()-2);
            else if(body.endsWith("\n") || body.endsWith("\r")) body=body.substring(0,body.length()-1);
            String[] lines=body.split("\\R",-1);
            if(lines.length<1 || lines.length>2 || lines[0].isBlank() || lines[lines.length-1].isBlank())
                throw new IllegalArgumentException("Invalid result batch");
            var results=new java.util.ArrayList<ExternalResult>(lines.length);
            for(String line:lines) {
                String[] fields=line.split("\\|",-1);
                if(fields.length!=3 || !lease.id().toString().equals(fields[0])) throw new IllegalArgumentException("Mismatched result");
                long version=Long.parseLong(fields[1]);
                if(version<1 || !java.util.Set.of("SUCCEEDED","FAILED").contains(fields[2])) throw new IllegalArgumentException("Invalid result");
                results.add(new ExternalResult(version,fields[2]));
            }
            ExternalResult result=results.getFirst();
            if(results.size()==2 && !results.get(0).equals(results.get(1))) {
                ExternalResult duplicate=results.get(1);
                if(result.version()==duplicate.version() && !result.status().equals(duplicate.status())) {
                    boolean recorded=service.rejectContradictoryBatch(lease,result.version(),result.status(),duplicate.status());
                    LOG.log(System.Logger.Level.WARNING,"delivery operationId={0} attempt={1} outcome={2}",lease.id(),lease.attempts(),recorded?"CONTRADICTORY_RESULT_BATCH_REQUIRES_REVIEW":"STALE_LEASE_IGNORED");
                } else {
                    service.reject(lease);
                    LOG.log(System.Logger.Level.WARNING,"delivery operationId={0} attempt={1} outcome=INVALID_RESULT_REQUIRES_REVIEW",lease.id(),lease.attempts());
                }
                return true;
            }
            boolean accepted=service.complete(lease,result.version(),result.status());
            LOG.log(System.Logger.Level.INFO,"delivery operationId={0} attempt={1} outcome={2}",lease.id(),lease.attempts(),accepted?"RESULT_ACCEPTED":"STALE_LEASE_IGNORED");
        } catch(IllegalArgumentException e) {
            service.reject(lease);
            LOG.log(System.Logger.Level.WARNING,"delivery operationId={0} attempt={1} outcome=INVALID_RESULT_REQUIRES_REVIEW",lease.id(),lease.attempts());
        } catch(Exception e) {
            if(e instanceof InterruptedException) Thread.currentThread().interrupt();
            service.finish(lease,false);
            LOG.log(System.Logger.Level.WARNING,"delivery operationId={0} attempt={1} outcome=TEMPORARY_RETRY error={2}",lease.id(),lease.attempts(),e.getClass().getSimpleName());
        }
        return true;
    }
}
