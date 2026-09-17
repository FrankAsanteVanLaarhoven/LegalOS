-- Append-only means append-only, including against the tooling.
--
-- The row-level triggers on these tables guard UPDATE and DELETE. TRUNCATE
-- fires statement-level triggers only, so it ran straight past them: the audit
-- log this platform advertises as immutable could be emptied in one statement
-- by anything holding the table.
--
-- That was not theoretical. The first live model execution this system ever
-- recorded was destroyed by its own integration suite, an hour after it was
-- written, because the tests reset state with TRUNCATE against the same
-- database the application uses.
--
-- The protection belongs here rather than in a convention about what nobody
-- should call. Every application, migration, script, test harness and future
-- service inherits it, and none of them can opt out.
--
-- Consequence, stated rather than discovered: test suites that reset by
-- truncating these tables will now fail. That is the point. A test that can
-- empty the audit log is exercising a system that does not have the property
-- the test is there to demonstrate.

CREATE OR REPLACE FUNCTION refuse_truncate() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION
        'relation % is append-only and may not be truncated', TG_TABLE_NAME
        USING HINT = 'Recreate the database instead. Recovery from a lost audit trail is not possible.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_truncate
    BEFORE TRUNCATE ON audit_log
    FOR EACH STATEMENT EXECUTE FUNCTION refuse_truncate();

CREATE TRIGGER ai_executions_no_truncate
    BEFORE TRUNCATE ON ai_executions
    FOR EACH STATEMENT EXECUTE FUNCTION refuse_truncate();

CREATE TRIGGER ai_execution_transitions_no_truncate
    BEFORE TRUNCATE ON ai_execution_transitions
    FOR EACH STATEMENT EXECUTE FUNCTION refuse_truncate();

CREATE TRIGGER ai_execution_completions_no_truncate
    BEFORE TRUNCATE ON ai_execution_completions
    FOR EACH STATEMENT EXECUTE FUNCTION refuse_truncate();

-- Deliberately not guarded: agent_metrics, retrieval_snapshots and
-- prompt_templates. The first is a projection that is rebuilt from the log, and
-- the other two are versioned artefacts an execution references by hash — a
-- replay detects their absence rather than being misled by it. Guarding
-- everything would make the distinction between a record and a derived artefact
-- disappear, and that distinction is what makes the projection safe to drop.
