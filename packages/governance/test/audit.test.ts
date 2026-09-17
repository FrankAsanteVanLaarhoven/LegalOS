import { test } from "node:test";
import assert from "node:assert/strict";

import { AuditChain, canonicalise, GENESIS_HASH, type AuditEntry } from "../src/audit.ts";

function seeded(): AuditChain {
  const chain = new AuditChain();
  chain.append({
    at: "2026-07-26T09:00:00.000Z",
    actor: "agent:intake",
    action: "MODEL_OUTPUT_PROPOSED",
    subject: "case-001",
    payload: { verdict: "flag", codes: ["VER-010"] },
  });
  chain.append({
    at: "2026-07-26T09:05:00.000Z",
    actor: "user:solicitor-7",
    action: "PROPOSAL_AUTHORISED",
    subject: "case-001",
    payload: { proposalId: "p-1" },
  });
  return chain;
}

test("the first entry links to the genesis hash", () => {
  const chain = new AuditChain();
  const entry = chain.append({
    at: "2026-07-26T09:00:00.000Z",
    actor: "a",
    action: "X",
    subject: "s",
    payload: {},
  });
  assert.equal(entry.prevHash, GENESIS_HASH);
  assert.equal(entry.seq, 0);
});

test("an intact chain verifies", () => {
  const verification = seeded().verify();
  assert.equal(verification.valid, true);
  assert.equal(verification.brokenAt, null);
});

test("editing a payload after the fact is detected", () => {
  const chain = seeded();
  const tampered = chain.entries() as AuditEntry[];
  // Simulate an attacker rewriting history in the exported log.
  const forged = tampered.map((entry, index) =>
    index === 0 ? { ...entry, payload: { verdict: "pass", codes: [] } } : entry
  );
  const reloaded = AuditChain.fromExport(forged.map((e) => JSON.stringify(e)).join("\n"));
  const verification = reloaded.verify();
  assert.equal(verification.valid, false);
  assert.equal(verification.brokenAt, 0);
  assert.equal(verification.reason, "payload has been altered");
});

test("deleting an entry breaks the chain", () => {
  const chain = seeded();
  const remaining = chain.entries().slice(1);
  const reloaded = AuditChain.fromExport(remaining.map((e) => JSON.stringify(e)).join("\n"));
  const verification = reloaded.verify();
  assert.equal(verification.valid, false);
  assert.equal(verification.brokenAt, 0);
});

test("export round-trips and stays valid", () => {
  const chain = seeded();
  const reloaded = AuditChain.fromExport(chain.export());
  assert.equal(reloaded.length, 2);
  assert.equal(reloaded.verify().valid, true);
  assert.deepEqual(reloaded.entries(), chain.entries());
});

test("canonicalisation is key-order independent", () => {
  assert.equal(
    canonicalise({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } }),
    canonicalise({ a: { c: [3, { e: 5, f: 4 }], d: 2 }, b: 1 })
  );
});

test("identical payloads in different key orders hash identically", () => {
  const one = new AuditChain();
  const two = new AuditChain();
  const first = one.append({
    at: "2026-07-26T09:00:00.000Z",
    actor: "a",
    action: "X",
    subject: "s",
    payload: { alpha: 1, beta: 2 },
  });
  const second = two.append({
    at: "2026-07-26T09:00:00.000Z",
    actor: "a",
    action: "X",
    subject: "s",
    payload: { beta: 2, alpha: 1 },
  });
  assert.equal(first.hash, second.hash);
});
