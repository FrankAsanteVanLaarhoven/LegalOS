import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/cookies";

/**
 * Route gating.
 *
 * Fail-closed by path: everything under /api and /workspace requires a session
 * unless it appears in PUBLIC_API below. A route added tomorrow is protected
 * without anyone remembering to protect it, which is the only default that
 * survives a growing codebase.
 *
 * The session is only *resolved* here, never validated against the store —
 * middleware runs on every request and a database round trip per request is the
 * wrong shape. It checks that a session cookie is present and well formed; the
 * route handler verifies it properly via checkSession(). Middleware is the
 * coarse gate, not the authority.
 */

/**
 * Routes that serve public information and must stay reachable without an
 * account. Reading about the law requires no identity — Principle 11.
 */
const PUBLIC_API = [
  // Called by a load balancer with no session. It reports whether each
  // dependency works and never what it is.
  "/api/health",
  "/api/feeds",
  "/api/weather",
  "/api/currency",
  "/api/resources/preview",
  "/api/auth/dev-session",
  /**
   * Sign-in must be reachable by somebody who is not signed in.
   *
   * These two were absent, so the gate below returned 401 to every
   * unauthenticated caller of the endpoints whose entire purpose is to serve
   * unauthenticated callers: sign-in could not be started, and the code it
   * issues could not be verified. Nothing caught it because no test crosses
   * this boundary — the middleware only runs inside a real server, which is
   * what the development smoke starts. It was found by `pnpm smoke:dev`
   * observing 401 where it expected the delivery-provider response.
   */
  "/api/auth/start",
  "/api/auth/verify",
];

function isPublicApi(pathname: string): boolean {
  return PUBLIC_API.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

/**
 * A session token is opaque and base64url. This checks shape only — a
 * well-formed token proves nothing, and the handler still verifies it.
 */
function hasPlausibleSession(req: NextRequest): boolean {
  const value = req.cookies.get(SESSION_COOKIE)?.value;
  return typeof value === "string" && /^[A-Za-z0-9_-]{20,}$/.test(value);
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/api")) {
    if (isPublicApi(pathname) || hasPlausibleSession(req)) return NextResponse.next();

    // JSON for an API route: a redirect here would return a login page body to
    // something expecting data, which is worse than an honest 401.
    return NextResponse.json(
      { error: "Sign in to continue.", code: "UNAUTHENTICATED" },
      { status: 401 }
    );
  }

  if (pathname.startsWith("/workspace")) {
    if (hasPlausibleSession(req)) return NextResponse.next();

    const signIn = new URL("/sign-in", req.url);
    // Preserved so a person returns to what they were doing rather than a
    // dashboard — for someone working to a tribunal deadline that matters.
    signIn.searchParams.set("next", pathname);
    return NextResponse.redirect(signIn);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*", "/workspace/:path*"],
};
