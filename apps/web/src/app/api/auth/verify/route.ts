import { NextResponse, type NextRequest } from "next/server";
import {
  activate,
  assessRecovery,
  hashToken,
  issueToken,
  SESSION_TTL_MS,
  verifyChallenge,
  type FactorEnrolment,
} from "@legalos/auth";
import { z } from "zod";

import {
  accountStoreIsAvailable,
  markAccountActive,
  resolveAccount,
} from "@/lib/auth/account-store";
import { getChallenge, putChallenge } from "@/lib/auth/challenge-store";
import { putSession } from "@/lib/auth/session-store";
import { SESSION_COOKIE } from "@/lib/auth/cookies";

/**
 * Completes sign-in.
 *
 * The recovery gate applies here rather than later: an account is not usable
 * until there is a way back into it that does not depend on one phone. A first
 * sign-in therefore returns what is still needed instead of a session, and the
 * response says what would satisfy it.
 */
const VerifySchema = z.object({
  challengeId: z.string().uuid(),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter the six-digit code."),
  /** Factors already enrolled. Empty on a first sign-in. */
  factors: z
    .array(
      z.object({
        factor: z.enum([
          "passkey",
          "authenticator_app",
          "email_code",
          "sms_code",
          "whatsapp_code",
          "recovery_codes",
        ]),
        enrolledAt: z.string(),
        boundTo: z.string().nullable(),
      })
    )
    .default([]),
});

export async function POST(req: NextRequest) {
  const parsed = VerifySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();
  const stored = getChallenge(parsed.data.challengeId);
  const result = verifyChallenge(stored, parsed.data.code, now);

  // Persist the advanced attempt count whether or not it succeeded, otherwise
  // the limit never bites.
  if (result.challenge) putChallenge(result.challenge);

  if (!result.ok || !result.challenge) {
    return NextResponse.json({ error: result.message }, { status: 401 });
  }

  // Without somewhere to put an account there is nothing to sign in to. An
  // id derived from the contact string used to stand in here, which meant a
  // session pointed at no record and carried no membership.
  if (!accountStoreIsAvailable()) {
    return NextResponse.json(
      { error: "Sign-in is not available yet: no account store is configured." },
      { status: 503 }
    );
  }

  const factors = parsed.data.factors as FactorEnrolment[];
  const resolved = await resolveAccount(result.challenge.contact, now).catch(() => null);
  if (!resolved) {
    return NextResponse.json({ error: "Could not complete sign-in." }, { status: 503 });
  }

  const activation = activate({
    account: resolved.account,
    contactVerified: true,
    factors,
    at: now,
  });

  if (!activation.ok) {
    const recovery = assessRecovery(factors);
    return NextResponse.json(
      {
        status: "recovery_required",
        reason: activation.failure,
        advice: activation.advice,
        problems: recovery.problems,
      },
      { status: 200 }
    );
  }

  // The schema refuses an active account without a recovery timestamp, so this
  // records what activate() established rather than asserting it separately.
  await markAccountActive(activation.account.id, now).catch(() => undefined);

  const token = issueToken();
  const created = new Date(now);
  await putSession({
    id: crypto.randomUUID(),
    accountId: activation.account.id,
    tokenHash: hashToken(token),
    previousHash: null,
    deviceLabel: req.headers.get("user-agent")?.slice(0, 80) ?? null,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: new Date(created.getTime() + SESSION_TTL_MS).toISOString(),
    revokedAt: null,
    revokedReason: null,
  });

  const response = NextResponse.json({
    status: "signed_in",
    // Tenancy comes from membership, not from the account, so a person acting
    // in two organisations carries no permissions between them.
    workspaces: resolved.memberships.map((m) => ({ id: m.workspaceId, role: m.role })),
  });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.nextUrl.protocol === "https:",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
  return response;
}
