import { createHmac } from "node:crypto";

import type { Role } from "./index.ts";

/**
 * Active-tenant selection — the rules, apart from the request that applies them.
 *
 * Pure and in a package, so the decisions a security boundary turns on can be
 * read and attacked without a browser, a cookie or a database. ADR-004 records
 * why each one is what it is.
 */

export type TenantFailure =
  | "no_active_organisation"
  | "selection_required"
  | "invalid_active_organisation";

export type Selection =
  | { readonly ok: true; readonly organisationId: string; readonly persist: boolean }
  | { readonly ok: false; readonly failure: TenantFailure; readonly detail: string };

export interface OrganisationMembership {
  readonly membershipId: string;
  readonly workspaceId: string;
  readonly accountId: string;
  readonly role: Role;
  readonly regulatoryReference: string | null;
  readonly removedAt: string | null;
  readonly organisationId: string;
  readonly organisationName: string;
}

/**
 * Decides which organisation a request acts in.
 *
 * The clause worth reading twice is the multi-membership one. With several
 * memberships and no stated preference the answer is `selection_required`, not
 * the first row: `ORDER BY` omitted means insertion order, and a solicitor
 * acting for two firms would silently act in whichever tenancy happened to be
 * created first — with every repository then correctly refusing the other one's
 * cases, which reads as a bug rather than as the wrong tenancy.
 *
 * A revoked membership is expected to be excluded before this is called, and is
 * excluded again here. Two filters for one property, because the cost of
 * forgetting is granting access.
 */
export function selectOrganisation(
  memberships: readonly OrganisationMembership[],
  preference: string | null
): Selection {
  // `organizations` has no status column, so organisation-level suspension is
  // not modelled anywhere in this platform. An earlier draft of this file read
  // `COALESCE(o.status, 'active')` and invented one, which would have produced
  // a suspension check that always passed and a test that proved it did.
  const live = memberships.filter((m) => m.removedAt === null);
  const organisations = [...new Set(live.map((m) => m.organisationId))];

  if (organisations.length === 0) {
    return {
      ok: false,
      failure: "no_active_organisation",
      detail: "This account has no organisation membership.",
    };
  }

  if (preference !== null) {
    if (organisations.includes(preference)) {
      return { ok: true, organisationId: preference, persist: false };
    }
    // Left it, was removed from it, or was never in it. One answer for all
    // three: distinguishing them lets a caller enumerate organisations.
    return {
      ok: false,
      failure: "invalid_active_organisation",
      detail: "The selected organisation is no longer available to this account.",
    };
  }

  if (organisations.length === 1) {
    return { ok: true, organisationId: organisations[0]!, persist: true };
  }
  return {
    ok: false,
    failure: "selection_required",
    detail: "Select which organisation to work in.",
  };
}

/**
 * The membership whose role governs, when an account holds several in one
 * organisation.
 *
 * Strongest role wins, from an explicit order rather than from whatever the
 * database returned first.
 */
const ROLE_RANK: readonly Role[] = [
  "admin",
  "solicitor",
  "adviser",
  "reviewer",
  "caseworker",
  "client",
];

export function governingMembership(
  memberships: readonly OrganisationMembership[],
  organisationId: string
): OrganisationMembership | null {
  const inOrg = memberships.filter(
    (m) => m.organisationId === organisationId && m.removedAt === null
  );
  if (inOrg.length === 0) return null;
  return [...inOrg].sort((a, b) => ROLE_RANK.indexOf(a.role) - ROLE_RANK.indexOf(b.role))[0]!;
}

/** Organisations an actor could switch to. */
export function switchableOrganisations(
  memberships: readonly OrganisationMembership[]
): readonly { readonly id: string; readonly name: string }[] {
  const seen = new Map<string, string>();
  for (const m of memberships) {
    if (m.removedAt === null) seen.set(m.organisationId, m.organisationName);
  }
  return [...seen]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Signs a selection.
 *
 * The signature is **not** authorisation. A forged value that verifies still
 * fails the membership check, because the cookie is a preference and
 * `workspace_members` is the authority. What signing buys is that a
 * hand-edited organisation id never reaches a query, a log or an audit payload
 * as though the system had chosen it.
 */
export function signSelection(organisationId: string, secret: string): string {
  const signature = createHmac("sha256", secret).update(organisationId).digest("base64url");
  return `${organisationId}.${signature}`;
}

/** Reads a signed selection, or null if it does not verify. */
export function verifySelection(value: string | null, secret: string): string | null {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const id = value.slice(0, dot);
  return signSelection(id, secret) === value ? id : null;
}
