import { checkSession, type Session } from "./index.ts";

/**
 * The one place a session token becomes a verdict.
 *
 * Obligation 3 set out to prove that `requireSession`, `resolveServerSession`
 * and the switch path agree. The measurement found three inline copies of the
 * same sequence — read the token, look up the session, call `checkSession`,
 * handle replay, refuse — and they had already begun to diverge:
 * `requireSession` collapsed an expired session into the same answer as an
 * absent one, while `resolveServerSession` distinguished them.
 *
 * Agreement between three copies is a property that has to be re-established
 * every time one of them is edited. Agreement between three callers of one
 * function is a property of the code. This is that function.
 *
 * The cookie layer needs no such treatment: `NextRequest.cookies` and the
 * `cookies()` returned by `next/headers` are the *same* `RequestCookies` class
 * from Next's vendored `@edge-runtime/cookies`, so both read a `Cookie` header
 * identically — last duplicate wins, and a value whose percent-encoding will
 * not decode is silently dropped rather than reported. Both behaviours are
 * inherited, not chosen, and both are asserted in the equivalence harness.
 */

/**
 * Why a token was refused.
 *
 * `expired` is distinct from `unauthenticated` because a caller who was signed
 * in and timed out should be told something different from one who never was —
 * but the *verdict* is identical, and no caller may treat `expired` as a
 * weaker refusal.
 */
export type SessionVerdict =
  | { readonly ok: true; readonly session: Session; readonly accountId: string }
  | { readonly ok: false; readonly refusal: SessionRefusal };

export type SessionRefusal = "absent" | "unauthenticated" | "expired" | "replayed";

export interface SessionVerification {
  /** The token from the request, or null/undefined when no cookie was present. */
  readonly token: string | null | undefined;
  readonly now: string;
  findSession(token: string): Promise<Session | null>;
  /** Called when a rotated-out token is presented. */
  onReplay?(session: Session): Promise<void>;
}

/**
 * Turns a token into a verdict.
 *
 * A replayed token ends the session rather than serving whichever request
 * arrived second: two parties holding tokens for one session is not a state to
 * pick a winner from.
 */
export async function verifySessionToken(
  input: SessionVerification
): Promise<SessionVerdict> {
  if (!input.token) return { ok: false, refusal: "absent" };

  const session = await input.findSession(input.token).catch(() => null);
  const check = checkSession(session, input.token, input.now);

  if (check.suspectedReplay && session) {
    await input.onReplay?.(session).catch(() => undefined);
    return { ok: false, refusal: "replayed" };
  }

  if (!check.valid || !session) {
    return {
      ok: false,
      refusal: check.rejection === "EXPIRED" ? "expired" : "unauthenticated",
    };
  }

  return { ok: true, session, accountId: session.accountId };
}

/** Whether a verdict authenticates the caller. The only question that gates access. */
export function isAuthenticated(verdict: SessionVerdict): boolean {
  return verdict.ok;
}
