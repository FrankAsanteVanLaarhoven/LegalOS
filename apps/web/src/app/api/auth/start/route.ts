import { NextResponse, type NextRequest } from "next/server";
import { issueChallenge } from "@legalos/auth";
import { z } from "zod";

import { deliveryIsConfigured, putChallenge } from "@/lib/auth/challenge-store";

/**
 * Starts sign-in by issuing a one-time code.
 *
 * A contact is either an email address or a phone number — one is enough to
 * open an account, and no legal name is asked for.
 *
 * Delivery is not built: no email or SMS provider is configured. Rather than
 * pretending a message was sent, this refuses in production and returns the
 * code directly in development so the flow is exercisable. A route that claimed
 * to have sent something it did not would leave someone waiting for a message
 * that never arrives, which is worse than saying so.
 */
const StartSchema = z.object({
  contact: z.string().trim().min(3).max(254),
});

export async function POST(req: NextRequest) {
  const parsed = StartSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter an email address or phone number." }, { status: 400 });
  }

  if (!deliveryIsConfigured() && process.env.NODE_ENV === "production") {
    return NextResponse.json(
      {
        error: "Sign-in is not available yet: no way to send you a code has been configured.",
      },
      { status: 503 }
    );
  }

  const { challenge, code } = issueChallenge({
    id: crypto.randomUUID(),
    purpose: "sign_in",
    contact: parsed.data.contact,
    now: new Date().toISOString(),
  });
  putChallenge(challenge);

  return NextResponse.json({
    challengeId: challenge.id,
    expiresAt: challenge.expiresAt,
    delivered: deliveryIsConfigured(),
    // Development only, and never when a provider exists.
    ...(deliveryIsConfigured() ? {} : { developmentCode: code }),
  });
}
