import type { Trivalent } from "./trivalent.ts";

export type FactValue = string | number | boolean;

/** A fact plus the evidence that supports it. Unsupported facts are assumptions. */
export interface Fact {
  readonly value: FactValue;
  /** Evidence artefact ids. Empty means the fact is asserted, not evidenced. */
  readonly evidenceIds: readonly string[];
}

export type FactSheet = Readonly<Record<string, Fact>>;

export interface ResolvedFacts {
  get(key: string): FactValue | undefined;
  string(key: string): string | undefined;
  number(key: string): number | undefined;
  boolean(key: string): boolean | undefined;
  /** True when the fact exists and is backed by at least one evidence artefact. */
  isEvidenced(key: string): boolean;
}

export interface Requirement {
  readonly id: string;
  /** Source in @legalos/knowledge that this requirement encodes. */
  readonly sourceId: string;
  /**
   * Paragraph/section within the source. `null` means not yet recorded —
   * the requirement cannot back releasable output until it is filled in.
   */
  readonly locator: string | null;
  readonly description: string;
  /** Fact keys required before `evaluate` is meaningful. */
  readonly requires: readonly string[];
  /** Evidence artefact types a caseworker would need to prove this. */
  readonly evidenceRequired: readonly string[];
  /** Called only when every key in `requires` is present. */
  evaluate(facts: ResolvedFacts): Trivalent;
}

export interface LegalWorkflow {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly combine: "all" | "any";
  readonly requirements: readonly Requirement[];
}

export interface RequirementOutcome {
  readonly requirementId: string;
  readonly result: Trivalent;
  readonly sourceId: string;
  readonly locator: string | null;
  readonly missingFacts: readonly string[];
  readonly missingEvidence: readonly string[];
  /** Facts used that were asserted without supporting evidence. */
  readonly unevidencedFacts: readonly string[];
}

export type ReleaseBlocker =
  "SOURCE_UNUSABLE" | "LOCATOR_MISSING" | "INSUFFICIENT_EVIDENCE" | "UNEVIDENCED_FACTS";

export interface WorkflowResult {
  readonly workflowId: string;
  /** The logical outcome. Never show this to a user unless `releasable` is true. */
  readonly decision: Trivalent;
  readonly outcomes: readonly RequirementOutcome[];
  readonly missingFacts: readonly string[];
  readonly missingEvidence: readonly string[];
  readonly sourceIds: readonly string[];
  /**
   * False when the result must not be presented as a legal conclusion —
   * unusable sources, missing locators, or gaps in the evidence base.
   */
  readonly releasable: boolean;
  readonly blockers: readonly ReleaseBlocker[];
}
