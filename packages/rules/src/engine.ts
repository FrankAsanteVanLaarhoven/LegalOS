import type { SourceRegistry } from "@legalos/knowledge";

import { and, or, type Trivalent } from "./trivalent.ts";
import type {
  FactSheet,
  FactValue,
  LegalWorkflow,
  ReleaseBlocker,
  Requirement,
  RequirementOutcome,
  ResolvedFacts,
  WorkflowResult,
} from "./types.ts";

function resolveFacts(facts: FactSheet): ResolvedFacts {
  return {
    get: (key) => facts[key]?.value,
    string: (key) => {
      const value = facts[key]?.value;
      return typeof value === "string" ? value : undefined;
    },
    number: (key) => {
      const value = facts[key]?.value;
      return typeof value === "number" ? value : undefined;
    },
    boolean: (key) => {
      const value = facts[key]?.value;
      return typeof value === "boolean" ? value : undefined;
    },
    isEvidenced: (key) => (facts[key]?.evidenceIds.length ?? 0) > 0,
  };
}

function evaluateRequirement(
  requirement: Requirement,
  facts: FactSheet,
  resolved: ResolvedFacts
): RequirementOutcome {
  const missingFacts = requirement.requires.filter((key) => facts[key] === undefined);
  const unevidencedFacts = requirement.requires.filter(
    (key) => facts[key] !== undefined && facts[key]!.evidenceIds.length === 0
  );

  if (missingFacts.length > 0) {
    return {
      requirementId: requirement.id,
      result: "insufficient_evidence",
      sourceId: requirement.sourceId,
      locator: requirement.locator,
      missingFacts,
      missingEvidence: requirement.evidenceRequired,
      unevidencedFacts,
    };
  }

  // A requirement author may still return `insufficient_evidence` for facts that
  // are present but not decisive (e.g. a threshold that has no verified value).
  const result = requirement.evaluate(resolved);

  return {
    requirementId: requirement.id,
    result,
    sourceId: requirement.sourceId,
    locator: requirement.locator,
    missingFacts: [],
    missingEvidence: result === "insufficient_evidence" ? requirement.evidenceRequired : [],
    unevidencedFacts,
  };
}

export interface EvaluateOptions {
  /**
   * When provided, every requirement's source must resolve in this registry
   * for the result to be releasable. Omitting it forces `releasable: false`.
   */
  readonly registry?: SourceRegistry;
}

export function evaluateWorkflow(
  workflow: LegalWorkflow,
  facts: FactSheet,
  options: EvaluateOptions = {}
): WorkflowResult {
  const resolved = resolveFacts(facts);
  const outcomes = workflow.requirements.map((requirement) =>
    evaluateRequirement(requirement, facts, resolved)
  );

  const results = outcomes.map((outcome) => outcome.result);
  const decision: Trivalent = workflow.combine === "all" ? and(results) : or(results);

  const blockers = new Set<ReleaseBlocker>();

  const { registry } = options;
  for (const outcome of outcomes) {
    if (!registry || !registry.resolve(outcome.sourceId).ok) {
      blockers.add("SOURCE_UNUSABLE");
    }
    if (outcome.locator === null) blockers.add("LOCATOR_MISSING");
    if (outcome.unevidencedFacts.length > 0) blockers.add("UNEVIDENCED_FACTS");
  }
  if (decision === "insufficient_evidence") {
    blockers.add("INSUFFICIENT_EVIDENCE");
  }

  const missingFacts = dedupe(outcomes.flatMap((o) => o.missingFacts));
  const missingEvidence = dedupe(outcomes.flatMap((o) => o.missingEvidence));

  return {
    workflowId: workflow.id,
    decision,
    outcomes,
    missingFacts,
    missingEvidence,
    sourceIds: dedupe(outcomes.map((o) => o.sourceId)),
    releasable: blockers.size === 0,
    blockers: [...blockers],
  };
}

function dedupe(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

/** Helper for building fact sheets in callers and tests. */
export function fact(
  value: FactValue,
  evidenceIds: readonly string[] = []
): { value: FactValue; evidenceIds: readonly string[] } {
  return { value, evidenceIds };
}
