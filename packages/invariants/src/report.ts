import type { InvariantResult, InvariantStatus } from "./evaluate.ts";
import type { RegistryDefect } from "./validate.ts";

/**
 * Reporting.
 *
 * Ordered worst-first and grouped by status rather than by category, because
 * the question a reader has is "what is broken" and not "how many privacy
 * invariants are there". Counts are printed for every status including the
 * uncomfortable ones; a report that only showed satisfied would be the same
 * class of mistake as a green badge on an unmeasured capability.
 */

const ORDER: readonly InvariantStatus[] = [
  "failed",
  "unfalsified",
  "unmeasured",
  "no_observer",
  "blocked",
  "satisfied",
];

const MARK: Readonly<Record<InvariantStatus, string>> = {
  failed: "FAIL",
  unfalsified: "UNFAL",
  unmeasured: "UNMES",
  no_observer: "NOOBS",
  blocked: "BLOCK",
  satisfied: "OK",
};

export interface Summary {
  readonly counts: Readonly<Record<InvariantStatus, number>>;
  readonly total: number;
  /** Critical invariants not satisfied — the number that matters most. */
  readonly criticalUnsatisfied: number;
}

export function summarise(results: readonly InvariantResult[]): Summary {
  const counts = Object.fromEntries(ORDER.map((s) => [s, 0])) as Record<InvariantStatus, number>;
  for (const r of results) counts[r.status] += 1;
  return {
    counts,
    total: results.length,
    criticalUnsatisfied: results.filter(
      (r) => r.severity === "critical" && r.status !== "satisfied"
    ).length,
  };
}

export function formatReport(
  results: readonly InvariantResult[],
  defects: readonly RegistryDefect[]
): string {
  const lines: string[] = ["System Invariants", ""];

  if (defects.length > 0) {
    lines.push("Registry defects (these fail the build):");
    for (const d of defects) lines.push(`  ${d.invariantId}  ${d.problem}`);
    lines.push("");
  }

  const summary = summarise(results);
  lines.push(`  ${summary.total} invariants`);
  for (const status of ORDER) {
    lines.push(`    ${status.padEnd(12)} ${summary.counts[status]}`);
  }
  lines.push(`  critical not satisfied  ${summary.criticalUnsatisfied}`);
  lines.push("");

  for (const status of ORDER) {
    const group = results.filter((r) => r.status === status);
    if (group.length === 0) continue;
    lines.push(`${status}:`);
    for (const r of group) {
      lines.push(`  [${MARK[status].padEnd(5)}] ${r.id.padEnd(8)} ${r.title}`);
      if (status !== "satisfied") lines.push(`            ${r.nextAction}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
