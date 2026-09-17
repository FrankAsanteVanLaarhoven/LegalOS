import {
  AGENTS,
  route,
  standingChecks,
  standingFor,
  type AgentDefinition,
  type AgentStanding,
  type StandingCheck,
} from "@legalos/agentos";
import {
  evaluateAll,
  readFalsifications,
  selfObservations,
  withSelfObservations,
  type InvariantResult,
} from "@legalos/invariants";

import { currentObservations, platformStatus, repoRoot } from "./capabilities";

/**
 * Agent governance, assembled server-side.
 *
 * Three things people conflate, kept apart here because the difference is the
 * whole point of the page:
 *
 *   definition   what the registry declares. Fixed, and real today.
 *   capability   which of its invariants hold. Derived, and measured today.
 *   operation    what it has actually done. Derived, and currently zero.
 *
 * Zero executions is not missing data. It is the correct measurement of an
 * agent that has never processed a live request, and the page says so in those
 * words rather than showing an empty dashboard that reads as broken.
 *
 * Nothing here is memoised. It was, in a module-level map with no invalidation,
 * so the first request of a server's life decided what every later one showed —
 * a page reporting no executions while the projection held some, on a route
 * already marked force-dynamic. Process-lifetime caching suits configuration
 * and capability manifests; operational metrics change on every execution, and
 * a governance surface that lags them is asserting rather than measuring. If
 * the per-request read ever costs anything, the answer is a framework cache
 * with explicit invalidation, not an unbounded map.
 */

export interface AgentGovernance {
  readonly definition: AgentDefinition;
  readonly standing: AgentStanding;
  readonly checks: readonly StandingCheck[];
  /** Results for the invariants this agent declares. */
  readonly invariants: readonly InvariantResult[];
  readonly satisfied: number;
  readonly failed: number;
  readonly unmeasured: number;
  /** Declared invariants not satisfied. Lower is better; zero is the goal. */
  readonly debt: number;
  readonly routing: readonly {
    readonly capability: string;
    readonly provider: string | null;
    readonly basis: string;
    /** Whether the decision cites benchmark evidence, or is not a ranking. */
    readonly kind: "sole_provider" | "benchmark" | "refused";
  }[];
  readonly metrics: AgentOperationalMetrics | null;
}

export interface AgentOperationalMetrics {
  readonly executions: number;
  readonly verificationRate: number | null;
  readonly medianLatencyMs: number | null;
  readonly p95LatencyMs: number | null;
  readonly policyBlocks: number;
  readonly failures: number;
  readonly totalCostPence: number;
  readonly lastExecutionAt: string | null;
}

/** Why operational metrics are absent, when they are. */
export type MetricsAvailability =
  { readonly available: true } | { readonly available: false; readonly reason: string };

/**
 * Reads the metrics projection.
 *
 * Never falls back to computing from the execution log: the projection is what
 * standing consumes, and a page quietly reading a different source would hide
 * exactly the drift the projection's digest exists to expose.
 */
async function readProjection(): Promise<{
  rows: Map<string, AgentOperationalMetrics>;
  availability: MetricsAvailability;
}> {
  const rows = new Map<string, AgentOperationalMetrics>();

  if (!process.env.DATABASE_URL) {
    return {
      rows,
      availability: {
        available: false,
        reason:
          "No database is configured, so no execution records exist to project from. This is the state of the running instance, not a failure to load.",
      },
    };
  }

  try {
    const { createPool, PostgresAgentMetrics } = await import("@legalos/database");
    const pool = await createPool();
    try {
      for (const row of await new PostgresAgentMetrics(pool).read()) {
        rows.set(row.agentId, {
          executions: row.executionCount,
          verificationRate:
            row.executionCount > 0 ? row.verificationPasses / row.executionCount : null,
          medianLatencyMs: row.medianLatencyMs,
          p95LatencyMs: row.p95LatencyMs,
          policyBlocks: row.policyBlocks,
          failures: row.failedExecutions,
          totalCostPence: row.totalCostPence,
          lastExecutionAt: row.lastExecutionAt,
        });
      }
    } finally {
      await pool.end();
    }
    return { rows, availability: { available: true } };
  } catch (error) {
    // Surfaced rather than swallowed. A page that silently showed zeros when it
    // could not reach the database would be indistinguishable from one
    // reporting a genuine zero, and those mean opposite things.
    return {
      rows,
      availability: {
        available: false,
        reason: `The metrics projection could not be read: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      },
    };
  }
}

export async function agentGovernance(): Promise<{
  agents: readonly AgentGovernance[];
  availability: MetricsAvailability;
}> {
  const { rows, availability } = await readProjection();

  // The providers this deployment actually has, and the evidence that ranks
  // them. Both read rather than assumed: a page describing routing it cannot
  // justify is the thing this whole subsystem removes.
  // Mirrors what the runner would actually resolve. This read one vendor's
  // variable, so with a gateway configured the trust page showed no provider at
  // all — routing described as unavailable while requests were being served.
  const providerKind = process.env.AI_PROVIDER ?? "gateway";
  const configuredProviders =
    providerKind === "xai"
      ? process.env.XAI_API_KEY
        ? ["xai"]
        : []
      : process.env.AI_GATEWAY_URL && process.env.AI_GATEWAY_API_KEY && process.env.AI_GATEWAY_MODEL
        ? ["gateway"]
        : [];
  const { readRoutingEvidence } = await import("@legalos/bench");
  const routingEvidence = await readRoutingEvidence(repoRoot);

  const falsifications = await readFalsifications(repoRoot);
  const observations = await currentObservations();
  const derived = selfObservations({
    observations,
    falsifications,
    capabilities: await platformStatus(),
  });
  const results = evaluateAll({
    observations: withSelfObservations(observations, derived),
    falsifications,
  });
  const byInvariantId = new Map(results.map((r) => [r.id, r] as const));

  const agents = AGENTS.map((definition): AgentGovernance => {
    const metrics = rows.get(definition.id) ?? null;

    const input = {
      agentId: definition.id,
      executions: metrics?.executions ?? 0,
      passed: metrics ? Math.round((metrics.verificationRate ?? 0) * metrics.executions) : 0,
      failed: metrics?.failures ?? 0,
      medianLatencyMs: metrics?.medianLatencyMs ?? null,
      p95LatencyMs: metrics?.p95LatencyMs ?? null,
    };

    const invariants = definition.observableInvariants
      .map((id) => byInvariantId.get(id))
      .filter((r): r is InvariantResult => r !== undefined);

    const satisfied = invariants.filter((r) => r.status === "satisfied").length;
    const failed = invariants.filter((r) => r.status === "failed").length;
    const unmeasured = invariants.filter(
      (r) => r.status === "unmeasured" || r.status === "no_observer"
    ).length;

    return {
      definition,
      // Certified requires every declared invariant to hold; passed through so
      // an agent cannot reach it on execution volume alone.
      standing: standingFor({
        ...input,
        invariantsSatisfied: invariants.length > 0 && failed === 0 && unmeasured === 0,
      }),
      checks: standingChecks(input),
      invariants,
      satisfied,
      failed,
      unmeasured,
      debt: invariants.length - satisfied,
      // Resolved the same way the runner resolves it, from the same evidence,
      // so the page cannot show a routing decision the runtime would not make.
      routing: definition.capabilities.map((capability) => {
        const resolved = route({
          capability,
          configured: configuredProviders,
          evidence: routingEvidence,
          now: Date.now(),
        });
        return {
          capability,
          provider: resolved.provider,
          basis: resolved.basis.detail,
          kind: resolved.basis.kind,
        };
      }),
      metrics,
    };
  });

  return { agents, availability };
}

/** Agents grouped by department, mirroring the architecture. */
export function byDepartment(
  agents: readonly AgentGovernance[]
): readonly { department: string; agents: readonly AgentGovernance[] }[] {
  const departments = [...new Set(agents.map((a) => a.definition.department))].sort();
  return departments.map((department) => ({
    department,
    agents: agents.filter((a) => a.definition.department === department),
  }));
}

/** Worst verification debt first — the ordering that names the next work. */
export function byDebt(agents: readonly AgentGovernance[]): readonly AgentGovernance[] {
  return [...agents].sort(
    (a, b) => b.debt - a.debt || a.definition.id.localeCompare(b.definition.id)
  );
}
