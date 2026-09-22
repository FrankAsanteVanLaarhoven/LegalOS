import {
  AGENT_CAPABILITY,
  createPlatformRegistry,
  observeSystem,
  type CapabilityStatus,
  type ObservationSet,
} from "@legalos/capabilities";

import type { AgentBadge } from "./capability-display";

export { evidenceTone, maturityTone, type AgentBadge } from "./capability-display";

/**
 * Capability status for the UI.
 *
 * Observations are taken once per server process, at module load, by measuring
 * the running system — not read from configuration. Nothing here accepts a
 * caller-supplied status: the point of the registry is that a component cannot
 * assert a maturity it has not earned.
 *
 * Server-only. The observation layer reads the filesystem and, where a
 * connection is available, the database.
 */
const registry = createPlatformRegistry();

/** Next runs the server from the app directory; the repository root is two up. */
export const repoRoot = process.cwd().endsWith("apps/web")
  ? `${process.cwd()}/../..`
  : process.cwd();

/**
 * Observations, taken when they are asked for.
 *
 * Two defects lived in the line this replaces. It ran once at module load, so a
 * long-running server showed the state of its own startup for the rest of its
 * life. And it passed no `query`, so every database-backed observation reported
 * unavailable no matter what was configured — `session_store_durable` computes
 * `hasDatabasePath && Boolean(query)`, which is why the trust page said sessions
 * were held in memory while they were being written to PostgreSQL.
 *
 * A page that reports a system's state must ask the system, at the moment
 * somebody looks. This opens a connection per request, which is the cost of the
 * page being true.
 */
export async function currentObservations(): Promise<ObservationSet> {
  const benchReportPath = `${repoRoot}/docs/smoke-evidence/benchmark-report.json`;
  const auditArtefactPath = `${repoRoot}/docs/audit/external-audit.json`;
  const telemetryReportPath = `${repoRoot}/docs/smoke-evidence/production-telemetry.json`;

  if (!process.env.DATABASE_URL) {
    try {
      const { sqliteQuery } = await import("@legalos/database");
      return await observeSystem({
        repoRoot,
        benchReportPath,
        auditArtefactPath,
        telemetryReportPath,
        query: (sql: string) => sqliteQuery(sql),
      });
    } catch {
      return observeSystem({
        repoRoot,
        benchReportPath,
        auditArtefactPath,
        telemetryReportPath,
      });
    }
  }

  const { createPool } = await import("@legalos/database");
  const pool = await createPool();
  try {
    return await observeSystem({
      repoRoot,
      benchReportPath,
      auditArtefactPath,
      telemetryReportPath,
      query: (sql: string) => pool.query(sql),
    });
  } catch {
    // Unreachable is not "no database": the observation layer already
    // distinguishes those, and handing it no query would collapse them.
    return observeSystem({
      repoRoot,
      benchReportPath,
      auditArtefactPath,
      telemetryReportPath,
    });
  } finally {
    await pool.end();
  }
}

export async function platformStatus(): Promise<readonly CapabilityStatus[]> {
  return registry.all(await currentObservations());
}

export async function capabilityStatus(id: string): Promise<CapabilityStatus | null> {
  return registry.status(id, await currentObservations());
}

export async function agentStatus(agentId: string): Promise<CapabilityStatus | null> {
  const capability = AGENT_CAPABILITY[agentId];
  return capability ? registry.status(capability, await currentObservations()) : null;
}

export async function belowTargetCapabilities(): Promise<readonly CapabilityStatus[]> {
  return registry.belowTarget(await currentObservations());
}

export async function platformRoadmap(): Promise<
  readonly { capability: string; action: string }[]
> {
  return registry.roadmap(await currentObservations());
}

/** Capability status keyed by capability id, for the navigation menu. */
export async function capabilityBadges(): Promise<Record<string, AgentBadge>> {
  const out: Record<string, AgentBadge> = {};
  for (const status of await platformStatus()) {
    out[status.id] = {
      implementation: status.implementation,
      detail: status.failing[0]?.detail ?? null,
    };
  }
  return out;
}

export async function agentBadges(
  agentIds: readonly string[]
): Promise<Record<string, AgentBadge>> {
  // One observation pass for every agent rather than one per agent: the reads
  // are the expensive part, and asking the same question ten times would make
  // a page slower for no additional truth.
  const observed = await currentObservations();
  const out: Record<string, AgentBadge> = {};
  for (const id of agentIds) {
    const capability = AGENT_CAPABILITY[id];
    const status = capability ? registry.status(capability, observed) : null;
    if (!status) continue;
    out[id] = {
      implementation: status.implementation,
      detail: status.failing[0]?.detail ?? null,
    };
  }
  return out;
}
