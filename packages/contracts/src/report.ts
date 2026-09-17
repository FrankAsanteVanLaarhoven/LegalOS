import type { ContractResult, GuaranteeStatus } from "./evaluate.ts";
import type { ContractDefect } from "./validate.ts";

const MARK: Record<GuaranteeStatus, string> = {
  honoured: "OK  ",
  unimplemented: "----",
  unproven: "??  ",
  no_observer: "NONE",
  failed: "FAIL",
};

/**
 * The report.
 *
 * Ordered by status rather than by repository, so the thing needing attention
 * is at the top and an all-unimplemented registry reads as what it is: a
 * specification, not an achievement.
 */
export function formatContracts(
  results: readonly ContractResult[],
  defects: readonly ContractDefect[]
): string {
  const lines: string[] = ["", "Repository contracts", ""];

  for (const result of results) {
    const shown = result.implemented ? result.module : `${result.module} — not written yet`;
    lines.push(`  ${result.repository}  (${shown})`);
    for (const g of result.guarantees) {
      lines.push(`    [${MARK[g.status]}] ${g.id.padEnd(6)} ${g.statement}`);
      if (g.status !== "honoured" && g.status !== "unimplemented") {
        lines.push(`             ${g.nextAction}`);
      }
    }
    lines.push("");
  }

  const all = results.flatMap((r) => r.guarantees);
  const count = (status: GuaranteeStatus) => all.filter((g) => g.status === status).length;

  lines.push(
    `  ${results.length} contract(s), ${all.length} guarantee(s): ` +
      `${count("honoured")} honoured, ${count("unimplemented")} awaiting the repository, ` +
      `${count("unproven")} unproven, ${count("no_observer")} without a check, ${count("failed")} failed`
  );

  if (defects.length > 0) {
    lines.push("", "  Structural defects in the declarations:");
    for (const defect of defects) lines.push(`    ${defect.subject}: ${defect.problem}`);
  }

  return lines.join("\n");
}
