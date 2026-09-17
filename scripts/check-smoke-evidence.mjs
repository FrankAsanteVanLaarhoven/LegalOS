/**
 * The smoke evidence gate.
 *
 * A smoke that writes a file saying it passed is worth exactly as much as the
 * file is hard to forge by accident. This reads that file and refuses it unless
 * it is internally consistent: the declared counts must match the recorded
 * cases, every mandatory case must have passed, the server must be recorded as
 * terminated, and cleanup must be recorded as complete.
 *
 * It fails closed. A missing file, an empty file, malformed JSON, an absent key
 * or zero cases are all refusals, because each of those is what an
 * unsuccessful or never-executed smoke leaves behind.
 */

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const EVIDENCE = join(repoRoot, "docs", "smoke-evidence", "development-smoke.json");

const REQUIRED = [
  "checkId",
  "verdict",
  "at",
  "commit",
  "durationMs",
  "environment",
  "server",
  "preflight",
  "routesExercised",
  "sessionSeeding",
  "caseCount",
  "mandatoryCount",
  "failedCount",
  "cases",
  "observations",
  "cleanup",
  "termination",
];

const problems = [];
const fail = (message) => problems.push(message);

let raw;
try {
  raw = await readFile(EVIDENCE, "utf8");
} catch {
  fail(`no evidence at docs/smoke-evidence/development-smoke.json — run \`pnpm smoke:dev\``);
  report();
}

if (raw !== undefined) {
  if (raw.trim() === "") fail("the evidence file is empty");

  let evidence;
  try {
    evidence = JSON.parse(raw);
  } catch (error) {
    fail(`the evidence file is not valid JSON: ${error.message}`);
  }

  if (evidence) {
    for (const key of REQUIRED) {
      if (!(key in evidence)) fail(`required key missing: ${key}`);
    }

    if (evidence.checkId !== "development_smoke") {
      fail(`unexpected checkId ${JSON.stringify(evidence.checkId)}`);
    }

    if (!Array.isArray(evidence.cases) || evidence.cases.length === 0) {
      fail("no cases were declared — a smoke that ran nothing is not a smoke that passed");
    } else {
      if (evidence.cases.length !== evidence.caseCount) {
        fail(`caseCount ${evidence.caseCount} does not match ${evidence.cases.length} recorded cases`);
      }
      const mandatory = evidence.cases.filter((c) => c.mandatory);
      if (mandatory.length !== evidence.mandatoryCount) {
        fail(
          `mandatoryCount ${evidence.mandatoryCount} does not match ${mandatory.length} mandatory cases`
        );
      }
      const failed = mandatory.filter((c) => !c.passed);
      if (failed.length !== evidence.failedCount) {
        fail(`failedCount ${evidence.failedCount} does not match ${failed.length} failed cases`);
      }
      // The forgery this gate exists to catch.
      if (evidence.verdict === "passed" && failed.length > 0) {
        fail(
          `the evidence claims success while ${failed.length} mandatory case(s) failed: ` +
            failed.map((c) => c.name).join(", ")
        );
      }
      if (evidence.verdict !== "passed") {
        fail(`the recorded verdict is ${JSON.stringify(evidence.verdict)}`);
      }
    }

    // Lifecycle. A smoke that left a server running has not passed, whatever
    // its cases say.
    if (evidence.termination?.alive !== false) {
      fail(`the server was not recorded as terminated (alive=${evidence.termination?.alive})`);
    }
    if (evidence.cleanup?.ok !== true) {
      fail(`cleanup was not recorded as complete (ok=${evidence.cleanup?.ok})`);
    }

    // Nothing secret may be in here.
    const text = JSON.stringify(evidence);
    if (/legalos_session=[A-Za-z0-9_-]{20,}/.test(text)) {
      fail("a raw session cookie value appears in the evidence");
    }
    if (/postgres:\/\/[^"]*:[^"@]*@/.test(text)) {
      fail("a database password appears in the evidence");
    }

    // The coverage the obligation requires, asserted rather than assumed.
    const routes = evidence.routesExercised ?? [];
    for (const route of ["/api/analyze", "/api/dev/identity", "/workspace"]) {
      if (!routes.includes(route)) fail(`the smoke did not exercise ${route}`);
    }
    if (evidence.observations?.duplicateCookies?.frameworkAgreesWithHarness !== true) {
      fail("the framework's duplicate-cookie behaviour was not confirmed to match obligation 3");
    }
  }
}

report();

function report() {
  process.stdout.write("\nDevelopment smoke evidence\n\n");
  if (problems.length === 0) {
    process.stdout.write("  The recorded smoke is internally consistent and complete.\n\n");
    process.exit(0);
  }
  for (const problem of problems) process.stdout.write(`  ✗ ${problem}\n`);
  process.stdout.write(`\n  ${problems.length} problem(s).\n\n`);
  process.exit(1);
}
