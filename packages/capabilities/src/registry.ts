import {
  EVIDENCE_ORDER,
  evidenceRank,
  IMPLEMENTATION_ORDER,
  implementationRank,
  type CapabilityCheck,
  type CapabilityDefinition,
  type CapabilityStatus,
  type EvidenceLevel,
  type ImplementationLevel,
  type ObservationSet,
} from "./types.ts";

/**
 * Resolves a capability's displayable status from its checks.
 *
 * A failing check that gates level L caps its axis at the level below L. The
 * declared level is an upper bound, never a floor — this is what makes it
 * impossible for the UI to show more than the evidence supports.
 */
export function resolve(
  definition: CapabilityDefinition,
  observations: ObservationSet
): CapabilityStatus {
  const checks = definition.checks(observations);
  const failing = checks.filter((check) => !check.satisfied);

  // Implementation is cumulative: a level is reached when every check gating it
  // or anything below it passes. Failing a check therefore caps the axis just
  // beneath the level that check gates.
  let implementation = definition.declaredImplementation;
  for (const check of failing) {
    if (check.dimension !== "implementation") continue;
    const capped =
      IMPLEMENTATION_ORDER[
        Math.max(0, implementationRank(check.gates as ImplementationLevel) - 1)
      ]!;
    if (implementationRank(capped) < implementationRank(implementation)) {
      implementation = capped;
    }
  }

  // Evidence is NOT cumulative, and treating it as such produced a false claim:
  // a capability whose only failing evidence check gated production telemetry
  // was reported as externally audited, purely because nothing below that level
  // had failed. Absence of a failing check is not evidence.
  //
  // A level is therefore earned only by a check that explicitly gates it and
  // passes. With no passing evidence check, the answer is `none`.
  let evidence: EvidenceLevel = "none";
  for (const check of checks) {
    if (check.dimension !== "evidence" || !check.satisfied) continue;
    const level = check.gates as EvidenceLevel;
    if (evidenceRank(level) > evidenceRank(evidence)) evidence = level;
  }
  if (evidenceRank(evidence) > evidenceRank(definition.declaredEvidence)) {
    evidence = definition.declaredEvidence;
  }

  // The blocking check is the failing one gating the lowest level — the next
  // thing that has to be true, rather than an arbitrary member of the list.
  const blocking = lowestGating(failing);

  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    declaredImplementation: definition.declaredImplementation,
    declaredEvidence: definition.declaredEvidence,
    implementation,
    evidence,
    checks,
    failing,
    blocking,
    unmeasured: failing.filter((check) => check.unmeasured),
    nextAction: blocking?.nextAction ?? null,
    reason:
      failing.length === 0
        ? `All ${checks.length} checks pass.`
        : failing.map((check) => check.detail).join(" "),
  };
}

function lowestGating(failing: readonly CapabilityCheck[]): CapabilityCheck | null {
  let best: CapabilityCheck | null = null;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const check of failing) {
    const r =
      check.dimension === "implementation"
        ? implementationRank(check.gates as ImplementationLevel)
        : evidenceRank(check.gates as EvidenceLevel);
    // Implementation blocks before evidence: there is no point auditing
    // something that has not been built.
    const weighted = check.dimension === "implementation" ? r : r + 100;
    if (weighted < bestRank) {
      bestRank = weighted;
      best = check;
    }
  }
  return best;
}

export class CapabilityRegistry {
  readonly #definitions = new Map<string, CapabilityDefinition>();

  constructor(definitions: readonly CapabilityDefinition[] = []) {
    for (const definition of definitions) this.register(definition);
  }

  register(definition: CapabilityDefinition): void {
    if (this.#definitions.has(definition.id)) {
      throw new Error(`duplicate capability id: ${definition.id}`);
    }
    this.#definitions.set(definition.id, definition);
  }

  status(id: string, observations: ObservationSet): CapabilityStatus | null {
    const definition = this.#definitions.get(id);
    return definition ? resolve(definition, observations) : null;
  }

  all(observations: ObservationSet): readonly CapabilityStatus[] {
    return [...this.#definitions.values()].map((definition) => resolve(definition, observations));
  }

  /**
   * Capabilities not yet at the level they are built towards.
   *
   * Note what this is NOT: a list of things the UI is currently overclaiming.
   * That list is empty by construction — status is derived from observations,
   * so no surface can display more than was measured. `declared` is a target
   * ceiling, and this is the distance still to travel.
   */
  belowTarget(observations: ObservationSet): readonly CapabilityStatus[] {
    return this.all(observations).filter(
      (status) =>
        implementationRank(status.implementation) <
          implementationRank(status.declaredImplementation) ||
        evidenceRank(status.evidence) < evidenceRank(status.declaredEvidence)
    );
  }

  /** Every outstanding next action, in dependency-ish order. */
  roadmap(observations: ObservationSet): readonly { capability: string; action: string }[] {
    return this.all(observations)
      .filter((status) => status.nextAction !== null)
      .map((status) => ({ capability: status.name, action: status.nextAction! }));
  }
}
