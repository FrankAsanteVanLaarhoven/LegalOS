/**
 * Operational readiness, in three tiers.
 *
 *   --mode structural    the engine itself. Needs no secret, runs on every push.
 *   --mode environment   measures what this environment can answer. The default.
 *   --mode deployment    a release gate, where "could not tell" is a failure.
 *
 * The distinction the tiers exist to preserve: absence of measurement is not
 * measured failure. A contributor with no production secrets should not have a
 * red pipeline, because a pipeline that is always red teaches people to stop
 * reading it — and "no database configured here" and "the database is broken"
 * are different facts that deserve different marks.
 */
import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { readDatasets, readRoutingEvidence, verifyDataset } from "../packages/bench/src/index.ts";
import {
  CHECKS,
  DEPLOYMENT_PROFILE,
  MANIFEST_VERSION,
  REQUIRED_CHECKS,
  evaluate,
  validateManifest,
  verdict,
} from "../packages/readiness/src/index.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const modeArg = process.argv.find((a) => a.startsWith("--mode="));
const mode = modeArg ? modeArg.slice("--mode=".length) : "environment";
if (!["structural", "environment", "deployment"].includes(mode)) {
  console.error(`unknown mode ${mode}; expected structural, environment or deployment`);
  process.exit(2);
}

/* ------------------------------------------------------------------ */
/* Tier 1: structural. The engine, not the deployment.                 */
/* ------------------------------------------------------------------ */

const defects = validateManifest();

console.log("\nReadiness engine\n");
console.log(`  manifest version   ${MANIFEST_VERSION}`);
console.log(`  checks declared    ${CHECKS.length}`);
console.log(`  required checks    ${REQUIRED_CHECKS.length}`);
console.log(`  structural defects ${defects.length}`);
for (const defect of defects) console.log(`    ✗ ${defect.checkId}  ${defect.problem}`);

if (defects.length > 0) {
  // Always fatal, at every tier. A model that cannot describe itself cannot be
  // trusted to describe anything else.
  console.error("\n  The readiness model is defective. This is a code defect, not a deployment gap.\n");
  process.exit(1);
}
console.log("  PASS — the platform still knows how to measure readiness\n");

if (mode === "structural") process.exit(0);

/* ------------------------------------------------------------------ */
/* Tier 2: environment. Measure what can be measured.                  */
/* ------------------------------------------------------------------ */

const measurements = [];
const applicable = [];
const measure = (id, state, detail) => measurements.push({ id, state, detail });

// The ADR's assumptions, verified against the live environment rather than left
// as prose that drifts.
measure(
  "deployment_profile_declared",
  DEPLOYMENT_PROFILE.adr && DEPLOYMENT_PROFILE.healthEndpoint ? "pass" : "fail",
  `${DEPLOYMENT_PROFILE.adr}: ${DEPLOYMENT_PROFILE.target}, expected region ${DEPLOYMENT_PROFILE.expectedRegion}, ${DEPLOYMENT_PROFILE.unverifiable.length} assumption(s) recorded as unverifiable from here`
);

// Validated against whichever provider is configured, rather than against one
// vendor's variable. The platform integrates a provider interface; which vendor
// sits behind it is configuration.
const providerKind = process.env.AI_PROVIDER ?? "gateway";
const providerMissing =
  providerKind === "xai"
    ? process.env.XAI_API_KEY
      ? []
      : ["XAI_API_KEY"]
    : ["AI_GATEWAY_URL", "AI_GATEWAY_API_KEY", "AI_GATEWAY_MODEL"].filter((v) => !process.env[v]);
measure(
  "provider_credential",
  providerMissing.length === 0 ? "pass" : "fail",
  providerMissing.length === 0
    ? `${providerKind} configured`
    : `${providerKind}: ${providerMissing.join(", ")} not set`
);

measure(
  "delivery_provider",
  process.env.EMAIL_PROVIDER_URL || process.env.SMS_PROVIDER_URL ? "pass" : "fail",
  process.env.EMAIL_PROVIDER_URL || process.env.SMS_PROVIDER_URL
    ? "configured"
    : "none — sign-in returns 503 in production, so nobody outside development can obtain a session"
);

let pool = null;
if (!process.env.DATABASE_URL) {
  // Not measurable rather than failed: this environment was not asked to have
  // a database. At deployment tier the same absence blocks.
  measure("database", "not_measurable", "DATABASE_URL is not set in this environment");
} else {
  try {
    const { createPool, PostgresAuditStore } = await import("../packages/database/src/index.ts");
    pool = await createPool();
    await pool.query("SELECT 1");
    measure("database", "pass", "reachable");

    const files = (await readdir(join(repoRoot, "packages/database/migrations")))
      .filter((f) => f.endsWith(".sql"))
      .sort();
    const applied = await pool.query("SELECT name FROM schema_migrations ORDER BY name");
    const appliedNames = new Set(applied.rows.map((r) => r.name));
    const pending = files.filter((f) => !appliedNames.has(f));
    measure(
      "migrations",
      pending.length === 0 ? "pass" : "fail",
      pending.length === 0 ? `${files.length} applied, none pending` : `pending: ${pending.join(", ")}`
    );

    const triggers = await pool.query(
      `SELECT t.tgname FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
        WHERE NOT t.tgisinternal
          AND c.relname IN ('audit_log', 'ai_executions', 'ai_execution_transitions', 'ai_execution_completions')`
    );
    const present = new Set(triggers.rows.map((r) => r.tgname));
    const required = [
      "audit_log_tombstone_only",
      "audit_log_no_delete",
      "ai_executions_no_update",
      "ai_executions_no_delete",
      "ai_execution_transitions_no_change",
      "ai_execution_completions_no_change",
    ];
    const missing = required.filter((t) => !present.has(t));
    measure(
      "append_only_triggers",
      missing.length === 0 ? "pass" : "fail",
      missing.length === 0 ? `${required.length} installed` : `missing: ${missing.join(", ")}`
    );

    // ADR-001 assumes an encrypted connection. Read from the live connection
    // rather than from the URL, because a URL saying sslmode=require and a
    // connection that actually negotiated TLS are different claims.
    const ssl = await pool.query(
      "SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()"
    );
    const encrypted = ssl.rows[0]?.ssl === true;
    measure(
      "database_encrypted",
      encrypted ? "pass" : "fail",
      encrypted ? "connection negotiated TLS" : "connection is not encrypted"
    );

    // A colocated database shares the blast radius of the process it serves.
    // Loopback is the signal available from here; it does not prove the
    // database is managed, only that it is not on this host.
    const host = new URL(process.env.DATABASE_URL.replace(/^postgres(ql)?:/, "http:")).hostname;
    const colocated = host === "localhost" || host === "127.0.0.1" || host === "::1";
    if (DEPLOYMENT_PROFILE.requiresManagedDatabase) applicable.push("database_managed");
    measure(
      "database_managed",
      colocated ? "fail" : "pass",
      colocated
        ? `database is on ${host}, colocated with the application`
        : "database is not on the application host"
    );

    const executions = await pool.query("SELECT count(*)::int AS n FROM ai_executions");
    const count = Number(executions.rows[0]?.n ?? 0);
    measure(
      "production_executions",
      count > 0 ? "pass" : "fail",
      count > 0 ? `${count} recorded` : "none — architecturally complete, operationally unevidenced"
    );

    const verification = await new PostgresAuditStore(pool).verify();
    measure(
      "audit_chain",
      verification.valid ? "pass" : "fail",
      verification.valid ? "chain intact" : `broken at ${verification.brokenAt}: ${verification.reason}`
    );
  } catch (error) {
    measure(
      "database",
      "fail",
      `unreachable: ${error instanceof Error ? error.message : "unknown error"}`
    );
  } finally {
    if (pool) await pool.end();
  }
}

// Health, probed rather than assumed present. Without HEALTH_URL there is no
// running deployment to ask, which is an absence and not a failure.
if (!process.env.HEALTH_URL) {
  measure("health_endpoint", "not_measurable", "HEALTH_URL is not set; no deployment to probe");
} else {
  applicable.push("health_endpoint");
  try {
    const response = await fetch(process.env.HEALTH_URL, { signal: AbortSignal.timeout(10_000) });
    const body = await response.json().catch(() => ({}));
    measure(
      "health_endpoint",
      response.ok ? "pass" : "fail",
      `${response.status} ${body?.status ?? ""}`.trim()
    );
  } catch (error) {
    measure(
      "health_endpoint",
      "fail",
      `unreachable: ${error instanceof Error ? error.message : "unknown error"}`
    );
  }
}

const datasets = await readDatasets(repoRoot);
if (datasets.length === 0) {
  measure("benchmark_dataset", "not_measurable", "none installed; benchmarking is not enabled here");
} else {
  applicable.push("benchmark_dataset", "reviewer_approvals");
  const datasetDefects = datasets.flatMap((d) => verifyDataset(d.manifest, d.samples));
  measure(
    "benchmark_dataset",
    datasetDefects.length === 0 ? "pass" : "fail",
    datasetDefects.length === 0
      ? `${datasets.reduce((n, d) => n + d.samples.length, 0)} samples verifying`
      : `${datasetDefects.length} defect(s)`
  );
  const underReviewed = datasetDefects.filter((d) => d.kind === "INSUFFICIENT_REVIEW").length;
  measure(
    "reviewer_approvals",
    underReviewed === 0 ? "pass" : "fail",
    underReviewed === 0 ? "two independent reviewers per sample" : `${underReviewed} under-reviewed`
  );
}

// Benchmark evidence is owed once more than one provider is configured, and not
// before: with one provider nothing is being ranked.
const configuredProviders = providerMissing.length === 0 ? [providerKind] : [];
const evidence = await readRoutingEvidence(repoRoot);
const current = evidence.filter((e) => Date.parse(e.expiresAt) > Date.now());
if (configuredProviders.length > 1) applicable.push("benchmark_evidence");
measure(
  "benchmark_evidence",
  configuredProviders.length > 1
    ? current.length > 0
      ? "pass"
      : "fail"
    : "not_measurable",
  configuredProviders.length > 1
    ? `${current.length} current of ${evidence.length}`
    : `${configuredProviders.length} provider configured; nothing is ranked and none is owed`
);

/* ------------------------------------------------------------------ */
/* Report                                                              */
/* ------------------------------------------------------------------ */

const results = evaluate({ tier: mode, measurements, applicable });
const summary = verdict(results);
const width = Math.max(...results.map((r) => r.check.label.length));
const mark = { pass: "✓", fail: "✗", not_measurable: "—" };

console.log(`Readiness — ${mode}\n`);
for (const result of results) {
  const flag = result.blocking ? " (blocking)" : "";
  console.log(`  ${mark[result.state]} ${result.check.label.padEnd(width)}  ${result.detail}${flag}`);
}

console.log("");
console.log(
  `  ${summary.counts.pass} passing · ${summary.counts.fail} failing · ${summary.counts.not_measurable} not measurable`
);

if (summary.ready) {
  console.log(`\n  ${mode === "deployment" ? "Ready to deploy." : "No blocking failures at this tier."}\n`);
  process.exit(0);
}

console.log("\n  Blocking:");
for (const result of summary.blocking) {
  console.log(`    ${result.check.label} (${result.check.owner.replace(/_/g, " ")})`);
  console.log(`      ${result.check.remedy}`);
}
console.log("");

// Only a deployment gate fails the process. Environment mode reports and exits
// clean, because a contributor's laptop legitimately lacks production secrets.
process.exit(mode === "deployment" ? 1 : 0);
