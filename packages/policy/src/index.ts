import { isReserved } from "@legalos/governance";
import type { WorkflowResult } from "@legalos/rules";
import type { Finding, Verdict } from "@legalos/verification";

/**
 * @legalos/policy — the release decision.
 *
 * Verification answers "is this text supportable?". Policy answers a different
 * question: "given that verdict, what should happen to it?" — show it, show it
 * with caveats, withhold it, or send it to a human.
 *
 * These were entangled in the web app: a WITHHOLD_CODES set sat inside the
 * request path, so the rule deciding what users may see lived next to the code
 * calling the model, was untestable on its own, and would have drifted the
 * moment a second surface needed the same decision. Verification is about
 * evidence; policy is about consequences, and consequences are what a regulator
 * asks about.
 */

export type Disposition = "release" | "release_with_caveats" | "withhold" | "escalate";

export type PolicyCode =
  | "POL-HARMFUL-CONTENT"
  | "POL-UNVERIFIED-SOURCING"
  | "POL-ENGINE-DISAGREEMENT"
  | "POL-RESERVED-ACTIVITY"
  | "POL-OUT-OF-JURISDICTION"
  | "POL-NO-CONCLUSION-AVAILABLE";

export interface PolicyReason {
  readonly code: PolicyCode;
  readonly detail: string;
  /** Verification findings that triggered this reason, where applicable. */
  readonly findings: readonly string[];
}

export interface PolicyDecision {
  readonly disposition: Disposition;
  /** True only when the text may be shown as legal information. */
  readonly releasable: boolean;
  /** True when the text may be shown at all, caveated or not. */
  readonly displayable: boolean;
  readonly humanReviewRequired: boolean;
  readonly reasons: readonly PolicyReason[];
}

/**
 * Findings whose content is harmful to show regardless of framing. No caveat
 * makes a guaranteed outcome or "you don't need a solicitor" safe, so these
 * withhold rather than annotate.
 */
const HARMFUL = new Set([
  "VER-005", // guarantees an outcome
  "VER-006", // discourages representation
  "VER-007", // asserts a numeric confidence
  "VER-009", // empty output
]);

/** Findings that mean the text is unverified, not that it is dangerous. */
const SOURCING = new Set([
  "VER-001", // citation does not resolve
  "VER-002", // source not verified
  "VER-003", // legal claim with no citation
  "VER-010", // no acknowledgement of limits
]);

export interface PolicyInput {
  readonly verdict: Verdict;
  readonly ruleResult?: WorkflowResult;
  /**
   * The activity the user is asking the system to perform, if identifiable.
   * A reserved activity is escalated regardless of how good the text is.
   */
  readonly requestedActivity?: string;
  /** Jurisdiction the question concerns, if identifiable. */
  readonly jurisdiction?: string;
}

/** Jurisdictions this platform is built for. */
export const SUPPORTED_JURISDICTIONS = ["england-and-wales", "uk"] as const;

export function decide(input: PolicyInput): PolicyDecision {
  const { verdict, ruleResult, requestedActivity, jurisdiction } = input;
  const reasons: PolicyReason[] = [];

  const codesOf = (predicate: (f: Finding) => boolean): readonly string[] =>
    verdict.findings.filter(predicate).map((f) => f.code);

  const harmful = codesOf((f) => HARMFUL.has(f.code));
  const sourcing = codesOf((f) => SOURCING.has(f.code));
  const disagreement = codesOf((f) => f.code === "VER-004");

  if (harmful.length > 0) {
    reasons.push({
      code: "POL-HARMFUL-CONTENT",
      detail:
        "The text contains a guarantee, a fabricated confidence figure, advice to proceed without representation, or nothing at all. No caveat makes this safe to display.",
      findings: harmful,
    });
  }

  if (disagreement.length > 0) {
    reasons.push({
      code: "POL-ENGINE-DISAGREEMENT",
      detail:
        "The text asserts an outcome the deterministic rule engine does not support on the same facts.",
      findings: disagreement,
    });
  }

  if (sourcing.length > 0) {
    reasons.push({
      code: "POL-UNVERIFIED-SOURCING",
      detail:
        "Citations could not be resolved to verified sources, so the text may be shown only as unverified information.",
      findings: sourcing,
    });
  }

  if (requestedActivity && isReserved(requestedActivity)) {
    reasons.push({
      code: "POL-RESERVED-ACTIVITY",
      detail: `"${requestedActivity}" is a reserved legal activity and requires a regulated human.`,
      findings: [],
    });
  }

  if (jurisdiction && !isSupported(jurisdiction)) {
    reasons.push({
      code: "POL-OUT-OF-JURISDICTION",
      detail: `This platform covers ${SUPPORTED_JURISDICTIONS.join(" and ")}; "${jurisdiction}" is outside it.`,
      findings: [],
    });
  }

  if (ruleResult && !ruleResult.releasable) {
    reasons.push({
      code: "POL-NO-CONCLUSION-AVAILABLE",
      detail: `The rule engine could not release a conclusion (${ruleResult.blockers.join(", ") || "no blockers recorded"}).`,
      findings: [],
    });
  }

  return finalise(reasons);
}

function finalise(reasons: readonly PolicyReason[]): PolicyDecision {
  const has = (code: PolicyCode) => reasons.some((r) => r.code === code);

  // Order matters: withholding beats escalation beats caveats. A reserved
  // activity request whose text is also harmful must not be "escalated" in a
  // way that shows the harmful text to the reviewer's client.
  if (has("POL-HARMFUL-CONTENT") || has("POL-ENGINE-DISAGREEMENT")) {
    return {
      disposition: "withhold",
      releasable: false,
      displayable: false,
      humanReviewRequired: true,
      reasons,
    };
  }

  if (has("POL-RESERVED-ACTIVITY") || has("POL-OUT-OF-JURISDICTION")) {
    return {
      disposition: "escalate",
      releasable: false,
      displayable: false,
      humanReviewRequired: true,
      reasons,
    };
  }

  if (has("POL-UNVERIFIED-SOURCING") || has("POL-NO-CONCLUSION-AVAILABLE")) {
    return {
      disposition: "release_with_caveats",
      releasable: false,
      displayable: true,
      humanReviewRequired: true,
      reasons,
    };
  }

  return {
    disposition: "release",
    releasable: true,
    displayable: true,
    humanReviewRequired: false,
    reasons: [],
  };
}

function isSupported(jurisdiction: string): boolean {
  const normalised = jurisdiction.trim().toLowerCase().replace(/\s+/g, "-");
  return (SUPPORTED_JURISDICTIONS as readonly string[]).includes(normalised);
}
