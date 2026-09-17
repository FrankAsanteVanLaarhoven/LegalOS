import type { NextConfig } from "next";

/**
 * Workspace packages are published as raw TypeScript (`main: ./src/index.ts`),
 * so Next has to compile them rather than treat them as prebuilt dependencies.
 */
const WORKSPACE_PACKAGES = [
  "@legalos/auth",
  "@legalos/capabilities",
  "@legalos/knowledge",
  "@legalos/policy",
  "@legalos/ratelimit",
  "@legalos/rules",
  "@legalos/verification",
  "@legalos/reliability",
  "@legalos/governance",
  "@legalos/fiduciary",
  "@legalos/bench",
  "@legalos/database",
];

/**
 * React's development build calls eval() for debugging features such as
 * reconstructing callstacks across environments. Its production build never
 * does. So 'unsafe-eval' is granted in development only — a deployed build
 * keeps the strict policy.
 *
 * This is keyed off NODE_ENV rather than a flag anyone can set, so there is no
 * way to ship a production bundle with eval permitted.
 */
const isDevelopment = process.env.NODE_ENV !== "production";

const scriptSrc = isDevelopment
  ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
  : "script-src 'self' 'unsafe-inline'";

/** Turbopack's hot-reload channel is a websocket back to the dev server. */
const connectSrc = isDevelopment ? "connect-src 'self' ws: wss:" : "connect-src 'self'";

/**
 * Baseline response headers. Previously the config was empty, so every response
 * shipped with no CSP, no frame-ancestors, and no HSTS — leaving the case
 * workspace framable for clickjacking and full case URLs leaking in Referer.
 */
const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Next injects inline bootstrap scripts and styles.
      scriptSrc,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "media-src 'self'",
      "font-src 'self' data:",
      connectSrc,
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "geolocation=(), microphone=(), camera=(), payment=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

/**
 * Where the build lives.
 *
 * Next refuses to start a second development server for the same directory: it
 * holds a lock under the build directory and reports the existing server's pid.
 * That is correct for two developers' servers, and wrong for the development
 * smoke, which needs its own server for a few seconds without disturbing — or
 * being blocked by — a `pnpm dev` somebody already has running.
 *
 * So the build directory is overridable. Unset, it is the default `.next` and
 * nothing changes. The smoke sets it, gets its own lock, its own port and its
 * own compiled output, and two smokes can run at once.
 */
const distDir = process.env.NEXT_DIST_DIR ?? ".next";

const nextConfig: NextConfig = {
  distDir,
  transpilePackages: WORKSPACE_PACKAGES,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
