/**
 * System invariants — properties that must hold, declared apart from the code
 * that makes them hold.
 *
 * The capability layer answers "how mature is this subsystem". That turned out
 * to be the wrong unit for trust. A subsystem can be mature and still let
 * evidence cross a tenant boundary, because maturity is measured per subsystem
 * and the property spans several. An invariant is stated once and evaluated
 * across whatever it touches.
 *
 * An invariant declares three things and no more:
 *
 *   - what must hold, in words a non-engineer can check
 *   - which observations would demonstrate it
 *   - which capability it belongs to and what it depends on
 *
 * It contains no logic. The moment an invariant can compute its own answer it
 * can be written to compute a convenient one, which is how five checks in the
 * authentication milestone came to look correct while asking nothing.
 */

export const CATEGORIES = [
  "security",
  "privacy",
  "ai",
  "evidence",
  "governance",
  "audit",
  "tenancy",
  "verification",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const SEVERITIES = ["critical", "high", "medium"] as const;
export type Severity = (typeof SEVERITIES)[number];

/**
 * How a piece of evidence may move an invariant.
 *
 * The asymmetry is the point. A passing adversarial test demonstrates
 * resistance to one attack that someone thought of; it says nothing about the
 * class. Treated as proof it becomes the most dangerous evidence in the system,
 * because it reads as coverage. So security tests and static analysis can pull
 * an invariant down and can never, on their own, hold one up.
 */
export const EVIDENCE_KINDS = {
  unit: {
    raises: false,
    lowers: true,
    why: "Units in isolation cannot show a property that spans them.",
  },
  integration: {
    raises: true,
    lowers: true,
    why: "Exercises the pieces together against real infrastructure.",
  },
  security: {
    raises: false,
    lowers: true,
    why: "A blocked payload is not immunity to the class of attack.",
  },
  static: { raises: false, lowers: true, why: "Reading source shows shape, not behaviour." },
  telemetry: { raises: true, lowers: true, why: "Measured in real use." },
  audit: { raises: true, lowers: true, why: "Judged by someone outside the project." },
} as const;

export type EvidenceKind = keyof typeof EVIDENCE_KINDS;

export interface InvariantSpec {
  /** Stable identifier, e.g. `INV-001`. Referenced from commits and reports. */
  readonly id: string;
  readonly title: string;
  readonly category: Category;
  readonly severity: Severity;
  /** Why this matters, in terms of the person it protects rather than the code. */
  readonly rationale: string;
  /**
   * Observation ids that together demonstrate the property. Every one must
   * hold; an invariant is not satisfied by a majority of its observations.
   */
  readonly observations: readonly string[];
  /** The capability this belongs to, so the two views stay reconciled. */
  readonly capability: string;
  /**
   * Paths this property protects, so a report answers "where do I work" and not
   * only "what is broken".
   *
   * Validated against the filesystem rather than taken on trust. A traceability
   * list nobody checks rots into a list of directories that used to exist, and
   * then points the next person at the wrong place — which is worse than having
   * no list, because it is followed.
   */
  readonly protects: readonly string[];
  /**
   * Invariants that must hold first. A dependency that is not satisfied makes
   * this one `blocked` rather than `failed` — a distinction that separates a
   * root cause from its symptoms, so a report names the one thing to fix.
   */
  readonly dependsOn?: readonly string[];
  /** Kinds of evidence that may raise this invariant. At least one must raise. */
  readonly evidenceKinds: readonly EvidenceKind[];
}

export interface Invariant extends InvariantSpec {
  readonly dependsOn: readonly string[];
}

/**
 * Declares an invariant.
 *
 * Deliberately not a class and not validating here: structural validation runs
 * over the whole registry at once, because the interesting defects are
 * relational — a dependency on an id that does not exist, two invariants
 * claiming the same id, a cycle. None of those are visible from inside one
 * declaration.
 */
export function defineInvariant(spec: InvariantSpec): Invariant {
  return { ...spec, dependsOn: spec.dependsOn ?? [] };
}
