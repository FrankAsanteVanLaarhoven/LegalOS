/**
 * Machine-readable representation of legal sources.
 *
 * Design rule: a legal statement may never reach a user unless it resolves to a
 * registered source. "I could not find a source" is a valid, expected outcome —
 * inventing a rule number is not.
 */

export type SourceKind =
  | "primary_legislation"
  | "statutory_instrument"
  | "immigration_rule"
  | "home_office_guidance"
  | "practice_direction"
  | "tribunal_procedure_rule"
  | "case_law";

/**
 * `verified`   — text was retrieved from the publisher and checksummed in this repo.
 * `unverified` — the citation is recorded but nothing has been retrieved or checked.
 *                Fail-closed: unusable for user-facing legal conclusions.
 * `superseded` — known to be replaced; `supersededBy` points at the successor.
 */
export type VerificationStatus = "verified" | "unverified" | "superseded";

export interface LegalSource {
  /** Stable slug, e.g. `uk.immigration-rules.appendix-skilled-worker`. */
  readonly id: string;
  readonly kind: SourceKind;
  readonly title: string;
  /** Human-readable citation as it should appear in the UI. */
  readonly citation: string;
  readonly publisher: string;
  readonly url: string;
  /** Publisher's edition/version identifier, or `null` when not yet recorded. */
  readonly version: string | null;
  /** ISO-8601 date the text was retrieved, or `null` if never retrieved. */
  readonly retrievedAt: string | null;
  /** sha-256 of the retrieved text, or `null` if never retrieved. */
  readonly checksum: string | null;
  readonly verificationStatus: VerificationStatus;
  readonly supersededBy?: string;
}

/**
 * A single legal proposition bound to the exact place it comes from.
 * `locator` is the paragraph/section reference within the source.
 */
export interface Proposition {
  readonly id: string;
  readonly sourceId: string;
  readonly locator: string;
  readonly text: string;
}

export type SourceLookupFailure = "SRC_UNKNOWN" | "SRC_UNVERIFIED" | "SRC_SUPERSEDED";

export interface SourceResolution {
  readonly ok: boolean;
  readonly source: LegalSource | null;
  readonly failure: SourceLookupFailure | null;
}
