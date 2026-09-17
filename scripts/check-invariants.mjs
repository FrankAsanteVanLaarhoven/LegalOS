/**
 * System invariant check.
 *
 * Evaluates every declared invariant against observations taken now, and fails
 * on structural defects in the registry itself.
 *
 * What it does NOT fail on: an invariant with no observer, or one that is
 * unmeasured. Those are counted and printed. Failing the build for them would
 * put pressure on the wrong thing — the cheapest way to a green build would be
 * deleting the invariant, and a registry that only contains solved problems is
 * worth nothing.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createPlatformRegistry, observeSystem } from "../packages/capabilities/src/index.ts";
import {
  INVARIANTS,
  coverageByCapability,
  evaluateAll,
  formatCoverage,
  formatReport,
  readFalsifications,
  selfObservations,
  summarise,
  validateProtectedPaths,
  validateRegistry,
  withSelfObservations,
} from "../packages/invariants/src/index.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const defects = [...validateRegistry(), ...(await validateProtectedPaths(repoRoot))];

const base = await observeSystem({ repoRoot });
const capabilities = createPlatformRegistry().all(base);
const falsifications = await readFalsifications(repoRoot);

const derived = selfObservations({ observations: base, falsifications, capabilities });
const observations = withSelfObservations(base, derived);

const results = evaluateAll({ observations, falsifications });
console.log(formatReport(results, defects));

console.log(formatCoverage(coverageByCapability(results)));
console.log("");

const summary = summarise(results);
console.log(
  `  registry: ${INVARIANTS.length} declared, ${defects.length} structural defect(s), ` +
    `${summary.counts.no_observer} awaiting an observer`
);

// Only structural defects fail the build. Everything else is the honest state
// of the system, and the report is where it belongs.
if (defects.length > 0) {
  console.error(`\n${defects.length} registry defect(s). This is a defect in the declarations.`);
  process.exit(1);
}
