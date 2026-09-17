/**
 * Approval workflow for anything the system must not do on its own authority.
 *
 * The Phantom Agent problem: an AI output must never be the thing that carries
 * legal responsibility. A proposal is a *proposal* until a named, qualified
 * human authorises it, and the identity of that human is recorded.
 */

export type Role = "client" | "caseworker" | "adviser" | "solicitor" | "reviewer" | "admin";

export type ProposalState = "DRAFT" | "REVIEW" | "AUTHORISED" | "REJECTED";

/**
 * Activities that may only be authorised by a qualified legal professional.
 * Mirrors the reserved-activities concept in England & Wales.
 */
export const RESERVED_ACTIVITIES = [
  "give_legal_advice",
  "conduct_litigation",
  "file_application",
  "lodge_appeal",
  "sign_statement_of_truth",
] as const;

export type ReservedActivity = (typeof RESERVED_ACTIVITIES)[number];

const QUALIFIED_ROLES: readonly Role[] = ["solicitor"];

export interface Actor {
  readonly id: string;
  readonly role: Role;
  /** Regulator reference, e.g. an SRA number. Required for reserved activities. */
  readonly regulatoryReference?: string;
}

export interface Proposal {
  readonly id: string;
  readonly state: ProposalState;
  readonly activity: string;
  readonly reserved: boolean;
  readonly proposedBy: string;
  readonly summary: string;
  readonly authorisedBy: string | null;
  readonly rejectedBy: string | null;
  readonly reason: string | null;
}

export type TransitionFailure =
  "ILLEGAL_TRANSITION" | "ROLE_NOT_PERMITTED" | "SELF_APPROVAL" | "REGULATORY_REFERENCE_REQUIRED";

export interface TransitionResult {
  readonly ok: boolean;
  readonly proposal: Proposal;
  readonly failure: TransitionFailure | null;
}

export function isReserved(activity: string): activity is ReservedActivity {
  return (RESERVED_ACTIVITIES as readonly string[]).includes(activity);
}

/** AI systems propose; they never author. `proposedBy` records which agent. */
export function propose(input: {
  id: string;
  activity: string;
  proposedBy: string;
  summary: string;
}): Proposal {
  return {
    id: input.id,
    state: "DRAFT",
    activity: input.activity,
    reserved: isReserved(input.activity),
    proposedBy: input.proposedBy,
    summary: input.summary,
    authorisedBy: null,
    rejectedBy: null,
    reason: null,
  };
}

export function submitForReview(proposal: Proposal): TransitionResult {
  if (proposal.state !== "DRAFT") {
    return { ok: false, proposal, failure: "ILLEGAL_TRANSITION" };
  }
  return { ok: true, proposal: { ...proposal, state: "REVIEW" }, failure: null };
}

export function authorise(proposal: Proposal, actor: Actor): TransitionResult {
  if (proposal.state !== "REVIEW") {
    return { ok: false, proposal, failure: "ILLEGAL_TRANSITION" };
  }
  if (actor.id === proposal.proposedBy) {
    return { ok: false, proposal, failure: "SELF_APPROVAL" };
  }
  if (proposal.reserved) {
    if (!QUALIFIED_ROLES.includes(actor.role)) {
      return { ok: false, proposal, failure: "ROLE_NOT_PERMITTED" };
    }
    if (!actor.regulatoryReference || actor.regulatoryReference.trim() === "") {
      return { ok: false, proposal, failure: "REGULATORY_REFERENCE_REQUIRED" };
    }
  } else if (actor.role === "client") {
    return { ok: false, proposal, failure: "ROLE_NOT_PERMITTED" };
  }
  return {
    ok: true,
    proposal: { ...proposal, state: "AUTHORISED", authorisedBy: actor.id },
    failure: null,
  };
}

export function reject(proposal: Proposal, actor: Actor, reason: string): TransitionResult {
  if (proposal.state !== "REVIEW") {
    return { ok: false, proposal, failure: "ILLEGAL_TRANSITION" };
  }
  return {
    ok: true,
    proposal: { ...proposal, state: "REJECTED", rejectedBy: actor.id, reason },
    failure: null,
  };
}

/** Records which model and prompt produced an output, so answers stay traceable. */
export interface ProvenanceRecord {
  readonly modelId: string;
  readonly promptVersion: string;
  readonly guardrailsVersion: string;
  readonly verificationVersion: string;
}
