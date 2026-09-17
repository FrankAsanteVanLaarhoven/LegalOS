/**
 * Repository contract check.
 *
 * Evaluates every declared guarantee against two facts about the world: whether
 * the repository module exists, and whether a check has recently demonstrated
 * the failure that guarantee names being refused.
 *
 * What fails the build:
 *
 *   - structural defects in the declarations
 *   - any guarantee of a repository that EXISTS and is not honoured
 *
 * What does not:
 *
 *   - guarantees of repositories nobody has written yet
 *
 * That asymmetry is the entire design. Contracts are meant to be written before
 * the code, so an unimplemented one is the expected state and punishing it would
 * push everyone into writing contracts afterwards — where they describe the
 * implementation rather than constrain it. But the moment a module appears,
 * every promise it carries has to have been demonstrated, because from then on
 * panels are written against those promises and will not re-check them.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { readEvidence } from "../packages/integration/src/index.ts";
import { INVARIANTS } from "../packages/invariants/src/index.ts";
import {
  CONTRACTS,
  breaches,
  evaluateAll,
  formatContracts,
  validateContracts,
  validateInvariantRefs,
  validateTables,
} from "../packages/contracts/src/index.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const now = Date.now();

const defects = [
  ...validateContracts(),
  ...(await validateTables(repoRoot)),
  ...validateInvariantRefs(new Set(INVARIANTS.map((i) => i.id))),
];

// Evidence is read once per check id, ahead of evaluation, so the evaluator
// stays a pure function of the facts it is given and can be tested without a
// filesystem.
const readings = new Map();
for (const contract of CONTRACTS) {
  for (const guarantee of contract.guarantees) {
    if (!guarantee.provedBy || readings.has(guarantee.provedBy)) continue;
    const reading = await readEvidence(repoRoot, guarantee.provedBy, now);
    readings.set(guarantee.provedBy, reading.demonstrated);
  }
}

const results = evaluateAll(CONTRACTS, {
  moduleExists: (path) => existsSync(join(repoRoot, path)),
  evidenceFor: (checkId) => readings.get(checkId) ?? null,
});

console.log(formatContracts(results, defects));

/**
 * The other direction: a repository written with no contract at all.
 *
 * The gate above catches a contract whose promises are unproven. It cannot
 * catch a module that never made any, and that is the easier mistake — nobody
 * has to skip a step, they just have to not think of it.
 *
 * Counted and printed, not failed, for the reason the invariant registry does
 * not fail on `no_observer`: the cheapest route to a green build would be
 * deleting the contract, and a registry containing only solved problems is
 * worth nothing. It is listed here so it is a visible debt rather than a silent
 * absence.
 */
const { readdir } = await import("node:fs/promises");
const dir = join(repoRoot, "apps/web/src/lib/repositories");
const modules = (await readdir(dir).catch(() => [])).filter((f) => f.endsWith(".ts"));
const contracted = new Set(CONTRACTS.map((c) => c.module.split("/").pop()));
const uncontracted = modules.filter((m) => !contracted.has(m));

if (uncontracted.length > 0) {
  console.log(
    `\n  ${uncontracted.length} repository module(s) state no contract: ${uncontracted.join(", ")}.\n` +
      `  They live in apps/web, which nothing under packages/ may import, so there is\n` +
      `  nowhere to write a test that reaches them. Contracting them means moving them\n` +
      `  into a package or running tests inside the app — a real decision, recorded here\n` +
      `  rather than left as an omission.`
  );
}

if (defects.length > 0) {
  console.error(`\n${defects.length} defect(s) in the contract declarations.`);
  process.exit(1);
}

const failing = breaches(results);
if (failing.length > 0) {
  console.error(
    `\n${failing.length} guarantee(s) of repositories that exist are not honoured:\n` +
      failing.map((g) => `  ${g.repository}.${g.id} — ${g.nextAction}`).join("\n")
  );
  process.exit(1);
}
