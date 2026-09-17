/**
 * Verification reason codes.
 *
 * `block` means the text must not be shown as legal output. `flag` means it may
 * be shown but must carry the finding. There is deliberately no "warn and hope".
 */

export type Severity = "block" | "flag";

export interface ReasonCodeSpec {
  readonly code: string;
  readonly severity: Severity;
  readonly title: string;
  readonly rationale: string;
}

export const REASON_CODES: Readonly<Record<string, ReasonCodeSpec>> = {
  "VER-001": {
    code: "VER-001",
    severity: "block",
    title: "CITATION_UNRESOLVED",
    rationale:
      "The text cites law that does not resolve to a registered source. An unresolvable citation cannot be distinguished from an invented one.",
  },
  "VER-002": {
    code: "VER-002",
    severity: "block",
    title: "SOURCE_UNVERIFIED",
    rationale:
      "The cited source is registered but has never been retrieved and checksummed, so its current text is unknown.",
  },
  "VER-003": {
    code: "VER-003",
    severity: "flag",
    title: "UNCITED_LEGAL_CLAIM",
    rationale: "A legal proposition was stated with no citation at all.",
  },
  "VER-004": {
    code: "VER-004",
    severity: "block",
    title: "CONTRADICTS_RULE_ENGINE",
    rationale:
      "The text asserts an eligibility outcome that disagrees with the deterministic rule engine on the same facts.",
  },
  "VER-005": {
    code: "VER-005",
    severity: "block",
    title: "OUTCOME_GUARANTEE",
    rationale:
      "The text guarantees or predicts a legal outcome. No system may promise an immigration result.",
  },
  "VER-006": {
    code: "VER-006",
    severity: "block",
    title: "DISCOURAGES_REPRESENTATION",
    rationale:
      "The text suggests the user does not need a solicitor or adviser. Discouraging representation is the highest-harm failure mode for this cohort.",
  },
  "VER-007": {
    code: "VER-007",
    severity: "block",
    title: "UNSUPPORTED_CONFIDENCE",
    rationale:
      "The text asserts a numeric confidence or probability. A language model has no calibrated probability over legal outcomes.",
  },
  "VER-008": {
    code: "VER-008",
    severity: "flag",
    title: "RESERVED_ACTIVITY_DIRECTION",
    rationale:
      "The text directs the user to file, submit, or appeal. Reserved activities require a qualified human.",
  },
  "VER-009": {
    code: "VER-009",
    severity: "block",
    title: "EMPTY_OUTPUT",
    rationale:
      "There is no output to verify. Empty output must surface as an error, never be silently replaced with canned text.",
  },
  "VER-010": {
    code: "VER-010",
    severity: "flag",
    title: "NO_UNCERTAINTY_DISCLOSED",
    rationale: "A legal proposition was stated with no acknowledgement of what was not verified.",
  },
} as const;

export function specFor(code: string): ReasonCodeSpec {
  const spec = REASON_CODES[code];
  if (!spec) throw new Error(`unknown reason code: ${code}`);
  return spec;
}
