import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createPool, PostgresAuditStore, withTransaction, type PoolLike } from "@legalos/database";
import { tombstoneEntry, tombstonePreservesChain } from "@legalos/privacy";

import { guardOrSkip } from "../guard.ts";
import { emitEvidence } from "../../src/index.ts";

/**
 * Audit chain integrity, end to end against a real database.
 *
 * The audit log is the one record that has to hold when everything else is in
 * dispute. Its guarantee is not "we write things down" — it is that a record
 * cannot be altered afterwards without the alteration being detectable. That is
 * only worth anything if the detection has been seen working, so this suite
 * tampers with the table directly, as somebody with database access would.
 *
 * Destructive: it truncates audit_log, so it refuses to run against anything
 * that is not local.
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = guardOrSkip(DATABASE_URL);

const held = new Map<string, boolean>();

function records(name: string, fn: () => Promise<void>) {
  return async () => {
    held.set(name, false);
    await fn();
    held.set(name, true);
  };
}

function commit(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

let pool: PoolLike;

async function store<T>(fn: (s: PostgresAuditStore) => Promise<T>): Promise<T> {
  return withTransaction(pool, (tx) => fn(new PostgresAuditStore(tx)));
}

const EVENTS = [
  { actor: "sabinah", action: "evidence.uploaded", subject: "doc-1" },
  { actor: "caseworker", action: "evidence.verified", subject: "doc-1" },
  { actor: "sabinah", action: "bundle.generated", subject: "case-1" },
];

before(async () => {
  if (skip) return;
  pool = await createPool(DATABASE_URL);
  for (const [index, event] of EVENTS.entries()) {
    await store((s) =>
      s.append({ ...event, at: `2026-07-26T09:${10 + index}:00.000Z`, payload: { index } })
    );
  }
});

test(
  "AU-001 a freshly written chain verifies",
  { skip },
  records("chain_valid", async () => {
    const result = await store((s) => s.verify());
    assert.equal(result.valid, true, `chain invalid at ${result.brokenAt}: ${result.reason}`);
  })
);

test(
  "AU-001 an altered payload is detected",
  { skip },
  records("tampering_detected", async () => {
    // Written as somebody with database access would do it: disable the guard,
    // edit the row, put the guard back. If the chain cannot catch this it is
    // recording history rather than protecting it, and the whole structure is
    // decoration.
    await pool.query("ALTER TABLE audit_log DISABLE TRIGGER audit_log_tombstone_only");
    try {
      await pool.query(`UPDATE audit_log SET payload = '{"index": 99}'::jsonb WHERE seq = 1`);
      const result = await store((s) => s.verify());
      assert.equal(result.valid, false, "an altered payload went undetected");
      assert.equal(result.brokenAt, 1);
      assert.equal(result.reason, "payload has been altered");
    } finally {
      await pool.query(`UPDATE audit_log SET payload = '{"index": 1}'::jsonb WHERE seq = 1`);
      await pool.query("ALTER TABLE audit_log ENABLE TRIGGER audit_log_tombstone_only");
    }

    // And the chain is sound again once the tampering is undone, so the test
    // above proved detection rather than merely leaving the chain broken.
    const restored = await store((s) => s.verify());
    assert.equal(restored.valid, true, `chain left broken: ${restored.reason}`);
  })
);

test(
  "AU-003 an audit row cannot be updated",
  { skip },
  records("append_only_update", async () => {
    await assert.rejects(
      () => pool.query("UPDATE audit_log SET actor = 'someone else' WHERE seq = 0"),
      /append-only/
    );
  })
);

test(
  "AU-003 an audit row cannot be deleted",
  { skip },
  records("append_only_delete", async () => {
    await assert.rejects(() => pool.query("DELETE FROM audit_log WHERE seq = 0"), /append-only/);
  })
);

test(
  "AU-002 a tombstone erases the payload and the chain still verifies",
  { skip },
  records("tombstone_preserves_chain", async () => {
    const [entry] = await store((s) => s.entries(1));
    assert.ok(entry);
    // What the in-memory model says should survive erasure.
    assert.equal(
      tombstonePreservesChain(entry, tombstoneEntry(entry, "2026-07-26T12:00:00.000Z")),
      true
    );

    await store((s) => s.tombstone(0, "2026-07-26T12:00:00.000Z"));

    const after = await pool.query<{ payload: unknown; payload_hash: string }>(
      "SELECT payload, payload_hash FROM audit_log WHERE seq = 0"
    );
    // The content is gone and the fingerprint remains. Both halves matter: the
    // first is the erasure, the second is what keeps the chain verifiable.
    assert.deepEqual(after.rows[0]?.payload, {});
    assert.equal(after.rows[0]?.payload_hash, entry.payloadHash);

    const result = await store((s) => s.verify());
    assert.equal(result.valid, true, `tombstone broke the chain: ${result.reason}`);
  })
);

test(
  "AU-003 the tombstone exception does not open a general update path",
  { skip },
  records("tombstone_is_narrow", async () => {
    // The most important test here. Narrowing the trigger to permit erasure is
    // only safe if it permits nothing else, and a hole in this direction would
    // look exactly like a working system.
    await assert.rejects(
      () =>
        pool.query(
          "UPDATE audit_log SET actor = 'someone else', tombstoned_at = now(), payload = '{}'::jsonb WHERE seq = 2"
        ),
      /only payload erasure is permitted/,
      "the actor of an audit entry could be rewritten under cover of a tombstone"
    );

    // A tombstone that leaves the payload in place would be indistinguishable
    // from a real one to anyone reading the row's tombstone marker.
    await assert.rejects(
      () => pool.query("UPDATE audit_log SET tombstoned_at = now() WHERE seq = 2"),
      /must empty the payload/
    );

    // Erasing twice would allow a payload to be substituted and then erased,
    // leaving no trace of the substitution.
    await assert.rejects(
      () => store((s) => s.tombstone(0, "2026-07-26T13:00:00.000Z")),
      /already tombstoned/
    );

    const result = await store((s) => s.verify());
    assert.equal(result.valid, true);
  })
);

after(async () => {
  if (skip) return;

  const emit = (checkId: string, names: readonly string[], demonstrates: string) =>
    emitEvidence(repoRoot, {
      checkId,
      passed: names.every((n) => held.get(n) === true),
      at: new Date().toISOString(),
      commit: commit(),
      producedBy: "packages/integration/test/audit/chain.test.ts",
      demonstrates,
    });

  await emit(
    "audit_chain_valid",
    ["chain_valid", "tampering_detected"],
    "a written chain verifies, and an altered payload is detected and located by recomputation against a real database"
  );
  await emit(
    "audit_append_only",
    ["append_only_update", "append_only_delete", "tombstone_is_narrow"],
    "the database refuses UPDATE and DELETE on audit_log, and the erasure exception permits only the payload transition — not a changed actor, not a tombstone that keeps the payload, not a second tombstone"
  );
  // The privacy invariants read the same run. PR-001 and PR-006 are the two
  // halves of the same assertion — the payload is gone, the fingerprint is not
  // — so they are emitted from the one test that establishes both rather than
  // from a second suite that could drift away from it.
  await emit(
    "erasure_removes_payload",
    ["tombstone_preserves_chain"],
    "an erasure request empties the payload of an audit entry in the database"
  );
  await emit(
    "tombstone_preserves_hash",
    ["tombstone_preserves_chain"],
    "the erased entry keeps its payload_hash, seq, prev_hash and hash"
  );
  await emit(
    "audit_chain_valid_after_tombstone",
    ["tombstone_preserves_chain"],
    "an audit entry can have its payload erased while the chain still verifies"
  );
  await pool.end();
});
