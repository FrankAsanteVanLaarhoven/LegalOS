#!/usr/bin/env node
/**
 * Regression suite for the identity-architecture checker.
 *
 * Runs the real checker — the same file that gates `apps/web/src` — against
 * committed fixtures. A self-test against a re-implementation would prove the
 * re-implementation, which is the failure this whole programme keeps finding.
 *
 * Positive fixtures must produce no violations. Negative fixtures must each
 * produce their expected rule, in their expected file, with a non-zero exit.
 */
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHECKER = join(repoRoot, "scripts/check-identity-architecture.mjs");
const ROOT = "scripts/fixtures/identity-architecture";

function run(root) {
  try {
    const out = execFileSync(
      process.execPath,
      ["--experimental-strip-types", CHECKER, `--root=${root}`, "--quiet"],
      { cwd: repoRoot, encoding: "utf8" }
    );
    return { exit: 0, violations: JSON.parse(out.trim() || "[]") };
  } catch (error) {
    return { exit: error.status ?? 1, violations: JSON.parse((error.stdout ?? "[]").trim() || "[]") };
  }
}

/** Every negative fixture, with the rule it must provoke. */
const EXPECTED = [
  ["manual-context.ts", "ST-A1"],
  ["context-assertion.ts", "ST-A1"],
  ["identity-from-form.ts", "ST-A2"],
  ["duplicate-cookie.ts", "ST-A4"],
  ["active-org-parsing.ts", "ST-A5"],
  ["membership-query.ts", "ST-A6"],
  ["client-imports-server.tsx", "ST-A7"],
  ["alternate-factory.ts", "ST-A8"],
];

const failures = [];

const accepted = run(`${ROOT}/accepted`);
if (accepted.exit !== 0 || accepted.violations.length > 0) {
  failures.push(
    `accepted fixtures were rejected: ${accepted.violations
      .map((v) => `${v.file}:${v.line} ${v.rule}`)
      .join(", ")}`
  );
}

const rejected = run(`${ROOT}/rejected`);
if (rejected.exit === 0) failures.push("rejected fixtures produced a zero exit status");

for (const [file, rule] of EXPECTED) {
  const hit = rejected.violations.find((v) => v.file === file && v.rule === rule);
  if (!hit) {
    failures.push(`${file} did not produce ${rule}`);
  } else if (!Number.isInteger(hit.line) || hit.line < 1) {
    failures.push(`${file} produced ${rule} with no usable line number`);
  }
}

console.log("\nIdentity-architecture checker self-test\n");
console.log(`  accepted fixtures: ${accepted.violations.length} violation(s), exit ${accepted.exit}`);
console.log(`  rejected fixtures: ${rejected.violations.length} violation(s), exit ${rejected.exit}`);
for (const [file, rule] of EXPECTED) {
  const hit = rejected.violations.find((v) => v.file === file && v.rule === rule);
  console.log(`  ${hit ? "OK  " : "FAIL"}  ${rule.padEnd(6)} ${file}${hit ? `:${hit.line}` : ""}`);
}

if (failures.length > 0) {
  console.error(`\n${failures.length} self-test failure(s):`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`\n  ${EXPECTED.length} negative and ${5} positive fixtures hold.`);
