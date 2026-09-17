import "server-only";

import { membershipFor, type Membership, type Role } from "@legalos/auth";

/**
 * The case repository.
 *
 * The structural dependency behind most of the workspace. A case is currently a
 * TypeScript literal in `lib/data/`, which is why timeline, evidence, tasks and
 * deadlines cannot become operational: there is nothing persistent underneath
 * them, so every panel about a case is a panel about a constant.
 *
 * The schema has existed since the first migration — `cases`, `timeline_events`,
 * `evidence_items` — and nothing reads it. This is the reader.
 *
 * Two behaviours are deliberate and will look like gaps until the rest catches
 * up. A case with no persisted row returns `NOT_PERSISTED` rather than falling
 * back to the fixture: a page that silently served a literal when the database
 * had nothing would be indistinguishable from one serving real data, which is
 * the confusion this layer exists to end. And `is_demo` rows are marked rather
 * than hidden, because a demonstration case that reads as a real matter is how
 * somebody acts on an invented deadline.
 */

export interface CaseRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly clientId: string;
  readonly reference: string;
  readonly status: string;
  readonly matterTypes: readonly string[];
  readonly riskLevel: "low" | "medium" | "high";
  /** True for fixture data. Surfaced, never filtered out silently. */
  readonly isDemo: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TimelineEventRecord {
  readonly id: string;
  readonly occurredOn: string;
  readonly title: string;
  readonly description: string | null;
  /** Provenance, not a score: how this event came to be known. */
  readonly source: "client_stated" | "document" | "ai_inferred";
}

export interface EvidenceRecord {
  readonly id: string;
  readonly title: string;
  readonly category: string;
  readonly status: "received" | "requested" | "missing" | "expired";
  readonly summary: string | null;
  readonly receivedAt: string | null;
}

export type CaseUnavailable =
  | { readonly reason: "NO_DATABASE"; readonly detail: string }
  | { readonly reason: "NOT_PERSISTED"; readonly detail: string }
  | { readonly reason: "FORBIDDEN"; readonly detail: string }
  | { readonly reason: "UNREACHABLE"; readonly detail: string };

export type CaseView =
  | {
      readonly ok: true;
      readonly record: CaseRecord;
      readonly timeline: readonly TimelineEventRecord[];
      readonly evidence: readonly EvidenceRecord[];
    }
  | { readonly ok: false; readonly unavailable: CaseUnavailable };

/** Roles permitted to read a case. Absence of a membership is refusal. */
const MAY_READ_CASE: readonly Role[] = [
  "client",
  "caseworker",
  "adviser",
  "solicitor",
  "reviewer",
  "admin",
];

const iso = (value: Date | string | null): string | null =>
  value === null ? null : value instanceof Date ? value.toISOString() : value;

export interface CaseQuery {
  readonly caseId: string;
  readonly accountId: string;
  readonly memberships: readonly Membership[];
}

export async function readCase(query: CaseQuery): Promise<CaseView> {
  if (!process.env.DATABASE_URL) {
    return {
      ok: false,
      unavailable: {
        reason: "NO_DATABASE",
        detail:
          "No database is configured, so no case is persisted. This is the state of this instance, not a failure to load.",
      },
    };
  }

  const { createPool } = await import("@legalos/database");
  const pool = await createPool();
  try {
    const found = await pool.query<{
      id: string;
      workspace_id: string;
      client_id: string;
      reference: string;
      status: string;
      matter_types: string[];
      risk_level: "low" | "medium" | "high";
      is_demo: boolean;
      created_at: Date | string;
      updated_at: Date | string;
    }>("SELECT * FROM cases WHERE id = $1 OR reference = $1 LIMIT 1", [query.caseId]);

    const row = found.rows[0];
    if (!row) {
      // Never a fixture fallback. A page serving a literal when the database
      // had nothing would look exactly like one serving real data.
      return {
        ok: false,
        unavailable: {
          reason: "NOT_PERSISTED",
          detail: `No case ${query.caseId} exists in the database. The workspace currently renders a fixture, which this layer will not serve as though it were a record.`,
        },
      };
    }

    // Permission after the case is known, because the membership is resolved
    // against the case's workspace rather than one the caller names.
    const membership = membershipFor(query.memberships, query.accountId, row.workspace_id);
    if (!membership || !MAY_READ_CASE.includes(membership.role)) {
      return {
        ok: false,
        unavailable: {
          reason: "FORBIDDEN",
          detail: membership
            ? `the ${membership.role} role may not read this case`
            : "no membership of the workspace this case belongs to",
        },
      };
    }

    const [timeline, evidence] = await Promise.all([
      pool.query<{
        id: string;
        occurred_on: Date | string;
        title: string;
        description: string | null;
        source: TimelineEventRecord["source"];
      }>(
        "SELECT * FROM timeline_events WHERE case_id = $1 ORDER BY occurred_on ASC, created_at ASC",
        [row.id]
      ),
      pool.query<{
        id: string;
        title: string;
        category: string;
        status: EvidenceRecord["status"];
        summary: string | null;
        received_at: Date | string | null;
      }>("SELECT * FROM evidence_items WHERE case_id = $1 ORDER BY created_at ASC", [row.id]),
    ]);

    return {
      ok: true,
      record: {
        id: row.id,
        workspaceId: row.workspace_id,
        clientId: row.client_id,
        reference: row.reference,
        status: row.status,
        matterTypes: row.matter_types ?? [],
        riskLevel: row.risk_level,
        isDemo: row.is_demo,
        createdAt: iso(row.created_at)!,
        updatedAt: iso(row.updated_at)!,
      },
      timeline: timeline.rows.map((event) => ({
        id: event.id,
        occurredOn: iso(event.occurred_on)!,
        title: event.title,
        description: event.description,
        source: event.source,
      })),
      evidence: evidence.rows.map((item) => ({
        id: item.id,
        title: item.title,
        category: item.category,
        status: item.status,
        summary: item.summary,
        receivedAt: iso(item.received_at),
      })),
    };
  } catch (error) {
    return {
      ok: false,
      unavailable: {
        reason: "UNREACHABLE",
        detail: error instanceof Error ? error.message : "the case store could not be read",
      },
    };
  } finally {
    await pool.end();
  }
}

/**
 * Evidence completeness, derived by counting rows.
 *
 * There is deliberately no stored completeness score, and this is why: a
 * percentage nobody recomputes drifts away from the evidence it summarises, and
 * a stale readiness figure on a tribunal deadline is not a rounding error.
 */
export function completeness(evidence: readonly EvidenceRecord[]): {
  received: number;
  required: number;
  missing: readonly string[];
} {
  const received = evidence.filter((item) => item.status === "received");
  return {
    received: received.length,
    required: evidence.length,
    missing: evidence
      .filter((item) => item.status === "missing" || item.status === "requested")
      .map((item) => item.title),
  };
}
