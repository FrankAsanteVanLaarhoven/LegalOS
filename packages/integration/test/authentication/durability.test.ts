import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  hashToken,
  issueToken,
  checkSession,
  rotateSession,
  SESSION_TTL_MS,
  type Session,
} from "@legalos/auth";
import { createPool, PostgresSessionStore, withTransaction } from "@legalos/database";

import { guardOrSkip } from "../guard.ts";
import { emitEvidence } from "../../src/index.ts";

/**
 * PostgreSQL session durability.
 *
 * This tests the claim the last three commits made but could not demonstrate:
 * that a session survives the process that created it. The in-memory store it
 * replaced lost every session on restart, and no unit test could tell the
 * difference — both stores satisfy the same interface, and a test written
 * against that interface passes either way.
 *
 * A restart is simulated by ending the pool entirely and opening a new one, so
 * nothing is carried in the process between a write and the read that follows.
 * That is the property that matters: after a deployment the person on the other
 * end is still signed in, and the device they revoked is still revoked.
 *
 * Without DATABASE_URL these skip rather than run against a fake. A durability
 * test with a mocked store asserts that a map remembers things, which is not
 * the question being asked.
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = guardOrSkip(DATABASE_URL);

const NOW = new Date();
const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";

/** Recorded per assertion, so the evidence reflects what actually held. */
const held = new Map<string, boolean>();

function records(name: string, fn: () => Promise<void>) {
  return async () => {
    held.set(name, false);
    await fn();
    held.set(name, true);
  };
}

let token = "";
let sessionId = "";

function commit(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

/**
 * Runs a body against a connection opened and closed for that body alone.
 *
 * Each call is a separate pool, so nothing leaks between them in the process.
 * If a session is visible across two of these it is because the row exists, not
 * because an object was still in scope.
 */
async function afterRestart<T>(fn: (store: PostgresSessionStore) => Promise<T>): Promise<T> {
  const pool = await createPool(DATABASE_URL);
  try {
    return await withTransaction(pool, (tx) => fn(new PostgresSessionStore(tx)));
  } finally {
    await pool.end();
  }
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: sessionId,
    accountId: ACCOUNT_ID,
    tokenHash: hashToken(token),
    previousHash: null,
    deviceLabel: "durability test",
    createdAt: NOW.toISOString(),
    lastSeenAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + SESSION_TTL_MS).toISOString(),
    revokedAt: null,
    revokedReason: null,
    ...overrides,
  };
}

before(async () => {
  if (skip) return;
  const pool = await createPool(DATABASE_URL);
  try {
    // Sessions cascade from the account, so removing the account clears both.
    await pool.query("DELETE FROM accounts WHERE id = $1", [ACCOUNT_ID]);
    await pool.query(
      "INSERT INTO accounts (id, preferred_name, status) VALUES ($1, $2, 'pending_recovery')",
      [ACCOUNT_ID, "durability test"]
    );
  } finally {
    await pool.end();
  }
});

test(
  "a session written by one connection is found by another",
  { skip },
  records("survives_restart", async () => {
    token = issueToken();
    sessionId = crypto.randomUUID();

    await afterRestart((store) => store.put(session()));

    // Every connection from the write above is closed before this line runs.
    const found = await afterRestart((store) => store.findByTokenHash(hashToken(token)));
    assert.ok(found, "the session did not survive the connection that created it");
    assert.equal(found.accountId, ACCOUNT_ID);
    assert.equal(found.deviceLabel, "durability test");
  })
);

test(
  "the recovered session validates, rather than merely existing",
  { skip },
  records("validates_after_restart", async () => {
    const found = await afterRestart((store) => store.findByTokenHash(hashToken(token)));
    const check = checkSession(found, token, NOW.toISOString());
    assert.equal(check.valid, true, `a durable session must verify: ${check.rejection}`);
  })
);

test(
  "a second restart changes nothing",
  { skip },
  records("survives_second_restart", async () => {
    // Two restarts specifically: one can pass on a connection that was never
    // really closed, and the point is that no process state is doing the work.
    const first = await afterRestart((store) => store.findByTokenHash(hashToken(token)));
    const second = await afterRestart((store) => store.findByTokenHash(hashToken(token)));
    assert.ok(first && second);
    assert.equal(second.id, first.id);
    assert.equal(checkSession(second, token, NOW.toISOString()).valid, true);
  })
);

test(
  "a rotated-out token still resolves, so replay stays detectable after a restart",
  { skip },
  records("replay_detectable_after_restart", async () => {
    const rotation = rotateSession(session(), NOW.toISOString());
    await afterRestart((store) => store.put(rotation.session));

    // The old token must not read as unknown. An unknown token is a typo; a
    // rotated-out one presented again means two parties hold tokens for one
    // session. Losing that distinction on restart loses the detection.
    const byOldToken = await afterRestart((store) => store.findByTokenHash(hashToken(token)));
    assert.ok(byOldToken, "the previous hash was lost across a restart");
    const check = checkSession(byOldToken, token, NOW.toISOString());
    assert.equal(check.valid, false);
    assert.equal(check.rejection, "REPLAYED");

    token = rotation.token;
  })
);

test(
  "revocation survives a restart, which is the half that matters for safety",
  { skip },
  records("revocation_survives_restart", async () => {
    await afterRestart((store) =>
      store.revoke(sessionId, new Date().toISOString(), "durability test")
    );

    const found = await afterRestart((store) => store.findByTokenHash(hashToken(token)));
    assert.ok(found, "the session vanished instead of being marked revoked");
    assert.notEqual(found.revokedAt, null, "a revoked session came back alive after restart");

    // Revoked rows are kept so a person can see that a device was signed out
    // and when. Kept, and still refused.
    const check = checkSession(found, token, new Date().toISOString());
    assert.equal(check.valid, false);
    assert.equal(check.rejection, "REVOKED");
  })
);

test(
  "an unknown token resolves to nothing rather than to someone else",
  { skip },
  records("unknown_token_matches_nothing", async () => {
    const other = await afterRestart((store) => store.findByTokenHash(hashToken(issueToken())));
    assert.equal(other, null);
  })
);

after(async () => {
  if (skip) return;

  const expected = [
    "survives_restart",
    "validates_after_restart",
    "survives_second_restart",
    "replay_detectable_after_restart",
    "revocation_survives_restart",
    "unknown_token_matches_nothing",
  ];
  // Every assertion must have run and held. A test that never executed leaves
  // no entry, and that counts as failure — silence is not a pass.
  const passed = expected.every((name) => held.get(name) === true);

  await emitEvidence(repoRoot, {
    checkId: "session_durability_survives_restart",
    passed,
    at: new Date().toISOString(),
    commit: commit(),
    producedBy: "packages/integration/test/authentication/durability.test.ts",
    demonstrates:
      "a session written through the sessions table is found, validates, detects replay and stays revoked after every connection is closed and reopened",
  });

  const pool = await createPool(DATABASE_URL);
  try {
    await pool.query("DELETE FROM accounts WHERE id = $1", [ACCOUNT_ID]);
  } finally {
    await pool.end();
  }
});
