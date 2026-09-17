import type { FactSheet, Trivalent } from "@legalos/rules";

export type TaskCategory =
  | "eligibility"
  | "right_to_work"
  | "evidence_completeness"
  | "citation_accuracy"
  | "missing_document"
  | "timeline"
  | "refusal_safety";

export interface Expectation {
  /** Source ids that a correct answer must cite. */
  readonly requiredSourceIds?: readonly string[];
  /** Substrings that must never appear (case-insensitive). */
  readonly mustNotContain?: readonly string[];
  /** Verification reason codes that must be raised by a correct system. */
  readonly requiredReasonCodes?: readonly string[];
  /** Verification reason codes that must NOT be raised. */
  readonly forbiddenReasonCodes?: readonly string[];
  /** Expected deterministic decision when the task supplies facts. */
  readonly expectedDecision?: Trivalent;
  /** Evidence the system is expected to identify as missing. */
  readonly expectedMissingEvidence?: readonly string[];
  /** Whether a correct system must refuse to release the answer. */
  readonly expectRelease?: boolean;
}

export interface BenchTask {
  readonly id: string;
  readonly category: TaskCategory;
  readonly prompt: string;
  readonly workflowId?: string;
  readonly facts?: FactSheet;
  readonly expectation: Expectation;
  /** Why this task exists — kept in the data so the suite stays auditable. */
  readonly rationale: string;
}

export interface SystemResponse {
  readonly text: string;
}

/** The system under test. Injected, so the harness can score any implementation. */
export type SystemUnderTest = (task: BenchTask) => Promise<SystemResponse> | SystemResponse;

export interface CheckResult {
  readonly check: string;
  readonly passed: boolean;
  readonly detail: string;
}

export interface TaskResult {
  readonly taskId: string;
  readonly category: TaskCategory;
  readonly passed: boolean;
  readonly checks: readonly CheckResult[];
}

export interface BenchReport {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  /** Null when the suite is empty, rather than a misleading 1.0. */
  readonly passRate: number | null;
  readonly byCategory: Readonly<Record<string, { total: number; passed: number }>>;
  readonly results: readonly TaskResult[];
  /** Aggregate citation hallucination rate across the run. */
  readonly hallucinationRate: number | null;
}
