import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { emitEvidence, evidenceDigest, FRESHNESS_MS, readEvidence } from "../src/index.ts";

const NOW = Date.parse("2026-07-26T10:00:00.000Z");

async function scratch() {
  return mkdtemp(join(tmpdir(), "legalos-evidence-"));
}

const RECORD = {
  checkId: "session_revocation_propagates",
  passed: true,
  at: "2026-07-26T09:00:00.000Z",
  commit: "abc1234",
  producedBy: "revocation.test.ts",
  demonstrates: "a revoked session is refused on another instance",
};

test("absent evidence reads as not demonstrated, never as failure", async () => {
  const dir = await scratch();
  try {
    const reading = await readEvidence(dir, "anything", NOW);
    assert.equal(reading.demonstrated, null);
    assert.match(reading.reason, /no integration evidence/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("fresh passing evidence demonstrates the check", async () => {
  const dir = await scratch();
  try {
    await emitEvidence(dir, RECORD);
    const reading = await readEvidence(dir, RECORD.checkId, NOW);
    assert.equal(reading.demonstrated, true);
    assert.match(reading.reason, /revocation\.test\.ts/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a failing run is a failure, distinct from having no evidence", async () => {
  const dir = await scratch();
  try {
    await emitEvidence(dir, { ...RECORD, passed: false });
    const reading = await readEvidence(dir, RECORD.checkId, NOW);
    assert.equal(reading.demonstrated, false);
    assert.match(reading.reason, /did not hold/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("stale evidence stops vouching, so a suite that quietly stopped running is caught", async () => {
  const dir = await scratch();
  try {
    await emitEvidence(dir, RECORD);
    const later = Date.parse(RECORD.at) + FRESHNESS_MS + 1;
    const reading = await readEvidence(dir, RECORD.checkId, later);
    assert.equal(reading.demonstrated, null);
    assert.match(reading.reason, /older than 30 days/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("evidence from another commit is not inherited", async () => {
  const dir = await scratch();
  try {
    await emitEvidence(dir, RECORD);
    const reading = await readEvidence(dir, RECORD.checkId, NOW, "def5678");
    assert.equal(reading.demonstrated, null);
    assert.match(reading.reason, /produced against abc1234/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("matching commit is accepted", async () => {
  const dir = await scratch();
  try {
    await emitEvidence(dir, RECORD);
    assert.equal((await readEvidence(dir, RECORD.checkId, NOW, "abc1234")).demonstrated, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("corrupt evidence reads as absent rather than throwing", async () => {
  const dir = await scratch();
  try {
    await emitEvidence(dir, { ...RECORD, at: "not-a-date" });
    assert.equal((await readEvidence(dir, RECORD.checkId, NOW)).demonstrated, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the digest changes when any record changes", async () => {
  const a = evidenceDigest([RECORD]);
  assert.equal(a, evidenceDigest([RECORD]));
  assert.notEqual(a, evidenceDigest([{ ...RECORD, passed: false }]));
});
