import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/cookies";
import { limitAuthRoute } from "@/lib/ai/rate-limit";

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
  /**
   * The LegalOS Companion chatbot answers public questions about legal processes
   * across all pages without requiring account sign-in.
   */
  "/api/chat",
];

function isPublicApi(pathname: string): boolean {
  return PUBLIC_API.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

/**
 * A session token is opaque and base64url. This checks shape only — a
 * well-formed token proves nothing, and the handler still verifies it.
 */
const SENSITIVE_CACHE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
  Pragma: "no-cache",
  "Surrogate-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function applySensitiveHeaders(res: NextResponse): NextResponse {
  for (const [key, value] of Object.entries(SENSITIVE_CACHE_HEADERS)) {
    res.headers.set(key, value);
  }
  return res;
}

function hasPlausibleSession(req: NextRequest): boolean {
  const value = req.cookies.get(SESSION_COOKIE)?.value;
  return typeof value === "string" && /^[A-Za-z0-9_-]{20,}$/.test(value);
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 1. Rate-limit authentication routes to stop automated spam & PIN brute force
  if (pathname === "/api/auth/start" || pathname === "/api/auth/verify") {
    const isVerify = pathname === "/api/auth/verify";
    const { decision, headers } = await limitAuthRoute(req, isVerify);
    if (!decision.allowed) {
      const retryAfter = Math.max(1, Math.ceil((decision.resetAt - Date.now()) / 1000));
      const res = NextResponse.json(
        {
          error: decision.message ?? "Too many attempts. Please try again later.",
          code: "RATE_LIMITED",
        },
        { status: 429, headers: { ...headers, "Retry-After": String(retryAfter) } }
      );
      return applySensitiveHeaders(res);
    }
  }

  if (pathname.startsWith("/api")) {
    if (isPublicApi(pathname) || hasPlausibleSession(req)) {
      const res = NextResponse.next();
      return applySensitiveHeaders(res);
    }

    // JSON for an API route: a redirect here would return a login page body to
    // something expecting data, which is worse than an honest 401.
    const res = NextResponse.json(
      { error: "Sign in to continue.", code: "UNAUTHENTICATED" },
      { status: 401 }
    );
    return applySensitiveHeaders(res);
  }

  if (pathname.startsWith("/workspace")) {
    if (hasPlausibleSession(req)) {
      const res = NextResponse.next();
      return applySensitiveHeaders(res);
    }

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
