-- Execution lifecycle, without giving up immutability.
--
-- The record has to be created before the provider is called, so that a call
-- which times out, is refused by guardrails, or crashes is still recorded — a
-- log that only contains successes is the one that cannot answer questions
-- after an incident. But the outcome is not known until afterwards, and
-- ai_executions is append-only by trigger.
--
-- Rather than weaken that trigger, the lifecycle and the outcome each get their
-- own append-only table. The execution row stays exactly what it was: an
-- immutable statement of what was requested and with what inputs. State is
-- derived from transitions, and the result is a separate immutable row. Nothing
-- is ever edited, so nothing has to be trusted not to have been.

-- Fields that are genuinely unknown when the request record is written. They
-- were NOT NULL in 0005, which assumed a record could only be created after the
-- fact — the assumption this migration exists to undo.
ALTER TABLE ai_executions ALTER COLUMN verification_verdict DROP NOT NULL;
ALTER TABLE ai_executions ALTER COLUMN released DROP NOT NULL;
ALTER TABLE ai_executions ALTER COLUMN response_hash DROP NOT NULL;

CREATE TABLE ai_execution_transitions (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    execution_id  uuid NOT NULL REFERENCES ai_executions(id) ON DELETE RESTRICT,
    -- NULL for the first transition, which has nothing to come from.
    from_state    text,
    to_state      text NOT NULL CHECK (to_state IN (
                      'created', 'retrieving', 'verified', 'executing',
                      'guardrails', 'completed',
                      'failed', 'cancelled', 'timed_out', 'blocked')),
    -- Why, in words, for the states where "it stopped" is not an explanation.
    detail        text,
    at            timestamptz NOT NULL DEFAULT now(),
    UNIQUE (execution_id, to_state)
);

CREATE INDEX ai_execution_transitions_execution_idx
    ON ai_execution_transitions(execution_id, id);

-- The outcome. One row per execution, written once, whatever the outcome was.
CREATE TABLE ai_execution_completions (
    execution_id         uuid PRIMARY KEY REFERENCES ai_executions(id) ON DELETE RESTRICT,
    terminal_state       text NOT NULL CHECK (terminal_state IN (
                             'completed', 'failed', 'cancelled', 'timed_out', 'blocked')),
    -- NULL when nothing was returned, which is a real and common outcome.
    response_hash        char(64),
    verification_verdict text CHECK (verification_verdict IN ('pass', 'flag', 'block')),
    released             boolean NOT NULL DEFAULT false,

    -- Operational measurements. Here rather than in the request record because
    -- they are outcomes, and because keeping them apart means adding one later
    -- never touches a row anyone has already relied on.
    latency_ms           integer,
    input_tokens         integer,
    output_tokens        integer,
    estimated_cost_pence integer,
    retries              integer NOT NULL DEFAULT 0,
    provider_endpoint    text,
    finish_reason        text,
    provider_metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,

    error_code           text,
    error_detail         text,
    at                   timestamptz NOT NULL DEFAULT now(),

    -- Nothing is released without having passed. Same rule as ai_outputs and
    -- ai_executions, restated here because this is now where it is decided.
    CONSTRAINT completion_released_passed CHECK (
        released = false OR verification_verdict = 'pass'
    ),
    -- A completed execution returned something; anything else did not complete.
    CONSTRAINT completed_has_a_response CHECK (
        terminal_state <> 'completed' OR response_hash IS NOT NULL
    )
);

CREATE OR REPLACE FUNCTION execution_records_are_immutable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'execution records are append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ai_execution_transitions_no_change
    BEFORE UPDATE OR DELETE ON ai_execution_transitions
    FOR EACH ROW EXECUTE FUNCTION execution_records_are_immutable();

CREATE TRIGGER ai_execution_completions_no_change
    BEFORE UPDATE OR DELETE ON ai_execution_completions
    FOR EACH ROW EXECUTE FUNCTION execution_records_are_immutable();
