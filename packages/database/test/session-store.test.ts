import { test } from "node:test";
import assert from "node:assert/strict";

import type { Session } from "@legalos/auth";

import { PostgresSessionStore } from "../src/session-store.ts";
import type { QueryResult, SqlExecutor } from "../src/client.ts";

/** Records statements and returns scripted rows. */
class RecordingSql implements SqlExecutor {
  readonly statements: { sql: string; values: readonly unknown[] }[] = [];
  rows: Record<string, unknown>[] = [];
  rowCount = 0;

  async query<Row = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = []
  ): Promise<QueryResult<Row>> {
    this.statements.push({ sql: text.replace(/\s+/g, " ").trim(), values });
    return { rows: this.rows as Row[], rowCount: this.rowCount };
  }
}

const SESSION: Session = {
  id: "s1",
  accountId: "a1",
  tokenHash: "a".repeat(64),
  previousHash: null,
  deviceLabel: "iPhone",
  createdAt: "2026-07-26T10:00:00.000Z",
  lastSeenAt: "2026-07-26T10:00:00.000Z",
  expiresAt: "2026-07-26T22:00:00.000Z",
  revokedAt: null,
  revokedReason: null,
};

const ROW = {
  id: "s1",
  account_id: "a1",
  token_hash: "a".repeat(64),
  previous_hash: null,
  device_label: "iPhone",
  created_at: new Date("2026-07-26T10:00:00.000Z"),
  last_seen_at: new Date("2026-07-26T10:00:00.000Z"),
  expires_at: new Date("2026-07-26T22:00:00.000Z"),
  revoked_at: null,
  revoked_reason: null,
};

test("only the token hash is written, never a token", async () => {
  const sql = new RecordingSql();
  await new PostgresSessionStore(sql).put(SESSION);
  const serialised = JSON.stringify(sql.statements);
  assert.match(serialised, /token_hash/);
  assert.equal(/[^_]token[^_]/.test(serialised.replace(/token_hash|previous_hash/g, "")), false);
});

test("a lookup matches the rotated-out hash too, so replay stays detectable", async () => {
  const sql = new RecordingSql();
  await new PostgresSessionStore(sql).findByTokenHash("b".repeat(64));
  assert.match(sql.statements[0]!.sql, /token_hash = \$1 OR previous_hash = \$1/);
});

test("rows are mapped back with timestamps normalised", async () => {
  const sql = new RecordingSql();
  sql.rows = [ROW];
  const session = await new PostgresSessionStore(sql).findByTokenHash("a".repeat(64));
  assert.equal(session?.id, "s1");
  assert.equal(session?.createdAt, "2026-07-26T10:00:00.000Z");
  assert.equal(session?.revokedAt, null);
});

test("an unknown token returns null rather than an empty session", async () => {
  const sql = new RecordingSql();
  assert.equal(await new PostgresSessionStore(sql).findByTokenHash("c".repeat(64)), null);
});

test("revocation updates rather than deletes, so the record survives", async () => {
  const sql = new RecordingSql();
  await new PostgresSessionStore(sql).revoke("s1", "2026-07-26T11:00:00.000Z", "signed out");
  assert.match(sql.statements[0]!.sql, /^UPDATE sessions SET revoked_at/);
  assert.equal(/DELETE/.test(sql.statements[0]!.sql), false);
});

test("revoking an already-revoked session is a no-op", async () => {
  const sql = new RecordingSql();
  await new PostgresSessionStore(sql).revoke("s1", "2026-07-26T11:00:00.000Z", "x");
  assert.match(sql.statements[0]!.sql, /revoked_at IS NULL/);
});

test("listing active sessions excludes revoked and expired ones", async () => {
  const sql = new RecordingSql();
  await new PostgresSessionStore(sql).listActive("a1", "2026-07-26T12:00:00.000Z");
  assert.match(sql.statements[0]!.sql, /revoked_at IS NULL AND expires_at > \$2/);
});

test("signing out other devices keeps the current one and reports the count", async () => {
  const sql = new RecordingSql();
  sql.rowCount = 3;
  const ended = await new PostgresSessionStore(sql).revokeAllExcept(
    "a1",
    "s1",
    "2026-07-26T11:00:00.000Z",
    "signed out everywhere"
  );
  assert.equal(ended, 3);
  assert.match(sql.statements[0]!.sql, /id <> \$2/);
});
