import { findAgent } from "./registry.ts";
import { lifecycleRank, type AgentStanding, type Lifecycle } from "./types.ts";

/**
 * Where an agent actually stands, derived from execution records.
 *
 * The thresholds below are stated once here rather than scattered across the
 * codebase, and every one of them is a floor on *evidence*, never on effort:
 * an agent rises because executions happened and held up, not because someone
 * decided it was ready.
 *
 * Four of the metrics proposed for this are deliberately absent, and the reason
 * is the same in each case — the system cannot measure them, and a field
 * holding a number nobody computed is how a hardcoded confidence percentage
 * ends up on screen as tribunal readiness:
 *
 *   hallucination rate          needs ground truth the platform does not have
 *   appeal success contribution a causal claim needing a controlled comparison
 *   user satisfaction           needs users, and asking them
 *   retrieval precision         needs labelled relevance judgements
 *
 * Each is worth measuring. None can be measured yet, so none is reported.
 */

export interface StandingInput {
  readonly agentId: string;
  /** Recorded executions for this agent, from the metrics projection. */
  readonly executions: number;
  /** Executions whose verification verdict was `pass`. */
  readonly passed: number;
  /** Executions that ended in a non-terminal-success state. */
  readonly failed: number;
  readonly medianLatencyMs: number | null;
  readonly p95LatencyMs?: number | null;
  /**
   * Whether every invariant this agent declares is currently satisfied.
   *
   * Required for `certified` and above. Execution count alone must never
   * produce it: an agent can run ten thousand times and still be violating the
   * property it was built to respect, and a level reached by volume would say
   * nothing about whether it behaved.
   */
  readonly invariantsSatisfied?: boolean;
  /** Whether telemetry from real use exists, required for `operational`. */
  readonly hasProductionTelemetry?: boolean;
}

/** Executions needed before a level can be reached at all. */
const MINIMUM_EXECUTIONS: Readonly<Record<Lifecycle, number>> = {
  draft: 0,
  testing: 1,
  verified: 50,
  certified: 500,
  operational: 2_000,
  deprecated: 0,
  retired: 0,
};

/** Verification rate needed, at levels where a rate means anything. */
const MINIMUM_VERIFICATION_RATE: Readonly<Partial<Record<Lifecycle, number>>> = {
  verified: 0.9,
  certified: 0.95,
  operational: 0.98,
};

export function standingFor(input: StandingInput): AgentStanding {
  const agent = findAgent(input.agentId);
  const ceiling: Lifecycle = agent?.declaredCeiling ?? "draft";

  const verificationRate = input.executions > 0 ? input.passed / input.executions : null;
  const failureRate = input.executions > 0 ? input.failed / input.executions : null;

  const base = {
    id: input.agentId,
    declaredCeiling: ceiling,
    executions: input.executions,
    verificationRate,
    failureRate,
    medianLatencyMs: input.medianLatencyMs,
  };

  if (!agent) {
    return {
      ...base,
      observed: "draft",
      reason: `${input.agentId} is not in the registry, so nothing about it is governed`,
    };
  }

  // Highest level whose evidence requirements are met, then capped by the
  // declared ceiling. The cap can only ever lower it.
  let earned: Lifecycle = "draft";
  for (const level of ["testing", "verified", "certified", "operational"] as const) {
    if (input.executions < MINIMUM_EXECUTIONS[level]) break;
    const required = MINIMUM_VERIFICATION_RATE[level];
    if (required !== undefined && (verificationRate === null || verificationRate < required)) break;
    // Certified requires the agent's declared invariants to hold. Volume is not
    // evidence of behaving correctly, and a level reachable by counting alone
    // would mean an agent that violates its own rules ten thousand times ranks
    // above one that has run twice and never broken them.
    if (level === "certified" && input.invariantsSatisfied !== true) break;
    if (level === "operational" && input.hasProductionTelemetry !== true) break;
    earned = level;
  }

  const observed = lifecycleRank(earned) > lifecycleRank(ceiling) ? ceiling : earned;

  const reason =
    input.executions === 0
      ? "no execution has been recorded for this agent"
      : observed === ceiling && lifecycleRank(earned) > lifecycleRank(ceiling)
        ? `evidence supports ${earned}; held at the declared ceiling ${ceiling}`
        : verificationRate !== null && verificationRate < 0.9
          ? `verification rate ${(verificationRate * 100).toFixed(1)}% is below the bar for verified`
          : earned === "verified" && input.invariantsSatisfied !== true
            ? "certified additionally requires every declared invariant to hold"
            : `${input.executions} recorded execution(s)`;

  return { ...base, observed, reason };
}

/** One condition behind a standing, and whether it is met. */
export interface StandingCheck {
  readonly label: string;
  readonly met: boolean;
  readonly detail: string;
}

/**
 * Why an agent stands where it does.
 *
 * A level on its own is not actionable — "draft" tells a reader nothing about
 * what would change it. These are the conditions, each independently true or
 * false, so the page can show what is already in place as well as what is
 * missing. Governance being complete while operation is empty is the normal
 * state of a new agent, and it should read that way rather than as a failure.
 */
export function standingChecks(input: StandingInput): readonly StandingCheck[] {
  const agent = findAgent(input.agentId);
  const rate = input.executions > 0 ? input.passed / input.executions : null;

  return [
    {
      label: "Registered",
      met: agent !== null,
      detail: agent
        ? `${agent.department} department, version ${agent.version}`
        : "not in the registry, so nothing about it is governed",
    },
    {
      label: "Capability policy declared",
      met: (agent?.capabilities.length ?? 0) > 0,
      detail: agent?.capabilities.join(", ") ?? "none",
    },
    {
      label: "Permissions declared",
      met: agent !== null,
      detail:
        agent === null
          ? "none"
          : agent.permissions.length === 0
            ? "none — reads nothing, which is a declaration and not an omission"
            : agent.permissions.join(", "),
    },
    {
      label: "Verification policy declared",
      met: agent?.requiresVerification === true,
      detail: agent?.requiresVerification
        ? "output passes the verification gate before release"
        : "no verification requirement declared",
    },
    {
      label: "Human review policy declared",
      met: agent !== null,
      detail: agent?.requiresHumanReview
        ? "a named qualified human authorises before release"
        : "no human authorisation required for release",
    },
    {
      label: "Executions recorded",
      met: input.executions > 0,
      detail:
        input.executions > 0 ? `${input.executions} recorded` : "no production executions recorded",
    },
    {
      label: "Latency measured",
      met: input.medianLatencyMs !== null,
      detail:
        input.medianLatencyMs !== null
          ? `median ${input.medianLatencyMs} ms`
          : "no latency measurements — nothing has run",
    },
    {
      label: "Verification statistics",
      met: rate !== null,
      detail:
        rate !== null
          ? `${(rate * 100).toFixed(1)}% of executions passed the gate`
          : "no verification statistics — nothing has run",
    },
  ];
}
