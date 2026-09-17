-- AI executions: reproducible from immutable artefacts, not merely traceable.
--
-- `ai_outputs` recorded the model, prompt, prompt version, guardrails version,
-- resolved sources, verdict and time. Enough to say roughly what happened, and
-- not enough to reconstruct it: nothing recorded what was actually retrieved,
-- or who asked. AU-004 reports failed on exactly that.
--
-- Two decisions shape the schema.
--
-- Hashes and references rather than bodies. The execution row stays compact and
-- immutable, and the bodies live in versioned artefact tables that can be
-- fetched to reconstruct the inputs exactly. Storing a prompt inline would
-- duplicate megabytes per call and still not prove the copy was faithful.
--
-- Replay means reconstructing the *inputs*, never re-running the model.
-- Models are not deterministic, and a "replay" that re-invoked one and got a
-- different answer would look like a failure of the record rather than a
-- property of the model. What is reproducible is precisely what was sent and
-- what state the system was in — which is what an appeal, an incident review or
-- an external auditor actually needs.

-- ---------------------------------------------------------------------------
-- Versioned artefacts. Append-only by convention and by the absence of any
-- update path; the hash is what makes a substitution detectable regardless.
-- ---------------------------------------------------------------------------

CREATE TABLE prompt_templates (
    id          text NOT NULL,
    version     text NOT NULL,
    kind        text NOT NULL CHECK (kind IN ('system', 'developer', 'user_template')),
    body        text NOT NULL,
    -- sha-256 of `body`. Recomputed on replay: if the body were ever edited in
    -- place, the recomputation would no longer match what the execution cited.
    body_hash   char(64) NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (id, version)
);

CREATE TABLE retrieval_snapshots (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id          uuid REFERENCES workspaces(id) ON DELETE CASCADE,
    case_id               uuid REFERENCES cases(id) ON DELETE CASCADE,
    -- The query as issued, and the filters applied. Both change what comes
    -- back, so neither can be reconstructed from the results alone.
    query                 text NOT NULL,
    filters               jsonb NOT NULL DEFAULT '{}'::jsonb,
    retrieval_strategy    text NOT NULL,
    -- What the model actually saw, in order. The ordering is part of the input.
    chunks                jsonb NOT NULL,
    source_hashes         text[] NOT NULL DEFAULT '{}',
    -- Index and embedding versions: the same query against a re-embedded corpus
    -- is a different retrieval, and without these that is invisible.
    embeddings_version    text NOT NULL,
    vector_index_version  text NOT NULL,
    content_hash          char(64) NOT NULL,
    created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX retrieval_snapshots_case_idx ON retrieval_snapshots(case_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- The execution itself
-- ---------------------------------------------------------------------------

CREATE TABLE ai_executions (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    workspace_id          uuid REFERENCES workspaces(id) ON DELETE CASCADE,
    case_id               uuid REFERENCES cases(id) ON DELETE CASCADE,
    organisation_id       uuid REFERENCES organizations(id) ON DELETE CASCADE,

    -- Who initiated it. `actor_type` is not decoration: an execution started by
    -- a scheduled job, an API caller or another agent is a different event from
    -- one a person asked for, and after an incident that distinction is the
    -- first question anyone asks.
    actor_id              text NOT NULL,
    actor_type            text NOT NULL CHECK (actor_type IN (
                              'client', 'caseworker', 'adviser', 'solicitor', 'barrister',
                              'interpreter', 'administrator', 'ai_agent', 'system',
                              'scheduled_job', 'api')),
    session_id            text,
    device_id             text,

    -- Which subsystem produced it. "GPT-5.5 said so" does not answer the
    -- question that matters, which is which agent was reasoning and why it was
    -- the one asked.
    department            text NOT NULL,
    agent_id              text NOT NULL,
    agent_version         text NOT NULL,

    provider              text NOT NULL,
    model                 text NOT NULL,
    model_version         text NOT NULL,

    prompt_template_id      text NOT NULL,
    prompt_template_version text NOT NULL,
    system_prompt_hash      char(64) NOT NULL,
    developer_prompt_hash   char(64),
    user_message_hash       char(64) NOT NULL,

    retrieval_snapshot_id uuid REFERENCES retrieval_snapshots(id) ON DELETE RESTRICT,
    retrieval_context_hash char(64),

    resolved_sources      text[] NOT NULL DEFAULT '{}',
    tool_calls            jsonb NOT NULL DEFAULT '[]'::jsonb,

    -- The state of the system at generation time, so it can later be
    -- established whether advice predated a policy change rather than argued
    -- about. Counts and versions, not a judgement.
    verified_source_count   integer NOT NULL,
    unverified_source_count integer NOT NULL,
    registry_version        text NOT NULL,
    guardrail_version       text NOT NULL,
    verification_verdict    text NOT NULL CHECK (verification_verdict IN ('pass', 'flag', 'block')),
    released                boolean NOT NULL,

    response_hash         char(64) NOT NULL,
    created_at            timestamptz NOT NULL DEFAULT now(),

    FOREIGN KEY (prompt_template_id, prompt_template_version)
        REFERENCES prompt_templates(id, version) ON DELETE RESTRICT,

    -- A retrieval-backed execution must cite the snapshot's hash, so a
    -- substituted snapshot is detectable rather than silently accepted.
    CONSTRAINT retrieval_recorded_together CHECK (
        (retrieval_snapshot_id IS NULL) = (retrieval_context_hash IS NULL)
    ),
    -- Mirrors the constraint already on ai_outputs: a released answer carries
    -- no unresolved findings.
    CONSTRAINT released_execution_passed CHECK (
        released = false OR verification_verdict = 'pass'
    )
);

CREATE INDEX ai_executions_case_idx ON ai_executions(case_id, created_at DESC);
CREATE INDEX ai_executions_actor_idx ON ai_executions(actor_id, created_at DESC);

-- An execution is a record of something that happened. Editing one is not a
-- correction, it is a rewrite, and the same reasoning applies here as to the
-- audit log.
CREATE OR REPLACE FUNCTION ai_executions_are_immutable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'ai_executions is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ai_executions_no_update
    BEFORE UPDATE ON ai_executions
    FOR EACH ROW EXECUTE FUNCTION ai_executions_are_immutable();

CREATE TRIGGER ai_executions_no_delete
    BEFORE DELETE ON ai_executions
    FOR EACH ROW EXECUTE FUNCTION ai_executions_are_immutable();
