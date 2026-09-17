import { createHash } from "node:crypto";

import { canonicalise, GENESIS_HASH, type AuditEntry, type AuditInput } from "@legalos/governance";

import type { SqlExecutor } from "./client.ts";

/**
 * Durable audit chain.
 *
 * The in-process chain in @legalos/governance is correct but does not survive a
 * restart, so a platform relying on it cannot honestly claim an audit trail.
 * This is the same construction persisted to an append-only table: each row
 * commits to its predecessor, and UPDATE/DELETE are blocked by a trigger, so
 * tampering is detectable by recomputation and prevented at the source.
 */

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function entryHash(input: {
  seq: number;
  at: string;
  actor: string;
  action: string;
  subject: string;
  payloadHash: string;
  prevHash: string;
}): string {
  return sha256(canonicalise(input));
}

interface AuditRow {
  seq: string | number;
  at: Date | string;
  actor: string;
  action: string;
  subject: string;
  payload: Record<string, unknown>;
  payload_hash: string;
  prev_hash: string;
  hash: string;
  tombstoned_at?: Date | string | null;
}

function toEntry(row: AuditRow): AuditEntry {
  return {
    seq: Number(row.seq),
    at: row.at instanceof Date ? row.at.toISOString() : row.at,
    actor: row.actor,
    action: row.action,
    subject: row.subject,
    payload: row.payload,
    payloadHash: row.payload_hash,
    prevHash: row.prev_hash,
    hash: row.hash,
  };
}

export class PostgresAuditStore {
  readonly #sql: SqlExecutor;

  constructor(sql: SqlExecutor) {
    this.#sql = sql;
  }

  /**
   * Appends an entry.
   *
   * The tail is read with FOR UPDATE so two concurrent appends cannot both link
   * to the same predecessor and fork the chain; the caller must therefore run
   * this inside a transaction. The UNIQUE constraint on `hash` is the backstop
   * if it is ever called outside one.
   */
  async append(input: AuditInput): Promise<AuditEntry> {
    const tail = await this.#sql.query<{ seq: string; hash: string }>(
      "SELECT seq, hash FROM audit_log ORDER BY seq DESC LIMIT 1 FOR UPDATE"
    );

    const previous = tail.rows[0];
    const seq = previous ? Number(previous.seq) + 1 : 0;
    const prevHash = previous?.hash ?? GENESIS_HASH;
    const payloadHash = sha256(canonicalise(input.payload));
    const hash = entryHash({
      seq,
      at: input.at,
      actor: input.actor,
      action: input.action,
      subject: input.subject,
      payloadHash,
      prevHash,
    });

    await this.#sql.query(
      `INSERT INTO audit_log (seq, at, actor, action, subject, payload, payload_hash, prev_hash, hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        seq,
        input.at,
        input.actor,
        input.action,
        input.subject,
        JSON.stringify(input.payload),
        payloadHash,
        prevHash,
        hash,
      ]
    );

    return { ...input, seq, payloadHash, prevHash, hash };
  }

  async entries(limit = 1000): Promise<AuditEntry[]> {
    const result = await this.#sql.query<AuditRow>(
      "SELECT * FROM audit_log ORDER BY seq ASC LIMIT $1",
      [limit]
    );
    return result.rows.map(toEntry);
  }

  /** Recomputes every hash and confirms the chain links, in sequence order. */
  async verify(): Promise<{ valid: boolean; brokenAt: number | null; reason: string | null }> {
    const result = await this.#sql.query<AuditRow>("SELECT * FROM audit_log ORDER BY seq ASC");
    let prevHash = GENESIS_HASH;

    for (const [index, row] of result.rows.entries()) {
      const entry = toEntry(row);
      if (entry.seq !== index) {
        return { valid: false, brokenAt: index, reason: "sequence number out of order" };
      }
      if (entry.prevHash !== prevHash) {
        return { valid: false, brokenAt: index, reason: "previous hash does not link" };
      }
      // A tombstoned entry has had its payload erased on request. The chain is
      // computed from `payload_hash`, never the payload, so the link is intact
      // and there is nothing left to recompute. Skipping the comparison here is
      // what lets erasure and an append-only chain coexist; the row is still
      // hashed and linked below exactly like any other.
      const tombstoned = row.tombstoned_at !== null && row.tombstoned_at !== undefined;
      const payloadHash = tombstoned ? entry.payloadHash : sha256(canonicalise(entry.payload));
      if (!tombstoned && payloadHash !== entry.payloadHash) {
        return { valid: false, brokenAt: index, reason: "payload has been altered" };
      }
      const expected = entryHash({
        seq: entry.seq,
        at: entry.at,
        actor: entry.actor,
        action: entry.action,
        subject: entry.subject,
        payloadHash,
        prevHash,
      });
      if (expected !== entry.hash) {
        return { valid: false, brokenAt: index, reason: "entry hash does not match content" };
      }
      prevHash = entry.hash;
    }

    return { valid: true, brokenAt: null, reason: null };
  }

  /**
   * Erases an entry's payload, keeping everything the chain depends on.
   *
   * The database enforces the same rule independently: the trigger permits this
   * transition and no other. Two guards rather than one, because an erasure
   * path that only application code polices is one bug away from being a way to
   * rewrite history.
   */
  async tombstone(seq: number, at: string): Promise<void> {
    const result = await this.#sql.query(
      "UPDATE audit_log SET payload = '{}'::jsonb, tombstoned_at = $2 WHERE seq = $1 AND tombstoned_at IS NULL",
      [seq, at]
    );
    if (result.rowCount === 0) {
      throw new Error(`audit entry ${seq} does not exist or is already tombstoned`);
    }
  }

  /** Newline-delimited JSON export, suitable for handing to a regulator. */
  async export(): Promise<string> {
    const entries = await this.entries(Number.MAX_SAFE_INTEGER);
    return entries.map((entry) => JSON.stringify(entry)).join("\n");
  }
}
