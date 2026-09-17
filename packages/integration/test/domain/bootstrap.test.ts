import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import {
  bootstrapTenancy,
  createPool,
  PostgresAuditStore,
  withTransaction,
  type PoolLike,
} from "@legalos/database";

import { guardOrSkip } from "../guard.ts";

/**
 * Operational bootstrap.
 *
 * A seeded case becomes another fixture within months. A bootstrap is a
 * procedure, and these tests establish the three properties that make it one:
 * it is idempotent, everything it creates is marked as demonstration data, and
 * it audits itself.
 */
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = guardOrSkip(DATABASE_URL);

let pool: PoolLike;
const ORGANISATION = "Bootstrap test tenancy";

const input = {
  organisationName: ORGANISATION,
  workspaceName: "Bootstrap test workspace",
  caseReference: "TEST-0001",
  at: "2026-07-27T12:00:00.000Z",
  operator: "test",
};

before(async () => {
  if (skip) return;
  pool = await createPool(DATABASE_URL);
  await pool.query("DELETE FROM organizations WHERE name = $1", [ORGANISATION]);
});

test("a bootstrap creates a whole tenancy, not a row", { skip }, async () => {
  const result = await withTransaction(pool, (tx) => bootstrapTenancy(tx, input));
  assert.equal(result.created, true);
  for (const id of [
    result.organisationId,
    result.workspaceId,
    result.administratorId,
    result.caseworkerId,
    result.clientId,
    result.caseId,
  ]) {
    assert.match(id, /^[0-9a-f-]{36}$/, "every entity in the chain must exist");
  }
  assert.equal(result.evidenceIds.length, 4);
  assert.equal(result.timelineIds.length, 3);
});

test("everything it creates is marked as demonstration data", { skip }, async () => {
  // A demonstration case that reads as a real matter is how somebody acts on an
  // invented deadline.
  const row = await pool.query<{ is_demo: boolean }>(
    "SELECT is_demo FROM cases WHERE reference = $1",
    [input.caseReference]
  );
  assert.equal(row.rows[0]?.is_demo, true);
});

test(
  "evidence spans several states, so completeness can be counted rather than stored",
  { skip },
  async () => {
    const rows = await pool.query<{ status: string }>(
      `SELECT status FROM evidence_items
        WHERE case_id = (SELECT id FROM cases WHERE reference = $1)
        GROUP BY status`,
      [input.caseReference]
    );
    const states = new Set(rows.rows.map((r) => r.status));
    assert.ok(states.size >= 3, "a register where everything is received demonstrates nothing");
    assert.ok(states.has("missing"));
  }
);

test("timeline events record how each came to be known", { skip }, async () => {
  // An interface that cannot distinguish what a person said from what a
  // document shows is missing the distinction that matters most.
  const rows = await pool.query<{ source: string }>(
    `SELECT DISTINCT source FROM timeline_events
      WHERE case_id = (SELECT id FROM cases WHERE reference = $1)`,
    [input.caseReference]
  );
  assert.ok(rows.rows.length >= 2);
});

test("running it again finds the tenancy rather than duplicating it", { skip }, async () => {
  const first = await pool.query<{ n: string }>(
    "SELECT count(*)::int AS n FROM cases WHERE reference = $1",
    [input.caseReference]
  );
  const again = await withTransaction(pool, (tx) => bootstrapTenancy(tx, input));
  const second = await pool.query<{ n: string }>(
    "SELECT count(*)::int AS n FROM cases WHERE reference = $1",
    [input.caseReference]
  );

  assert.equal(again.created, false);
  assert.equal(Number(second.rows[0]?.n), Number(first.rows[0]?.n));
  // Idempotent by natural key, not by a flag it keeps itself: a bootstrap
  // tracking whether it had run would be a second source of truth about it.
  assert.equal(again.caseReference, input.caseReference);
});

test("creating a tenancy is audited", { skip }, async () => {
  await pool.query("DELETE FROM organizations WHERE name = $1", [ORGANISATION]);
  const before = await pool.query<{ n: string }>("SELECT count(*)::int AS n FROM audit_log");

  await withTransaction(pool, (tx) => bootstrapTenancy(tx, input, new PostgresAuditStore(tx)));

  const entry = await pool.query<{ action: string }>(
    "SELECT action FROM audit_log ORDER BY seq DESC LIMIT 1"
  );
  const after = await pool.query<{ n: string }>("SELECT count(*)::int AS n FROM audit_log");

  // Creating a case is an action, and an unaudited creation is what the chain
  // exists to catch. A bootstrap is not exempt from it.
  assert.equal(Number(after.rows[0]?.n), Number(before.rows[0]?.n) + 1);
  assert.equal(entry.rows[0]?.action, "TENANCY_BOOTSTRAPPED");

  const verification = await new PostgresAuditStore(pool).verify();
  assert.equal(verification.valid, true, "the chain must still verify afterwards");
});

after(async () => {
  if (skip) return;
  await pool.query("DELETE FROM organizations WHERE name = $1", [ORGANISATION]);
  await pool.end();
});
