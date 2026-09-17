import { NextResponse, type NextRequest } from "next/server";
import { hashToken, issueToken, SESSION_TTL_MS } from "@legalos/auth";

import { putSession } from "@/lib/auth/session-store";
import { SESSION_COOKIE } from "@/lib/auth/cookies";

/**
 * Development-only session issuance.
 *
 * There is no sign-in flow yet: account creation, passkey enrolment and
 * recovery all exist as domain logic but nothing wires them to a browser. This
 * route exists so the workspace remains reachable while that is built.
 *
 * It is keyed off NODE_ENV rather than a flag, exactly like the CSP relaxation,
 * so there is no configuration that turns it on in a deployed build. It issues
 * a token with no account behind it — enough to pass the middleware's shape
 * check, and deliberately not enough to satisfy a route handler that verifies
 * the session properly against the store.
 *
 * Delete this the moment real sign-in lands.
 */
export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available." }, { status: 404 });
  }

  const token = issueToken();
  const now = new Date();

  /**
   * The account this session belongs to.
   *
   * This used to be the string "dev-account", which worked only because no
   * database was configured and the session store fell back to a map. With one
   * configured the insert fails: sessions.account_id is a uuid with a foreign
   * key, and a session referencing an account that does not exist is exactly
   * what that constraint is for.
   *
   * So a development account row is created, once, and reused. It is marked in
   * its preferred name and left at `pending_recovery` — it has no verified
   * contact and no recovery factor, so it must not reach `active`, and the
   * schema enforces that independently of this route.
   */
  const accountId = await developmentAccountId();

  // Registered in the store so route handlers verify it exactly as they would a
  // real one.
  await putSession({
    id: crypto.randomUUID(),
    accountId,
    tokenHash: hashToken(token),
    previousHash: null,
    deviceLabel: "development",
    createdAt: now.toISOString(),
    lastSeenAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
    revokedAt: null,
    revokedReason: null,
  });

  const response = NextResponse.json({
    ok: true,
    accountId,
    note: "Development session, backed by a development account. Not a real identity.",
  });

  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.nextUrl.protocol === "https:",
    path: "/",
    maxAge: 60 * 60 * 12,
  });

  return response;
}

/**
 * Finds or creates the single development account.
 *
 * Without a database there is nothing to reference, so a generated id is
 * returned and the in-memory store accepts it — the same behaviour as before,
 * for the same reason.
 */
async function developmentAccountId(): Promise<string> {
  if (!process.env.DATABASE_URL) return crypto.randomUUID();

  const { createPool } = await import("@legalos/database");
  const pool = await createPool();
  try {
    const found = await pool.query<{ id: string }>(
      "SELECT id FROM accounts WHERE preferred_name = $1 LIMIT 1",
      [DEVELOPMENT_ACCOUNT_NAME]
    );
    if (found.rows[0]) return found.rows[0].id;

    const created = await pool.query<{ id: string }>(
      `INSERT INTO accounts (preferred_name, status) VALUES ($1, 'pending_recovery')
       RETURNING id`,
      [DEVELOPMENT_ACCOUNT_NAME]
    );
    return created.rows[0]!.id;
  } finally {
    await pool.end();
  }
}

const DEVELOPMENT_ACCOUNT_NAME = "development session account";
