import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

/**
 * Alert subscription endpoint — currently a no-op by design.
 *
 * This form asks asylum seekers and trafficking survivors for an email address
 * and a phone number, on a page about immigration law. Three things were wrong
 * with accepting them:
 *
 *  - Nothing was stored. The response said "Subscription recorded", so a user
 *    relying on it for a rules change affecting their status would wait for an
 *    alert that could never arrive.
 *  - There was no privacy notice, lawful basis, or consent step anywhere in the
 *    flow, for data whose mere association with this app discloses that someone
 *    is pursuing an immigration or asylum matter.
 *  - `channels` was caller-supplied and echoed back, so wiring a real provider
 *    behind it would have handed the caller control of the delivery list.
 *
 * Until a provider and a privacy notice exist, the endpoint accepts the request
 * and tells the truth: no contact details are retained and no alert will be sent.
 * `topics` is kept so the UI can show what a user asked for; `channels` is
 * derived server-side, never taken from the caller.
 */
const TOPICS = ["immigration_rules", "home_office_news", "case_law", "tribunal_practice"] as const;

const RequestSchema = z
  .object({
    email: z.string().trim().max(254).email("Invalid email.").optional().or(z.literal("")),
    phone: z.string().trim().max(32).optional().or(z.literal("")),
    topics: z.array(z.enum(TOPICS)).max(TOPICS.length).optional(),
  })
  .refine((value) => Boolean(value.email) || Boolean(value.phone), {
    message: "Provide at least an email or phone number.",
  });

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    // A `null` body used to throw and surface as a 500, reporting malformed
    // input as a server fault.
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body." },
      { status: 400 }
    );
  }

  const { email, phone, topics } = parsed.data;

  return NextResponse.json({
    ok: true,
    subscription: {
      // No id is minted and nothing is persisted — deliberately, so this cannot
      // be mistaken for a stored record.
      stored: false,
      channels: [email ? "email" : null, phone ? "sms" : null].filter(Boolean),
      topics: topics ?? [...TOPICS],
      status: "not_yet_available",
      message:
        "Alerts are not running yet, so nothing has been saved and no alert will be sent. Your email and phone number were not retained. Check GOV.UK directly for changes that affect you.",
    },
  });
}
