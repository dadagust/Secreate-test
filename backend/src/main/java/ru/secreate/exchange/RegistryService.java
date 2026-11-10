package ru.secreate.exchange;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import java.util.*;

@Service
class RegistryService {
    private final JdbcTemplate db;
    RegistryService(JdbcTemplate db) { this.db=db; }
    Map<String,Object> list(String actor,boolean operator,String status,int page,boolean problems) {
        if(page<0 || page>100000 || (status!=null && !Set.of("PENDING","SUCCEEDED","FAILED").contains(status)))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Недопустимый фильтр или страница");
        String scope=operator ? "exists (select 1 from operator_scope s where s.operator_name=? and s.owner_name=t.owner_name)" : "t.owner_name=?";
        String filter=status==null?"":" and t.status=?";
        String problem=problems?" and (o.state in ('FAILED','REVIEW') or o.failure_reason is not null or (o.state='READY' and exists(select 1 from exchange_events e where e.task_id=t.id and e.event='AMBIGUOUS_RETRY')) or exists(select 1 from result_conflicts c where c.task_id=t.id) or exists(select 1 from reconciliations r where r.id=(select r2.id from reconciliations r2 where r2.task_id=t.id order by r2.observed_at desc,r2.id desc limit 1) and r.outcome in ('DIFFERENT','INVALID','UNAVAILABLE','ABSENT') and r.decision is null))":"";
        var args=new ArrayList<Object>(); args.add(actor); if(status!=null) args.add(status); args.add(page*20);
        var rows=db.queryForList("select t.id,t.title,t.owner_name,t.assignee,t.local_version,t.status as business_status,t.result_version,t.created_at,o.state as delivery_state,o.attempts,o.failure_reason from tasks t join outbox o on o.task_id=t.id where "+scope+filter+problem+" order by t.created_at desc,t.id desc limit 21 offset ?",args.toArray());
        boolean more=rows.size()>20; return Map.of("items",more?rows.subList(0,20):rows,"page",page,"hasNext",more);
    }
    @Transactional
    Map<String,Object> assign(String actor,UUID id,String assignee,Long version) {
        if(assignee==null || !Set.of("alice","bob","operator").contains(assignee) || version==null || version<0)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Укажите допустимого ответственного и версию");
        var rows=db.queryForList("select t.assignee,t.local_version from tasks t join operator_scope s on s.owner_name=t.owner_name where t.id=? and s.operator_name=? for update of t",id,actor);
        if(rows.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Задание недоступно");
        var row=rows.getFirst(); long current=((Number)row.get("local_version")).longValue();
        if(current!=version) throw new ResponseStatusException(HttpStatus.CONFLICT,"Данные изменились. Обновите карточку.");
        db.update("update tasks set assignee=?,local_version=local_version+1 where id=?",assignee,id);
        db.update("insert into assignment_audit(task_id,actor,old_assignee,new_assignee,old_version,new_version) values (?,?,?,?,?,?)",id,actor,row.get("assignee"),assignee,current,current+1);
        return Map.of("id",id,"assignee",assignee,"version",current+1);
    }
}
