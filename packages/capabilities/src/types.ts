import type { ObservationSet } from "./observe.ts";

/**
 * Capability maturity, on two orthogonal axes.
 *
 * The problem this solves: the workspace rendered seven agents with green
 * "active" badges, including a Research Agent whose retrieval corpus does not
 * exist. That is the same defect as a hardcoded confidence percentage — a
 * status asserted rather than established.
 *
 * A capability may *declare* a level, but the level it is shown at is capped by
 * checks that must pass. A declaration can only ever lower the displayed
 * status, never raise it above what the evidence supports.
 *
 * Two axes rather than one, because they answer different questions and
 * collapsing them loses information. "The code is written and its dependencies
 * are configured" is implementation. "We have grounds to believe it works" is
 * evidence. A subsystem can be fully operational with no evidence beyond unit
 * tests, and that is a materially different claim from one validated against a
 * benchmark or audited externally.
 */

export const IMPLEMENTATION_ORDER = [
  "prototype", // UI only
  "implemented", // the code exists
  "operational", // its dependencies are configured and it can run
  "verified", // it passes its own checks
  "certified", // it meets production requirements
] as const;

export const EVIDENCE_ORDER = [
  "none", // nothing but developer intent
  "unit_tests", // the units are tested in isolation
  "integration_tests", // the pieces are tested together
  "benchmark_validated", // scored by a benchmark suite
  "external_audit", // reviewed by someone outside the project
  "production_telemetry", // measured in real use
  "independent_replication", // reproduced by a third party
] as const;

export type ImplementationLevel = (typeof IMPLEMENTATION_ORDER)[number];
export type EvidenceLevel = (typeof EVIDENCE_ORDER)[number];
export type Dimension = "implementation" | "evidence";

export function implementationRank(level: ImplementationLevel): number {
  return IMPLEMENTATION_ORDER.indexOf(level);
}

export function evidenceRank(level: EvidenceLevel): number {
  return EVIDENCE_ORDER.indexOf(level);
}

export type { ObservationSet };

export interface CapabilityCheck {
  readonly id: string;
  readonly label: string;
  readonly dimension: Dimension;
  /** Level this check gates: failing it caps that axis below this level. */
  readonly gates: ImplementationLevel | EvidenceLevel;
  readonly satisfied: boolean;
  readonly detail: string;
  /** What has to be done to satisfy it. Turns the dashboard into a roadmap. */
  readonly nextAction: string;
  /** The observation this check read, and how that observation was taken. */
  readonly observationId: string | null;
  readonly method: string | null;
  /**
   * True when the check failed because the underlying state could not be
   * measured, rather than because it was measured and found wanting. Both fail
   * closed, but they call for different work: one needs building, the other
   * needs instrumenting.
   */
  readonly unmeasured: boolean;
}

export interface CapabilityDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly declaredImplementation: ImplementationLevel;
  readonly declaredEvidence: EvidenceLevel;
  readonly checks: (observations: ObservationSet) => readonly CapabilityCheck[];
}

export interface CapabilityStatus {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly declaredImplementation: ImplementationLevel;
  readonly declaredEvidence: EvidenceLevel;
  /** What may actually be shown. Never higher than what was declared. */
  readonly implementation: ImplementationLevel;
  readonly evidence: EvidenceLevel;
  readonly checks: readonly CapabilityCheck[];
  readonly failing: readonly CapabilityCheck[];
  /** The failing check currently holding the capability back, if any. */
  readonly blocking: CapabilityCheck | null;
  /** Checks that failed only because nothing could measure them. */
  readonly unmeasured: readonly CapabilityCheck[];
  /** What to do next, taken from the blocking check. */
  readonly nextAction: string | null;
  readonly reason: string;
}
