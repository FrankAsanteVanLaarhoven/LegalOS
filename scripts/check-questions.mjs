/**
 * Research question registry.
 *
 * Every question must cite claims and invariants that exist, and may not report
 * a status above the claims it rests on. That last rule is the point: a
 * question answered by engineering-supported claims is an engineering result,
 * and calling it a scientific one is the over-claim this registry exists to
 * make mechanical rather than editorial.
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { INVARIANTS } from "../packages/invariants/src/index.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const questions = await readFile(join(repoRoot, "docs/RESEARCH_QUESTIONS.md"), "utf8");
const claimsDoc = await readFile(join(repoRoot, "docs/CLAIMS.md"), "utf8");

/** Claims, with the evidence type each is supported at. */
const claims = new Map();
for (const line of claimsDoc.split("\n")) {
  const cells = line.split("|").map((c) => c.trim());
  if (cells.length < 6) continue;
  const [, claim, type, , status] = cells;
  if (!["engineering", "scientific", "operational"].includes(type)) continue;
  claims.set(claim, { type, supported: status === "supported" });
}

const invariantIds = new Set(INVARIANTS.map((i) => i.id));

// Split on the question headings.
const sections = questions.split(/^## (RQ-\d+)/m).slice(1);
const parsed = [];
for (let i = 0; i < sections.length; i += 2) {
  const id = sections[i];
  const body = sections[i + 1] ?? "";
  const claimBlock = body.match(/\*\*Claims\*\*\n\n([\s\S]*?)\n\n/)?.[1] ?? "";
  const cited = claimBlock
    .split("\n")
    .map((l) => l.replace(/^-\s*/, "").trim())
    .filter(Boolean);
  const invariants = [...body.matchAll(/`([A-Z]{2,3}-\d{3})`/g)].map((m) => m[1]);
  const status = body.match(/\*\*Status\.\*\*([\s\S]*?)(?:\n\n|---)/)?.[1] ?? "";
  parsed.push({ id, cited, invariants, status });
}

const problems = [];
if (parsed.length === 0) problems.push("no research questions parsed");

for (const question of parsed) {
  if (question.cited.length === 0) {
    problems.push(`${question.id} cites no claims`);
  }
  for (const claim of question.cited) {
    if (!claims.has(claim)) {
      problems.push(`${question.id} cites a claim not in the register: "${claim}"`);
    }
  }
  for (const invariant of question.invariants) {
    if (!invariantIds.has(invariant)) {
      problems.push(`${question.id} cites ${invariant}, which is not in the invariant registry`);
    }
  }

  // A question may not claim a status its claims do not carry.
  for (const type of ["scientific", "operational"]) {
    const claimsSupport = question.cited.some((c) => {
      const entry = claims.get(c);
      return entry?.type === type && entry.supported;
    });
    const asserts = new RegExp(`${type}:\\s*supported`, "i").test(question.status);
    if (asserts && !claimsSupport) {
      problems.push(
        `${question.id} reports ${type}: supported, but no claim it cites is ${type}-supported`
      );
    }
  }
}

console.log("\nResearch questions\n");
for (const question of parsed) {
  const engineering = question.cited.filter((c) => claims.get(c)?.supported).length;
  console.log(
    `  ${question.id}  ${question.cited.length} claim(s), ${question.invariants.length} invariant(s), ${engineering} supported`
  );
}

if (problems.length > 0) {
  console.error(`\n  ${problems.length} problem(s):`);
  for (const problem of problems) console.error(`    ${problem}`);
  console.error("");
  process.exit(1);
}

console.log("\n  Every question cites artefacts that exist, at a status its claims carry.\n");
