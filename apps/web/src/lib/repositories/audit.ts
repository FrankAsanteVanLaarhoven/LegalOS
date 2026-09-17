import "server-only";

import { membershipFor, type Membership, type Role } from "@legalos/auth";

/**
 * The audit repository.
 *
 * The first repository in this workspace, and the reason none of the sixteen
 * pages could pass the completeness rule: every panel read a fixture, so "real
 * data" had nowhere to come from. A page reading a literal looks identical to
 * one reading a database, which is what let a workspace render hand-typed
 * percentages as tribunal readiness.
 *
 * Everything here is read-only. The audit log is append-only at the storage
 * layer and there is deliberately no write path from the interface: an entry is
 * written by the action it records, never by a page about it.
 */

export interface AuditEntryView {
  readonly seq: number;
  readonly at: string;
  readonly actor: string;
  readonly action: string;
  readonly subject: string;
  /** Null when the payload was erased on request. The hash survives. */
  readonly payload: unknown | null;
  readonly payloadHash: string;
  readonly hash: string;
  readonly tombstonedAt: string | null;
}

export interface ChainVerification {
  readonly valid: boolean;
  readonly brokenAt: number | null;
  readonly reason: string | null;
  readonly checkedAt: string;
}

export type AuditUnavailable =
  | { readonly reason: "NO_DATABASE"; readonly detail: string }
  | { readonly reason: "UNREACHABLE"; readonly detail: string }
  | { readonly reason: "FORBIDDEN"; readonly detail: string };

export type AuditView =
  | {
      readonly ok: true;
      readonly entries: readonly AuditEntryView[];
      readonly verification: ChainVerification;
      readonly total: number;
    }
  | { readonly ok: false; readonly unavailable: AuditUnavailable };

/** Roles permitted to read an audit trail. Absence of a membership is refusal. */
const MAY_READ_AUDIT: readonly Role[] = ["caseworker", "adviser", "solicitor", "reviewer", "admin"];

export interface AuditQuery {
  readonly accountId: string;
  readonly workspaceId: string | null;
  readonly memberships: readonly Membership[];
  readonly limit?: number;
}

/**
 * Reads the audit trail, verifying the chain on every read.
 *
 * Verification runs here rather than on a schedule because a page showing an
 * audit trail without saying whether it still verifies is showing a list, and a
 * list is what an audit log is not. If the chain is broken the page must say so
 * at the moment somebody looks.
 */
export async function readAuditTrail(query: AuditQuery): Promise<AuditView> {
  // Permission first, and by membership rather than by role name passed in.
  // A caller supplying its own role would be asserting the thing being checked.
  const membership = query.workspaceId
    ? membershipFor(query.memberships, query.accountId, query.workspaceId)
    : null;

  if (!membership || !MAY_READ_AUDIT.includes(membership.role)) {
    return {
      ok: false,
      unavailable: {
        reason: "FORBIDDEN",
        detail: membership
          ? `the ${membership.role} role may not read an audit trail`
          : "no membership of this workspace",
      },
    };
  }

  if (!process.env.DATABASE_URL) {
    return {
      ok: false,
      unavailable: {
        reason: "NO_DATABASE",
        detail:
          "No database is configured, so there is no audit trail to read. This is the state of this instance, not a failure to load.",
      },
    };
  }

  const { createPool, PostgresAuditStore } = await import("@legalos/database");
  const pool = await createPool();
  try {
    const store = new PostgresAuditStore(pool);
    const [entries, verification, count] = await Promise.all([
      store.entries(query.limit ?? 200),
      store.verify(),
      pool.query<{ n: string }>("SELECT count(*)::int AS n FROM audit_log"),
    ]);

    const tombstones = await pool.query<{ seq: string; tombstoned_at: Date | string | null }>(
      "SELECT seq, tombstoned_at FROM audit_log WHERE tombstoned_at IS NOT NULL"
    );
    const tombstonedBySeq = new Map(
      tombstones.rows.map((row) => [
        Number(row.seq),
        row.tombstoned_at instanceof Date
          ? row.tombstoned_at.toISOString()
          : (row.tombstoned_at as string),
      ])
    );

    return {
      ok: true,
      total: Number(count.rows[0]?.n ?? 0),
      verification: { ...verification, checkedAt: new Date().toISOString() },
      entries: entries.map((entry) => {
        const tombstonedAt = tombstonedBySeq.get(entry.seq) ?? null;
        return {
          seq: entry.seq,
          at: entry.at,
          actor: entry.actor,
          action: entry.action,
          subject: entry.subject,
          // An erased payload is shown as erased rather than as empty, so the
          // difference between "nothing was recorded" and "this was removed on
          // request" survives into the interface.
          payload: tombstonedAt ? null : entry.payload,
          payloadHash: entry.payloadHash,
          hash: entry.hash,
          tombstonedAt,
        };
      }),
    };
  } catch (error) {
    return {
      ok: false,
      unavailable: {
        reason: "UNREACHABLE",
        detail: error instanceof Error ? error.message : "the audit store could not be read",
      },
    };
  } finally {
    await pool.end();
  }
}
