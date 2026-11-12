-- V7 recorded event identity but not transition payloads. Reconstruct only from
-- immutable task history, snapshots, conflicts, recovery commands and the executor ledger.
DO $$
DECLARE
    task_row record;
    event_row record;
    conflict_row record;
    snapshot_row record;
    recovery_row record;
    business_status text;
    business_version bigint;
    delivery_state text;
    attempts integer;
    attempt_limit integer;
    failure_reason text;
    event_attempt integer;
    next_business_status text;
    next_business_version bigint;
    incoming_status text;
    incoming_version bigint;
    decision text;
    audit_details jsonb;
BEGIN
    FOR task_row IN SELECT id, owner_name, title, status, result_version FROM tasks LOOP
        business_status := 'PENDING';
        business_version := 0;
        delivery_state := 'READY';
        attempts := 0;
        attempt_limit := 5;
        failure_reason := NULL;

        FOR event_row IN
            SELECT id, event, actor, created_at
            FROM exchange_events
            WHERE task_id = task_row.id
            ORDER BY id
        LOOP
            audit_details := NULL;
            incoming_status := NULL;
            incoming_version := NULL;

            IF event_row.event = 'CREATED' THEN
                audit_details := jsonb_build_object(
                    'ownerName', task_row.owner_name,
                    'title', task_row.title,
                    'newBusinessStatus', 'PENDING',
                    'newResultVersion', 0,
                    'newDeliveryState', 'READY'
                );
                business_status := 'PENDING';
                business_version := 0;
                delivery_state := 'READY';
                attempts := 0;
                attempt_limit := 5;
                failure_reason := NULL;
            ELSIF event_row.event ~ '^ATTEMPT_[0-9]+$' THEN
                event_attempt := substring(event_row.event from '^ATTEMPT_([0-9]+)$')::integer;
                audit_details := jsonb_build_object(
                    'oldDeliveryState', delivery_state,
                    'newDeliveryState', 'READY',
                    'attemptsBefore', event_attempt - 1,
                    'attemptsAfter', event_attempt
                );
                attempts := event_attempt;
                delivery_state := 'READY';
                failure_reason := NULL;
            ELSIF event_row.event = 'AMBIGUOUS_RETRY' THEN
                delivery_state := CASE WHEN attempts >= attempt_limit THEN 'FAILED' ELSE 'READY' END;
                failure_reason := 'TEMPORARY_DELIVERY_FAILURE';
                audit_details := jsonb_build_object(
                    'oldDeliveryState', 'READY',
                    'newDeliveryState', delivery_state,
                    'attempts', attempts,
                    'attemptLimit', attempt_limit,
                    'reason', failure_reason
                );
            ELSIF event_row.event = 'LAST_LEASE_EXPIRED' THEN
                audit_details := jsonb_build_object(
                    'oldDeliveryState', delivery_state,
                    'newDeliveryState', 'FAILED',
                    'attempts', attempts,
                    'attemptLimit', attempt_limit,
                    'reason', 'LAST_LEASE_EXPIRED'
                );
                delivery_state := 'FAILED';
                failure_reason := 'LAST_LEASE_EXPIRED';
            ELSIF event_row.event = 'INVALID_RESULT_REQUIRES_REVIEW' THEN
                audit_details := jsonb_build_object(
                    'oldDeliveryState', delivery_state,
                    'newDeliveryState', 'REVIEW',
                    'attempt', attempts,
                    'reason', 'INVALID_RESULT'
                );
                delivery_state := 'REVIEW';
                failure_reason := 'INVALID_RESULT';
            ELSIF event_row.event = 'DELIVERED' THEN
                audit_details := jsonb_build_object(
                    'oldDeliveryState', delivery_state,
                    'newDeliveryState', 'DONE',
                    'attempts', attempts
                );
                delivery_state := 'DONE';
                failure_reason := NULL;
            ELSIF event_row.event = 'RESULT_APPLY' THEN
                IF to_regclass('executor.executions') IS NOT NULL THEN
                    EXECUTE 'SELECT result_status, result_version FROM executor.executions WHERE id = $1'
                        INTO incoming_status, incoming_version USING task_row.id;
                END IF;
                IF incoming_status IS NULL THEN
                    SELECT external_status, external_version INTO incoming_status, incoming_version
                    FROM reconciliations
                    WHERE task_id = task_row.id AND external_state = 'FOUND'
                    ORDER BY observed_at DESC, id DESC
                    LIMIT 1;
                END IF;
                IF incoming_status IS NULL THEN
                    audit_details := jsonb_build_object(
                        'oldBusinessStatus', business_status,
                        'newBusinessStatus', NULL,
                        'oldResultVersion', business_version,
                        'newResultVersion', NULL,
                        'incomingBusinessStatus', NULL,
                        'incomingResultVersion', NULL,
                        'incomingResultAvailable', false,
                        'resultDecision', 'APPLY',
                        'oldDeliveryState', delivery_state,
                        'newDeliveryState', 'DONE',
                        'legacyPayloadAvailable', false,
                        'reason', 'LEGACY_RESULT_PAYLOAD_NOT_RECORDED'
                    );
                    business_status := NULL;
                    business_version := NULL;
                ELSE
                    next_business_status := incoming_status;
                    next_business_version := incoming_version;
                    audit_details := jsonb_build_object(
                        'oldBusinessStatus', business_status,
                        'newBusinessStatus', next_business_status,
                        'oldResultVersion', business_version,
                        'newResultVersion', next_business_version,
                        'incomingBusinessStatus', next_business_status,
                        'incomingResultVersion', next_business_version,
                        'incomingResultAvailable', true,
                        'resultDecision', 'APPLY',
                        'oldDeliveryState', delivery_state,
                        'newDeliveryState', 'DONE',
                        'reason', NULL
                    );
                    business_status := next_business_status;
                    business_version := next_business_version;
                END IF;
                delivery_state := 'DONE';
                failure_reason := NULL;
            ELSIF event_row.event IN ('RESULT_DUPLICATE', 'RESULT_STALE') THEN
                IF to_regclass('executor.executions') IS NOT NULL THEN
                    EXECUTE 'SELECT result_status, result_version FROM executor.executions WHERE id = $1'
                        INTO incoming_status, incoming_version USING task_row.id;
                END IF;
                IF incoming_status IS NULL THEN
                    SELECT external_status, external_version INTO incoming_status, incoming_version
                    FROM reconciliations
                    WHERE task_id = task_row.id AND external_state = 'FOUND'
                    ORDER BY observed_at DESC, id DESC
                    LIMIT 1;
                END IF;
                decision := substring(event_row.event from 'RESULT_(.+)$');
                audit_details := jsonb_build_object(
                    'oldBusinessStatus', business_status,
                    'newBusinessStatus', business_status,
                    'oldResultVersion', business_version,
                    'newResultVersion', business_version,
                    'incomingBusinessStatus', incoming_status,
                    'incomingResultVersion', incoming_version,
                    'incomingResultAvailable', incoming_status IS NOT NULL,
                    'resultDecision', decision,
                    'oldDeliveryState', delivery_state,
                    'newDeliveryState', 'DONE',
                    'legacyPayloadAvailable', incoming_status IS NOT NULL,
                    'reason', CASE WHEN incoming_status IS NULL THEN 'LEGACY_RESULT_PAYLOAD_NOT_RECORDED' ELSE NULL END
                );
                delivery_state := 'DONE';
                failure_reason := NULL;
            ELSIF event_row.event IN ('RESULT_CONFLICT', 'RESULT_CONFLICT_REQUIRES_REVIEW') THEN
                SELECT * INTO conflict_row
                FROM result_conflicts
                WHERE task_id = task_row.id AND attempt = attempts AND created_at = event_row.created_at
                ORDER BY id DESC
                LIMIT 1;
                IF FOUND THEN
                    audit_details := jsonb_build_object(
                        'oldBusinessStatus', conflict_row.current_status,
                        'newBusinessStatus', conflict_row.current_status,
                        'oldResultVersion', conflict_row.current_version,
                        'newResultVersion', conflict_row.current_version,
                        'incomingBusinessStatus', conflict_row.incoming_status,
                        'incomingResultVersion', conflict_row.incoming_version,
                        'resultDecision', 'CONFLICT',
                        'oldDeliveryState', delivery_state,
                        'newDeliveryState', 'REVIEW',
                        'reason', conflict_row.reason,
                        'attempt', conflict_row.attempt
                    );
                    business_status := conflict_row.current_status;
                    business_version := conflict_row.current_version;
                    failure_reason := conflict_row.reason;
                ELSE
                    audit_details := jsonb_build_object(
                        'legacyEvent', event_row.event,
                        'legacyPayloadAvailable', false,
                        'reason', 'LEGACY_CONFLICT_RECORD_NOT_FOUND'
                    );
                    failure_reason := 'LEGACY_CONFLICT_RECORD_NOT_FOUND';
                END IF;
                delivery_state := 'REVIEW';
            ELSIF event_row.event LIKE 'RECONCILIATION_DECISION_%' THEN
                SELECT * INTO snapshot_row
                FROM reconciliations
                WHERE task_id = task_row.id AND decided_by = event_row.actor AND decided_at = event_row.created_at
                ORDER BY id DESC
                LIMIT 1;
                IF FOUND THEN
                    decision := COALESCE(snapshot_row.decision, substring(event_row.event from 'RECONCILIATION_DECISION_(.+)$'));
                    next_business_status := CASE WHEN decision = 'APPLY' THEN snapshot_row.external_status ELSE snapshot_row.local_status END;
                    next_business_version := CASE WHEN decision = 'APPLY' THEN snapshot_row.external_version ELSE snapshot_row.local_version END;
                    audit_details := jsonb_build_object(
                        'snapshotId', snapshot_row.id,
                        'oldBusinessStatus', snapshot_row.local_status,
                        'newBusinessStatus', next_business_status,
                        'oldResultVersion', snapshot_row.local_version,
                        'newResultVersion', next_business_version,
                        'localDeliveryState', snapshot_row.delivery_state,
                        'oldDeliveryState', delivery_state,
                        'newDeliveryState', 'DONE',
                        'externalState', snapshot_row.external_state,
                        'externalBusinessStatus', snapshot_row.external_status,
                        'externalResultVersion', snapshot_row.external_version,
                        'externalExecutions', snapshot_row.external_executions,
                        'reconciliationOutcome', snapshot_row.outcome,
                        'resultDecision', decision,
                        'reason', snapshot_row.invalid_reason
                    );
                    business_status := next_business_status;
                    business_version := next_business_version;
                ELSE
                    audit_details := jsonb_build_object(
                        'legacyEvent', event_row.event,
                        'legacyPayloadAvailable', false,
                        'reason', 'LEGACY_RECONCILIATION_SNAPSHOT_NOT_FOUND'
                    );
                END IF;
                delivery_state := 'DONE';
                failure_reason := NULL;
            ELSIF event_row.event LIKE 'RECONCILIATION_%' THEN
                SELECT * INTO snapshot_row
                FROM reconciliations
                WHERE task_id = task_row.id AND actor = event_row.actor AND observed_at = event_row.created_at
                ORDER BY id DESC
                LIMIT 1;
                IF FOUND THEN
                    audit_details := jsonb_build_object(
                        'snapshotId', snapshot_row.id,
                        'oldBusinessStatus', snapshot_row.local_status,
                        'newBusinessStatus', snapshot_row.local_status,
                        'oldResultVersion', snapshot_row.local_version,
                        'newResultVersion', snapshot_row.local_version,
                        'oldDeliveryState', snapshot_row.delivery_state,
                        'newDeliveryState', snapshot_row.delivery_state,
                        'attempts', snapshot_row.attempts,
                        'externalState', snapshot_row.external_state,
                        'externalBusinessStatus', snapshot_row.external_status,
                        'externalResultVersion', snapshot_row.external_version,
                        'externalExecutions', snapshot_row.external_executions,
                        'reconciliationOutcome', snapshot_row.outcome,
                        'reason', snapshot_row.invalid_reason
                    );
                    business_status := snapshot_row.local_status;
                    business_version := snapshot_row.local_version;
                ELSE
                    audit_details := jsonb_build_object(
                        'legacyEvent', event_row.event,
                        'legacyPayloadAvailable', false,
                        'reason', 'LEGACY_RECONCILIATION_SNAPSHOT_NOT_FOUND'
                    );
                END IF;
            ELSIF event_row.event = 'MANUAL_RECOVERY' THEN
                SELECT * INTO recovery_row
                FROM recovery_commands
                WHERE task_id = task_row.id AND actor = event_row.actor AND created_at = event_row.created_at
                ORDER BY command_key
                LIMIT 1;
                audit_details := jsonb_build_object(
                    'commandRecorded', FOUND,
                    'oldDeliveryState', delivery_state,
                    'newDeliveryState', 'READY',
                    'businessStatus', business_status,
                    'resultVersion', business_version,
                    'attempts', attempts,
                    'attemptLimitBefore', attempt_limit,
                    'attemptLimitAfter', attempts + 5,
                    'reason', failure_reason
                );
                delivery_state := 'READY';
                attempt_limit := attempts + 5;
                failure_reason := NULL;
            ELSE
                audit_details := jsonb_build_object(
                    'legacyEvent', event_row.event,
                    'legacyPayloadAvailable', false,
                    'reason', 'PAYLOAD_NOT_RECORDED_BY_PRE_V8_SCHEMA'
                );
            END IF;

            UPDATE exchange_events SET details = audit_details
            WHERE id = event_row.id AND details = '{}'::jsonb;
        END LOOP;
    END LOOP;
END $$;

ALTER TABLE exchange_events ALTER COLUMN details DROP DEFAULT;
ALTER TABLE exchange_events
    ADD CONSTRAINT exchange_events_details_non_empty CHECK (details <> '{}'::jsonb);
