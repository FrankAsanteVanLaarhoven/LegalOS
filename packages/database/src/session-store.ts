import type { Session } from "@legalos/auth";

import type { SqlExecutor } from "./client.ts";

/**
 * Session storage, backed by the `sessions` table.
 *
 * Replaces an in-memory map that lost every session on restart and could not be
 * shared between instances — behind more than one process a person was signed
 * out at random, which for someone working to a tribunal deadline is not a
 * minor annoyance.
 *
 * Two properties the table gives that the map could not: a revocation is
 * visible to every instance immediately, and a session survives a deployment.
 */

interface SessionRow {
  id: string;
  account_id: string;
  token_hash: string;
  previous_hash: string | null;
  device_label: string | null;
  created_at: Date | string;
  last_seen_at: Date | string;
  expires_at: Date | string;
  revoked_at: Date | string | null;
  revoked_reason: string | null;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    accountId: row.account_id,
    tokenHash: row.token_hash,
    previousHash: row.previous_hash,
    deviceLabel: row.device_label,
    createdAt: iso(row.created_at),
    lastSeenAt: iso(row.last_seen_at),
    expiresAt: iso(row.expires_at),
    revokedAt: row.revoked_at === null ? null : iso(row.revoked_at),
    revokedReason: row.revoked_reason,
  };
}

export class PostgresSessionStore {
  readonly #sql: SqlExecutor;

  constructor(sql: SqlExecutor) {
    this.#sql = sql;
  }

  async put(session: Session): Promise<void> {
    await this.#sql.query(
      `INSERT INTO sessions
         (id, account_id, token_hash, previous_hash, device_label,
          created_at, last_seen_at, expires_at, revoked_at, revoked_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO UPDATE SET
         token_hash = EXCLUDED.token_hash,
         previous_hash = EXCLUDED.previous_hash,
         last_seen_at = EXCLUDED.last_seen_at,
         expires_at = EXCLUDED.expires_at,
         revoked_at = EXCLUDED.revoked_at,
         revoked_reason = EXCLUDED.revoked_reason`,
      [
        session.id,
        session.accountId,
        session.tokenHash,
        session.previousHash,
        session.deviceLabel,
        session.createdAt,
        session.lastSeenAt,
        session.expiresAt,
        session.revokedAt,
        session.revokedReason,
      ]
    );
  }

  /**
   * Finds a session by a presented token hash, matching the rotated-out hash
   * too so replay is detectable rather than reading as an unknown token.
   */
  async findByTokenHash(tokenHash: string): Promise<Session | null> {
    const result = await this.#sql.query<SessionRow>(
      "SELECT * FROM sessions WHERE token_hash = $1 OR previous_hash = $1 LIMIT 1",
      [tokenHash]
    );
    const row = result.rows[0];
    return row ? toSession(row) : null;
  }

  /**
   * Revokes a session.
   *
   * Written to the table rather than removed, so a person can see that a device
   * was signed out and when — which matters for someone who may have been
   * coerced into handing over a phone. Every instance sees it on the next read.
   */
  async revoke(sessionId: string, at: string, reason: string): Promise<void> {
    await this.#sql.query(
      "UPDATE sessions SET revoked_at = $2, revoked_reason = $3 WHERE id = $1 AND revoked_at IS NULL",
      [sessionId, at, reason]
    );
  }

  /** Active sessions for an account, for a device-management view. */
  async listActive(accountId: string, now: string): Promise<Session[]> {
    const result = await this.#sql.query<SessionRow>(
      `SELECT * FROM sessions
        WHERE account_id = $1 AND revoked_at IS NULL AND expires_at > $2
        ORDER BY last_seen_at DESC`,
      [accountId, now]
    );
    return result.rows.map(toSession);
  }

  /** Signs out every other device, returning how many were ended. */
  async revokeAllExcept(
    accountId: string,
    keepSessionId: string,
    at: string,
    reason: string
  ): Promise<number> {
    const result = await this.#sql.query(
      `UPDATE sessions SET revoked_at = $3, revoked_reason = $4
        WHERE account_id = $1 AND id <> $2 AND revoked_at IS NULL`,
      [accountId, keepSessionId, at, reason]
    );
    return result.rowCount;
  }
}
