-- What actually answered, as distinct from what was asked for.
--
-- A gateway resolves an alias to a concrete model, and that resolution can
-- change without the alias changing. An execution recording only the requested
-- id would describe a request rather than an answer, and a replay months later
-- would cite a model that may not be the one that ran.
--
-- These live on the completion row rather than the execution row because they
-- are outcomes: the request record is written before the provider is called, so
-- the resolved model is not known when it is created. Putting them there would
-- have meant either updating an append-only row or writing a value before it
-- was true.

ALTER TABLE ai_execution_completions
    -- The upstream vendor the gateway routed to, where it reports one.
    ADD COLUMN resolved_provider text,
    -- The concrete model that answered, which may differ from the requested id.
    ADD COLUMN resolved_model text,
    -- The gateway's own identifier for this call, so a support conversation has
    -- something to refer to that both sides can see.
    ADD COLUMN provider_response_id text,
    ADD COLUMN provider_api_version text;

COMMENT ON COLUMN ai_execution_completions.resolved_model IS
    'The model that actually answered. ai_executions.model records what was '
    'requested; an alias resolving differently later is then visible rather '
    'than silent.';
