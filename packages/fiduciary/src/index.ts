/**
 * @legalos/fiduciary — loyalty, confidentiality, and candour as executable checks.
 *
 * Fiduciary duties are usually written as principles in a policy document, where
 * nothing enforces them. Here they are functions that run before content leaves
 * the system: does this disclose one client's material to another, does it send
 * special-category data to a third party, does it present an assumption as a fact.
 */

export type DutyCode = "FID-CONFIDENTIALITY" | "FID-CONFLICT" | "FID-CANDOUR" | "FID-LOYALTY";

export interface DutyBreach {
  readonly code: DutyCode;
  readonly detail: string;
  readonly evidence: string | null;
}

/* ------------------------------------------------------------------ */
/* Confidentiality                                                     */
/* ------------------------------------------------------------------ */

interface Detector {
  readonly label: string;
  readonly regex: RegExp;
}

/**
 * Identifiers that must not be sent to a third-party model provider without a
 * deliberate decision. Deliberately narrow and UK-shaped — a broad "PII regex"
 * that matches everything gets switched off in practice.
 */
const IDENTIFIER_DETECTORS: readonly Detector[] = [
  { label: "Home Office reference", regex: /\b[A-Z]{1,2}\d{6,10}\b/g },
  { label: "National Insurance number", regex: /\b[A-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b/g },
  { label: "UK postcode", regex: /\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/gi },
  { label: "email address", regex: /\b[\w.+-]+@[\w-]+\.[\w.]{2,}\b/g },
  { label: "UK phone number", regex: /\b(?:\+44\s?7\d{3}|\(?07\d{3}\)?)\s?\d{3}\s?\d{3}\b/g },
  { label: "date of birth", regex: /\b\d{1,2}[/-]\d{1,2}[/-](?:19|20)\d{2}\b/g },
];

/**
 * Categories where disclosure carries elevated risk for this cohort. Presence is
 * not automatically a breach — a case file is *about* these things — but sending
 * them outside the trust boundary is a decision that must be explicit.
 */
const SPECIAL_CATEGORY_TERMS =
  /\b(?:asylum|trafficking|traffick\w*|modern slavery|NRM|PTSD|suicide|self-harm|rape|sexual violence|domestic abuse|forced marriage|HIV|pregnan\w+|religio\w+|sexual orientation)\b/gi;

export interface ConfidentialityReport {
  readonly identifiers: readonly { label: string; text: string }[];
  readonly specialCategoryTerms: readonly string[];
  readonly safeToSendExternally: boolean;
  readonly breaches: readonly DutyBreach[];
}

export function inspectConfidentiality(text: string): ConfidentialityReport {
  const identifiers: { label: string; text: string }[] = [];
  for (const { label, regex } of IDENTIFIER_DETECTORS) {
    regex.lastIndex = 0;
    for (const match of text.matchAll(regex)) {
      identifiers.push({ label, text: match[0] });
    }
  }

  SPECIAL_CATEGORY_TERMS.lastIndex = 0;
  const specialCategoryTerms = [
    ...new Set([...text.matchAll(SPECIAL_CATEGORY_TERMS)].map((m) => m[0].toLowerCase())),
  ];

  const breaches: DutyBreach[] = [];
  for (const identifier of identifiers) {
    breaches.push({
      code: "FID-CONFIDENTIALITY",
      detail: `Content contains a direct identifier (${identifier.label}) and must not leave the trust boundary unredacted.`,
      evidence: identifier.text,
    });
  }

  return {
    identifiers,
    specialCategoryTerms,
    safeToSendExternally: identifiers.length === 0,
    breaches,
  };
}

/** Replaces detected identifiers with typed placeholders, preserving structure. */
export function redact(text: string): string {
  let output = text;
  for (const { label, regex } of IDENTIFIER_DETECTORS) {
    regex.lastIndex = 0;
    output = output.replace(regex, `[redacted: ${label}]`);
  }
  return output;
}

/* ------------------------------------------------------------------ */
/* Conflicts of interest                                               */
/* ------------------------------------------------------------------ */

export interface Matter {
  readonly id: string;
  readonly clientId: string;
  /** Parties adverse to the client in this matter. */
  readonly adverseParties: readonly string[];
  readonly assignedTo: readonly string[];
}

export function detectConflicts(
  candidate: Matter,
  existing: readonly Matter[]
): readonly DutyBreach[] {
  const breaches: DutyBreach[] = [];
  for (const other of existing) {
    if (other.id === candidate.id) continue;

    const sharedAdvisers = candidate.assignedTo.filter((adviser) =>
      other.assignedTo.includes(adviser)
    );
    if (sharedAdvisers.length === 0) continue;

    if (other.adverseParties.includes(candidate.clientId)) {
      breaches.push({
        code: "FID-CONFLICT",
        detail: `${sharedAdvisers.join(", ")} acts in matter ${other.id}, where this client is an adverse party.`,
        evidence: other.id,
      });
    }
    if (candidate.adverseParties.includes(other.clientId)) {
      breaches.push({
        code: "FID-CONFLICT",
        detail: `${sharedAdvisers.join(", ")} acts for ${other.clientId}, who is an adverse party in this matter.`,
        evidence: other.id,
      });
    }
  }
  return breaches;
}

/* ------------------------------------------------------------------ */
/* Candour — facts vs assumptions                                      */
/* ------------------------------------------------------------------ */

export interface Assertion {
  readonly text: string;
  /** Evidence ids supporting the assertion. Empty means it is an assumption. */
  readonly evidenceIds: readonly string[];
}

export interface CandourReport {
  readonly facts: readonly string[];
  readonly assumptions: readonly string[];
  readonly breaches: readonly DutyBreach[];
}

const HEDGE =
  /\b(?:assum\w+|if|appears?|reportedly|understood to|unconfirmed|states?|stated|stating|claims?|instructs?|believes?|may|might|possibly)\b/i;

/**
 * An unevidenced assertion is not forbidden — much of a case starts as client
 * instructions — but it must be presented as an assumption, not as a finding.
 */
export function assessCandour(assertions: readonly Assertion[]): CandourReport {
  const facts: string[] = [];
  const assumptions: string[] = [];
  const breaches: DutyBreach[] = [];

  for (const assertion of assertions) {
    if (assertion.evidenceIds.length > 0) {
      facts.push(assertion.text);
      continue;
    }
    assumptions.push(assertion.text);
    if (!HEDGE.test(assertion.text)) {
      breaches.push({
        code: "FID-CANDOUR",
        detail:
          "Stated as established fact with no supporting evidence and no indication that it is an assumption.",
        evidence: assertion.text,
      });
    }
  }

  return { facts, assumptions, breaches };
}

/* ------------------------------------------------------------------ */
/* Combined assessment                                                 */
/* ------------------------------------------------------------------ */

export interface FiduciaryAssessment {
  readonly breaches: readonly DutyBreach[];
  readonly clear: boolean;
}

export function assess(input: {
  text?: string;
  matter?: { candidate: Matter; existing: readonly Matter[] };
  assertions?: readonly Assertion[];
}): FiduciaryAssessment {
  const breaches: DutyBreach[] = [];
  if (input.text !== undefined) {
    breaches.push(...inspectConfidentiality(input.text).breaches);
  }
  if (input.matter) {
    breaches.push(...detectConflicts(input.matter.candidate, input.matter.existing));
  }
  if (input.assertions) {
    breaches.push(...assessCandour(input.assertions).breaches);
  }
  return { breaches, clear: breaches.length === 0 };
}
