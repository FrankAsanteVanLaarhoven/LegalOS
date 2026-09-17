/**
 * Documentation drift.
 *
 * The README states figures about this repository. Every one of them is
 * recomputed here and compared, so a number cannot survive the thing it
 * describes changing.
 *
 * This exists because of a specific mistake rather than as a general principle:
 * the falsification-record count was overstated by three across several
 * messages, having been counted by memory rather than measured. A README is the
 * document most likely to be believed and least likely to be re-checked, and it
 * would otherwise have been the one artefact in this project exempt from its
 * own rule.
 *
 * Deliberately cheap: no database, no test run. It measures what can be counted
 * from the filesystem and the observation layer, so it can run on every push.
 */
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createPlatformRegistry, observeSystem } from "../packages/capabilities/src/index.ts";
import {
  INVARIANTS,
  evaluateAll,
  readFalsifications,
  selfObservations,
  withSelfObservations,
} from "../packages/invariants/src/index.ts";
import { CHECKS, REQUIRED_CHECKS } from "../packages/readiness/src/index.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const count = async (dir, filter = () => true) => {
  try {
    return (await readdir(join(repoRoot, dir))).filter(filter).length;
  } catch {
    return 0;
  }
};

const observations = await observeSystem({ repoRoot });
const falsifications = await readFalsifications(repoRoot);
const derived = selfObservations({
  observations,
  falsifications,
  capabilities: createPlatformRegistry().all(observations),
});
const results = evaluateAll({
  observations: withSelfObservations(observations, derived),
  falsifications,
});

const measured = {
  packages: await count("packages"),
  migrations: await count("packages/database/migrations", (f) => f.endsWith(".sql")),
  invariants: INVARIANTS.length,
  "invariants satisfied": results.filter((r) => r.status === "satisfied").length,
  "invariants awaiting an observer": results.filter((r) => r.status === "no_observer").length,
  "falsification records": falsifications.size,
  "readiness checks": CHECKS.length,
  "readiness checks required": REQUIRED_CHECKS.length,
  "architecture decision records": await count("docs/adr", (f) => f.endsWith(".md") && f !== "README.md"),
};

/**
 * Figures are read from a table in the README, one metric per row.
 *
 * Parsing the rendered document rather than injecting into it, so what a reader
 * sees is what was checked. A generated block a reader cannot see would be
 * checking something other than the claim.
 */
const readme = await readFile(join(repoRoot, "README.md"), "utf8");
const stated = new Map();
for (const line of readme.split("\n")) {
  const match = line.match(/^\|\s*([A-Za-z][A-Za-z \-]+?)\s*\|\s*([0-9]+)\s*\|/);
  if (match) stated.set(match[1].trim().toLowerCase(), Number(match[2]));
}

const problems = [];
for (const [metric, value] of Object.entries(measured)) {
  const claimed = stated.get(metric.toLowerCase());
  if (claimed === undefined) {
    problems.push(`${metric}: measured ${value}, not stated in the README`);
  } else if (claimed !== value) {
    problems.push(`${metric}: README says ${claimed}, measured ${value}`);
  }
}

console.log("\nDocumentation figures\n");
for (const [metric, value] of Object.entries(measured)) {
  const claimed = stated.get(metric.toLowerCase());
  const mark = claimed === value ? "✓" : "✗";
  console.log(`  ${mark} ${metric.padEnd(34)} ${value}${claimed === value ? "" : ` (README: ${claimed ?? "absent"})`}`);
}

if (problems.length > 0) {
  console.error(`\n  ${problems.length} figure(s) drifted:`);
  for (const problem of problems) console.error(`    ${problem}`);
  console.error("");
  process.exit(1);
}

console.log("\n  Every stated figure matches what was measured.\n");
