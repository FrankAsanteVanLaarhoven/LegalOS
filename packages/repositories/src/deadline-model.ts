/**
 * The deadline domain model, and the one judgement the repository makes.
 *
 * Everything here is pure, so the rule that decides whether a date may be shown
 * as authoritative can be tested without a database — and, more importantly,
 * read without one. It is the rule most likely to cause harm if it is wrong,
 * and it should be legible to somebody who does not write SQL.
 */

export const CLASSIFICATIONS = [
  "statutory",
  "tribunal_directed",
  "home_office_directed",
  "contractual",
  "internal_target",
  "eligibility_monitoring",
] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

/**
 * The classifications that bind somebody outside this organisation.
 *
 * Missing one of these is a procedural failure with consequences the platform
 * cannot undo. Missing an internal target is a missed internal target.
 */
export const BINDING: readonly Classification[] = [
  "statutory",
  "tribunal_directed",
  "home_office_directed",
  "contractual",
];

export const SOURCE_TYPES = [
  "document",
  "correspondence",
  "legislation",
  "direction",
  "client_stated",
  "calculated",
  "unknown",
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const VERIFICATION_STATES = [
  "unverified",
  "source_matched",
  "professional_confirmed",
  "disputed",
  "superseded",
] as const;
export type VerificationState = (typeof VERIFICATION_STATES)[number];

export const CERTAINTY_STATES = ["exact", "calculated", "estimated", "unknown"] as const;
export type CertaintyState = (typeof CERTAINTY_STATES)[number];

export const STATUSES = ["open", "met", "missed", "superseded", "withdrawn"] as const;
export type DeadlineStatus = (typeof STATUSES)[number];

export const DEADLINE_EVENTS = [
  "recorded",
  "verified",
  "disputed",
  "superseded",
  "met",
  "missed",
  "withdrawn",
  "corrected",
] as const;
export type DeadlineEventName = (typeof DEADLINE_EVENTS)[number];

/**
 * Whether the source reference could be resolved to a row that exists.
 *
 * `unreferenced` is not a failure: a deadline read from a paper direction that
 * was never scanned has a locator and no stored source. `dangling` is — the row
 * names a source id that resolves to nothing, which is ADR-003's open question
 * showing up as data.
 */
export type SourceResolution = "resolved" | "unreferenced" | "dangling";

export interface DeadlineRecord {
  readonly id: string;
  readonly caseId: string;
  readonly organisationId: string;
  readonly classification: Classification;
  readonly deadlineType: string;
  readonly deadlineAt: string;
  readonly timezone: string;
  readonly status: DeadlineStatus;
  readonly certaintyState: CertaintyState;
  readonly verificationState: VerificationState;
  readonly sourceType: SourceType;
  readonly sourceId: string | null;
  readonly sourceLocator: string | null;
  readonly sourceResolution: SourceResolution;
  readonly recordedBy: string;
  readonly recordedAt: string;
  readonly verifiedBy: string | null;
  readonly verifiedAt: string | null;
  readonly supersedesId: string | null;
  readonly supersededById: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  /**
   * Whether this date may be presented as binding. Derived on every read from
   * the columns beside it, never stored — a stored flag would go on saying yes
   * after the thing that justified it changed.
   */
  readonly authoritative: boolean;
  /**
   * Why not, when it is not. Present so a surface can say what is missing
   * instead of showing a date with no explanation and no way to act on it.
   */
  readonly authorityWithheldBecause: string | null;
}

export interface DeadlineEventRecord {
  readonly id: number;
  readonly deadlineId: string;
  readonly event: DeadlineEventName;
  readonly actorId: string | null;
  readonly detail: string | null;
  readonly at: string;
}

/** The columns the authority rule reads. Narrowed so the rule cannot reach past them. */
export interface AuthorityInput {
  readonly classification: Classification;
  readonly status: DeadlineStatus;
  readonly verificationState: VerificationState;
  readonly sourceType: SourceType;
  readonly sourceLocator: string | null;
  readonly sourceResolution: SourceResolution;
}

/**
 * Whether a deadline may be presented as authoritative, and why not when it may
 * not.
 *
 * Every clause is a refusal. That is deliberate: the default is that a date is
 * *not* authoritative, and it earns the description by having a classification
 * that binds, a source that exists, a locator somebody can turn to, a state
 * that is not in dispute, and a human or documentary check against that source.
 *
 * The failure this prevents is not exotic. It is a caseworker seeing a date and
 * having no way to tell whether anyone checked it — because on screen a
 * transcription error and a confirmed tribunal direction look identical.
 *
 * No number comes out of this function. A percentage would be actionable-
 * looking and unactionable, and the reason a date cannot be relied on is
 * information; "72%" is not.
 */
export function deriveAuthority(input: AuthorityInput): {
  authoritative: boolean;
  withheldBecause: string | null;
} {
  const withhold = (because: string) => ({ authoritative: false, withheldBecause: because });

  if (!BINDING.includes(input.classification)) {
    return withhold(
      `a ${input.classification.replace(/_/g, " ")} is set by this organisation, so it binds nobody outside it`
    );
  }
  if (input.status === "superseded") {
    return withhold("this deadline has been replaced by a later one");
  }
  if (input.status === "withdrawn") {
    return withhold("this deadline was withdrawn");
  }
  if (input.verificationState === "disputed") {
    return withhold("this date is disputed and has not been resolved");
  }
  if (input.verificationState === "superseded") {
    return withhold("this date has been superseded");
  }
  if (input.sourceType === "unknown") {
    return withhold("no source was recorded for this date");
  }
  if (!input.sourceLocator || input.sourceLocator.trim() === "") {
    return withhold("the source has no locator, so nobody can check the date against it");
  }
  // ADR-003: `source_id` is untyped text with no foreign key, so a reference
  // that resolves to nothing satisfies the schema. A locator pointing at a
  // document that is not there is worse than no locator, because it looks
  // checked.
  if (input.sourceResolution === "dangling") {
    return withhold("the source reference does not resolve to any stored source");
  }
  if (input.verificationState === "unverified") {
    return withhold("nobody has yet matched this date to the source it came from");
  }

  return { authoritative: true, withheldBecause: null };
}

/**
 * Deterministic order for every default read.
 *
 * Three keys because two are not enough: several deadlines can fall on the same
 * instant, and `created_at` has millisecond resolution that a batch insert can
 * tie. Without the final key the order is whatever the plan happened to
 * produce, which changes when an index is added and makes a rendered list
 * shuffle for no reason a reader can see.
 */
export const DETERMINISTIC_ORDER = "ORDER BY d.deadline_at ASC, d.created_at ASC, d.id ASC";

/** Fields that can hold free text a person wrote. Referenced by ADR-002. */
export const PERSONAL_TEXT_FIELDS = {
  deadlines: ["deadline_type", "source_locator"],
  deadline_events: ["detail"],
} as const;
