import { AGENT_INVARIANTS } from "./invariants/agents.ts";
import { BENCHMARK_INVARIANTS } from "./invariants/benchmarks.ts";
import { DEPLOYMENT_INVARIANTS } from "./invariants/deployment.ts";
import { AI } from "./invariants/ai.ts";
import { AUDIT } from "./invariants/audit.ts";
import { EVIDENCE } from "./invariants/evidence.ts";
import { GOVERNANCE } from "./invariants/governance.ts";
import { PRIVACY } from "./invariants/privacy.ts";
import { SECURITY } from "./invariants/security.ts";
import type { Invariant } from "./invariant.ts";

/**
 * The registry.
 *
 * One list, so that `/trust`, the capability layer, CI and the evidence ledger
 * all answer from the same statement of what must hold. Four places each
 * holding their own version of the rules is how they came to disagree.
 */
export const INVARIANTS: readonly Invariant[] = [
  ...SECURITY,
  ...AI,
  ...AUDIT,
  ...AGENT_INVARIANTS,
  ...BENCHMARK_INVARIANTS,
  ...DEPLOYMENT_INVARIANTS,
  ...PRIVACY,
  ...EVIDENCE,
  ...GOVERNANCE,
];

export function invariant(id: string): Invariant | null {
  return INVARIANTS.find((i) => i.id === id) ?? null;
}

/** Invariants belonging to one capability, for reconciling the two views. */
export function forCapability(capability: string): readonly Invariant[] {
  return INVARIANTS.filter((i) => i.capability === capability);
}

/** Every observation id the registry depends on, deduplicated. */
export function requiredObservations(): readonly string[] {
  return [...new Set(INVARIANTS.flatMap((i) => i.observations))].sort();
}
