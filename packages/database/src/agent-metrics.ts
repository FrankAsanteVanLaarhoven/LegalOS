import { createHash } from "node:crypto";

import type { SqlExecutor } from "./client.ts";

/**
 * The agent metrics projection.
 *
 * `ai_executions` and `ai_execution_completions` are the immutable event log.
 * This is derived from them, and can be dropped and rebuilt without losing
 * anything.
 *
 * Rebuilt rather than incremented, deliberately. An increment path is how a
 * projection silently stops matching its source: a dropped call, a retry
 * counted twice, and the number is wrong in a way nobody can see by looking at
 * it. Recomputation is idempotent and its correctness is checkable, which
 * matters more here than the cost of a periodic aggregate.
 *
 * Three counting decisions, each of which could reasonably have gone the other
 * way and would be invisible in the resulting number:
 *
 * `execution_count` counts request records, not completions. An execution still
 * in flight, or one that died before writing its outcome, is still an
 * execution — counting completions would let a crash improve an agent's record.
 *
 * `failed` means the call did not produce an answer: it threw, timed out or was
 * cancelled. `blocked` is not a failure. A blocked answer is the verification
 * gate working, and folding it into a failure rate would make an agent look
 * unreliable exactly when it was being correctly restrained.
 *
 * `verification_passes` counts a verdict of `pass`, not a release. An agent
 * requiring human review never has output released automatically, and treating
 * that as a verification failure would punish the agents held to the highest
 * standard.
 */

/** The narrow surface the runner needs, so it depends on a port not a class. */
export interface AgentMetricsProjection {
  refreshAgent(agentId: string, agentsRequiringReview: readonly string[]): Promise<void>;
}

export interface AgentMetricsRow {
  readonly agentId: string;
  readonly executionCount: number;
  readonly successfulExecutions: number;
  readonly failedExecutions: number;
  readonly policyBlocks: number;
  readonly timeouts: number;
  readonly verificationPasses: number;
  readonly verificationFailures: number;
  readonly humanReviewRequired: number;
  readonly retriesTotal: number;
  readonly medianLatencyMs: number | null;
  readonly p95LatencyMs: number | null;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly totalCostPence: number;
  readonly lastExecutionAt: string | null;
  readonly lastSuccessAt: string | null;
  readonly lastFailureAt: string | null;
  readonly sourceDigest: string;
  readonly updatedAt: string | null;
}

interface RawRow {
  agent_id: string;
  execution_count: string | number;
  successful_executions: string | number;
  failed_executions: string | number;
  policy_blocks: string | number;
  timeouts: string | number;
  verification_passes: string | number;
  verification_failures: string | number;
  human_review_required: string | number;
  retries_total: string | number;
  median_latency_ms: string | number | null;
  p95_latency_ms: string | number | null;
  total_input_tokens: string | number;
  total_output_tokens: string | number;
  total_cost_pence: string | number;
  last_execution_at: Date | string | null;
  last_success_at: Date | string | null;
  last_failure_at: Date | string | null;
  source_digest?: string;
  updated_at?: Date | string | null;
}

const n = (value: string | number | null | undefined): number =>
  value === null || value === undefined ? 0 : Number(value);

const iso = (value: Date | string | null | undefined): string | null =>
  value === null || value === undefined
    ? null
    : value instanceof Date
      ? value.toISOString()
      : value;

const rounded = (value: string | number | null): number | null =>
  value === null ? null : Math.round(Number(value));

function toRow(raw: RawRow): AgentMetricsRow {
  return {
    agentId: raw.agent_id,
    executionCount: n(raw.execution_count),
    successfulExecutions: n(raw.successful_executions),
    failedExecutions: n(raw.failed_executions),
    policyBlocks: n(raw.policy_blocks),
    timeouts: n(raw.timeouts),
    verificationPasses: n(raw.verification_passes),
    verificationFailures: n(raw.verification_failures),
    humanReviewRequired: n(raw.human_review_required),
    retriesTotal: n(raw.retries_total),
    medianLatencyMs: rounded(raw.median_latency_ms ?? null),
    p95LatencyMs: rounded(raw.p95_latency_ms ?? null),
    totalInputTokens: n(raw.total_input_tokens),
    totalOutputTokens: n(raw.total_output_tokens),
    totalCostPence: n(raw.total_cost_pence),
    lastExecutionAt: iso(raw.last_execution_at),
    lastSuccessAt: iso(raw.last_success_at),
    lastFailureAt: iso(raw.last_failure_at),
    sourceDigest: raw.source_digest ?? "",
    updatedAt: iso(raw.updated_at ?? null),
  };
}

/**
 * Aggregation over the event log. The single place these numbers are defined.
 *
 * `agents_requiring_review` is passed in rather than joined, because whether an
 * agent requires human review is a property of the registry and not of the
 * database. Joining against a table would put a second copy of the registry in
 * the schema, and the two would drift.
 */
const AGGREGATE = `
  SELECT
    e.agent_id,
    count(*)::int AS execution_count,
    count(*) FILTER (WHERE c.terminal_state = 'completed')::int AS successful_executions,
    count(*) FILTER (WHERE c.terminal_state IN ('failed', 'timed_out', 'cancelled'))::int AS failed_executions,
    count(*) FILTER (WHERE c.terminal_state = 'blocked')::int AS policy_blocks,
    count(*) FILTER (WHERE c.terminal_state = 'timed_out')::int AS timeouts,
    count(*) FILTER (WHERE c.verification_verdict = 'pass')::int AS verification_passes,
    count(*) FILTER (WHERE c.verification_verdict IN ('flag', 'block'))::int AS verification_failures,
    count(*) FILTER (WHERE e.agent_id = ANY($1::text[]))::int AS human_review_required,
    coalesce(sum(c.retries), 0)::int AS retries_total,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY c.latency_ms)
      FILTER (WHERE c.latency_ms IS NOT NULL) AS median_latency_ms,
    percentile_cont(0.95) WITHIN GROUP (ORDER BY c.latency_ms)
      FILTER (WHERE c.latency_ms IS NOT NULL) AS p95_latency_ms,
    coalesce(sum(c.input_tokens), 0)::bigint AS total_input_tokens,
    coalesce(sum(c.output_tokens), 0)::bigint AS total_output_tokens,
    coalesce(sum(c.estimated_cost_pence), 0)::bigint AS total_cost_pence,
    max(e.created_at) AS last_execution_at,
    max(e.created_at) FILTER (WHERE c.terminal_state = 'completed') AS last_success_at,
    max(e.created_at) FILTER (WHERE c.terminal_state IN ('failed', 'timed_out', 'cancelled')) AS last_failure_at
  FROM ai_executions e
  LEFT JOIN ai_execution_completions c ON c.execution_id = e.id
  GROUP BY e.agent_id
  ORDER BY e.agent_id
`;

export class PostgresAgentMetrics {
  readonly #sql: SqlExecutor;

  constructor(sql: SqlExecutor) {
    this.#sql = sql;
  }

  /**
   * Recomputes one agent's row from the log.
   *
   * Called as each execution completes, so the projection is continuous rather
   * than periodic. Deliberately a recompute of that agent rather than an
   * increment: an increment is a second implementation of the aggregation, and
   * two implementations of the same arithmetic drift. Recomputing one agent
   * touches the rows for one agent, which is cheap, and keeps the projection
   * derivable by construction rather than by convention.
   */
  async refreshAgent(agentId: string, agentsRequiringReview: readonly string[]): Promise<void> {
    const computed = await this.computeFromLog(agentsRequiringReview);
    const row = computed.find((r) => r.agentId === agentId);
    if (!row) {
      // No executions remain for this agent, so no row should either. A row of
      // zeros would imply it ran and did nothing.
      await this.#sql.query("DELETE FROM agent_metrics WHERE agent_id = $1", [agentId]);
      return;
    }
    await this.#upsert(row);
  }

  /** Reads the projection. Cheap; this is what standing consumes. */
  async read(): Promise<AgentMetricsRow[]> {
    const result = await this.#sql.query<RawRow>("SELECT * FROM agent_metrics ORDER BY agent_id");
    return result.rows.map(toRow);
  }

  /** Recomputes from the event log without writing. Used to check for drift. */
  async computeFromLog(agentsRequiringReview: readonly string[]): Promise<AgentMetricsRow[]> {
    const result = await this.#sql.query<RawRow>(AGGREGATE, [[...agentsRequiringReview]]);
    return result.rows.map((raw) => ({ ...toRow(raw), sourceDigest: digestOf(toRow(raw)) }));
  }

  /**
   * Rebuilds the projection from the event log.
   *
   * Deletes rows for agents that no longer appear: an agent whose executions
   * were removed with a workspace should not keep a metrics row implying it
   * ran. The whole rebuild is one statement sequence inside the caller's
   * transaction, so a reader never sees a half-rebuilt projection.
   */
  async rebuild(agentsRequiringReview: readonly string[]): Promise<number> {
    const computed = await this.computeFromLog(agentsRequiringReview);
    const seen = computed.map((row) => row.agentId);

    await this.#sql.query(
      seen.length === 0
        ? "DELETE FROM agent_metrics"
        : "DELETE FROM agent_metrics WHERE agent_id <> ALL($1::text[])",
      seen.length === 0 ? [] : [seen]
    );

    for (const row of computed) {
      await this.#upsert(row);
    }

    return computed.length;
  }

  async #upsert(row: AgentMetricsRow): Promise<void> {
    {
      await this.#sql.query(
        `INSERT INTO agent_metrics (
           agent_id, execution_count, successful_executions, failed_executions,
           policy_blocks, timeouts, verification_passes, verification_failures,
           human_review_required, retries_total, median_latency_ms, p95_latency_ms,
           total_input_tokens, total_output_tokens, total_cost_pence,
           last_execution_at, last_success_at, last_failure_at, source_digest, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19, now())
         ON CONFLICT (agent_id) DO UPDATE SET
           execution_count = EXCLUDED.execution_count,
           successful_executions = EXCLUDED.successful_executions,
           failed_executions = EXCLUDED.failed_executions,
           policy_blocks = EXCLUDED.policy_blocks,
           timeouts = EXCLUDED.timeouts,
           verification_passes = EXCLUDED.verification_passes,
           verification_failures = EXCLUDED.verification_failures,
           human_review_required = EXCLUDED.human_review_required,
           retries_total = EXCLUDED.retries_total,
           median_latency_ms = EXCLUDED.median_latency_ms,
           p95_latency_ms = EXCLUDED.p95_latency_ms,
           total_input_tokens = EXCLUDED.total_input_tokens,
           total_output_tokens = EXCLUDED.total_output_tokens,
           total_cost_pence = EXCLUDED.total_cost_pence,
           last_execution_at = EXCLUDED.last_execution_at,
           last_success_at = EXCLUDED.last_success_at,
           last_failure_at = EXCLUDED.last_failure_at,
           source_digest = EXCLUDED.source_digest,
           updated_at = now()`,
        [
          row.agentId,
          row.executionCount,
          row.successfulExecutions,
          row.failedExecutions,
          row.policyBlocks,
          row.timeouts,
          row.verificationPasses,
          row.verificationFailures,
          row.humanReviewRequired,
          row.retriesTotal,
          row.medianLatencyMs,
          row.p95LatencyMs,
          row.totalInputTokens,
          row.totalOutputTokens,
          row.totalCostPence,
          row.lastExecutionAt,
          row.lastSuccessAt,
          row.lastFailureAt,
          row.sourceDigest,
        ]
      );
    }
  }

  /**
   * Whether the projection still matches the log.
   *
   * This is the property that makes a projection safe to read. Without it, a
   * stale or hand-edited metrics table is indistinguishable from a correct one,
   * and standing would be derived from a number nobody can trace — which is the
   * failure the whole architecture exists to prevent, reintroduced through a
   * cache.
   */
  async drift(
    agentsRequiringReview: readonly string[]
  ): Promise<{ faithful: boolean; disagreeing: string[] }> {
    const [stored, computed] = await Promise.all([
      this.read(),
      this.computeFromLog(agentsRequiringReview),
    ]);

    const byId = new Map(stored.map((row) => [row.agentId, row] as const));
    const disagreeing: string[] = [];

    for (const row of computed) {
      const found = byId.get(row.agentId);
      byId.delete(row.agentId);
      if (!found) {
        disagreeing.push(row.agentId);
        continue;
      }
      // Recomputed from the stored row's own values, not read from its
      // `source_digest` column.
      //
      // Comparing the stored column would have missed the only edit anybody
      // would actually make: change the counts and leave the digest alone. This
      // compared columns at first and a test caught it — a check that trusts a
      // field to describe the row it sits in is checking nothing.
      if (digestOf(found) !== row.sourceDigest || found.sourceDigest !== row.sourceDigest) {
        disagreeing.push(row.agentId);
      }
    }
    // Anything left has a projection row and no executions behind it.
    disagreeing.push(...byId.keys());

    return { faithful: disagreeing.length === 0, disagreeing: disagreeing.sort() };
  }
}

/**
 * Hash of everything derived for one agent.
 *
 * Covers the values, not the row's identity or its write time, so two
 * independent computations of the same log agree and a stored row that has been
 * edited does not.
 */
export function digestOf(row: AgentMetricsRow): string {
  const material = [
    row.agentId,
    row.executionCount,
    row.successfulExecutions,
    row.failedExecutions,
    row.policyBlocks,
    row.timeouts,
    row.verificationPasses,
    row.verificationFailures,
    row.humanReviewRequired,
    row.retriesTotal,
    row.medianLatencyMs,
    row.p95LatencyMs,
    row.totalInputTokens,
    row.totalOutputTokens,
    row.totalCostPence,
    row.lastExecutionAt,
    row.lastSuccessAt,
    row.lastFailureAt,
  ].join(" ");
  return createHash("sha256").update(material, "utf8").digest("hex");
}
