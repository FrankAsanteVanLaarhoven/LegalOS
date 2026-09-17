import { verifySessionToken, type Session } from "@legalos/auth";
import type { NextRequest } from "next/server";

import { findByToken, revoke } from "./session-store";
import { SESSION_COOKIE } from "./cookies";

export { SESSION_COOKIE };

export type SessionOutcome =
  | { readonly ok: true; readonly session: Session; readonly accountId: string }
  | { readonly ok: false; readonly reason: string; readonly status: 401 };

/**
 * Resolves and verifies the caller's session.
 *
 * The middleware checks that a cookie is present and well formed; this is where
 * it is actually verified. Keeping the two separate means the edge stays cheap
 * while the authority sits next to the data.
 *
 * A rotated-out token revokes the whole session rather than refreshing it: it
 * means two parties hold tokens for one session, and the wrong response is to
 * serve whichever arrived second.
 */
export async function requireSession(
  req: NextRequest,
  now = new Date().toISOString()
): Promise<SessionOutcome> {
  // The shared verifier, so this entry point cannot drift from the two others.
  // It previously collapsed an expired session into the same branch as an
  // absent one while `resolveServerSession` distinguished them — agreement
  // between three copies is a property that has to be re-established on every
  // edit, and this is what replaced it.
  const verdict = await verifySessionToken({
    token: req.cookies.get(SESSION_COOKIE)?.value,
    now,
    findSession: findByToken,
    onReplay: (s) => revoke(s, now, "a rotated-out token was presented").then(() => undefined),
  });

  if (!verdict.ok) {
    return {
      ok: false,
      reason:
        verdict.refusal === "replayed"
          ? "This session has ended for security reasons. Please sign in again."
          : "Sign in to continue.",
      status: 401,
    };
  }
  const session = verdict.session;

  return { ok: true, session, accountId: session.accountId };
}
