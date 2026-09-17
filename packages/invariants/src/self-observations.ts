import { evidenceRank, type CapabilityStatus, type EvidenceLevel } from "@legalos/capabilities";

import { evaluateAll, type ObservationLike, type ObservationLookup } from "./evaluate.ts";
import type { Falsification } from "./falsification.ts";
import { INVARIANTS } from "./registry.ts";

/**
 * Observations about the framework itself.
 *
 * The governance invariants need measurements, and the thing they measure is
 * the capability layer and this registry. Producing them here means governance
 * rules are evaluated by the same evaluator as everything else — a rule that
 * got special treatment would be the first place the next quiet exemption
 * appeared.
 *
 * One ordering constraint. `every_satisfied_critical_invariant_is_falsifiable`
 * is derived from evaluating the registry, and the governance invariants are in
 * the registry, so evaluating them here would not terminate. The subset
 * excluding governance is used instead, and governance invariants are evaluated
 * afterwards against the result. That is a real limitation: these five
 * observations describe everything except themselves.
 */

function observation(id: string, value: boolean, method: string): ObservationLike {
  return { id, value, method };
}

export interface SelfObservationInput {
  readonly observations: ObservationLookup;
  readonly falsifications: ReadonlyMap<string, Falsification>;
  readonly capabilities: readonly CapabilityStatus[];
}

export function selfObservations(
  input: SelfObservationInput
): ReadonlyMap<string, ObservationLike> {
  const { observations, falsifications, capabilities } = input;
  const subject = INVARIANTS.filter((i) => i.category !== "governance");
  const results = evaluateAll({ observations, falsifications, registry: subject });

  const out = new Map<string, ObservationLike>();

  // GV-000. Every critical invariant that would otherwise be satisfied must
  // rest on at least one observation demonstrated capable of reporting false.
  const unfalsified = results.filter((r) => r.status === "unfalsified");
  out.set(
    "every_satisfied_critical_invariant_is_falsifiable",
    observation(
      "every_satisfied_critical_invariant_is_falsifiable",
      unfalsified.length === 0,
      unfalsified.length === 0
        ? "no critical invariant rests on observations that have never been seen to fail"
        : `${unfalsified.length} critical invariant(s) rest on observations never seen to fail: ${unfalsified.map((r) => r.id).join(", ")}`
    )
  );

  // GV-004. An invariant may name an observation nobody has built — that is how
  // the registry holds unmet work — but it is counted, never silent.
  const known = new Set<string>();
  for (const id of collectObservationIds(input)) known.add(id);
  const orphaned = INVARIANTS.filter((i) => i.observations.some((o) => !known.has(o)));
  out.set(
    "every_invariant_names_an_existing_observation",
    observation(
      "every_invariant_names_an_existing_observation",
      orphaned.length === 0,
      orphaned.length === 0
        ? "every invariant names observations that exist"
        : `${orphaned.length} invariant(s) name observations nobody has built: ${orphaned.map((i) => i.id).join(", ")}`
    )
  );

  // GV-001. A check gating `verified` or above must read a measurement. A
  // hand-written constant at that level is a declaration in a check's clothing.
  const selfEvident = capabilities.flatMap((c) =>
    c.checks
      .filter(
        (check) =>
          check.observationId === null &&
          check.dimension === "implementation" &&
          (check.gates === "verified" || check.gates === "certified")
      )
      .map((check) => `${c.id}.${check.id}`)
  );
  out.set(
    "no_self_evident_check_above_operational",
    observation(
      "no_self_evident_check_above_operational",
      selfEvident.length === 0,
      selfEvident.length === 0
        ? "no check above operational is hand-asserted"
        : `hand-asserted checks gating verified or certified: ${selfEvident.join(", ")}`
    )
  );

  // GV-002. Written after finding a declared ceiling silently discarding a
  // measurement that had risen above it. An under-claim is not safe — it means
  // a constant, not the evidence, decided the level.
  const suppressed = capabilities
    .filter((c) => {
      const earned = c.checks
        .filter((check) => check.dimension === "evidence" && check.satisfied)
        .map((check) => check.gates as EvidenceLevel);
      const highest = earned.reduce<number>((max, l) => Math.max(max, evidenceRank(l)), 0);
      return highest > evidenceRank(c.declaredEvidence);
    })
    .map((c) => c.id);
  out.set(
    "no_capability_exceeds_its_observations",
    observation(
      "no_capability_exceeds_its_observations",
      suppressed.length === 0,
      suppressed.length === 0
        ? "no capability's declared ceiling is discarding a measurement"
        : `declared ceiling below measured evidence for: ${suppressed.join(", ")}`
    )
  );

  // GV-003. Unmeasurable is not a pass. Every check reading an observation that
  // could not be measured must be failing.
  const leaking = capabilities.flatMap((c) =>
    c.checks
      .filter((check) => {
        if (!check.observationId || !check.satisfied) return false;
        const value = observations.get(check.observationId)?.value;
        return value === null || value === undefined;
      })
      .map((check) => `${c.id}.${check.id}`)
  );
  out.set(
    "unavailable_observations_fail_their_checks",
    observation(
      "unavailable_observations_fail_their_checks",
      leaking.length === 0,
      leaking.length === 0
        ? "every check reading an unmeasurable observation fails closed"
        : `checks passing on unmeasurable observations: ${leaking.join(", ")}`
    )
  );

  return out;
}

/** Observation ids visible to the registry, base plus the ones derived here. */
function collectObservationIds(input: SelfObservationInput): readonly string[] {
  const derived = [
    "every_satisfied_critical_invariant_is_falsifiable",
    "every_invariant_names_an_existing_observation",
    "no_self_evident_check_above_operational",
    "no_capability_exceeds_its_observations",
    "unavailable_observations_fail_their_checks",
  ];
  const base = INVARIANTS.flatMap((i) => i.observations).filter((id) =>
    Boolean(input.observations.get(id))
  );
  return [...base, ...derived];
}

/** Combines base observations with the derived ones into a single lookup. */
export function withSelfObservations(
  base: ObservationLookup,
  derived: ReadonlyMap<string, ObservationLike>
): ObservationLookup {
  return {
    get(id: string) {
      return derived.get(id) ?? base.get(id);
    },
  };
}
