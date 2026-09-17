import type { Membership, Role } from "@legalos/auth";

/**
 * The caller, as a repository sees them.
 *
 * Two identifiers rather than one, because the schema has two. `actorId` is a
 * `users` row and is what gets written into `recorded_by` and `verified_by`;
 * `accountId` is an `accounts` row and is what memberships are held against.
 * Collapsing them would mean guessing one from the other, and the guess would
 * be wrong for anyone acting in two organisations — which is the exact person
 * tenancy has to hold for.
 *
 * `organisationId` is supplied by the caller and then *checked*, never trusted.
 * It says which tenancy the caller believes they are acting in; the repository
 * establishes which tenancy the case actually belongs to and compares. A
 * context is a claim, not an authorisation.
 */
export interface RepositoryContext {
  /** `users.id`. Written to `recorded_by` and `verified_by`. */
  readonly actorId: string;
  /** `accounts.id`. The identity memberships are held against. */
  readonly accountId: string;
  /** The organisation the caller believes they are acting in. Verified, not trusted. */
  readonly organisationId: string;
  readonly memberships: readonly Membership[];
  /** Carried into audit payloads so one request can be followed across records. */
  readonly correlationId?: string;
}

/**
 * Why an operation produced nothing.
 *
 * `NOT_PERSISTED` covers two situations deliberately: the case does not exist,
 * and the case exists in another organisation. They are one reason because
 * telling them apart is exactly the disclosure tenancy is supposed to prevent —
 * a caller who can distinguish "no such case" from "not yours" can enumerate
 * another organisation's caseload one identifier at a time.
 *
 * `FORBIDDEN` is only ever returned for a case in the caller's *own*
 * organisation, where the existence of the case is not a secret from them and
 * the useful answer is that their role does not permit this.
 */
export type Refusal =
  | { readonly reason: "NO_DATABASE"; readonly detail: string }
  | { readonly reason: "NOT_PERSISTED"; readonly detail: string }
  | { readonly reason: "FORBIDDEN"; readonly detail: string }
  | { readonly reason: "INVALID"; readonly detail: string }
  | { readonly reason: "CONFLICT"; readonly detail: string }
  | { readonly reason: "UNREACHABLE"; readonly detail: string };

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly refusal: Refusal };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const refuse = <T>(refusal: Refusal): Result<T> => ({ ok: false, refusal });

/**
 * The single message returned when a case is not the caller's to see.
 *
 * One constant, used for both "no such case" and "another organisation's case",
 * so the two cannot drift apart later. A well-meant edit that made one of them
 * more helpful would reopen the enumeration channel without anyone noticing.
 */
export const CASE_NOT_AVAILABLE =
  "no case with that identifier is available to this organisation";

/** Roles permitted to read case material. */
export const MAY_READ: readonly Role[] = [
  "client",
  "caseworker",
  "adviser",
  "solicitor",
  "reviewer",
  "admin",
];

/**
 * Roles permitted to record or correct a deadline.
 *
 * `client` is absent: a client may see their dates and may not set them. A date
 * a client entered, rendered beside one taken from a tribunal direction, is the
 * confusion the classification column exists to prevent, and it should not be
 * creatable in the first place.
 */
export const MAY_WRITE: readonly Role[] = ["caseworker", "adviser", "solicitor", "admin"];

/**
 * Whether a membership may record a professional confirmation.
 *
 * Confirming a statutory date against its source is a judgement about law, so
 * it takes a regulated person and their registration. `reviewer` is not enough
 * — the role exists for checking work, not for holding a professional
 * qualification.
 */
export function mayConfirmProfessionally(membership: Membership | null): boolean {
  if (!membership) return false;
  if (membership.role !== "solicitor" && membership.role !== "adviser") return false;
  return (membership.regulatoryReference ?? "").trim() !== "";
}
