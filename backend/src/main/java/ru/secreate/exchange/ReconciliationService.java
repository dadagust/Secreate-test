package ru.secreate.exchange;

import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.HttpServerErrorException;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.transaction.PlatformTransactionManager;

@Service
class ReconciliationService {
    private final JdbcTemplate db;
    private final RestClient client;
    private final TransactionTemplate transactions;
    private final tools.jackson.databind.json.JsonMapper json=tools.jackson.databind.json.JsonMapper.builder(
            tools.jackson.core.json.JsonFactory.builder().enable(tools.jackson.core.StreamReadFeature.STRICT_DUPLICATE_DETECTION).build()).build();
    ReconciliationService(JdbcTemplate db, PlatformTransactionManager manager, @Value("${exchange.executor:http://localhost:9090}") String endpoint) {
        this.db=db;
        this.transactions=new TransactionTemplate(manager);
        var factory=new org.springframework.http.client.SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(2000); factory.setReadTimeout(3000);
        this.client=RestClient.builder().baseUrl(endpoint).requestFactory(factory).build();
    }
    record Remote(String state, String status, Long version, Integer executions, String reason, byte[] raw) {}
    private Remote invalid(String reason, byte[] raw) { return new Remote("INVALID",null,null,null,reason,raw); }
    private long integer(Object value) {
        if (!(value instanceof Byte || value instanceof Short || value instanceof Integer || value instanceof Long || value instanceof java.math.BigInteger)) throw new IllegalArgumentException("not an integer");
        return new java.math.BigInteger(value.toString()).longValueExact();
    }
    private Remote external(UUID id) {
        try {
            byte[] raw=client.get().uri("/operations/{id}",id).retrieve().body(byte[].class);
            Map<?,?> m;
            try { m=json.readValue(raw,Map.class); } catch(RuntimeException e) { return invalid("MALFORMED_JSON",raw); }
            if(m==null || !id.toString().equals(m.get("operationId"))) return invalid("OPERATION_ID_MISMATCH",raw);
            long version, executions;
            try { version=integer(m.get("version")); executions=integer(m.get("executions")); }
            catch(ArithmeticException | IllegalArgumentException e) { return invalid("NON_INTEGER_OR_OUT_OF_RANGE",raw); }
            if(version<1) return invalid("INVALID_VERSION",raw);
            if(executions!=1) return invalid("INVALID_EXECUTIONS",raw);
            if(!(m.get("status") instanceof String resultStatus) || !Set.of("SUCCEEDED","FAILED").contains(resultStatus)) return invalid("INVALID_STATUS",raw);
            return new Remote("FOUND",resultStatus,version,1,null,null);
        } catch(HttpClientErrorException.NotFound e) { return new Remote("ABSENT",null,null,null,null,null); }
          catch(HttpServerErrorException | ResourceAccessException e) { return new Remote("UNAVAILABLE",null,null,null,null,null); }
          catch(HttpClientErrorException e) { return invalid("HTTP_"+e.getStatusCode().value(),e.getResponseBodyAsByteArray()); }
          catch(RestClientException | IllegalArgumentException e) { return invalid("INVALID_RESPONSE",null); }
    }
    private Map<String,Object> scoped(String actor,UUID id,boolean lock) {
        var rows=db.queryForList("select t.status,t.result_version,o.state,o.attempts,o.lease_until,o.lease_token,o.next_attempt,o.attempt_limit,o.failure_reason,o.recovery_pending from tasks t join outbox o on o.task_id=t.id join operator_scope s on s.owner_name=t.owner_name where t.id=? and s.operator_name=?"+(lock?" for update of o,t":""),id,actor);
        if(rows.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        return rows.getFirst();
    }
    private void event(UUID id,String actor,String event,Map<String,?> details) { AuditEvents.record(db,id,event,actor,details); }
    public Map<String,Object> observe(String actor,UUID id) {
        var before=scoped(actor,id,false); var remote=external(id);
        return transactions.execute(transaction -> {
        var row=scoped(actor,id,true);
        if(!row.equals(before)) throw new ResponseStatusException(HttpStatus.CONFLICT,"Local state changed; reconcile again");
        long local=((Number)row.get("result_version")).longValue();
        String outcome=switch(remote.state()) {
            case "ABSENT" -> "ABSENT"; case "UNAVAILABLE" -> "UNAVAILABLE"; case "INVALID" -> "INVALID";
            default -> local==remote.version() && Objects.equals(row.get("status"),remote.status()) ? "MATCH" : "DIFFERENT";
        };
        UUID snapshot=UUID.randomUUID();
        byte[] raw=remote.raw();
        String legacyText=raw==null ? null : new String(raw,java.nio.charset.StandardCharsets.UTF_8);
        if(legacyText!=null && legacyText.indexOf('\0')>=0) legacyText=null;
        db.update("insert into reconciliations(id,task_id,actor,local_status,local_version,delivery_state,attempts,external_state,external_status,external_version,external_executions,outcome,invalid_reason,invalid_response,invalid_response_bytes) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                snapshot,id,actor,row.get("status"),local,row.get("state"),row.get("attempts"),remote.state(),remote.status(),remote.version(),remote.executions(),outcome,remote.reason(),legacyText,raw);
        event(id,actor,"RECONCILIATION_"+outcome,AuditEvents.details(
                "reconciliationId", snapshot.toString(), "outcome", outcome,
                "localBusinessStatus", row.get("status"), "localResultVersion", local,
                "localDeliveryState", row.get("state"), "localAttempts", row.get("attempts"),
                "externalState", remote.state(), "externalBusinessStatus", remote.status(),
                "externalResultVersion", remote.version(), "externalExecutions", remote.executions(),
                "reason", remote.reason()));
        return db.queryForMap("select * from reconciliations where id=?",snapshot);
        });
    }
    public Map<String,Object> decide(String actor,UUID id,UUID snapshot) {
        var before=scoped(actor,id,false);
        var remote=external(id);
        return transactions.execute(transaction -> {
        var local=scoped(actor,id,true);
        if(!before.equals(local)) throw new ResponseStatusException(HttpStatus.CONFLICT,"Local state changed; reconcile again");
        var entries=db.queryForList("select * from reconciliations where id=? and task_id=? for update",snapshot,id);
        if(entries.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        var s=entries.getFirst();
        if(s.get("decision")!=null || !"FOUND".equals(s.get("external_state"))) throw new ResponseStatusException(HttpStatus.CONFLICT,"New reconciliation required");
        if(local.get("lease_until")!=null && Boolean.TRUE.equals(db.queryForObject("select lease_until>clock_timestamp() from outbox where task_id=?",Boolean.class,id)))
            throw new ResponseStatusException(HttpStatus.CONFLICT,"Active lease; reconcile again");
        if(!Objects.equals(s.get("local_status"),local.get("status")) || !Objects.equals(s.get("local_version"),local.get("result_version"))
           || !Objects.equals(s.get("delivery_state"),local.get("state")) || !Objects.equals(s.get("attempts"),local.get("attempts"))
           || !"FOUND".equals(remote.state()) || !Objects.equals(s.get("external_status"),remote.status())
           || !Objects.equals(s.get("external_version"),remote.version()) || !Objects.equals(s.get("external_executions"),remote.executions()))
            throw new ResponseStatusException(HttpStatus.CONFLICT,"Snapshots changed; reconcile again");
        var decision=ResultDecision.decide(((Number)local.get("result_version")).longValue(),(String)local.get("status"),remote.version(),remote.status());
        if(decision==ResultDecision.CONFLICT || decision==ResultDecision.STALE)
            throw new ResponseStatusException(HttpStatus.CONFLICT,"External version cannot be applied");
        String oldBusinessStatus=(String)local.get("status");
        long oldResultVersion=((Number)local.get("result_version")).longValue();
        if(decision==ResultDecision.APPLY) db.update("update tasks set status=?,result_version=? where id=?",remote.status(),remote.version(),id);
        db.update("update outbox set state='DONE',lease_token=null,lease_until=null,recovery_pending=false,failure_reason=null where task_id=?",id);
        db.update("update reconciliations set decision=?,decided_at=now(),decided_by=? where id=?",decision.name(),actor,snapshot);
        event(id,actor,"RECONCILIATION_DECISION_"+decision.name(),AuditEvents.details(
                "reconciliationId", snapshot.toString(), "resultDecision", decision.name(),
                "oldBusinessStatus", oldBusinessStatus,
                "newBusinessStatus", decision==ResultDecision.APPLY ? remote.status() : oldBusinessStatus,
                "oldResultVersion", oldResultVersion,
                "newResultVersion", decision==ResultDecision.APPLY ? remote.version() : oldResultVersion,
                "incomingBusinessStatus", remote.status(), "incomingResultVersion", remote.version(),
                "oldDeliveryState", local.get("state"), "newDeliveryState", "DONE"));
        return db.queryForMap("select * from reconciliations where id=?",snapshot);
        });
    }
    @Transactional
    public Map<String,Object> retry(String actor,UUID id,String key) {
        if(key==null || key.isBlank() || key.length()>200) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Idempotency-Key required");
        var row=scoped(actor,id,true);
        var existing=db.queryForList("select task_id from recovery_commands where actor=? and command_key=?",actor,key);
        if(!existing.isEmpty()) {
            if(!id.equals(existing.getFirst().get("task_id"))) throw new ResponseStatusException(HttpStatus.CONFLICT,"Key reused");
            return Map.of("operationId",id,"scheduled",true);
        }
        if(Boolean.TRUE.equals(row.get("recovery_pending"))) throw new ResponseStatusException(HttpStatus.CONFLICT,"Recovery already scheduled");
        if(((Number)row.get("result_version")).longValue()>0 || !Set.of("READY","FAILED","REVIEW").contains(row.get("state")))
            throw new ResponseStatusException(HttpStatus.CONFLICT,"Recovery not permitted");
        if(row.get("lease_until")!=null && Boolean.TRUE.equals(db.queryForObject("select lease_until>clock_timestamp() from outbox where task_id=?",Boolean.class,id)))
            throw new ResponseStatusException(HttpStatus.CONFLICT,"Active lease");
        int inserted=db.update("insert into recovery_commands(actor,command_key,task_id) values (?,?,?) on conflict do nothing",actor,key,id);
        if(inserted==0) {
            UUID prior=db.queryForObject("select task_id from recovery_commands where actor=? and command_key=?",UUID.class,actor,key);
            if(!id.equals(prior)) throw new ResponseStatusException(HttpStatus.CONFLICT,"Key reused");
            return Map.of("operationId",id,"scheduled",true);
        }
        db.update("update outbox set state='READY',next_attempt=now(),lease_token=null,lease_until=null,recovery_pending=true,failure_reason=null,attempt_limit=attempts+5 where task_id=?",id);
        event(id,actor,"MANUAL_RECOVERY",AuditEvents.details(
                "oldDeliveryState", row.get("state"), "newDeliveryState", "READY",
                "businessStatus", row.get("status"), "resultVersion", row.get("result_version"),
                "attempts", row.get("attempts"), "attemptLimitBefore", row.get("attempt_limit"),
                "attemptLimitAfter", ((Number)row.get("attempts")).intValue()+5,
                "reason", row.get("failure_reason")));
        return Map.of("operationId",id,"scheduled",true);
    }
}
