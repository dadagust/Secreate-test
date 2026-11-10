alter table reconciliations add column invalid_reason text;
alter table reconciliations add column invalid_response text;
alter table outbox add column recovery_pending boolean not null default false;
-- Existing manual recoveries which have not yet been claimed remain scheduled.
update outbox o set recovery_pending=true
where o.state='READY' and o.lease_token is null
  and exists (select 1 from exchange_events e where e.task_id=o.task_id and e.event='MANUAL_RECOVERY'
    and e.id=(select max(e2.id) from exchange_events e2 where e2.task_id=o.task_id));
