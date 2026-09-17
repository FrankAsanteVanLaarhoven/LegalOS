import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { assertTestDatabase } from "@legalos/database";

/**
 * Tests for the smoke runner itself, and for the instrument it needs.
 *
 * The smoke proves things about the application. These prove things about the
 * smoke — that its database guard refuses, that its evidence gate refuses, and
 * that the development-only route it depends on is genuinely development-only.
 * A runner nobody tests is a runner whose green result means nothing.
 *
 * These run without a database and without a server, so they belong in the
 * ordinary suite rather than behind the smoke command.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

const source = (path: string) =>
  readFile(join(repoRoot, path), "utf8").then((text) =>
    text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
  );

/* ================================================================ */

test("the smoke refuses any database the canonical guard refuses", () => {
  // Not a rule of its own: the runner calls `assertTestDatabase`, so a database
  // the rest of the repository would refuse to write to is refused here too.
  for (const unsafe of [
    "postgres://u:p@host:5432/legalos_production",
    "postgres://u:p@host:5432/legalos",
    "postgres://u:p@host:5432/legalos_dev",
    undefined,
  ]) {
    assert.throws(() => assertTestDatabase(unsafe), `${unsafe} was admitted`);
  }
  assert.doesNotThrow(() => assertTestDatabase("postgres://u:p@host:5432/legalos_test"));
});

test("the smoke runner reads its database from a test variable, never from DATABASE_URL", async () => {
  const runner = await source("scripts/smoke-dev.mjs");
  // Falling back to DATABASE_URL is how a destructive routine reaches the
  // application's own database. The runner must not offer that fallback.
  assert.match(runner, /SMOKE_DATABASE_URL\s*\?\?\s*process\.env\.TEST_DATABASE_URL/);
  assert.doesNotMatch(
    runner.replace(/DATABASE_URL: databaseUrl/g, ""),
    /process\.env\.DATABASE_URL/,
    "the runner reads DATABASE_URL"
  );
  assert.match(runner, /assertTestDatabase\(databaseUrl\)/);
});

test("the smoke runner bounds every wait and escalates termination", async () => {
  const runner = await source("scripts/smoke-dev.mjs");
  assert.match(runner, /STARTUP_TIMEOUT_MS/);
  assert.match(runner, /REQUEST_TIMEOUT_MS/);
  assert.match(runner, /SIGKILL_GRACE_MS/);
  // SIGTERM first, SIGKILL as a bounded fallback, liveness read back after —
  // and against the whole process group, because `pnpm exec next dev` is three
  // processes deep and signalling only the direct child leaves the grandchild
  // running.
  assert.match(runner, /signalGroup\(pid, "SIGTERM"\)/);
  assert.match(runner, /signalGroup\(pid, "SIGKILL"\)/);
  assert.match(runner, /detached: true/);
  assert.match(runner, /alive: groupIsAlive\(pid\)/);
  assert.match(runner, /async function groupGone\(pid, withinMs\)/);
  // Readiness must never be a bare sleep.
  assert.match(runner, /\/api\/health/);
  assert.doesNotMatch(runner, /await new Promise\(\(r\) => setTimeout\(r, \d{4,}\)\)/);
});

test("the smoke runner cleans up on interruption, not only on success", async () => {
  const runner = await source("scripts/smoke-dev.mjs");
  assert.match(runner, /SIGINT/);
  assert.match(runner, /for \(const signal of \["SIGINT", "SIGTERM"\]\)/);
  // Cleanup is unconditional: seeding writes rows before it can fail, so a
  // cleanup guarded on a completed seed leaves them behind. It did, once.
  assert.doesNotMatch(runner, /if \(fixture\) \{\s*try \{\s*cleanup =/);
});

test("the smoke runner never deletes from the append-only audit log", async () => {
  const runner = await source("scripts/smoke-dev.mjs");
  assert.doesNotMatch(
    runner,
    /DELETE FROM audit_log/,
    "audit_log carries a BEFORE DELETE trigger; attempting it aborts cleanup entirely"
  );
});

test("the development-only routes refuse production", async () => {
  for (const path of [
    "apps/web/src/app/api/dev/identity/route.ts",
    "apps/web/src/app/api/auth/dev-session/route.ts",
  ]) {
    const route = await source(path);
    // Keyed off NODE_ENV, so no configuration turns it on in a deployed build.
    assert.match(
      route,
      /process\.env\.NODE_ENV === "production"/,
      `${path} does not check NODE_ENV`
    );
    assert.match(route, /status:\s*404/, `${path} does not 404 in production`);
  }
});

test("the diagnostic route discloses no raw identifier", async () => {
  const route = await source("apps/web/src/app/api/dev/identity/route.ts");
  // Every identifier goes through `digest`. A raw accountId in a response is a
  // disclosure whether or not anybody is reading it today.
  assert.match(route, /digest\(api\.accountId\)/);
  assert.match(route, /digest\(session\.value\.accountId\)/);
  assert.doesNotMatch(route, /accountId:\s*api\.accountId/);
  assert.doesNotMatch(route, /accountId:\s*session\.value\.accountId/);
  // And it requires a session before resolving anything.
  assert.match(route, /const api = await requireSession\(req\);/);
  assert.match(route, /if \(!api\.ok\)/);
});

test("sign-in is reachable by somebody who is not signed in", async () => {
  // The defect the smoke found: these two sat behind the middleware's session
  // gate, so the endpoints whose whole purpose is to serve unauthenticated
  // callers answered them 401.
  const middleware = await source("apps/web/src/middleware.ts");
  assert.match(middleware, /"\/api\/auth\/start"/);
  assert.match(middleware, /"\/api\/auth\/verify"/);
});

test("the evidence gate rejects every malformed shape", async () => {
  const gate = await source("scripts/check-smoke-evidence.mjs");
  // The refusals the brief requires, asserted as present rather than assumed.
  assert.match(gate, /no evidence at/);
  assert.match(gate, /the evidence file is empty/);
  assert.match(gate, /not valid JSON/);
  assert.match(gate, /required key missing/);
  assert.match(gate, /no cases were declared/);
  assert.match(gate, /does not match/);
  assert.match(gate, /claims success while/);
  assert.match(gate, /was not recorded as terminated/);
  assert.match(gate, /cleanup was not recorded as complete/);
  // And it must refuse secrets in the artefact.
  assert.match(gate, /a raw session cookie value appears/);
});

test("the recorded smoke evidence is real and complete", async () => {
  // The committed artefact, checked here too so a suite run notices a smoke
  // that was never re-run after the code changed under it.
  const evidence = JSON.parse(
    await readFile(join(repoRoot, "docs/smoke-evidence/development-smoke.json"), "utf8")
  );
  assert.equal(evidence.checkId, "development_smoke");
  assert.equal(evidence.verdict, "passed");
  assert.equal(evidence.termination.alive, false);
  assert.equal(evidence.cleanup.ok, true);
  assert.ok(evidence.cases.length > 20, `only ${evidence.cases.length} cases recorded`);
  assert.equal(
    evidence.cases.filter((c: { mandatory: boolean; passed: boolean }) => c.mandatory && !c.passed)
      .length,
    0
  );
  // No secret may have reached it.
  const text = JSON.stringify(evidence);
  assert.doesNotMatch(text, /legalos_session=[A-Za-z0-9_-]{20,}/);
  assert.doesNotMatch(text, /postgres:\/\/[^"]*:[^"@]*@/);
});
