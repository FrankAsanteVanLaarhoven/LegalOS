/**
 * Repository contracts — what a caller may rely on, declared apart from the
 * code that provides it.
 *
 * A repository interface says what you can call. That is not a domain boundary,
 * it is a data-access layer with types. The interesting part of
 * `readDeadlines(caseId)` is not its signature — it is everything the caller may
 * assume without checking: that nothing from another organisation is in the
 * result, that a superseded direction is not in it, that no date arrives without
 * the source it came from.
 *
 * Those assumptions are load-bearing. A panel written against them will not
 * re-check them, so if one silently stops holding the panel keeps rendering and
 * starts lying. Declaring them here makes them reviewable; requiring each one to
 * name the check that proves it makes them measurable.
 *
 * The rule this file exists to enforce:
 *
 *   A guarantee is honoured only when a test has attempted the failure it
 *   names and the attempt was refused.
 *
 * Not when the method exists. Not when the table exists. The distinction is the
 * same one that made `1 of 16` the honest count for the workspace: presence is
 * not evidence, and a contract layer that graded itself on presence would be the
 * most confident-looking untruth in the repository.
 */

export const GUARANTEE_KINDS = [
  /** Rows from another tenancy cannot appear, whatever the caller passes. */
  "scoping",
  /** The caller's permission decides what is returned, and is resolved safely. */
  "permission",
  /** A value is never emitted without the provenance that makes it checkable. */
  "provenance",
  /** What is deliberately excluded from a default read, and why. */
  "filtering",
  /** Absence, unreachability and refusal stay distinguishable. */
  "availability",
  /** A write records who did it, and cannot quietly overwrite. */
  "integrity",
  /** Something a reader might expect to be emitted that never is. */
  "abstention",
] as const;

export type GuaranteeKind = (typeof GUARANTEE_KINDS)[number];

export interface Guarantee {
  /** Stable id, e.g. `DL-G3`. Cited from tests and commits. */
  readonly id: string;
  /** What the caller may rely on, in words a reviewer can check. */
  readonly statement: string;
  readonly kind: GuaranteeKind;
  /**
   * The concrete failure this prevents, written as the thing that would go
   * wrong rather than as the property restated in the negative.
   *
   * This field is what a proving test is written against. "Is organisation
   * scoped" tells a test author nothing; "a deadline belonging to another
   * organisation appears in a caseworker's list" tells them exactly what to
   * attempt.
   */
  readonly refuses: string;
  /**
   * Evidence check id demonstrating it — the same ids the integration suite
   * emits under `docs/integration-evidence/`. A guarantee that names none can
   * never be honoured, which is checked structurally rather than left to
   * reviewers.
   */
  readonly provedBy: string;
}

export interface RepositoryContractSpec {
  /** The domain name, e.g. `DeadlineRepository`. */
  readonly repository: string;
  /**
   * The module that will provide it. Its existence is what turns an unproven
   * guarantee from an expected state into a build failure, so this path is the
   * switch between "not written yet" and "written and unverified".
   */
  readonly module: string;
  /** Why this boundary exists, in terms of the person it protects. */
  readonly rationale: string;
  /** Tables it reads. Validated against the migrations. */
  readonly tables: readonly string[];
  /** Workspace surfaces that will depend on it, so the blast radius is visible. */
  readonly surfaces: readonly string[];
  /** System invariants this repository sits on the path of. Validated against the ESI registry. */
  readonly invariants: readonly string[];
  readonly guarantees: readonly Guarantee[];
}

export type RepositoryContract = RepositoryContractSpec;

/**
 * Declares a contract.
 *
 * No validation here, for the same reason `defineInvariant` does none: the
 * defects worth catching are relational — a guarantee id used twice across two
 * contracts, a table no migration creates, an invariant id that does not exist.
 * None of those is visible from inside one declaration.
 */
export function defineContract(spec: RepositoryContractSpec): RepositoryContract {
  return spec;
}
