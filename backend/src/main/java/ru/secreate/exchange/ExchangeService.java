package ru.secreate.exchange;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;

@Service
public class ExchangeService {
    private static final System.Logger LOG = System.getLogger(ExchangeService.class.getName());
    private final JdbcTemplate db;
    public ExchangeService(JdbcTemplate db) { this.db = db; }
    public record Task(UUID id, String title, String status, long version) {}
    public record Lease(UUID id, UUID token, String title, int attempts) {}

    @Transactional
    public Task create(String owner, String key, String title) {
        if (key == null || key.isBlank() || key.length() > 200 || title == null || title.isBlank() || title.length() > 200)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid key or title");
        String hash = hash(title);
        UUID id = UUID.randomUUID();
        int inserted = db.update("insert into tasks(id,owner_name,request_key,request_hash,title) values (?,?,?,?,?) on conflict(owner_name,request_key) do nothing", id, owner, key, hash, title);
        var row = db.queryForMap("select * from tasks where owner_name=? and request_key=?", owner, key);
        if (!hash.equals(row.get("request_hash"))) throw new ResponseStatusException(HttpStatus.CONFLICT, "Key reused with different content");
        id = (UUID) row.get("id");
        if (inserted == 1) {
            db.update("insert into outbox(task_id) values (?)", id);
            event(id, "CREATED", owner, AuditEvents.details(
                    "newBusinessStatus", "PENDING", "newResultVersion", 0,
                    "newDeliveryState", "READY"));
        }
        return get(owner, id);
    }
    public Task get(String owner, UUID id) {
        var rows = db.query("select * from tasks where id=? and owner_name=?", (rs,n) -> new Task(id, rs.getString("title"),rs.getString("status"),rs.getLong("result_version")), id, owner);
        if (rows.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        return rows.getFirst();
    }
    @Transactional
    public Lease claim() {
        var expired = db.queryForList("update outbox set state='FAILED',lease_token=null,lease_until=null,recovery_pending=false,failure_reason='LAST_LEASE_EXPIRED' where state='READY' and attempts>=attempt_limit and lease_until<now() returning task_id,attempts");
        for (var row : expired) event((UUID)row.get("task_id"), "LAST_LEASE_EXPIRED", "worker", AuditEvents.details(
                "oldDeliveryState", "READY", "newDeliveryState", "FAILED",
                "attempts", row.get("attempts"), "reason", "LAST_LEASE_EXPIRED"));
        var rows = db.queryForList("select o.*,t.title from outbox o join tasks t on t.id=o.task_id where o.state='READY' and o.attempts<o.attempt_limit and o.next_attempt<=now() and (o.lease_until is null or o.lease_until<now()) order by o.next_attempt for update of o skip locked limit 1");
        if (rows.isEmpty()) return null;
        var r = rows.getFirst(); UUID id=(UUID)r.get("task_id"), token=UUID.randomUUID();
        int attemptsBefore=((Number)r.get("attempts")).intValue();
        int attempts=attemptsBefore+1;
        db.update("update outbox set attempts=?,lease_token=?,lease_until=now()+interval '30 seconds' where task_id=?",attempts,token,id);
        event(id,"ATTEMPT_"+attempts,"worker",AuditEvents.details(
                "oldDeliveryState", "READY", "newDeliveryState", "READY",
                "attemptsBefore", attemptsBefore, "attemptsAfter", attempts,
                "leaseSeconds", 30));
        LOG.log(System.Logger.Level.INFO,"exchange operationId={0} attempt={1} outcome=CLAIMED",id,attempts);
        return new Lease(id,token,(String)r.get("title"),attempts);
    }
    @Transactional
    public boolean complete(Lease lease, long version, String status) {
        if (lease == null || version < 1 || !Set.of("SUCCEEDED", "FAILED").contains(status == null ? "" : status))
            throw new IllegalArgumentException("Invalid external result");
        var locked = db.queryForList("select * from outbox where task_id=? and state='READY' and lease_token=? for update", lease.id(), lease.token());
        if (locked.isEmpty()) {
            LOG.log(System.Logger.Level.INFO,"exchange operationId={0} attempt={1} outcome=STALE_LEASE_IGNORED",lease.id(),lease.attempts());
            return false;
        }
        if (!Boolean.TRUE.equals(db.queryForObject("select lease_until>clock_timestamp() from outbox where task_id=?", Boolean.class, lease.id()))) {
            LOG.log(System.Logger.Level.INFO,"exchange operationId={0} attempt={1} outcome=EXPIRED_LEASE_IGNORED",lease.id(),lease.attempts());
            return false;
        }
        var row = db.queryForMap("select * from tasks where id=? for update", lease.id());
        long current = ((Number)row.get("result_version")).longValue();
        String previous = (String)row.get("status");
        var decision = ResultDecision.decide(current, previous, version, status);
        String newDeliveryState = decision == ResultDecision.CONFLICT ? "REVIEW" : "DONE";
        String reason = decision == ResultDecision.CONFLICT ? "SAME_VERSION_DIFFERENT_RESULT" : null;
        var updated = db.queryForList("update outbox set state=?,lease_token=null,lease_until=null,recovery_pending=false,failure_reason=? where task_id=? and state='READY' and lease_token=? and lease_until>clock_timestamp() returning state", newDeliveryState, reason, lease.id(), lease.token());
        if (updated.isEmpty()) {
            LOG.log(System.Logger.Level.INFO,"exchange operationId={0} attempt={1} outcome=EXPIRED_LEASE_IGNORED",lease.id(),lease.attempts());
            return false;
        }
        if (decision == ResultDecision.APPLY) db.update("update tasks set result_version=?,status=? where id=?",version,status,lease.id());
        if (decision == ResultDecision.CONFLICT) {
            db.update("insert into result_conflicts(task_id,attempt,current_version,incoming_version,current_status,incoming_status,reason) values (?,?,?,?,?,?,?)", lease.id(), locked.getFirst().get("attempts"), current, version, previous, status, "SAME_VERSION_DIFFERENT_RESULT");
        }
        event(lease.id(), "RESULT_" + decision, "executor", AuditEvents.details(
                "oldBusinessStatus", previous,
                "newBusinessStatus", decision == ResultDecision.APPLY ? status : previous,
                "oldResultVersion", current,
                "newResultVersion", decision == ResultDecision.APPLY ? version : current,
                "incomingBusinessStatus", status,
                "incomingResultVersion", version,
                "resultDecision", decision.name(),
                "oldDeliveryState", locked.getFirst().get("state"),
                "newDeliveryState", newDeliveryState,
                "reason", reason));
        LOG.log(System.Logger.Level.INFO,"exchange operationId={0} attempt={1} outcome=RESULT_{2}",lease.id(),lease.attempts(),decision);
        return true;
    }
    @Transactional
    public boolean rejectContradictoryBatch(Lease lease,long version,String firstStatus,String secondStatus) {
        var locked=db.queryForList("select state,attempts from outbox where task_id=? and state='READY' and lease_token=? for update",lease.id(),lease.token());
        if(locked.isEmpty() || !Boolean.TRUE.equals(db.queryForObject("select lease_until>clock_timestamp() from outbox where task_id=?",Boolean.class,lease.id()))) {
            LOG.log(System.Logger.Level.INFO,"exchange operationId={0} attempt={1} outcome=STALE_LEASE_IGNORED",lease.id(),lease.attempts());
            return false;
        }
        var task=db.queryForMap("select status,result_version from tasks where id=? for update",lease.id());
        String reason="CONTRADICTORY_RESULT_BATCH";
        int changed=db.update("update outbox set state='REVIEW',lease_token=null,lease_until=null,recovery_pending=false,failure_reason=? where task_id=? and state='READY' and lease_token=? and lease_until>clock_timestamp()",reason,lease.id(),lease.token());
        if(changed==0) return false;
        db.update("insert into result_conflicts(task_id,attempt,current_version,incoming_version,current_status,incoming_status,reason) values (?,?,?,?,?,?,?)",
                lease.id(),locked.getFirst().get("attempts"),task.get("result_version"),version,task.get("status"),firstStatus+"/"+secondStatus,reason);
        event(lease.id(),"RESULT_CONFLICT_REQUIRES_REVIEW","executor",AuditEvents.details(
                "oldBusinessStatus", task.get("status"), "newBusinessStatus", task.get("status"),
                "oldResultVersion", task.get("result_version"), "newResultVersion", task.get("result_version"),
                "incomingBusinessStatus", firstStatus + "/" + secondStatus, "incomingResultVersion", version,
                "resultDecision", "CONFLICT", "oldDeliveryState", locked.getFirst().get("state"),
                "newDeliveryState", "REVIEW", "reason", reason,
                "attempt", locked.getFirst().get("attempts")));
        LOG.log(System.Logger.Level.WARNING,"exchange operationId={0} attempt={1} outcome={2}",lease.id(),lease.attempts(),reason);
        return true;
    }
    @Transactional
    public void finish(Lease lease, boolean success) {
        db.queryForList("select task_id from outbox where task_id=? for update",lease.id());
        var updated = db.queryForList("update outbox set state=case when ? then 'DONE' when attempts>=attempt_limit then 'FAILED' else 'READY' end,lease_until=null,lease_token=null,recovery_pending=false,next_attempt=clock_timestamp()+(? * interval '1 second') where task_id=? and state='READY' and lease_token=? and lease_until>clock_timestamp() returning state,attempts,attempt_limit",
                success, Math.min(60,1<<Math.min(lease.attempts(),6)),lease.id(),lease.token());
        if (!updated.isEmpty()) {
            var row = updated.getFirst();
            event(lease.id(),success?"DELIVERED":"AMBIGUOUS_RETRY","worker",AuditEvents.details(
                    "oldDeliveryState", "READY", "newDeliveryState", row.get("state"),
                    "attempts", row.get("attempts"), "attemptLimit", row.get("attempt_limit"),
                    "reason", success ? null : "TEMPORARY_DELIVERY_FAILURE"));
            LOG.log(System.Logger.Level.INFO,"exchange operationId={0} attempt={1} outcome={2}",lease.id(),lease.attempts(),success?"DELIVERED":"AMBIGUOUS_RETRY");
        } else LOG.log(System.Logger.Level.INFO,"exchange operationId={0} attempt={1} outcome=STALE_LEASE_IGNORED",lease.id(),lease.attempts());
    }
    @Transactional
    public void reject(Lease lease) {
        db.queryForList("select task_id from outbox where task_id=? for update",lease.id());
        var updated=db.queryForList("update outbox set state='REVIEW',lease_until=null,lease_token=null,recovery_pending=false,failure_reason='INVALID_RESULT' where task_id=? and state='READY' and lease_token=? and lease_until>clock_timestamp() returning attempts",lease.id(),lease.token());
        if(!updated.isEmpty()) {
            event(lease.id(),"INVALID_RESULT_REQUIRES_REVIEW","worker",AuditEvents.details(
                    "oldDeliveryState", "READY", "newDeliveryState", "REVIEW",
                    "attempt", updated.getFirst().get("attempts"), "reason", "INVALID_RESULT"));
            LOG.log(System.Logger.Level.WARNING,"exchange operationId={0} attempt={1} outcome=INVALID_RESULT_REQUIRES_REVIEW",lease.id(),lease.attempts());
        }
    }
    private void event(UUID id,String event,String actor,Map<String,?> details) { AuditEvents.record(db,id,event,actor,details); }
    public static String hash(String text) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8))); }
        catch (java.security.NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }
}
