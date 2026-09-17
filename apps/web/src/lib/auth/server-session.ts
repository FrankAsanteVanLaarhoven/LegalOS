import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";

import {
  governingMembership,
  selectOrganisation as selectOrganisationRule,
  signSelection as sign,
  switchableOrganisations as switchable,
  verifySelection as verify,
  verifySessionToken,
  type Membership,
  type OrganisationMembership,
  type Role,
  type Session,
} from "@legalos/auth";

import { findByToken, revoke } from "./session-store";
import { SESSION_COOKIE } from "./cookies";

/**
 * Server-side identity, and the boundary between a request and a repository.
 *
 * Five repositories take an `organisationId` and refuse everything outside it.
 * Until this file existed nothing decided what that value was, which is what
 * blocked the first Mission Control route — the tenancy proofs were real and
 * had nothing to attach to.
 *
 * The rule ADR-004 turns on: **the cookie is a preference, not authority.** It
 * records which organisation the user last chose. Authority is
 * `workspace_members`, read on every request. A valid cookie never survives a
 * revoked membership, and an attacker who forges a perfect one still fails the
 * membership check — the signature exists so a tampered value is refused before
 * it reaches a log or an audit payload, not because signing grants anything.
 */

export const ACTIVE_ORG_COOKIE = "legalos_active_org";

export type SessionFailure =
  | "unauthenticated"
  | "session_expired"
  | "session_replayed"
  | "account_suspended"
  | "no_active_organisation"
  | "selection_required"
  | "invalid_active_organisation"
  | "membership_revoked"
  | "resolution_failed";

export type Resolved<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: SessionFailure; readonly detail: string };

const fail = <T>(failure: SessionFailure, detail: string): Resolved<T> => ({
  ok: false,
  failure,
  detail,
});

export interface ServerSession {
  readonly session: Session;
  readonly accountId: string;
}

/**
 * Verifies the caller's session from a server component, action or route.
 *
 * Shares `checkSession` and the session store with `requireSession`, which
 * handles the `NextRequest` case. One verifier, three entry points — a second
 * implementation would drift, and the half that drifted would be the half
 * nobody tested.
 *
 * Wrapped in React's request cache so several components in one render share
 * one verification. The cache is per request and per input; it is not durable
 * authorisation state and nothing here treats it as any.
 */
export const resolveServerSession = cache(async (): Promise<Resolved<ServerSession>> => {
  let token: string | undefined;
  try {
    token = (await cookies()).get(SESSION_COOKIE)?.value;
  } catch {
    return fail("resolution_failed", "no request context is available");
  }
  const now = new Date().toISOString();
  // The shared verifier. One implementation across all three entry points.
  const verdict = await verifySessionToken({
    token,
    now,
    findSession: findByToken,
    onReplay: (s) => revoke(s, now, "a rotated-out token was presented").then(() => undefined),
  });

  if (!verdict.ok) {
    return fail(
      verdict.refusal === "expired"
        ? "session_expired"
        : verdict.refusal === "replayed"
          ? "session_replayed"
          : "unauthenticated",
      verdict.refusal === "replayed"
        ? "This session has ended for security reasons."
        : "Sign in to continue."
    );
  }

  return { ok: true, value: { session: verdict.session, accountId: verdict.accountId } };
});

export type MembershipRow = OrganisationMembership;

/**
 * Current memberships, from the database, every request.
 *
 * Removed memberships are excluded in the query rather than filtered later:
 * a list that carries revoked rows is one forgotten `.filter()` away from
 * granting access, and the forgetting happens in the next file, not this one.
 */
export const loadMemberships = cache(async (accountId: string): Promise<readonly MembershipRow[]> => {
  if (!process.env.DATABASE_URL) return [];
  const { createPool } = await import("@legalos/database");
  const pool = await createPool();
  try {
    const rows = await pool.query<{
      membership_id: string;
      workspace_id: string;
      account_id: string;
      role: Role;
      regulatory_reference: string | null;
      removed_at: Date | string | null;
      organisation_id: string;
      organisation_name: string;
    }>(
      `SELECT m.id AS membership_id, m.workspace_id, m.account_id, m.role,
              m.regulatory_reference, m.removed_at,
              o.id AS organisation_id, o.name AS organisation_name
         FROM workspace_members m
         JOIN workspaces w ON w.id = m.workspace_id
         JOIN organizations o ON o.id = w.organization_id
        WHERE m.account_id = $1 AND m.removed_at IS NULL
        ORDER BY o.name ASC, m.workspace_id ASC`,
      [accountId]
    );
    return rows.rows.map((r) => ({
      membershipId: r.membership_id,
      workspaceId: r.workspace_id,
      accountId: r.account_id,
      role: r.role,
      regulatoryReference: r.regulatory_reference,
      removedAt: null,
      organisationId: r.organisation_id,
      organisationName: r.organisation_name,
    }));
  } finally {
    await pool.end();
  }
});

export interface TenantContext {
  readonly accountId: string;
  readonly organisationId: string;
  readonly organisationName: string;
  readonly membershipId: string;
  readonly role: Role;
  readonly regulatoryReference: string | null;
  readonly memberships: readonly MembershipRow[];
}

/** Resolves the active tenancy, reading memberships fresh on every request. */
export async function resolveTenantContext(): Promise<Resolved<TenantContext>> {
  const session = await resolveServerSession();
  if (!session.ok) return fail(session.failure, session.detail);

  const memberships = await loadMemberships(session.value.accountId);
  let cookieValue: string | null = null;
  try {
    cookieValue = (await cookies()).get(ACTIVE_ORG_COOKIE)?.value ?? null;
  } catch {
    cookieValue = null;
  }

  const chosen = selectOrganisationRule(memberships, verifySelection(cookieValue));
  if (!chosen.ok) return fail(chosen.failure, chosen.detail);

  const primary = governingMembership(memberships, chosen.organisationId);
  if (!primary) return fail("invalid_active_organisation", "no governing membership");

  return {
    ok: true,
    value: {
      accountId: session.value.accountId,
      organisationId: chosen.organisationId,
      organisationName: primary.organisationName,
      membershipId: primary.membershipId,
      role: primary.role,
      regulatoryReference: primary.regulatoryReference,
      memberships,
    },
  };
}

const SIGNING_KEY = () => process.env.SESSION_SIGNING_KEY ?? "development-only-unsigned";

/** Re-exported so one implementation serves the resolver and the switch action. */
export const verifySelection = (value: string | null) => verify(value, SIGNING_KEY());
export const signSelection = (organisationId: string) => sign(organisationId, SIGNING_KEY());
export const switchableOrganisations = switchable;
