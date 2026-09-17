import type { EvidenceLevel, ImplementationLevel } from "@legalos/capabilities";

/**
 * Pure display helpers, safe in client components.
 *
 * Kept apart from `lib/capabilities.ts`, which measures the running system at
 * module load and is therefore server-only.
 */

/** The subset an agent badge needs, in a shape safe to send to the client. */
export interface AgentBadge {
  readonly implementation: ImplementationLevel;
  readonly detail: string | null;
}

/**
 * Colour by implementation level. Only `verified` and above earn green — an
 * "operational" capability is running but unproven and must not read as
 * assurance.
 */
export function maturityTone(
  level: ImplementationLevel | undefined
): "success" | "accent" | "warning" | "neutral" {
  switch (level) {
    case "certified":
    case "verified":
      return "success";
    case "operational":
      return "accent";
    case "implemented":
      return "warning";
    default:
      return "neutral";
  }
}

/**
 * Evidence never earns green on its own. Believing something works because its
 * own unit tests pass is near the bottom of the ladder, and colouring it like
 * assurance is how the two axes collapse back into one.
 */
export function evidenceTone(level: EvidenceLevel | undefined): "accent" | "warning" | "neutral" {
  switch (level) {
    case "independent_replication":
    case "production_telemetry":
    case "external_audit":
      return "accent";
    case "benchmark_validated":
    case "integration_tests":
    case "unit_tests":
      return "warning";
    default:
      return "neutral";
  }
}
