package ru.secreate.exchange;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;

/** Persists structured change facts in the same transaction as the state they describe. */
final class AuditEvents {
    private static final tools.jackson.databind.json.JsonMapper JSON = tools.jackson.databind.json.JsonMapper.builder().build();

    private AuditEvents() {}

    static Map<String, Object> details(Object... values) {
        if (values.length % 2 != 0) throw new IllegalArgumentException("Audit detail keys and values must be paired");
        var details = new LinkedHashMap<String, Object>();
        for (int i = 0; i < values.length; i += 2) {
            if (!(values[i] instanceof String key) || key.isBlank()) throw new IllegalArgumentException("Audit detail key must be a non-empty string");
            details.put(key, values[i + 1]);
        }
        return details;
    }

    static void record(JdbcTemplate db, UUID taskId, String event, String actor, Map<String, ?> details) {
        try {
            String json = JSON.writeValueAsString(details);
            db.update("insert into exchange_events(task_id,event,actor,details) values (?,?,?,?::jsonb)", taskId, event, actor, json);
        } catch (Exception exception) {
            throw new IllegalStateException("Could not persist audit event details", exception);
        }
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> parse(Object json) {
        if (json == null) return Map.of();
        if (json instanceof Map<?, ?> map) return (Map<String, Object>) map;
        try {
            return JSON.readValue(json.toString(), Map.class);
        } catch (Exception exception) {
            throw new IllegalStateException("Stored audit event details are invalid", exception);
        }
    }
}
