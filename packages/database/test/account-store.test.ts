import { test } from "node:test";
import assert from "node:assert/strict";

import { PostgresAccountStore } from "../src/account-store.ts";
import type { QueryResult, SqlExecutor } from "../src/client.ts";

class RecordingSql implements SqlExecutor {
  readonly statements: { sql: string; values: readonly unknown[] }[] = [];
  rows: Record<string, unknown>[] = [];

  async query<Row = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = []
  ): Promise<QueryResult<Row>> {
    this.statements.push({ sql: text.replace(/\s+/g, " ").trim(), values });
    return { rows: this.rows as Row[], rowCount: this.rows.length };
  }
}

test("a contact resolves to its account through the join", async () => {
  const sql = new RecordingSql();
  await new PostgresAccountStore(sql).findByContact("email", "s@example.invalid");
  assert.match(sql.statements[0]!.sql, /JOIN account_contacts/);
  assert.deepEqual(sql.statements[0]!.values, ["email", "s@example.invalid"]);
});

test("an unknown contact returns null, not an empty account", async () => {
  const sql = new RecordingSql();
  assert.equal(await new PostgresAccountStore(sql).findByContact("phone", "+44"), null);
});

test("a found account is mapped with its recovery timestamp", async () => {
  const sql = new RecordingSql();
  sql.rows = [
    {
      id: "a1",
      preferred_name: "S",
      status: "active",
      recovery_ready_at: new Date("2026-07-26T10:00:00.000Z"),
    },
  ];
  const account = await new PostgresAccountStore(sql).findByContact("email", "s@example.invalid");
  assert.equal(account?.status, "active");
  assert.equal(account?.recoveryReadyAt, "2026-07-26T10:00:00.000Z");
});

test("creation writes the account and its contact together", async () => {
  const sql = new RecordingSql();
  const account = await new PostgresAccountStore(sql).create({
    id: "a1",
    preferredName: "S",
    channel: "email",
    contact: "s@example.invalid",
    verifiedAt: "2026-07-26T10:00:00.000Z",
  });
  assert.equal(sql.statements.length, 2);
  assert.match(sql.statements[0]!.sql, /INSERT INTO accounts/);
  assert.match(sql.statements[1]!.sql, /INSERT INTO account_contacts/);
  // A new account is never active: recovery has not been established.
  assert.equal(account.status, "pending_recovery");
  assert.equal(account.recoveryReadyAt, null);
});

test("a new account is created pending recovery, never active", async () => {
  const sql = new RecordingSql();
  await new PostgresAccountStore(sql).create({
    id: "a1",
    preferredName: "S",
    channel: "phone",
    contact: "+447700900000",
    verifiedAt: "2026-07-26T10:00:00.000Z",
  });
  assert.match(sql.statements[0]!.sql, /'pending_recovery'/);
  assert.equal(/'active'/.test(sql.statements[0]!.sql), false);
});

test("activation records when recovery became adequate", async () => {
  const sql = new RecordingSql();
  await new PostgresAccountStore(sql).markActive("a1", "2026-07-26T11:00:00.000Z");
  assert.match(sql.statements[0]!.sql, /status = 'active', recovery_ready_at = \$2/);
});

test("only active memberships are returned", async () => {
  const sql = new RecordingSql();
  await new PostgresAccountStore(sql).memberships("a1");
  assert.match(sql.statements[0]!.sql, /removed_at IS NULL/);
});

test("memberships carry role and regulatory reference for authorisation", async () => {
  const sql = new RecordingSql();
  sql.rows = [
    {
      workspace_id: "ws-1",
      account_id: "a1",
      role: "solicitor",
      regulatory_reference: "SRA-1",
      removed_at: null,
    },
  ];
  const [membership] = await new PostgresAccountStore(sql).memberships("a1");
  assert.equal(membership?.role, "solicitor");
  assert.equal(membership?.regulatoryReference, "SRA-1");
  assert.equal(membership?.removedAt, null);
});
