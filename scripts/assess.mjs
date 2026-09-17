/**
 * Research-engineering assessment.
 *
 *   pnpm assess              this repository
 *   pnpm assess <path>       any other repository
 *
 * Prints a scorecard and no overall score. A weighted total would invite a
 * platform to raise one dimension to compensate for another, and the dimensions
 * are not commensurable — provenance and documentation do not trade off.
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assess } from "../packages/assessment/src/index.ts";

const here = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = process.argv[2] ? resolve(process.argv[2]) : here;

const results = await assess(target);
const mark = { met: "✓", not_met: "✗", no_evidence: "—" };

console.log(`\nResearch-engineering assessment\n  ${target}\n`);

for (const dimension of results) {
  const label = dimension.dimension.replace(/_/g, " ");
  console.log(
    `  ${label.padEnd(22)} ${dimension.met} met · ${dimension.notMet} not met · ${dimension.noEvidence} no evidence`
  );
  for (const result of dimension.criteria) {
    console.log(`    ${mark[result.state]} ${result.criterion.id}  ${result.evidence}`);
  }
  console.log("");
}

const all = results.flatMap((d) => d.criteria);
console.log(
  `  ${all.filter((c) => c.state === "met").length} met, ` +
    `${all.filter((c) => c.state === "not_met").length} not met, ` +
    `${all.filter((c) => c.state === "no_evidence").length} no evidence, of ${all.length} criteria`
);
console.log("\n  No overall score, by design. See docs/RESEARCH_ENGINEERING_ASSESSMENT.md\n");
