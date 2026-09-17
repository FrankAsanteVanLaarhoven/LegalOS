import type { InvariantResult } from "./evaluate.ts";

/**
 * Coverage and verification debt, per capability.
 *
 * One deliberate departure from the metric as proposed. A gap expressed as
 * "implementation 92%, verification 68%, gap 24%" needs an implementation
 * percentage, and there is no honest denominator for one: it would be a rank on
 * a five-point scale rendered as a percentage, or a count of files, or somebody's
 * estimate. This project removed a hardcoded confidence percentage from the
 * workspace for exactly that reason, and reintroducing one in the governance
 * layer would be worse, because that layer is what everything else is measured
 * against.
 *
 * What is reported instead has a real denominator and cannot be inflated:
 *
 *   stated       properties declared for this capability
 *   observable   how many can be measured at all today
 *   satisfied    how many are demonstrated, falsification included
 *   debt         stated − satisfied, as a count of properties
 *
 * `debt` is an integer, not a ratio, so it cannot be improved by declaring more
 * invariants. It goes down one way: by satisfying a property that was stated.
 * Set beside the capability's implementation level — reported separately by the
 * capability layer — a high level with a high debt is the signal being asked
 * for: functionality has outrun what anyone can show about it.
 */

export interface CapabilityCoverage {
  readonly capability: string;
  readonly stated: number;
  /** Invariants whose observations all exist, whatever they currently say. */
  readonly observable: number;
  readonly satisfied: number;
  /** Properties stated and not demonstrated. Lower is better; zero is the goal. */
  readonly debt: number;
  /** Of the stated properties, how many can be measured at all. */
  readonly observableFraction: number;
  readonly criticalUnsatisfied: number;
}

export function coverageByCapability(
  results: readonly InvariantResult[]
): readonly CapabilityCoverage[] {
  const capabilities = [...new Set(results.map((r) => r.capability))].sort();

  return capabilities.map((capability) => {
    const mine = results.filter((r) => r.capability === capability);
    const observable = mine.filter((r) => r.status !== "no_observer").length;
    const satisfied = mine.filter((r) => r.status === "satisfied").length;
    return {
      capability,
      stated: mine.length,
      observable,
      satisfied,
      debt: mine.length - satisfied,
      observableFraction: mine.length === 0 ? 0 : observable / mine.length,
      criticalUnsatisfied: mine.filter((r) => r.severity === "critical" && r.status !== "satisfied")
        .length,
    };
  });
}

/** Total properties stated and not demonstrated, across the platform. */
export function totalVerificationDebt(results: readonly InvariantResult[]): number {
  return results.filter((r) => r.status !== "satisfied").length;
}

export function formatCoverage(rows: readonly CapabilityCoverage[]): string {
  const lines = [
    "Verification debt by capability",
    "",
    `  ${"capability".padEnd(22)} ${"stated".padStart(6)} ${"observable".padStart(10)} ${"satisfied".padStart(9)} ${"debt".padStart(5)}`,
  ];
  // Worst debt first: the point of the table is where verification has fallen
  // furthest behind, not an alphabetical inventory.
  for (const row of [...rows].sort((a, b) => b.debt - a.debt)) {
    lines.push(
      `  ${row.capability.padEnd(22)} ${String(row.stated).padStart(6)} ${String(row.observable).padStart(10)} ${String(row.satisfied).padStart(9)} ${String(row.debt).padStart(5)}`
    );
  }
  return lines.join("\n");
}
