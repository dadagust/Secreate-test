package ru.secreate.exchange;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import java.security.Principal;
import java.util.*;

@RestController
@RequestMapping("/api/operator/tasks")
class OperatorApi {
    private final JdbcTemplate db;
    private final ReconciliationService reconciliation;
    private final RegistryService registry;
    OperatorApi(JdbcTemplate db, ReconciliationService reconciliation, RegistryService registry) { this.db=db; this.reconciliation=reconciliation; this.registry=registry; }

    @GetMapping("/problems") Map<String,Object> problems(Principal p,@RequestParam(required=false) String status,@RequestParam(defaultValue="0") int page) { return registry.list(p.getName(),true,status,page,true); }

    @PostMapping("/{id}/reconcile") Map<String,Object> observe(Principal p,@PathVariable UUID id) { return reconciliation.observe(p.getName(),id); }
    @PostMapping("/{id}/reconciliations/{snapshot}/apply") Map<String,Object> decide(Principal p,@PathVariable UUID id,@PathVariable UUID snapshot) { return reconciliation.decide(p.getName(),id,snapshot); }
    @PostMapping("/{id}/retry") Map<String,Object> retry(Principal p,@PathVariable UUID id,@RequestHeader("Idempotency-Key") String key) { return reconciliation.retry(p.getName(),id,key); }

    @GetMapping("/{id}")
    Map<String,Object> details(Principal principal, @PathVariable UUID id) {
        var rows=db.queryForList("select t.id,t.owner_name,t.title,t.assignee,t.local_version,t.status as business_status,t.result_version,o.state as delivery_state,o.attempts,o.next_attempt,o.lease_until,o.recovery_pending,o.failure_reason from tasks t join outbox o on o.task_id=t.id join operator_scope s on s.owner_name=t.owner_name where t.id=? and s.operator_name=?",id,principal.getName());
        if(rows.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        var result=new LinkedHashMap<String,Object>(rows.getFirst());
        var history=new ArrayList<Map<String,Object>>();
        for(var row:db.queryForList("select id,task_id,event,actor,created_at,details::text as details from exchange_events where task_id=? order by id",id)) {
            var event=new LinkedHashMap<String,Object>(row);
            event.put("details",AuditEvents.parse(event.get("details")));
            history.add(event);
        }
        result.put("history",history);
        result.put("conflicts",db.queryForList("select * from result_conflicts where task_id=? order by id",id));
        result.put("reconciliations",db.queryForList("select * from reconciliations where task_id=? order by observed_at,id",id));
        result.put("assignmentHistory",db.queryForList("select * from assignment_audit where task_id=? order by id",id));
        return result;
    }
}
