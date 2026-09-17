import { NextResponse } from "next/server";

/**
 * Health.
 *
 * Called unauthenticated by a load balancer and by the release workflow, which
 * is why it is on the public allowlist. That makes what it reports a security
 * decision as well as an operational one: it answers whether each dependency is
 * working, and never what it is. No versions, no hostnames, no error text, no
 * counts — a health endpoint is the most reliably reachable surface a platform
 * has, and an attacker learning the database version from it has learned it
 * from the one route nobody thinks of as an interface.
 *
 * Degraded rather than down when a dependency fails. The distinction matters to
 * whoever is paged: the process is alive and something it needs is not, which
 * is a different response from the process being gone.
 */
export const dynamic = "force-dynamic";

interface Check {
  readonly name: string;
  readonly passed: boolean;
}

export async function GET() {
  const checks: Check[] = [];

  if (!process.env.DATABASE_URL) {
    // Not a failure in every deployment — a build with no database configured
    // is a real and valid state — but it is reported rather than omitted.
    checks.push({ name: "database_configured", passed: false });
  } else {
    let pool: import("@legalos/database").PoolLike | null = null;
    try {
      const { createPool, PostgresAuditStore } = await import("@legalos/database");
      pool = await createPool();
      await pool.query("SELECT 1");
      checks.push({ name: "database_configured", passed: true });
      checks.push({ name: "database_reachable", passed: true });

      // The audit chain is the one dependency whose silent failure would be
      // invisible from anywhere else, so it is checked on every probe rather
      // than left to a scheduled job somebody has to remember to read.
      const verification = await new PostgresAuditStore(pool).verify();
      checks.push({ name: "audit_chain_intact", passed: verification.valid });
    } catch {
      checks.push({ name: "database_reachable", passed: false });
    } finally {
      if (pool) await pool.end();
    }
  }

  const healthy = checks.every((check) => check.passed);

  return NextResponse.json(
    { status: healthy ? "ok" : "degraded", checks },
    {
      status: healthy ? 200 : 503,
      // Never cached. A cached health response reports the state of a moment
      // that has passed, to a caller deciding what to do now.
      headers: { "cache-control": "no-store" },
    }
  );
}
