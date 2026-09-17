import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { assessRecovery, type AuthFactor, type FactorEnrolment } from "@legalos/identity";

/**
 * @legalos/auth — sessions and account activation.
 *
 * Recovery is designed first, and that shows up as an ordering constraint
 * rather than a feature: `activate` refuses an account whose recovery is
 * inadequate. Enrolling a second factor is not an improvement someone gets
 * around to; it is the condition of having a usable account at all.
 *
 * The reason is specific to who uses this. Handsets are shared and numbers
 * change often, and an account locked behind a dead number may hold the only
 * copy of someone's asylum evidence — a copy they may not be able to obtain
 * again, and may need on a date fixed by a tribunal.
 */

export type AccountStatus = "pending_recovery" | "active" | "suspended" | "closed";

export interface Account {
  readonly id: string;
  /** Never required to be a legal name. See @legalos/identity. */
  readonly preferredName: string;
  readonly status: AccountStatus;
  readonly recoveryReadyAt: string | null;
}

export type ActivationFailure = "CONTACT_UNVERIFIED" | "RECOVERY_INADEQUATE" | "ACCOUNT_CLOSED";

export interface ActivationResult {
  readonly ok: boolean;
  readonly account: Account;
  readonly failure: ActivationFailure | null;
  /** What the person needs to do, in words they can act on. */
  readonly advice: readonly string[];
}

export interface ActivationInput {
  readonly account: Account;
  readonly contactVerified: boolean;
  readonly factors: readonly FactorEnrolment[];
  /** ISO-8601, supplied so activation is deterministic in tests. */
  readonly at: string;
}

/**
 * Activates an account, or explains why it cannot be.
 *
 * Fails closed on recovery. The temptation is to activate and nag afterwards,
 * which produces exactly the situation this exists to prevent: a person with a
 * case file, one factor, and a phone they no longer have.
 */
export function activate(input: ActivationInput): ActivationResult {
  const { account, contactVerified, factors, at } = input;

  if (account.status === "closed") {
    return { ok: false, account, failure: "ACCOUNT_CLOSED", advice: [] };
  }

  if (!contactVerified) {
    return {
      ok: false,
      account,
      failure: "CONTACT_UNVERIFIED",
      advice: ["Confirm your email address or phone number to continue."],
    };
  }

  const recovery = assessRecovery(factors);
  if (!recovery.adequate) {
    return { ok: false, account, failure: "RECOVERY_INADEQUATE", advice: recovery.advice };
  }

  return {
    ok: true,
    account: { ...account, status: "active", recoveryReadyAt: at },
    failure: null,
    advice: [],
  };
}

/**
 * Whether removing a factor would leave the account unrecoverable.
 *
 * Checked before removal rather than after, because the failure is silent: a
 * person tidying up their sign-in methods has no way to know they have just
 * made their evidence unreachable.
 */
export function canRemoveFactor(
  factors: readonly FactorEnrolment[],
  factorToRemove: AuthFactor
): { permitted: boolean; because: string | null } {
  const index = factors.findIndex((f) => f.factor === factorToRemove);
  if (index === -1) return { permitted: true, because: null };

  const remaining = [...factors.slice(0, index), ...factors.slice(index + 1)];
  const after = assessRecovery(remaining);

  return after.adequate
    ? { permitted: true, because: null }
    : {
        permitted: false,
        because:
          after.advice[0] ??
          "Removing this would leave no way back into the account if you lost the others.",
      };
}

/* ------------------------------------------------------------------ */
/* Sessions                                                            */
/* ------------------------------------------------------------------ */

export interface Session {
  readonly id: string;
  readonly accountId: string;
  readonly tokenHash: string;
  readonly previousHash: string | null;
  readonly deviceLabel: string | null;
  readonly createdAt: string;
  readonly lastSeenAt: string;
  readonly expiresAt: string;
  readonly revokedAt: string | null;
  readonly revokedReason: string | null;
}

/** Twelve hours. Long enough to finish a task, short enough to matter. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Generates a session token. Returned once; only its hash is ever stored. */
export function issueToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Constant-time comparison, so a token cannot be discovered by timing. */
export function tokenMatches(token: string, storedHash: string): boolean {
  // Uint8Array rather than Buffer: the Node typings for timingSafeEqual accept
  // ArrayBufferView, and a length mismatch must be rejected before comparing
  // because timingSafeEqual throws on unequal lengths.
  const candidate = Uint8Array.from(Buffer.from(hashToken(token), "hex"));
  const stored = Uint8Array.from(Buffer.from(storedHash, "hex"));
  if (candidate.length !== stored.length) return false;
  return timingSafeEqual(candidate, stored);
}

export type SessionRejection = "UNKNOWN" | "EXPIRED" | "REVOKED" | "REPLAYED";

export interface SessionCheck {
  readonly valid: boolean;
  readonly rejection: SessionRejection | null;
  /** True when the token matched a rotated-out hash, which suggests theft. */
  readonly suspectedReplay: boolean;
}

/**
 * Validates a presented token against a stored session.
 *
 * A token matching `previousHash` after rotation means two parties hold tokens
 * for one session — the legitimate holder and someone else. That is reported as
 * replay so the caller can revoke the whole session rather than silently
 * refreshing it.
 */
export function checkSession(session: Session | null, token: string, now: string): SessionCheck {
  if (!session) return { valid: false, rejection: "UNKNOWN", suspectedReplay: false };

  if (session.revokedAt !== null) {
    return { valid: false, rejection: "REVOKED", suspectedReplay: false };
  }

  if (Date.parse(session.expiresAt) <= Date.parse(now)) {
    return { valid: false, rejection: "EXPIRED", suspectedReplay: false };
  }

  if (tokenMatches(token, session.tokenHash)) {
    return { valid: true, rejection: null, suspectedReplay: false };
  }

  if (session.previousHash && tokenMatches(token, session.previousHash)) {
    return { valid: false, rejection: "REPLAYED", suspectedReplay: true };
  }

  return { valid: false, rejection: "UNKNOWN", suspectedReplay: false };
}

export interface RotationResult {
  readonly session: Session;
  /** Returned to the caller once. Never stored. */
  readonly token: string;
}

/** Rotates a session token, keeping the previous hash to detect replay. */
export function rotateSession(session: Session, now: string): RotationResult {
  const token = issueToken();
  return {
    token,
    session: {
      ...session,
      tokenHash: hashToken(token),
      previousHash: session.tokenHash,
      lastSeenAt: now,
      expiresAt: new Date(Date.parse(now) + SESSION_TTL_MS).toISOString(),
    },
  };
}

export function revokeSession(session: Session, now: string, reason: string): Session {
  return { ...session, revokedAt: now, revokedReason: reason };
}

/* ------------------------------------------------------------------ */
/* Membership and authorisation                                        */
/* ------------------------------------------------------------------ */

export type Role = "client" | "caseworker" | "adviser" | "solicitor" | "reviewer" | "admin";

export interface Membership {
  readonly workspaceId: string;
  readonly accountId: string;
  readonly role: Role;
  readonly regulatoryReference: string | null;
  readonly removedAt: string | null;
}

/**
 * The membership an account holds in a workspace, or null.
 *
 * Tenancy lives on the membership rather than the account, so one person acting
 * for two organisations carries no permissions between them. Returning null
 * rather than a default membership means a caller cannot accidentally treat an
 * outsider as a member holding the lowest role.
 */
export function membershipFor(
  memberships: readonly Membership[],
  accountId: string,
  workspaceId: string
): Membership | null {
  return (
    memberships.find(
      (m) => m.accountId === accountId && m.workspaceId === workspaceId && m.removedAt === null
    ) ?? null
  );
}

/** Whether a membership may authorise a reserved activity. */
export function mayAuthoriseReserved(membership: Membership | null): boolean {
  if (!membership) return false;
  if (membership.role !== "solicitor") return false;
  return (membership.regulatoryReference ?? "").trim() !== "";
}

export {
  CHALLENGE_TTL_MS,
  generateCode,
  hashCode,
  issueChallenge,
  MAX_ATTEMPTS,
  verifyChallenge,
  type Challenge,
  type ChallengePurpose,
  type ChallengeRejection,
  type ChallengeResult,
  type IssuedChallenge,
} from "./challenge.ts";

export { assessRecovery };
export type { AuthFactor, FactorEnrolment };

export {
  governingMembership,
  selectOrganisation,
  signSelection,
  switchableOrganisations,
  verifySelection,
  type OrganisationMembership,
  type Selection,
  type TenantFailure,
} from "./active-tenant.ts";

export {
  maySwitchFrom,
  maySwitchTo,
  resolveTenant,
  type ResolvedTenant,
  type TenantDependencies,
  type TenantOutcome,
  type TenantResolution,
} from "./tenant-resolution.ts";

export {
  switchOrganisationCore,
  UNAVAILABLE,
  type CookieMutation,
  type SwitchAuditEntry,
  type SwitchDependencies,
  type SwitchFailure,
  type SwitchInput,
  type SwitchResult,
} from "./switch-core.ts";

export {
  isAuthenticated,
  verifySessionToken,
  type SessionRefusal,
  type SessionVerdict,
  type SessionVerification,
} from "./session-verdict.ts";
