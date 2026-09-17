import { isReserved } from "@legalos/governance";

/**
 * Draft provenance.
 *
 * A generated legal document is only usable if every factual assertion in it
 * can be traced to something on the file, and every legal proposition to a
 * source. Fluent prose is the easy part and the dangerous part: a skeleton
 * argument that reads well and cites a case that does not exist is worse than
 * no draft, because it survives review by looking finished.
 *
 * So a draft here is a list of assertions with backing, not a block of text.
 * Rendering to prose happens only after every assertion is backed.
 */

export type AssertionKind =
  | "fact" // something that happened, drawn from the case file
  | "legal_proposition" // a statement about the law
  | "submission" // an argument built on the two above
  | "instruction"; // a request to the reader, e.g. "please provide a report"

export interface Backing {
  /** Evidence artefact id, for facts. */
  readonly evidenceId?: string;
  /** Registered legal source id, for legal propositions. */
  readonly sourceId?: string;
  /** Verbatim text supporting the assertion. */
  readonly quote: string;
}

export interface DraftAssertion {
  readonly id: string;
  readonly kind: AssertionKind;
  readonly text: string;
  readonly backing: readonly Backing[];
}

export type DraftProblem =
  "UNBACKED_FACT" | "UNSOURCED_LAW" | "SUBMISSION_WITHOUT_BASIS" | "RESERVED_ACTIVITY";

export interface DraftFinding {
  readonly code: DraftProblem;
  readonly assertionId: string | null;
  readonly detail: string;
}

export interface DraftReview {
  /** True only when every assertion is backed and nothing is reserved. */
  readonly renderable: boolean;
  readonly findings: readonly DraftFinding[];
  /** Always true for legal documents — see `requiresProfessionalReview`. */
  readonly humanReviewRequired: boolean;
}

export interface Draft {
  readonly id: string;
  /** The document being produced, e.g. "witness_statement", "appeal_grounds". */
  readonly documentType: string;
  /** Who the draft is addressed to; drives register and structure. */
  readonly audience: "home_office" | "tribunal" | "court" | "clinician" | "third_party";
  readonly assertions: readonly DraftAssertion[];
}

/**
 * Document types whose production for another person is a reserved or
 * regulated activity in England and Wales.
 *
 * A litigant in person may draft their own appeal grounds. A platform drafting
 * them for someone else is a different actor, and in immigration that requires
 * IAA registration or a solicitor. This list is the technical half of that
 * question; the registration itself is not something code can satisfy.
 */
export const REGULATED_DOCUMENT_TYPES: readonly string[] = [
  "appeal_grounds",
  "skeleton_argument",
  "rule_24_response",
  "rule_15_2a_application",
  "section_120_response",
  "further_submissions",
  "administrative_review",
  "n244",
  "affidavit",
];

export function isRegulatedDocument(documentType: string): boolean {
  return REGULATED_DOCUMENT_TYPES.includes(documentType) || isReserved(documentType);
}

/**
 * Checks a draft before it may be rendered.
 *
 * Fails closed: an assertion with no backing blocks the whole draft rather than
 * being footnoted. Partial rendering would produce exactly the document this
 * exists to prevent — mostly sound, with an invented paragraph inside it.
 */
export function reviewDraft(draft: Draft): DraftReview {
  const findings: DraftFinding[] = [];

  for (const assertion of draft.assertions) {
    const hasQuote = assertion.backing.some((b) => b.quote.trim() !== "");

    if (assertion.kind === "fact") {
      const backed = assertion.backing.some((b) => Boolean(b.evidenceId)) && hasQuote;
      if (!backed) {
        findings.push({
          code: "UNBACKED_FACT",
          assertionId: assertion.id,
          detail: `"${truncate(assertion.text)}" states a fact with no evidence on file behind it.`,
        });
      }
    }

    if (assertion.kind === "legal_proposition") {
      const sourced = assertion.backing.some((b) => Boolean(b.sourceId)) && hasQuote;
      if (!sourced) {
        findings.push({
          code: "UNSOURCED_LAW",
          assertionId: assertion.id,
          detail: `"${truncate(assertion.text)}" states the law with no registered source behind it.`,
        });
      }
    }

    if (assertion.kind === "submission" && assertion.backing.length === 0) {
      findings.push({
        code: "SUBMISSION_WITHOUT_BASIS",
        assertionId: assertion.id,
        detail: `"${truncate(assertion.text)}" argues a point resting on nothing in the draft.`,
      });
    }
  }

  if (isRegulatedDocument(draft.documentType)) {
    findings.push({
      code: "RESERVED_ACTIVITY",
      assertionId: null,
      detail: `Producing a ${draft.documentType.replace(/_/g, " ")} for another person is regulated; it requires a registered adviser or solicitor.`,
    });
  }

  return {
    renderable: findings.length === 0,
    findings,
    humanReviewRequired: true,
  };
}

/**
 * Every legal draft requires professional review before it is used.
 *
 * A constant rather than a computation, deliberately: there is no combination
 * of backing that makes a machine-generated legal document safe to file
 * unreviewed, so there must be no code path that concludes otherwise.
 */
export function requiresProfessionalReview(): true {
  return true;
}

function truncate(text: string, length = 60): string {
  return text.length <= length ? text : `${text.slice(0, length)}…`;
}
