/**
 * The review domain model.
 *
 * Everything here is pure, so the rules that decide who may decide what, and
 * what a queue position means, can be read and tested without a database. These
 * are the rules a regulator would ask about, and they should not be spread
 * through SQL.
 */

export const SUBJECT_TYPES = [
  "ai_output",
  "draft_document",
  "evidence_assessment",
  "bundle",
  "filing",
  "deadline",
  "other",
] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number];

export const REVIEW_STATUSES = [
  "open",
  "awaiting_material",
  "decided",
  "withdrawn",
  "expired",
] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/**
 * The four decisions the schema records.
 *
 * Not a pass/fail with a comment. `approved_with_amendments` is the one that
 * matters most: it is the common real outcome, and collapsing it into
 * "approved" would record a solicitor as having signed off text they in fact
 * required changes to.
 */
export const DECISIONS = [
  "approved",
  "approved_with_amendments",
  "refused",
  "referred_onward",
] as const;
export type Decision = (typeof DECISIONS)[number];

export const PRIORITIES = ["urgent", "high", "normal", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const REVIEW_EVENTS = [
  "requested",
  "assigned",
  "commented",
  "escalated",
  "decided",
  "withdrawn",
  "expired",
  "reopened",
] as const;
export type ReviewEventName = (typeof REVIEW_EVENTS)[number];

/**
 * Roles that may decide a review at all.
 *
 * A `client` cannot review, and a `caseworker` can review only what does not
 * require a professional. Which of those applies is decided per request by
 * `requires_professional`, not here.
 */
export const MAY_DECIDE = ["caseworker", "adviser", "solicitor", "reviewer", "admin"] as const;

/** Roles that can carry a reserved legal activity. */
export const PROFESSIONAL_ROLES = ["solicitor", "adviser"] as const;

/**
 * Where a request stands, as a reader would describe it.
 *
 * Derived from explicit columns rather than from missing data. `awaiting
 * material` in particular is a stored status and not the absence of something:
 * a review blocked on a document nobody sent is otherwise indistinguishable
 * from one nobody has picked up, and the second gets chased while the first
 * quietly waits.
 */
export type QueueState =
  | "unassigned"
  | "assigned"
  | "awaiting_material"
  | "decided"
  | "withdrawn"
  | "expired";

export function queueStateOf(input: {
  status: ReviewStatus;
  assignedTo: string | null;
}): QueueState {
  if (input.status === "awaiting_material") return "awaiting_material";
  if (input.status === "decided") return "decided";
  if (input.status === "withdrawn") return "withdrawn";
  if (input.status === "expired") return "expired";
  return input.assignedTo ? "assigned" : "unassigned";
}

/** States a request may still be worked on in. */
export const ACTIVE_STATUSES: readonly ReviewStatus[] = ["open", "awaiting_material"];

export interface ReviewRequestRecord {
  readonly id: string;
  readonly organisationId: string;
  readonly caseId: string;
  readonly subjectType: SubjectType;
  readonly subjectId: string;
  readonly subjectDigest: string | null;
  /** The execution that produced the artefact, when a model produced it. */
  readonly executionId: string | null;
  readonly requiresProfessional: boolean;
  readonly reservedActivity: string | null;
  readonly requiredRole: string | null;
  readonly reason: string | null;
  readonly priority: Priority;
  readonly requestedBy: string;
  readonly requestedAt: string;
  readonly assignedTo: string | null;
  readonly assignedAt: string | null;
  readonly dueDeadlineId: string | null;
  readonly status: ReviewStatus;
  readonly queueState: QueueState;
  /** Integer, deliberately. See migration 0014. */
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  /**
   * True only when an immutable decision exists. Never inferred from status:
   * a status column can be set by an UPDATE, and the question a regulator asks
   * is whether a decision record exists, not what a row says about itself.
   */
  readonly hasDecision: boolean;
}

export interface ReviewDecisionRecord {
  readonly id: string;
  readonly requestId: string;
  readonly decision: Decision;
  readonly basis: string;
  readonly decidedBy: string;
  /** The role as it was at the moment of signing, not as it is now. */
  readonly decidedByRole: string;
  readonly regulatoryReference: string | null;
  readonly decidedAt: string;
  readonly subjectDigest: string;
}

export interface ReviewEventRecord {
  readonly id: number;
  readonly requestId: string;
  readonly event: ReviewEventName;
  readonly actorId: string | null;
  readonly detail: string | null;
  readonly at: string;
}

/** A digest is 64 lowercase hex characters. Anything else is not a sha-256. */
export function isDigest(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

/**
 * Whether a decision still covers the artefact as it stands now.
 *
 * The failure this exists for: a draft is approved, then edited, and the
 * approval appears to cover the edited text. Nothing stops the edit — the
 * artefact lives elsewhere — but a reader can always ask whether what was
 * approved is what is there, and get an answer rather than an assumption.
 */
export function decisionCoversDigest(
  decision: Pick<ReviewDecisionRecord, "subjectDigest">,
  currentDigest: string
): boolean {
  return decision.subjectDigest === currentDigest;
}

export interface AuthorityInput {
  readonly requiresProfessional: boolean;
  readonly reservedActivity: string | null;
  readonly requiredRole: string | null;
  readonly actorRole: string;
  readonly regulatoryReference: string | null;
  readonly requestedBy: string;
  readonly actorId: string;
}

/**
 * Whether this actor may decide this request, and why not when they may not.
 *
 * Three independent refusals, and the separation-of-duty one is absolute. A
 * review whose requester decides it is not a review; it is a record of somebody
 * agreeing with themselves, and it would satisfy every other check here.
 */
export function mayDecide(input: AuthorityInput): { permitted: boolean; because: string | null } {
  const refuse = (because: string) => ({ permitted: false, because });

  if (!MAY_DECIDE.includes(input.actorRole as (typeof MAY_DECIDE)[number])) {
    return refuse(`the ${input.actorRole} role may not decide a review`);
  }
  if (input.actorId === input.requestedBy) {
    return refuse("the person who asked for a review may not be the person who decides it");
  }

  if (input.requiresProfessional) {
    if (!PROFESSIONAL_ROLES.includes(input.actorRole as (typeof PROFESSIONAL_ROLES)[number])) {
      return refuse(
        `this review requires a regulated professional and the actor holds the ${input.actorRole} role`
      );
    }
    if (!(input.regulatoryReference ?? "").trim()) {
      return refuse("a professional decision requires a registration on record");
    }
  }
  if (input.reservedActivity && !input.requiresProfessional) {
    // Defence in depth against a row that predates the schema constraint.
    return refuse("a reserved activity may only be decided under a professional requirement");
  }
  if (input.requiredRole && input.requiredRole !== input.actorRole) {
    return refuse(
      `this review requires the ${input.requiredRole} role and the actor holds ${input.actorRole}`
    );
  }
  return { permitted: true, because: null };
}

/**
 * Deterministic order for the queue reads.
 *
 * Priority first because a queue sorted only by arrival asks a reviewer to read
 * every row to find the urgent one. `id` last because two requests can arrive
 * in the same instant, and without it the order is whatever the plan produced.
 */
export const QUEUE_ORDER = "ORDER BY r.priority_rank ASC, r.requested_at ASC, r.id ASC";

/** Fields that can hold free text a person wrote. Referenced by ADR-002. */
export const PERSONAL_TEXT_FIELDS = {
  review_requests: ["reason", "reserved_activity", "subject_id"],
  review_decisions: ["basis"],
  review_events: ["detail"],
} as const;
