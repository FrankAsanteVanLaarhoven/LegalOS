import type { WorkflowResult } from "@legalos/rules";
import type { Verdict } from "@legalos/verification";

import type { CompletenessResult } from "./metrics.ts";

/**
 * What the platform is allowed to say about how much to rely on an answer.
 *
 * There is no numeric field here, and that is the entire design. A percentage is
 * the most decision-influencing token on the screen for someone deciding whether
 * to act on legal information; emitting one that no calibrated process produced
 * is worse than saying nothing, because it tells the user *how much* to trust an
 * unverified answer.
 *
 * What can be stated honestly is mechanical: which sources resolved, which
 * requirements the deterministic engine could not decide, what evidence is
 * missing, and what was not checked.
 */

export type ReliancePosture = "not_releasable" | "informational_only" | "review_required";

export interface CertaintyDisclosure {
  readonly posture: ReliancePosture;
  /** Plain-language statement of what the system did and did not establish. */
  readonly statement: string;
  readonly sourcesResolved: readonly string[];
  readonly unverifiedPoints: readonly string[];
  readonly missingEvidence: readonly string[];
  /** What would change the answer — the honest replacement for a confidence %. */
  readonly wouldChangeTheAnswer: readonly string[];
  readonly humanReviewRequired: boolean;
}

export interface DescribeCertaintyInput {
  readonly verdict: Verdict;
  readonly ruleResult?: WorkflowResult;
  readonly completeness?: CompletenessResult;
}

export function describeCertainty(input: DescribeCertaintyInput): CertaintyDisclosure {
  const { verdict, ruleResult, completeness } = input;

  const unverifiedPoints = verdict.findings.map((finding) => `${finding.title}: ${finding.detail}`);

  const missingEvidence = [
    ...(ruleResult?.missingEvidence ?? []),
    ...(completeness?.missing ?? []),
  ];

  const wouldChangeTheAnswer: string[] = [];
  if (ruleResult) {
    for (const outcome of ruleResult.outcomes) {
      if (outcome.result === "insufficient_evidence") {
        wouldChangeTheAnswer.push(
          `Evidence for "${outcome.requirementId}" (${outcome.missingFacts.join(", ") || "not yet decidable"})`
        );
      }
    }
    if (ruleResult.blockers.includes("SOURCE_UNUSABLE")) {
      wouldChangeTheAnswer.push("Verification of the underlying rule text against the publisher");
    }
  }

  const posture = derivePosture(verdict, ruleResult);

  return {
    posture,
    statement: buildStatement(posture, verdict, ruleResult),
    sourcesResolved: verdict.resolvedCitations,
    unverifiedPoints,
    missingEvidence: [...new Set(missingEvidence)],
    wouldChangeTheAnswer: [...new Set(wouldChangeTheAnswer)],
    humanReviewRequired: posture !== "informational_only",
  };
}

function derivePosture(verdict: Verdict, ruleResult: WorkflowResult | undefined): ReliancePosture {
  if (verdict.status === "block") return "not_releasable";
  if (ruleResult && !ruleResult.releasable) return "review_required";
  if (verdict.status === "flag") return "review_required";
  return "informational_only";
}

function buildStatement(
  posture: ReliancePosture,
  verdict: Verdict,
  ruleResult: WorkflowResult | undefined
): string {
  if (posture === "not_releasable") {
    return "This response was not released. It failed verification and has not been shown as legal information.";
  }
  const sourceCount = verdict.resolvedCitations.length;
  const sourcePart =
    sourceCount === 0
      ? "No legal source was cited and resolved"
      : `${sourceCount} cited source${sourceCount === 1 ? "" : "s"} resolved to verified text`;

  if (posture === "review_required") {
    const enginePart = ruleResult
      ? ` The rule engine returned "${ruleResult.decision}" and could not release a conclusion (${ruleResult.blockers.join(", ") || "no blockers recorded"}).`
      : "";
    return `${sourcePart}. This is general information, not advice on your case, and needs review by a qualified person before you act on it.${enginePart}`;
  }

  return `${sourcePart}. This is general information about the law, not advice about your case.`;
}
