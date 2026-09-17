import { type Session } from "./index.ts";
import { verifySessionToken } from "./session-verdict.ts";
import {
  governingMembership,
  selectOrganisation,
  verifySelection,
  type OrganisationMembership,
} from "./active-tenant.ts";

/**
 * Resolving a request into a tenant context.
 *
 * The composition, apart from the framework that supplies its inputs. It takes
 * a session lookup, a membership loader and a cookie reader, so the same code
 * runs in a server component and in an integration test against a real
 * database — rather than the app holding the wiring and the test proving a
 * re-typed copy of it.
 *
 * Order is the guarantee here. Identity is established before tenancy, tenancy
 * before role, and the membership read happens on every call. Nothing is taken
 * from the caller except the cookie value, and the cookie is a preference: it
 * says which organisation was last chosen and `workspace_members` says which
 * ones are permitted.
 */

export type TenantOutcome =
  | "unauthenticated"
  | "session_expired"
  | "session_replayed"
  | "account_suspended"
  | "no_active_organisation"
  | "selection_required"
  | "invalid_active_organisation"
  | "no_actor_record";

export type TenantResolution =
  | { readonly ok: true; readonly value: ResolvedTenant }
  | { readonly ok: false; readonly failure: TenantOutcome; readonly detail: string };

export interface ResolvedTenant {
  readonly accountId: string;
  readonly organisationId: string;
  readonly organisationName: string;
  readonly membershipId: string;
  readonly role: OrganisationMembership["role"];
  readonly regulatoryReference: string | null;
  readonly memberships: readonly OrganisationMembership[];
  /** True when the caller should persist the selection it just resolved. */
  readonly persist: boolean;
}

export interface TenantDependencies {
  /** The session token from the request, or null. */
  readonly token: string | null;
  /** The signed active-organisation cookie value, or null. */
  readonly selection: string | null;
  readonly signingSecret: string;
  readonly now: string;
  findSession(token: string): Promise<Session | null>;
  /** Called on every resolution. Must read current state, not a cached copy. */
  loadMemberships(accountId: string): Promise<readonly OrganisationMembership[]>;
  /** Account status, so a suspended account cannot resolve a tenancy. */
  accountStatus(accountId: string): Promise<string | null>;
  /** Invoked when a replayed token is detected. */
  onReplay?(session: Session): Promise<void>;
}

const fail = (failure: TenantOutcome, detail: string): TenantResolution => ({
  ok: false,
  failure,
  detail,
});

/**
 * Establishes identity, then tenancy, then role.
 *
 * Every refusal is typed. Returning an empty context for any of them would make
 * "not signed in", "no membership" and "choose an organisation" the same thing
 * to a caller, and the caller would then have to guess which — usually by
 * showing an empty page, which is the one answer that is wrong for all three.
 */
export async function resolveTenant(deps: TenantDependencies): Promise<TenantResolution> {
  // One verifier, three callers. See `session-verdict.ts` for why.
  const verdict = await verifySessionToken({
    token: deps.token,
    now: deps.now,
    findSession: deps.findSession,
    ...(deps.onReplay ? { onReplay: deps.onReplay } : {}),
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
  const session = verdict.session;

  // A suspended or closed account authenticates and still acts in nothing.
  const status = await deps.accountStatus(session.accountId).catch(() => null);
  if (status !== null && status !== "active") {
    return fail("account_suspended", "This account is not active.");
  }

  const memberships = await deps.loadMemberships(session.accountId);
  const chosen = selectOrganisation(memberships, verifySelection(deps.selection, deps.signingSecret));
  if (!chosen.ok) return fail(chosen.failure, chosen.detail);

  const primary = governingMembership(memberships, chosen.organisationId);
  if (!primary) {
    return fail("invalid_active_organisation", "no current membership governs that organisation");
  }

  return {
    ok: true,
    value: {
      accountId: session.accountId,
      organisationId: chosen.organisationId,
      organisationName: primary.organisationName,
      membershipId: primary.membershipId,
      role: primary.role,
      regulatoryReference: primary.regulatoryReference,
      memberships,
      persist: chosen.persist,
    },
  };
}

/**
 * Whether a target may be switched to.
 *
 * Separate from `resolveTenant` because switching validates a *proposed*
 * organisation rather than a remembered one, and shares only the membership
 * rule. One refusal for every unavailable target, whatever the reason:
 * distinguishing "not a member" from "does not exist" lets a caller walk
 * identifiers and map the organisations that do.
 */
export function maySwitchTo(
  memberships: readonly OrganisationMembership[],
  targetId: string
): OrganisationMembership | null {
  if (!/^[0-9a-f-]{36}$/i.test(targetId)) return null;
  return (
    memberships.find((m) => m.organisationId === targetId && m.removedAt === null) ?? null
  );
}

/**
 * Whether a request may change the active organisation.
 *
 * Switching moves the security context, so it takes a same-origin POST. An
 * HttpOnly cookie is not CSRF protection: it is sent with a forged cross-site
 * request exactly as it is with a real one, which is the whole mechanism.
 *
 * A missing `Origin` is refused rather than allowed. A same-origin POST from a
 * browser always sends it; its absence is a non-browser client or a request
 * shaped to avoid this check, and neither should move a tenancy.
 */
export function maySwitchFrom(request: {
  readonly method: string;
  readonly origin: string | null;
  readonly host: string | null;
}): boolean {
  if (request.method.toUpperCase() !== "POST") return false;
  if (!request.origin || !request.host) return false;
  try {
    return new URL(request.origin).host === request.host;
  } catch {
    return false;
  }
}
