-- Agent metrics: a projection of the execution log, never a source of truth.
--
-- `ai_executions` and `ai_execution_completions` are the immutable event log.
-- This table is derived from them and may be dropped and rebuilt at any time
-- without losing anything. That distinction is the whole design: standing must
-- not scan the event log on every read, and the projection must not become a
-- second place where facts about an agent live.
--
-- Two consequences follow, and both are enforced rather than documented.
--
-- There are no setters. Every column is computed by the projector from the
-- event log. Nothing in the application increments a counter, because an
-- increment path is how a projection silently stops matching its source — a
-- dropped message, a retry counted twice, and the number is wrong in a way
-- nobody can see by looking at it.
--
-- Every row carries `source_digest`, a hash of the execution rows it was
-- computed from. Recomputing the digest is cheap and comparing it to the stored
-- one answers "is this projection still faithful" without recomputing the
-- metrics themselves. AG-004 reads exactly that.

CREATE TABLE agent_metrics (
    agent_id                text PRIMARY KEY,

    execution_count         integer NOT NULL DEFAULT 0,
    successful_executions   integer NOT NULL DEFAULT 0,
    failed_executions       integer NOT NULL DEFAULT 0,
    -- A blocked answer is the verification gate working. Counted apart from
    -- failures so an agent does not look unreliable precisely when it was being
    -- correctly restrained.
    policy_blocks           integer NOT NULL DEFAULT 0,
    timeouts                integer NOT NULL DEFAULT 0,

    verification_passes     integer NOT NULL DEFAULT 0,
    verification_failures   integer NOT NULL DEFAULT 0,
    -- Executions by an agent whose definition requires a named human to
    -- authorise. Withholding is the policy working, not a failure of the model.
    human_review_required   integer NOT NULL DEFAULT 0,

    retries_total           integer NOT NULL DEFAULT 0,
    median_latency_ms       integer,
    p95_latency_ms          integer,

    total_input_tokens      bigint NOT NULL DEFAULT 0,
    total_output_tokens     bigint NOT NULL DEFAULT 0,
    total_cost_pence        bigint NOT NULL DEFAULT 0,

    last_execution_at       timestamptz,
    last_success_at         timestamptz,
    last_failure_at         timestamptz,

    -- sha-256 over the execution rows this was computed from, in a stable
    -- order. Lets a reader establish the projection still matches the log
    -- without recomputing it.
    source_digest           char(64) NOT NULL,
    updated_at              timestamptz NOT NULL DEFAULT now(),

    -- Arithmetic that must hold for the row to be internally coherent. A
    -- projection that contradicts itself is worse than a missing one, because
    -- it will be read.
    CONSTRAINT metrics_outcomes_within_total CHECK (
        successful_executions + failed_executions + policy_blocks <= execution_count
    ),
    CONSTRAINT metrics_verification_within_total CHECK (
        verification_passes + verification_failures <= execution_count
    ),
    CONSTRAINT metrics_counts_non_negative CHECK (
        execution_count >= 0 AND retries_total >= 0
    )
);

COMMENT ON TABLE agent_metrics IS
    'Derived projection of ai_executions. Rebuildable; never authoritative. '
    'No application code increments these columns.';
