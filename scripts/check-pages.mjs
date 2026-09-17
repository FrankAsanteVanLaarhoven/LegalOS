#!/usr/bin/env node
/**
 * Workspace page completeness.
 *
 * Applies the rule in PROGRAMME_PHASES.md: a page is complete only when it has
 * real data, real actions, observable state, audit, permissions and
 * verification. UI completeness is not feature completeness.
 *
 * This inspects each page's source for the integration points. It is a
 * heuristic and says so — a page could satisfy it superficially. What it
 * reliably catches is the opposite case, which is the one that actually
 * occurred here: a workspace that looked finished while rendering hand-typed
 * percentages as tribunal readiness.
 *
 *   node scripts/check-pages.mjs           # report
 *   node scripts/check-pages.mjs --write   # record the baseline
 *   STRICT_PAGES=1 node scripts/check-pages.mjs   # fail on any shortfall
 */
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const panels = join(repoRoot, "apps/web/src/components/workspace");

/** Each layer, and what counts as evidence of it in a page's source. */
/**
 * A panel that exists and is never rendered is not a page.
 *
 * Added after the audit panel was counted as complete while nothing imported
 * it. The checker read its source, found every layer, and said 1 of 16 — of a
 * page no user could reach. That is the same defect this project has removed
 * from five other checks: measuring the artefact rather than the property.
 */
async function isRendered(componentFile, panelSource) {
  const exported = panelSource.match(/export (?:async )?function (\w+)/)?.[1];
  if (!exported) return false;
  const { readdir, readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "apps/web/src");

  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (await walk(path)) return true;
      } else if (/\.(tsx|ts)$/.test(entry.name) && !path.endsWith(componentFile)) {
        const source = await readFile(path, "utf8");
        if (new RegExp(`<${exported}[\\s/>]`).test(source)) return true;
      }
    }
    return false;
  };
  return walk(root);
}

const LAYERS = [
  {
    id: "data",
    label: "Real data",
    // A fixture import is the tell: the page reads a literal, not a store.
    detect: (src) => /from "@\/lib\/(repositories|api)\//.test(src),
    negative: (src) => /from "@\/lib\/data\/sapana-case"/.test(src),
  },
  {
    id: "actions",
    label: "Real actions",
    detect: (src) => /onSubmit=|useTransition|"use server"|fetch\(\s*["'`]\/api\//.test(src),
  },
  {
    id: "observable",
    label: "Observable state",
    detect: (src) => /capability-display|@legalos\/capabilities|agentBadges/.test(src),
  },
  { id: "audit", label: "Audit", detect: (src) => /audit|AuditChain/i.test(src) },
  {
    id: "permissions",
    label: "Permissions",
    detect: (src) => /permission|isPermitted|role/i.test(src),
  },
  {
    id: "verification",
    label: "Verification",
    detect: (src) => /verified|verification|guarded/i.test(src),
  },
];

/**
 * Pages are discovered, never listed.
 *
 * A hardcoded list is a denominator that shrinks to fit the answer: add eight
 * pages, measure seven, and the score improves while the workspace does not.
 * Reading the directory means a new panel lowers the score until it earns its
 * place, which is the only direction that makes the number worth reading.
 *
 * `expected` names panels the roadmap requires but which do not exist yet, so
 * unbuilt pages count against the total rather than being invisible.
 */
const EXPECTED = [
  ["Deadlines", "deadlines-panel.tsx"],
  ["Communications", "communications-panel.tsx"],
  ["Documents", "documents-panel.tsx"],
  ["Bundle builder", "bundle-panel.tsx"],
  ["Lawyer review", "review-panel.tsx"],
  ["Hearing preparation", "hearing-panel.tsx"],
  ["Audit", "audit-panel.tsx"],
  ["Settings", "settings-panel.tsx"],
];

function titleOf(file) {
  return file
    .replace(/\.tsx$/, "")
    .replace(/-panel$/, "")
    .replace(/-/g, " ")
    .replace(/^./, (c) => c.toUpperCase());
}

const discovered = (await readdir(panels))
  .filter((f) => f.endsWith(".tsx") && f !== "case-workspace.tsx" && f !== "case-header.tsx")
  .sort()
  .map((f) => [titleOf(f), f]);

const PAGES = [
  ...discovered,
  ...EXPECTED.filter(([, file]) => !discovered.some(([, existing]) => existing === file)),
];

const report = [];

for (const [name, file] of PAGES) {
  let src;
  try {
    src = await readFile(join(panels, file), "utf8");
  } catch {
    report.push({ page: name, file, missingFile: true, layers: {}, complete: false });
    continue;
  }

  const layers = {};
  for (const layer of LAYERS) {
    const present = layer.detect(src) && !(layer.negative?.(src) ?? false);
    layers[layer.id] = present;
  }

  // Reachability last, and only worth asking when every layer is present.
  const reachable = Object.values(layers).every(Boolean) ? await isRendered(file, src) : false;
  layers.reachable = reachable;

  report.push({
    page: name,
    file,
    missingFile: false,
    layers,
    complete: Object.values(layers).every(Boolean),
  });
}

const width = Math.max(...report.map((r) => r.page.length));
console.log("Workspace page completeness\n");
console.log(
  `${"page".padEnd(width)}  ${LAYERS.map((l) => l.id.slice(0, 6).padEnd(6)).join(" ")}`,
);

for (const row of report) {
  const cells = LAYERS.map((l) => (row.layers[l.id] ? "  yes " : "  --  ")).join(" ");
  console.log(`${row.page.padEnd(width)}  ${cells}  ${row.complete ? "complete" : ""}`);
}

const complete = report.filter((r) => r.complete).length;
const missing = report.filter((r) => r.missingFile).length;
console.log(`\n${complete}/${report.length} pages meet the completeness rule.`);
if (missing > 0) {
  console.log(`${missing} of those do not exist yet and count against the total.`);
}

if (complete < report.length) {
  console.log(
    "\nA page missing any layer is incomplete regardless of how finished it looks.\n" +
      "Most of these depend on authentication and a persisted case model, which do not exist yet.",
  );
}

if (process.argv.includes("--write")) {
  const dir = join(repoRoot, "docs");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "page-completeness.json"),
    `${JSON.stringify({ report, complete, total: report.length }, null, 2)}\n`,
    "utf8",
  );
  console.log("\nwrote docs/page-completeness.json");
}

if (process.env.STRICT_PAGES === "1" && complete < report.length) {
  console.error("\nSTRICT_PAGES=1: failing on incomplete pages.");
  process.exit(1);
}
