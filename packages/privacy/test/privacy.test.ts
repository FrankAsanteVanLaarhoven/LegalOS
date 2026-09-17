import { test } from "node:test";
import assert from "node:assert/strict";

import { AuditChain } from "@legalos/governance";

import {
  DEFAULT_RETENTION,
  planErasure,
  tombstoneEntry,
  tombstonePreservesChain,
} from "../src/erasure.ts";
import { accessWasPermitted, ConsentLedger } from "../src/consent.ts";

/* ---------------- erasure ---------------- */

test("a full erasure removes everything the user supplied or the system derived", () => {
  const outcome = planErasure({ subjectId: "u1", requestedAt: "2026-07-26T10:00:00.000Z" });
  for (const dataClass of [
    "case_content",
    "evidence_bytes",
    "ocr_text",
    "translation",
    "ai_conversation",
    "ai_memory",
    "embeddings",
    "voice_recording",
  ] as const) {
    assert.ok(outcome.erased.includes(dataClass), dataClass);
  }
});

test("embeddings are erased, not treated as a separate surviving copy", () => {
  const outcome = planErasure({ subjectId: "u1", requestedAt: "2026-07-26T10:00:00.000Z" });
  assert.ok(outcome.erased.includes("embeddings"));
  const rule = outcome.actions.find((r) => r.dataClass === "embeddings");
  assert.match(rule?.reason ?? "", /removed with it/);
});

test("the audit entry is tombstoned rather than deleted or kept whole", () => {
  const outcome = planErasure({ subjectId: "u1", requestedAt: "2026-07-26T10:00:00.000Z" });
  assert.deepEqual(outcome.tombstoned, ["audit_entry"]);
  assert.equal(outcome.erased.includes("audit_entry"), false);
});

test("the consent record survives, because it proves the user asked", () => {
  const outcome = planErasure({ subjectId: "u1", requestedAt: "2026-07-26T10:00:00.000Z" });
  assert.deepEqual(outcome.retained, ["consent_record"]);
  const rule = outcome.actions.find((r) => r.dataClass === "consent_record");
  assert.match(rule?.reason ?? "", /proof that you asked/);
});

test("anything not erased must state why", () => {
  for (const rule of DEFAULT_RETENTION) {
    if (rule.action !== "erased") {
      assert.ok(rule.reason.trim().length > 20, rule.dataClass);
    }
  }
  assert.throws(
    () =>
      planErasure({ subjectId: "u1", requestedAt: "2026-07-26T10:00:00.000Z" }, [
        { dataClass: "case_content", action: "retained", reason: "  ", retainedUntil: null },
      ]),
    /without stating why/
  );
});

test("the outcome tells the user what erasure cannot reach", () => {
  const outcome = planErasure({ subjectId: "u1", requestedAt: "2026-07-26T10:00:00.000Z" });
  assert.ok(outcome.limitations.length >= 3);
  assert.ok(outcome.limitations.some((l) => /fingerprint/.test(l)));
  assert.ok(outcome.limitations.some((l) => /[Bb]ackups/.test(l)));
  assert.ok(outcome.limitations.some((l) => /exported or shared/.test(l)));
});

test("erasure can be scoped to specific data classes", () => {
  const outcome = planErasure({
    subjectId: "u1",
    requestedAt: "2026-07-26T10:00:00.000Z",
    dataClasses: ["voice_recording"],
  });
  assert.deepEqual(outcome.erased, ["voice_recording"]);
  assert.deepEqual(outcome.tombstoned, []);
});

/* ---------------- the tension this package exists to resolve ---------------- */

test("a tombstoned entry still verifies against the real audit chain", () => {
  const chain = new AuditChain();
  chain.append({
    at: "2026-07-26T09:00:00.000Z",
    actor: "agent:intake",
    action: "MODEL_OUTPUT_RELEASED",
    subject: "case-001",
    payload: { sensitive: "client trafficking detail" },
  });
  chain.append({
    at: "2026-07-26T09:05:00.000Z",
    actor: "user:solicitor-7",
    action: "PROPOSAL_AUTHORISED",
    subject: "case-001",
    payload: { proposalId: "p-1" },
  });
  assert.equal(chain.verify().valid, true);

  const first = chain.entries()[0]!;
  const tombstoned = tombstoneEntry(
    {
      seq: first.seq,
      at: first.at,
      actor: first.actor,
      action: first.action,
      subject: first.subject,
      payloadHash: first.payloadHash,
      prevHash: first.prevHash,
      hash: first.hash,
    },
    "2026-07-26T11:00:00.000Z"
  );

  // The content is gone from the tombstone.
  assert.equal(JSON.stringify(tombstoned).includes("trafficking"), false);

  // Everything the chain hashes over is preserved, so it still verifies.
  assert.equal(tombstonePreservesChain(first, tombstoned), true);
  assert.equal(tombstoned.payloadHash, first.payloadHash);
  assert.equal(tombstoned.hash, first.hash);
  assert.equal(tombstoned.tombstoned, true);
});

test("a tombstone that dropped a chain field would be caught", () => {
  const chain = new AuditChain();
  const entry = chain.append({
    at: "2026-07-26T09:00:00.000Z",
    actor: "a",
    action: "X",
    subject: "s",
    payload: { x: 1 },
  });
  const broken = tombstoneEntry(
    { ...entry, payloadHash: "0".repeat(64) },
    "2026-07-26T11:00:00.000Z"
  );
  assert.equal(tombstonePreservesChain(entry, broken), false);
});

/* ---------------- consent ---------------- */

test("consent granted with no stated scope is refused", () => {
  const ledger = new ConsentLedger();
  assert.throws(
    () =>
      ledger.record({
        permission: "camera",
        kind: "granted",
        at: "2026-06-12T10:00:00.000Z",
        scope: "   ",
        grantedTo: null,
        expiresAt: null,
      }),
    /no stated scope/
  );
});

test("a permission with no record is not granted", () => {
  assert.equal(new ConsentLedger().isActive("camera", "2026-07-26T10:00:00.000Z"), false);
});

test("withdrawal is a new event and the history survives it", () => {
  const ledger = new ConsentLedger();
  ledger.record({
    permission: "messaging_import",
    kind: "granted",
    at: "2026-06-15T10:00:00.000Z",
    scope: "Import a WhatsApp export I upload myself",
    grantedTo: null,
    expiresAt: null,
  });
  ledger.record({
    permission: "messaging_import",
    kind: "withdrawn",
    at: "2026-06-18T10:00:00.000Z",
    scope: "withdrawn by the user",
    grantedTo: null,
    expiresAt: null,
  });

  assert.equal(ledger.isActive("messaging_import", "2026-06-16T00:00:00.000Z"), true);
  assert.equal(ledger.isActive("messaging_import", "2026-06-20T00:00:00.000Z"), false);
  assert.equal(ledger.history("messaging_import").length, 2);
});

test("an expiry lapses on its own, with no sweep required", () => {
  const ledger = new ConsentLedger();
  ledger.record({
    permission: "share_with_professional",
    kind: "granted",
    at: "2026-06-01T10:00:00.000Z",
    scope: "Share the evidence bundle with my solicitor",
    grantedTo: "user:solicitor-7",
    expiresAt: "2026-07-01T00:00:00.000Z",
  });
  assert.equal(ledger.isActive("share_with_professional", "2026-06-15T00:00:00.000Z"), true);
  assert.equal(ledger.isActive("share_with_professional", "2026-07-02T00:00:00.000Z"), false);
});

test("an access after withdrawal is answerable after the fact", () => {
  const ledger = new ConsentLedger();
  ledger.record({
    permission: "email_sync",
    kind: "granted",
    at: "2026-06-15T10:00:00.000Z",
    scope: "Read attachments from my inbox",
    grantedTo: null,
    expiresAt: null,
  });
  ledger.record({
    permission: "email_sync",
    kind: "withdrawn",
    at: "2026-06-18T10:00:00.000Z",
    scope: "withdrawn by the user",
    grantedTo: null,
    expiresAt: null,
  });

  assert.equal(
    accessWasPermitted(ledger, { permission: "email_sync", at: "2026-06-16T00:00:00.000Z" }),
    true
  );
  assert.equal(
    accessWasPermitted(ledger, { permission: "email_sync", at: "2026-06-19T00:00:00.000Z" }),
    false
  );
});

test("active permissions can be listed for a privacy centre", () => {
  const ledger = new ConsentLedger();
  ledger.record({
    permission: "camera",
    kind: "granted",
    at: "2026-06-12T10:00:00.000Z",
    scope: "Scan documents I photograph",
    grantedTo: null,
    expiresAt: null,
  });
  ledger.record({
    permission: "voice_recording",
    kind: "granted",
    at: "2026-06-12T10:00:00.000Z",
    scope: "Record practice sessions",
    grantedTo: null,
    expiresAt: null,
  });
  ledger.record({
    permission: "voice_recording",
    kind: "withdrawn",
    at: "2026-06-22T10:00:00.000Z",
    scope: "withdrawn by the user",
    grantedTo: null,
    expiresAt: null,
  });

  assert.deepEqual(ledger.activePermissions("2026-07-26T00:00:00.000Z"), ["camera"]);
});
