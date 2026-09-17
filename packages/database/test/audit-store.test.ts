import { test } from "node:test";
import assert from "node:assert/strict";

import { GENESIS_HASH } from "@legalos/governance";

import { PostgresAuditStore } from "../src/audit-store.ts";
import { FakeAuditDatabase } from "./fake-sql.ts";

function seed() {
  const db = new FakeAuditDatabase();
  return { db, store: new PostgresAuditStore(db) };
}

const first = {
  at: "2026-07-26T09:00:00.000Z",
  actor: "agent:intake",
  action: "MODEL_OUTPUT_WITHHELD",
  subject: "case-001",
  payload: { verdict: "block", codes: ["VER-005"] },
};

const second = {
  at: "2026-07-26T09:05:00.000Z",
  actor: "user:solicitor-7",
  action: "PROPOSAL_AUTHORISED",
  subject: "case-001",
  payload: { proposalId: "p-1" },
};

test("the first entry links to the genesis hash", async () => {
  const { store } = seed();
  const entry = await store.append(first);
  assert.equal(entry.seq, 0);
  assert.equal(entry.prevHash, GENESIS_HASH);
  assert.match(entry.hash, /^[0-9a-f]{64}$/);
});

test("each entry commits to its predecessor", async () => {
  const { store } = seed();
  const a = await store.append(first);
  const b = await store.append(second);
  assert.equal(b.seq, 1);
  assert.equal(b.prevHash, a.hash);
  assert.equal((await store.verify()).valid, true);
});

test("the tail is locked before appending so concurrent writes cannot fork the chain", async () => {
  const { db, store } = seed();
  await store.append(first);
  assert.ok(
    db.statements.some((sql) => sql.includes("ORDER BY seq DESC LIMIT 1 FOR UPDATE")),
    "expected the tail read to take a row lock"
  );
});

test("altering a stored payload is detected", async () => {
  const { db, store } = seed();
  await store.append(first);
  await store.append(second);
  db.rows[0]!.payload = { verdict: "pass", codes: [] };
  const result = await store.verify();
  assert.equal(result.valid, false);
  assert.equal(result.brokenAt, 0);
  assert.equal(result.reason, "payload has been altered");
});

test("deleting an entry breaks the chain", async () => {
  const { db, store } = seed();
  await store.append(first);
  await store.append(second);
  db.rows.splice(0, 1);
  const result = await store.verify();
  assert.equal(result.valid, false);
  assert.equal(result.brokenAt, 0);
});

test("rewriting an entry's actor is detected even if the payload is untouched", async () => {
  const { db, store } = seed();
  await store.append(first);
  db.rows[0]!.actor = "user:someone-else";
  const result = await store.verify();
  assert.equal(result.valid, false);
  assert.equal(result.reason, "entry hash does not match content");
});

test("an empty log verifies", async () => {
  const { store } = seed();
  assert.equal((await store.verify()).valid, true);
});

test("export emits one JSON object per line", async () => {
  const { store } = seed();
  await store.append(first);
  await store.append(second);
  const lines = (await store.export()).split("\n");
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]!).seq, 0);
  assert.equal(JSON.parse(lines[1]!).actor, "user:solicitor-7");
});

test("payload key order does not change the hash", async () => {
  const one = new PostgresAuditStore(new FakeAuditDatabase());
  const two = new PostgresAuditStore(new FakeAuditDatabase());
  const a = await one.append({ ...first, payload: { alpha: 1, beta: 2 } });
  const b = await two.append({ ...first, payload: { beta: 2, alpha: 1 } });
  assert.equal(a.hash, b.hash);
});
