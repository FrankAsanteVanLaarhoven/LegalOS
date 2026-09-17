import { maySwitchFrom, maySwitchTo } from "./tenant-resolution.ts";
import type { OrganisationMembership } from "./active-tenant.ts";

/**
 * The canonical organisation-switch orchestration.
 *
 * One implementation, called by the browser-invoked server action and by every
 * test. It exists in a package rather than in the app because the app's action
 * imports `next/headers`, which no integration test can reach — and a core the
 * tests cannot execute is a core the tests do not prove.
 *
 * This replaces two inline rules that had drifted from the ones the contracts
 * cite. Before this, `switchOrganisation` did its own `.find()` for the target
 * and its own origin comparison, while `maySwitchTo` and `maySwitchFrom` sat
 * proved and uncalled. ST-G7 and ST-G11 were honoured on evidence from
 * functions the production path never executed. The two implementations also
 * disagreed: the inline lookup did not require `removedAt === null`, and the
 * action asserted no method at all.
 *
 * So the core **calls** those rules. It does not restate them, and there is
 * nowhere left for a second copy to live.
 */

/** Everything the core needs from the world, injected so it can be observed. */
export interface SwitchDependencies {
  /** The verified session. Identity comes from here and nowhere else. */
  resolveSession(): Promise<{ readonly ok: true; readonly accountId: string } | { readonly ok: false }>;
  /**
   * Current memberships, read at switch time.
   *
   * Called by the core rather than passed in as data, which is what makes the
   * read observable: an implementation handed a snapshot could not be
   * distinguished from one that queried, because both produce the same refusal.
   */
  loadMemberships(accountId: string): Promise<readonly OrganisationMembership[]>;
  /** The organisation currently selected, already signature-verified. */
  currentSelection(): string | null;
  /** Appends the switch record. Throwing means the switch does not happen. */
  appendAudit(entry: SwitchAuditEntry): Promise<void>;
  /** Produces the signed cookie value for a target. */
  serializeSelection(organisationId: string): string;
  correlationId(): string;
  now(): string;
}

export interface SwitchAuditEntry {
  readonly at: string;
  readonly actor: string;
  readonly action: "session.organisation_switched";
  readonly subject: string;
  readonly payload: {
    readonly previousOrganisationId: string | null;
    readonly targetOrganisationId: string;
    readonly membershipId: string;
    readonly correlationId: string;
  };
}

/**
 * What the adapter supplies.
 *
 * `method` comes from the **trusted adapter**, never from a caller. Next.js
 * 16.2.12 dispatches server actions only on POST — every branch of
 * `getServerActionRequestMetadata` in
 * `next/dist/server/lib/server-action-request-meta.js` requires
 * `req.method === 'POST'` — and `headers()` exposes no method to read back. So
 * the adapter states the framework's guarantee and `maySwitchFrom` still checks
 * it, which means a framework change fails closed rather than silently.
 */
export interface SwitchInput {
  readonly targetOrganisationId: string;
  readonly method: string;
  readonly origin: string | null;
  readonly host: string | null;
}

/** Why a switch did not happen. Separate from the message shown to a caller. */
export type SwitchFailure =
  | "invocation_refused"
  | "unauthenticated"
  | "target_unavailable"
  | "audit_failed";

export interface CookieMutation {
  readonly value: string;
}

export type SwitchResult =
  | {
      readonly ok: true;
      readonly organisationId: string;
      readonly unchanged: boolean;
      /** Null when nothing needs to change. Delivered by the adapter. */
      readonly cookie: CookieMutation | null;
    }
  | { readonly ok: false; readonly failure: SwitchFailure; readonly reason: string };

/**
 * One refusal for every unavailable target.
 *
 * "Not a member", "membership revoked", "malformed" and "no such organisation"
 * all read the same. Splitting them lets a caller submit identifiers and map
 * the organisations that exist from the answers.
 */
export const UNAVAILABLE = "That organisation is not available to this account.";
const NOT_THIS_SITE = "This request did not come from this site.";
const SIGN_IN = "Sign in to continue.";
const NOT_RECORDED = "The change could not be recorded, so it was not made.";

/**
 * Switches the active organisation, or explains why it did not.
 *
 * The order is the guarantee, and two parts of it are deliberate.
 *
 * **Invocation is checked first**, before the session lookup and before any
 * database work. A forged cross-origin request should cost a header comparison,
 * not a session query — and an unauthenticated cross-origin caller should learn
 * nothing about whether their session was valid.
 *
 * **Audit is committed before the cookie is produced.** A cookie and a database
 * row are two systems with no transaction between them, so this order chooses
 * which failure to have. Audit fails, nothing moves. Cookie delivery fails
 * afterwards, and an entry describes a switch that did not take effect — the
 * next request re-resolves the unchanged cookie and the caller is still where
 * they were. Cookie first would move the security context with no record of it,
 * which is the failure that matters. No atomicity is claimed.
 */
export async function switchOrganisationCore(
  dependencies: SwitchDependencies,
  input: SwitchInput
): Promise<SwitchResult> {
  // 1. Invocation, before anything expensive or disclosing.
  if (!maySwitchFrom({ method: input.method, origin: input.origin, host: input.host })) {
    return { ok: false, failure: "invocation_refused", reason: NOT_THIS_SITE };
  }

  // 2. Identity.
  const session = await dependencies.resolveSession();
  if (!session.ok) return { ok: false, failure: "unauthenticated", reason: SIGN_IN };

  // 3. Current memberships, read now.
  const memberships = await dependencies.loadMemberships(session.accountId);

  // 4. Where the caller is at the moment.
  const previous = dependencies.currentSelection();

  // 5. Whether the target is theirs, by the rule the contract cites. This is
  //    the second mechanism behind revocation: the loader excludes removed rows
  //    in SQL, and `maySwitchTo` requires `removedAt === null` independently.
  const target = maySwitchTo(memberships, input.targetOrganisationId);
  if (!target) return { ok: false, failure: "target_unavailable", reason: UNAVAILABLE };

  // Idempotent. Auditing a no-op would fill the chain with entries recording
  // nothing, and a double-submitted form would produce two of them.
  if (previous === input.targetOrganisationId) {
    return { ok: true, organisationId: input.targetOrganisationId, unchanged: true, cookie: null };
  }

  // 6. The record, before the effect.
  try {
    await dependencies.appendAudit({
      at: dependencies.now(),
      actor: session.accountId,
      action: "session.organisation_switched",
      subject: input.targetOrganisationId,
      payload: {
        // Structural identifiers only. No organisation names, no session token,
        // no cookie value, no membership list.
        previousOrganisationId: previous,
        targetOrganisationId: input.targetOrganisationId,
        membershipId: target.membershipId,
        correlationId: dependencies.correlationId(),
      },
    });
  } catch {
    return { ok: false, failure: "audit_failed", reason: NOT_RECORDED };
  }

  // 7. Only now.
  return {
    ok: true,
    organisationId: input.targetOrganisationId,
    unchanged: false,
    cookie: { value: dependencies.serializeSelection(input.targetOrganisationId) },
  };
}
