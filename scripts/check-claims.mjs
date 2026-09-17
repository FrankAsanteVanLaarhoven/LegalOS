/**
 * Claims register.
 *
 * Engineering, scientific and operational evidence are different kinds, and
 * mixing them is how an architecture gets mistaken for a result. This checks
 * that no claim is typed above what its evidence supports.
 *
 * Two rules, both mechanical:
 *
 *   A claim marked `supported` must cite something that exists. Where it names
 *   a falsification record, that record must be on disk.
 *
 *   A claim typed `operational` may not be `supported` while no execution has
 *   ever been recorded. That is the specific over-claim this project is most
 *   at risk of, having built the machinery for operations it has never run.
 */
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const register = await readFile(join(repoRoot, "docs/CLAIMS.md"), "utf8");
const falsifications = new Set(
  (await readdir(join(repoRoot, "docs/falsification")).catch(() => [])).map((f) =>
    f.replace(/\.json$/, "")
  )
);

const TYPES = new Set(["engineering", "scientific", "operational"]);
const STATUSES = new Set(["supported", "unsupported"]);

const claims = [];
for (const line of register.split("\n")) {
  const cells = line.split("|").map((c) => c.trim());
  // | claim | type | evidence | status |
  if (cells.length < 6) continue;
  const [, claim, type, evidence, status] = cells;
  if (!TYPES.has(type) || !STATUSES.has(status)) continue;
  claims.push({ claim, type, evidence, status });
}

const problems = [];

if (claims.length === 0) {
  problems.push("no claims parsed; the register is empty or its table shape changed");
}

for (const entry of claims) {
  if (entry.status === "supported" && /^none$/i.test(entry.evidence)) {
    problems.push(`"${entry.claim}" is supported by nothing`);
  }

  // Where a claim names a falsification record, it must exist.
  for (const match of entry.evidence.matchAll(/`([a-z_]+)`/g)) {
    const named = match[1];
    if (named.includes("_") && !falsifications.has(named) && entry.status === "supported") {
      const isPackage = named.startsWith("packages");
      if (!isPackage) {
        problems.push(`"${entry.claim}" cites ${named}, which has no falsification record`);
      }
    }
  }

  if (entry.type === "operational" && entry.status === "supported") {
    problems.push(
      `"${entry.claim}" is typed operational and marked supported; no execution has been recorded`
    );
  }
}

const counts = { engineering: 0, scientific: 0, operational: 0 };
const supported = { engineering: 0, scientific: 0, operational: 0 };
for (const entry of claims) {
  counts[entry.type] += 1;
  if (entry.status === "supported") supported[entry.type] += 1;
}

console.log("\nClaims register\n");
for (const type of ["engineering", "scientific", "operational"]) {
  console.log(`  ${type.padEnd(14)} ${supported[type]} supported of ${counts[type]}`);
}

if (problems.length > 0) {
  console.error(`\n  ${problems.length} problem(s):`);
  for (const problem of problems) console.error(`    ${problem}`);
  console.error("");
  process.exit(1);
}

console.log("\n  Every claim is typed at a level its evidence supports.\n");
