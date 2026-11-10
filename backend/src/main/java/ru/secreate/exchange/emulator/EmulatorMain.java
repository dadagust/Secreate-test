package ru.secreate.exchange.emulator;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.UUID;
import java.util.concurrent.Executors;

/** Independent local executor. Its ledger is separate from the application's tables. */
public class EmulatorMain {
    private static Connection connection() throws SQLException {
        return DriverManager.getConnection(System.getenv("EXECUTOR_DB_URL"), System.getenv("EXECUTOR_DB_USER"), System.getenv("EXECUTOR_DB_PASSWORD"));
    }

    public static void main(String[] args) throws Exception {
        try (var connection = connection(); var statement = connection.createStatement()) {
            statement.execute("create schema if not exists executor");
            statement.execute("create table if not exists executor.executions (id uuid primary key, payload text not null, executions integer not null check(executions=1), executed_at timestamptz not null default clock_timestamp())");
            statement.execute("alter table executor.executions add column if not exists result_version bigint not null default 1");
            statement.execute("alter table executor.executions add column if not exists result_status varchar(20) not null default 'SUCCEEDED'");
            statement.execute("alter table executor.executions add column if not exists executed_at timestamptz not null default clock_timestamp()");
            FaultModeStore.initialize(connection);
        }

        String bindAddress = System.getenv().getOrDefault("EXECUTOR_BIND_ADDRESS", "127.0.0.1");
        var server = HttpServer.create(new InetSocketAddress(bindAddress, Integer.parseInt(args[0])), 0);
        server.setExecutor(Executors.newVirtualThreadPerTaskExecutor());
        server.createContext("/fault-modes", EmulatorMain::faultModes);
        server.createContext("/fault/drop-next", EmulatorMain::legacyDropNext);
        server.createContext("/operations/", EmulatorMain::operation);
        server.start();
        System.out.println("READY " + server.getAddress().getPort());
        System.out.flush();
    }

    private static void faultModes(HttpExchange exchange) {
        String path = exchange.getRequestURI().getPath();
        try {
            if (path.equals("/fault-modes") && exchange.getRequestMethod().equals("GET")) {
                try (var connection = connection()) {
                    var mode = FaultModeStore.read(connection, false);
                    respond(exchange, 200, "{\"unavailable\":" + mode.unavailable() + ",\"dropAfterSave\":" + mode.dropAfterSave()
                            + ",\"duplicateResult\":" + mode.duplicateResult() + ",\"delayMs\":" + mode.delayMs() + "}", "application/json; charset=utf-8");
                }
                return;
            }
            if (path.equals("/fault-modes") && exchange.getRequestMethod().equals("DELETE")) {
                try (var connection = connection()) {
                    connection.setAutoCommit(false);
                    FaultModeStore.reset(connection);
                    connection.commit();
                }
                noContent(exchange);
                return;
            }
            if (exchange.getRequestMethod().equals("PUT") && path.startsWith("/fault-modes/")) {
                String mode = path.substring("/fault-modes/".length());
                if (mode.isBlank() || mode.contains("/")) {
                    respond(exchange, 404, "Unknown fault mode", "text/plain; charset=utf-8");
                    return;
                }
                int delay = mode.equals("delayed-result") ? delayMs(exchange.getRequestURI().getRawQuery()) : 0;
                try (var connection = connection()) {
                    connection.setAutoCommit(false);
                    FaultModeStore.enable(connection, mode, delay);
                    connection.commit();
                }
                noContent(exchange);
                return;
            }
            respond(exchange, 405, "Method not allowed", "text/plain; charset=utf-8");
        } catch (IllegalArgumentException exception) {
            respond(exchange, 400, "Invalid fault mode", "text/plain; charset=utf-8");
        } catch (SQLException exception) {
            respond(exchange, 503, "Storage temporarily unavailable", "text/plain; charset=utf-8");
        } catch (Exception exception) {
            respond(exchange, 500, "Internal error", "text/plain; charset=utf-8");
        }
    }

    private static void legacyDropNext(HttpExchange exchange) {
        if (!exchange.getRequestMethod().equals("POST")) {
            respond(exchange, 405, "Method not allowed", "text/plain; charset=utf-8");
            return;
        }
        try (var connection = connection()) {
            connection.setAutoCommit(false);
            FaultModeStore.enable(connection, "drop-after-save", 0);
            connection.commit();
            noContent(exchange);
        } catch (SQLException | java.io.IOException exception) {
            respond(exchange, 503, "Storage temporarily unavailable", "text/plain; charset=utf-8");
        }
    }

    private static void operation(HttpExchange exchange) {
        String path = exchange.getRequestURI().getPath();
        if (!path.startsWith("/operations/")) {
            respond(exchange, 404, "Unknown operation", "text/plain; charset=utf-8");
            return;
        }

        final UUID id;
        try {
            id = UUID.fromString(path.substring("/operations/".length()));
        } catch (IllegalArgumentException exception) {
            respond(exchange, 400, "Invalid operation", "text/plain; charset=utf-8");
            return;
        }

        if (exchange.getRequestMethod().equals("GET")) {
            getOperation(exchange, id);
            return;
        }
        if (!exchange.getRequestMethod().equals("POST")) {
            respond(exchange, 405, "Method not allowed", "text/plain; charset=utf-8");
            return;
        }

        try {
            byte[] bytes = exchange.getRequestBody().readNBytes(801);
            if (bytes.length > 800) throw new IllegalArgumentException("Payload too large");
            String payload = new String(bytes, StandardCharsets.UTF_8);
            boolean drop;
            boolean duplicate;
            int delay;
            String response;
            try (var connection = connection()) {
                connection.setAutoCommit(false);
                var mode = FaultModeStore.read(connection, true);
                if (mode.unavailable()) {
                    connection.rollback();
                    respond(exchange, 503, "Executor temporarily unavailable", "text/plain; charset=utf-8");
                    return;
                }
                try (var statement = connection.prepareStatement("insert into executor.executions(id,payload,executions) values (?,?,1) on conflict do nothing")) {
                    statement.setObject(1, id);
                    statement.setString(2, payload);
                    statement.executeUpdate();
                }
                try (var statement = connection.prepareStatement("select payload,result_version,result_status from executor.executions where id=?")) {
                    statement.setObject(1, id);
                    try (var result = statement.executeQuery()) {
                        if (!result.next()) throw new SQLException("Execution missing after insert");
                        if (!payload.equals(result.getString(1))) {
                            connection.rollback();
                            respond(exchange, 409, "Payload conflict", "text/plain; charset=utf-8");
                            return;
                        }
                        response = id + "|" + result.getLong(2) + "|" + result.getString(3);
                    }
                }
                drop = mode.dropAfterSave();
                duplicate = mode.duplicateResult();
                delay = mode.delayMs();
                if (drop || duplicate || delay > 0) FaultModeStore.consumeOneShots(connection);
                connection.commit();
            }
            if (drop) {
                exchange.close();
                return;
            }
            if (delay > 0) Thread.sleep(delay);
            if (duplicate) response += "\n" + response;
            respond(exchange, 200, response, "text/plain; charset=utf-8");
        } catch (SQLException exception) {
            respond(exchange, 503, "Storage temporarily unavailable", "text/plain; charset=utf-8");
        } catch (IllegalArgumentException exception) {
            respond(exchange, 400, "Invalid operation", "text/plain; charset=utf-8");
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            respond(exchange, 503, "Executor interrupted", "text/plain; charset=utf-8");
        } catch (Exception exception) {
            respond(exchange, 500, "Internal error", "text/plain; charset=utf-8");
        }
    }

    private static void getOperation(HttpExchange exchange, UUID id) {
        try (var connection = connection();
             var statement = connection.prepareStatement("select result_version,result_status,executions from executor.executions where id=?")) {
            statement.setObject(1, id);
            try (var result = statement.executeQuery()) {
                if (!result.next()) {
                    respond(exchange, 404, "Unknown", "text/plain; charset=utf-8");
                } else {
                    String body = "{\"operationId\":\"" + id + "\",\"version\":" + result.getLong(1)
                            + ",\"status\":\"" + result.getString(2) + "\",\"executions\":" + result.getInt(3) + "}";
                    respond(exchange, 200, body, "application/json; charset=utf-8");
                }
            }
        } catch (SQLException exception) {
            respond(exchange, 503, "Storage temporarily unavailable", "text/plain; charset=utf-8");
        }
    }

    private static int delayMs(String query) {
        if (query == null || query.isBlank()) throw new IllegalArgumentException("Missing delayMs");
        for (String pair : query.split("&")) {
            String[] fields = pair.split("=", 2);
            if (fields.length == 2 && URLDecoder.decode(fields[0], StandardCharsets.UTF_8).equals("delayMs")) {
                int delay = Integer.parseInt(URLDecoder.decode(fields[1], StandardCharsets.UTF_8));
                if (delay < 1 || delay > 2500) throw new IllegalArgumentException("delayMs out of range");
                return delay;
            }
        }
        throw new IllegalArgumentException("Missing delayMs");
    }

    private static void noContent(HttpExchange exchange) throws java.io.IOException {
        exchange.sendResponseHeaders(204, -1);
        exchange.close();
    }

    private static void respond(HttpExchange exchange, int code, String body, String contentType) {
        try {
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", contentType);
            exchange.sendResponseHeaders(code, bytes.length);
            exchange.getResponseBody().write(bytes);
            exchange.close();
        } catch (java.io.IOException exception) {
            exchange.close();
        }
    }
}
