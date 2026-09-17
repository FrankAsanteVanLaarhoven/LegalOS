import type { Falsification } from "./falsification.ts";
import { EVIDENCE_KINDS, type Invariant } from "./invariant.ts";
import { INVARIANTS } from "./registry.ts";

/**
 * Evaluating an invariant against observations.
 *
 * Six outcomes rather than two, because "not satisfied" hides the difference
 * between work that has not started, instrumentation that is missing, a real
 * defect, and a symptom of something else being broken. Those call for
 * different actions and a report that conflates them sends people to the wrong
 * one.
 */
export type InvariantStatus =
  /** Every observation was measured and held, and at least one can fail. */
  | "satisfied"
  /** Measured true throughout, but no observation has been shown able to fail. */
  | "unfalsified"
  /** An observation was measured and did not hold. */
  | "failed"
  /** A dependency is not satisfied; this one would otherwise hold. */
  | "blocked"
  /** An observation exists but could not be measured. Fails closed. */
  | "unmeasured"
  /** No observation exists for this property at all. */
  | "no_observer";

/**
 * Precedence, worst first. Fixed here rather than implied by the order of a
 * few `if` statements, because that is where it went wrong once already.
 *
 * The rule behind the order: report the strongest thing actually known. A
 * measured failure is knowledge and outranks every form of not-knowing, even
 * when something upstream is also broken and even when another observation was
 * never built. `unfalsified` sits below `unmeasured` rather than above it, as
 * it is a claim *about observations that held* — an invariant with anything
 * unmeasured has not earned the right to be described that way.
 */
export const STATUS_PRECEDENCE: readonly InvariantStatus[] = [
  "failed",
  "no_observer",
  "unmeasured",
  "blocked",
  "unfalsified",
  "satisfied",
];

/** The minimum an observation source has to provide. */
export interface ObservationLike {
  readonly id: string;
  readonly value: number | boolean | string | null;
  readonly method: string;
}

export interface ObservationLookup {
  get(id: string): ObservationLike | undefined;
}

export interface ObservationOutcome {
  readonly id: string;
  /** null when present but unmeasurable, undefined-as-missing is `exists`. */
  readonly held: boolean | null;
  readonly exists: boolean;
  readonly method: string | null;
}

export interface InvariantResult {
  readonly id: string;
  readonly title: string;
  readonly category: Invariant["category"];
  readonly severity: Invariant["severity"];
  readonly capability: string;
  readonly status: InvariantStatus;
  readonly observations: readonly ObservationOutcome[];
  /** The dependency holding this back, when status is `blocked`. */
  readonly blockedBy: string | null;
  /** What to do next, derived from the outcome rather than written per case. */
  readonly nextAction: string;
}

/**
 * Whether an observed value counts as the property holding.
 *
 * A number counts when above zero and a string when non-empty, which are the
 * only readings that make sense for the counts and identifiers the observation
 * layer produces. `null` is not false — it is unmeasured, and handled apart.
 */
function held(value: number | boolean | string | null): boolean | null {
  if (value === null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  return value.trim().length > 0;
}

function outcomes(
  invariant: Invariant,
  observations: ObservationLookup
): readonly ObservationOutcome[] {
  return invariant.observations.map((id) => {
    const observation = observations.get(id);
    return observation
      ? { id, held: held(observation.value), exists: true, method: observation.method }
      : { id, held: null, exists: false, method: null };
  });
}

export interface EvaluateOptions {
  readonly observations: ObservationLookup;
  readonly falsifications: ReadonlyMap<string, Falsification>;
  readonly registry?: readonly Invariant[];
}

/**
 * Evaluates one invariant.
 *
 * Own state is decided before dependencies. An invariant whose own observations
 * were measured and failed reports `failed` even when something upstream is
 * also broken: the measurement happened and its result is information the
 * dependency does not explain. `blocked` is reserved for the case where this
 * invariant would otherwise be fine, which is exactly when the upstream failure
 * is the whole story.
 */
export function evaluateInvariant(invariant: Invariant, options: EvaluateOptions): InvariantResult {
  const observed = outcomes(invariant, options.observations);
  const base = {
    id: invariant.id,
    title: invariant.title,
    category: invariant.category,
    severity: invariant.severity,
    capability: invariant.capability,
    observations: observed,
  };

  // Order matters and is fixed in STATUS_PRECEDENCE above. `failed` was second
  // here until an invariant with one observation measured false and another
  // never built reported `no_observer` — burying a real, measured defect behind
  // missing instrumentation. That is the same mistake as reporting `blocked`
  // over a local failure, made in the code that was written to avoid it.
  const failing = observed.filter((o) => o.held === false);
  if (failing.length > 0) {
    return {
      ...base,
      status: "failed",
      blockedBy: null,
      nextAction: `${failing.map((o) => o.id).join(", ")} was measured and did not hold.`,
    };
  }

  const missing = observed.filter((o) => !o.exists);
  if (missing.length > 0) {
    return {
      ...base,
      status: "no_observer",
      blockedBy: null,
      nextAction: `Instrument ${missing.map((o) => o.id).join(", ")} in the observation layer.`,
    };
  }

  const unmeasured = observed.filter((o) => o.held === null);
  if (unmeasured.length > 0) {
    return {
      ...base,
      status: "unmeasured",
      blockedBy: null,
      nextAction: `${unmeasured.map((o) => o.id).join(", ")} could not be measured. Until it can, this fails closed.`,
    };
  }

  const registry = options.registry ?? INVARIANTS;
  for (const dependencyId of invariant.dependsOn) {
    const dependency = registry.find((i) => i.id === dependencyId);
    if (!dependency) continue;
    const result = evaluateInvariant(dependency, options);
    if (result.status !== "satisfied") {
      return {
        ...base,
        status: "blocked",
        blockedBy: dependencyId,
        nextAction: `Held back by ${dependencyId} (${result.status}): ${result.nextAction}`,
      };
    }
  }

  // GV-000, enforced rather than described. A critical property may not report
  // satisfied on the strength of observations that have never been seen to
  // produce any other answer.
  if (invariant.severity === "critical") {
    const falsifiable = invariant.observations.some((id) => options.falsifications.has(id));
    if (!falsifiable) {
      return {
        ...base,
        status: "unfalsified",
        blockedBy: null,
        nextAction: `Break one of ${invariant.observations.join(", ")} deliberately, confirm it reports false, and record it under docs/falsification/.`,
      };
    }
  }

  return {
    ...base,
    status: "satisfied",
    blockedBy: null,
    nextAction: "Holding. Re-measured on every run.",
  };
}

export function evaluateAll(options: EvaluateOptions): readonly InvariantResult[] {
  const registry = options.registry ?? INVARIANTS;
  return registry.map((i) => evaluateInvariant(i, { ...options, registry }));
}

/** Whether any declared evidence kind is permitted to raise this invariant. */
export function canBeRaised(invariant: Invariant): boolean {
  return invariant.evidenceKinds.some((kind) => EVIDENCE_KINDS[kind].raises);
}
