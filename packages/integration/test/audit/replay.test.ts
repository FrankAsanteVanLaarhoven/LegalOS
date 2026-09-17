import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createPool,
  PostgresExecutionStore,
  withTransaction,
  type PoolLike,
} from "@legalos/database";

import { guardOrSkip } from "../guard.ts";
import { emitEvidence } from "../../src/index.ts";

/**
 * Execution replay.
 *
 * AU-004 asks whether a model answer can be reconstructed exactly rather than
 * approximately. The observations that record metadata are the easy half; this
 * is the half that tests the property they are supposed to guarantee, which is
 * that the metadata is *sufficient* — that the artefacts it cites are still the
 * ones that were used.
 *
 * The distinction that matters: replay reconstructs the inputs, it does not
 * re-run the model. Nobody can offer deterministic replay of a language model —
 * providers change weights behind a version string — and a replay that
 * re-invoked one and got a different answer would read as a failure of the
 * record when it is a property of the model.
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

const sha = (v: string) => createHash("sha256").update(v, "utf8").digest("hex");

let pool: PoolLike;
let executionId = "";
let snapshotId = "";

async function store<T>(fn: (s: PostgresExecutionStore) => Promise<T>): Promise<T> {
  return withTransaction(pool, (tx) => fn(new PostgresExecutionStore(tx)));
}

const SYSTEM_PROMPT =
  "You explain UK immigration processes. You never state a legal conclusion without a verified source.";

const CHUNKS = [
  { sourceId: "immigration-rules-276ADE", text: "private life grounds", rank: 1 },
  { sourceId: "ho-guidance-family-private-life", text: "very significant obstacles", rank: 2 },
];

before(async () => {
  if (skip) return;
  pool = await createPool(DATABASE_URL);

  const systemHash = await store((s) =>
    s.recordTemplate({ id: "replay-test", version: "1.0.0", kind: "system", body: SYSTEM_PROMPT })
  );

  const snapshot = await store((s) =>
    s.recordSnapshot({
      workspaceId: null,
      caseId: null,
      query: "can I apply on private life grounds after 12 years",
      filters: { jurisdiction: "UK" },
      retrievalStrategy: "replay-test",
      chunks: CHUNKS,
      sourceHashes: [sha("source-a"), sha("source-b")],
      embeddingsVersion: "e5-large-v2",
      vectorIndexVersion: "2026-07-01",
    })
  );
  snapshotId = snapshot.id;

  executionId = await store((s) =>
    s.record({
      workspaceId: null,
      caseId: null,
      organisationId: null,
      actorId: "sabinah",
      actorType: "client",
      sessionId: "sess-1",
      deviceId: "device-1",
      department: "case",
      agentId: "replay-test",
      agentVersion: "0.1.0",
      provider: "test",
      model: "test-model",
      modelVersion: "2026-07-01",
      promptTemplateId: "replay-test",
      promptTemplateVersion: "1.0.0",
      systemPromptHash: systemHash,
      developerPromptHash: null,
      userMessageHash: sha("can I apply on private life grounds after 12 years"),
      retrievalSnapshotId: snapshot.id,
      retrievalContextHash: snapshot.hash,
      resolvedSources: ["immigration-rules-276ADE"],
      toolCalls: [],
      verifiedSourceCount: 1,
      unverifiedSourceCount: 1,
      registryVersion: "0.2.0-dev",
      guardrailVersion: "1.0.0",
      verificationVerdict: "flag",
      released: false,
      responseHash: sha("withheld pending verification"),
    })
  );
});

test(
  "a recorded execution replays, reconstructing what the model was given",
  { skip },
  records("replay_succeeds", async () => {
    const result = await store((s) => s.replay(executionId));
    assert.equal(result.reproducible, true, `replay failed: ${result.failure} ${result.reason}`);
    // Reconstruction, not a boolean. A replay that says "yes" without handing
    // back what it reconstructed cannot be checked by the person who needs it.
    assert.equal(result.reconstructed?.promptTemplateBody, SYSTEM_PROMPT);
    assert.deepEqual(result.reconstructed?.retrievalChunks, CHUNKS);
    assert.equal(result.reconstructed?.sourceHashes?.length, 2);
  })
);

test(
  "an edited prompt template is caught",
  { skip },
  records("altered_template_detected", async () => {
    await pool.query(
      "UPDATE prompt_templates SET body = $1 WHERE id = 'replay-test' AND version = '1.0.0'",
      [`${SYSTEM_PROMPT} You may state conclusions without sources.`]
    );
    try {
      const result = await store((s) => s.replay(executionId));
      assert.equal(result.reproducible, false, "an edited system prompt went undetected");
      assert.equal(result.failure, "PROMPT_TEMPLATE_ALTERED");
    } finally {
      await pool.query(
        "UPDATE prompt_templates SET body = $1 WHERE id = 'replay-test' AND version = '1.0.0'",
        [SYSTEM_PROMPT]
      );
    }
    assert.equal((await store((s) => s.replay(executionId))).reproducible, true);
  })
);

test(
  "an edited retrieval snapshot is caught",
  { skip },
  records("altered_snapshot_detected", async () => {
    // The case where this matters: someone adds a document after the fact and
    // the answer then looks better supported than it was.
    await pool.query("UPDATE retrieval_snapshots SET chunks = $1 WHERE id = $2", [
      JSON.stringify([...CHUNKS, { sourceId: "invented", text: "helpful", rank: 3 }]),
      snapshotId,
    ]);
    try {
      const result = await store((s) => s.replay(executionId));
      assert.equal(result.reproducible, false, "an edited retrieval snapshot went undetected");
      assert.equal(result.failure, "RETRIEVAL_SNAPSHOT_ALTERED");
    } finally {
      await pool.query("UPDATE retrieval_snapshots SET chunks = $1 WHERE id = $2", [
        JSON.stringify(CHUNKS),
        snapshotId,
      ]);
    }
    assert.equal((await store((s) => s.replay(executionId))).reproducible, true);
  })
);

test(
  "reordering what the model saw is caught, because order is part of the input",
  { skip },
  records("reordering_detected", async () => {
    await pool.query("UPDATE retrieval_snapshots SET chunks = $1 WHERE id = $2", [
      JSON.stringify([...CHUNKS].reverse()),
      snapshotId,
    ]);
    try {
      assert.equal((await store((s) => s.replay(executionId))).reproducible, false);
    } finally {
      await pool.query("UPDATE retrieval_snapshots SET chunks = $1 WHERE id = $2", [
        JSON.stringify(CHUNKS),
        snapshotId,
      ]);
    }
  })
);

test(
  "an execution record cannot be edited or removed",
  { skip },
  records("executions_immutable", async () => {
    await assert.rejects(
      () =>
        pool.query("UPDATE ai_executions SET model = 'something else' WHERE id = $1", [
          executionId,
        ]),
      /append-only/
    );
    await assert.rejects(
      () => pool.query("DELETE FROM ai_executions WHERE id = $1", [executionId]),
      /append-only/
    );
  })
);

test(
  "a released answer cannot record a failing verdict",
  { skip },
  records("released_requires_pass", async () => {
    await assert.rejects(
      () =>
        pool.query(
          `INSERT INTO ai_executions (actor_id, actor_type, department, agent_id, agent_version,
             provider, model, model_version, prompt_template_id, prompt_template_version,
             system_prompt_hash, user_message_hash, verified_source_count, unverified_source_count,
             registry_version, guardrail_version, verification_verdict, released, response_hash)
           VALUES ('x','client','case','replay-test','0.1.0','test','m','v','replay-test','1.0.0',
             $1, $1, 0, 0, 'v', 'v', 'block', true, $1)`,
          [sha("x")]
        ),
      /released_execution_passed/
    );
  })
);

after(async () => {
  if (skip) return;

  const expected = [
    "replay_succeeds",
    "altered_template_detected",
    "altered_snapshot_detected",
    "reordering_detected",
    "executions_immutable",
    "released_requires_pass",
  ];
  await emitEvidence(repoRoot, {
    checkId: "execution_replay_succeeds",
    passed: expected.every((n) => held.get(n) === true),
    at: new Date().toISOString(),
    commit: commit(),
    producedBy: "packages/integration/test/audit/replay.test.ts",
    demonstrates:
      "a recorded execution is reconstructed from immutable artefacts, and an edited prompt template, an edited retrieval snapshot or a reordering of what the model saw all make it unreproducible",
  });
  await pool.end();
});
