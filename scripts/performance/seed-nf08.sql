BEGIN;

DELETE FROM recovery_commands WHERE task_id IN (SELECT id FROM tasks WHERE request_key LIKE 'nf08-fixture-%');
DELETE FROM reconciliations WHERE task_id IN (SELECT id FROM tasks WHERE request_key LIKE 'nf08-fixture-%');
DELETE FROM assignment_audit WHERE task_id IN (SELECT id FROM tasks WHERE request_key LIKE 'nf08-fixture-%');
DELETE FROM result_conflicts WHERE task_id IN (SELECT id FROM tasks WHERE request_key LIKE 'nf08-fixture-%');
DELETE FROM exchange_events WHERE task_id IN (SELECT id FROM tasks WHERE request_key LIKE 'nf08-fixture-%');
DELETE FROM outbox WHERE task_id IN (SELECT id FROM tasks WHERE request_key LIKE 'nf08-fixture-%');
DELETE FROM executor.executions WHERE id IN (SELECT id FROM tasks WHERE request_key LIKE 'nf08-fixture-%');
DELETE FROM tasks WHERE request_key LIKE 'nf08-fixture-%';

INSERT INTO tasks(id, owner_name, request_key, request_hash, title, status, result_version, created_at, assignee, local_version)
SELECT gen_random_uuid(),
       CASE WHEN n <= 2500 THEN 'alice' ELSE 'bob' END,
       'nf08-fixture-' || lpad(n::text, 5, '0'),
       repeat('0', 64),
       'NF08 fixture item ' || lpad(n::text, 5, '0'),
       CASE WHEN n % 2 = 0 THEN 'SUCCEEDED' ELSE 'FAILED' END,
       1,
       clock_timestamp() - make_interval(secs => n),
       CASE WHEN n <= 2500 THEN 'alice' ELSE 'bob' END,
       0
FROM generate_series(1, 5000) AS n;

INSERT INTO outbox(task_id, state, attempts, next_attempt, attempt_limit, recovery_pending, failure_reason)
SELECT id, 'DONE', 1, now(), 5, false, null
FROM tasks WHERE request_key LIKE 'nf08-fixture-%';

INSERT INTO exchange_events(task_id, event, actor, details, created_at)
SELECT id, 'CREATED', owner_name,
       jsonb_build_object('ownerName', owner_name, 'title', title,
                          'newBusinessStatus', 'PENDING', 'newResultVersion', 0,
                          'newDeliveryState', 'READY'), created_at
FROM tasks WHERE request_key LIKE 'nf08-fixture-%';

INSERT INTO exchange_events(task_id, event, actor, details, created_at)
SELECT id, 'ATTEMPT_1', 'worker',
       jsonb_build_object('oldDeliveryState', 'READY', 'newDeliveryState', 'READY',
                          'attemptsBefore', 0, 'attemptsAfter', 1, 'leaseSeconds', 30), created_at
FROM tasks WHERE request_key LIKE 'nf08-fixture-%';

INSERT INTO exchange_events(task_id, event, actor, details, created_at)
SELECT id, 'RESULT_APPLY', 'executor',
       jsonb_build_object('oldBusinessStatus', 'PENDING', 'newBusinessStatus', status,
                          'oldResultVersion', 0, 'newResultVersion', result_version,
                          'incomingBusinessStatus', status, 'incomingResultVersion', result_version,
                          'resultDecision', 'APPLY', 'oldDeliveryState', 'READY',
                          'newDeliveryState', 'DONE', 'reason', null), created_at
FROM tasks WHERE request_key LIKE 'nf08-fixture-%';

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM exchange_events e
        JOIN tasks t ON t.id = e.task_id
        WHERE t.request_key LIKE 'nf08-fixture-%' AND e.details = '{}'::jsonb
    ) THEN
        RAISE EXCEPTION 'NF08 fixtures must include structured audit details';
    END IF;
END $$;

INSERT INTO executor.executions(id, payload, executions, result_version, result_status, executed_at)
SELECT id, title, 1, result_version, status, created_at
FROM tasks WHERE request_key LIKE 'nf08-fixture-%';

COMMIT;
