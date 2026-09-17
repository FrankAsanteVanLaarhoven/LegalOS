import { NextResponse, type NextRequest } from "next/server";
import { createHash } from "node:crypto";

import { requireSession } from "@/lib/auth/require-session";
import { resolveServerSession, resolveTenantContext } from "@/lib/auth/server-session";

/**
 * The instrument obligation 3 could not have.
 *
 * Obligation 3 proved that `requireSession`, `resolveServerSession` and the
 * switch path reach the same authorisation decision — but only for the three
 * entry points reachable from `packages/`. Nothing under `packages/` may import
 * `apps/web`, so the two framework entry points were covered by a structural
 * guard reading source text, which is a weaker instrument and was recorded as
 * such.
 *
 * This route is the stronger instrument, on the other side of that boundary. It
 * drives both framework entry points in one real HTTP request and returns what
 * each resolved, so the smoke can compare them at runtime rather than by
 * reading code. `requireSession` is the API path; `resolveTenantContext` calls
 * `resolveServerSession` and is the path a server component would take.
 *
 * It does not replace the structural guard. A smoke observes one configuration
 * once; the guard holds on every commit.
 *
 * **Development only.** Keyed off NODE_ENV rather than a flag, exactly like the
 * dev-session route and the CSP relaxation, so there is no configuration that
 * turns it on in a deployed build.
 */

/**
 * Identifiers are returned as digests, never raw.
 *
 * The smoke needs to know whether two entry points resolved the *same* account,
 * not which account. A digest answers that and discloses nothing if this
 * response is ever logged. Truncated because a collision between two ids in one
 * request is not a risk worth carrying full hashes for.
 */
function digest(value: string | null): string | null {
  if (value === null) return null;
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available." }, { status: 404 });
  }

  // The API entry point. Refuses before anything else runs, exactly as
  // /api/analyze and /api/chat do.
  const api = await requireSession(req);
  if (!api.ok) {
    return NextResponse.json({ error: api.reason }, { status: api.status });
  }

  // The server-component entry point, resolved independently through the same
  // request. Called directly rather than read off the tenant result, because
  // the question is whether two *separate* resolutions agree — taking the
  // account id from `requireSession` would compare a value with itself.
  const session = await resolveServerSession();

  // Tenancy is a separate layer and is reported separately. A tenancy failure
  // is reached only *because* the session was accepted, so folding the two
  // together would report an authorisation split that does not exist — the
  // distinction obligation 3 had to make in its harness, made here for the same
  // reason.
  const tenant = await resolveTenantContext();

  return NextResponse.json({
    ok: true,
    requireSession: {
      authenticated: true,
      accountId: digest(api.accountId),
    },
    resolveServerSession: session.ok
      ? {
          authenticated: true,
          accountId: digest(session.value.accountId),
          // Present only when a tenancy resolved; the failure is reported
          // alongside rather than in place of the session outcome.
          organisationId: tenant.ok ? digest(tenant.value.organisationId) : null,
          membershipId: tenant.ok ? digest(tenant.value.membershipId) : null,
          role: tenant.ok ? tenant.value.role : null,
          membershipCount: tenant.ok ? tenant.value.memberships.length : null,
          tenancy: tenant.ok ? "resolved" : tenant.failure,
        }
      : {
          authenticated: false,
          accountId: null,
          tenancy: null,
          failure: session.failure,
        },
  });
}
