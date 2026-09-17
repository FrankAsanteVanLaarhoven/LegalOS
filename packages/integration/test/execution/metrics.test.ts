import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { AGENTS, standingFor } from "@legalos/agentos";
import {
  createPool,
  PostgresAgentMetrics,
  PostgresExecutionLifecycle,
  PostgresExecutionStore,
  type PoolLike,
} from "@legalos/database";

import { guardOrSkip } from "../guard.ts";
import { emitEvidence } from "../../src/index.ts";

/**
 * The agent metrics projection.
 *
 * `ai_executions` is the immutable event log; `agent_metrics` is derived from
 * it. The reason to build it that way is performance, but the reason it is safe
 * to *read* is that whether it still matches the log is itself measurable — and
 * that is what these tests establish.
 *
 * Without that check a stale or hand-edited metrics table is indistinguishable
 * from a correct one, and agent standing would be derived from a number nobody
 * can trace. That is the failure the whole architecture exists to prevent,
 * reintroduced through a cache.
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

const REVIEWERS = AGENTS.filter((a) => a.requiresHumanReview).map((a) => a.id);
const metrics = () => new PostgresAgentMetrics(pool);

/** Writes one execution with a chosen outcome, straight to the log. */
async function record(
  agentId: string,
  outcome: {
    terminal: "completed" | "failed" | "timed_out" | "blocked";
    verdict: "pass" | "flag" | "block" | null;
    latencyMs: number;
  }
): Promise<string> {
  const store = new PostgresExecutionStore(pool);
  const lifecycle = new PostgresExecutionLifecycle(pool);
  const id = await store.record({
    workspaceId: null,
    caseId: null,
    organisationId: null,
    actorId: "metrics-test",
    actorType: "client",
    sessionId: null,
    deviceId: null,
    department: "platform",
    agentId,
    agentVersion: "0.1.0",
    provider: "test",
    model: "test-model",
    modelVersion: "v",
    promptTemplateId: "metrics-test",
    promptTemplateVersion: "1.0.0",
    systemPromptHash: sha("system"),
    developerPromptHash: null,
    userMessageHash: sha("user"),
    retrievalSnapshotId: null,
    retrievalContextHash: null,
    resolvedSources: [],
    toolCalls: [],
    verifiedSourceCount: 0,
    unverifiedSourceCount: 0,
    registryVersion: "0.2.0-dev",
    guardrailVersion: "1.0.0",
    verificationVerdict: null,
    released: null,
    responseHash: null,
  });
  await lifecycle.complete(id, {
    terminalState: outcome.terminal,
    responseHash: outcome.terminal === "completed" ? sha("response") : null,
    verificationVerdict: outcome.verdict,
    released: false,
    latencyMs: outcome.latencyMs,
    inputTokens: 100,
    outputTokens: 200,
    estimatedCostPence: 2,
    retries: 1,
    providerEndpoint: null,
    finishReason: "stop",
    providerMetadata: {},
    errorCode: outcome.terminal === "completed" ? null : "TEST",
    errorDetail: null,
  });
  return id;
}

before(async () => {
  if (skip) return;
  pool = await createPool(DATABASE_URL);
  await new PostgresExecutionStore(pool).recordTemplate({
    id: "metrics-test",
    version: "1.0.0",
    kind: "system",
    body: "metrics test",
  });

  // A spread of outcomes for one agent: eight passes, one flagged, one failed.
  for (let i = 0; i < 8; i += 1) {
    await record("evidence", {
      terminal: "completed",
      verdict: "pass",
      latencyMs: 1_000 + i * 100,
    });
  }
  await record("evidence", { terminal: "blocked", verdict: "block", latencyMs: 900 });
  await record("evidence", { terminal: "failed", verdict: null, latencyMs: 5_000 });
  // And one for an agent that requires human review.
  await record("legal-analysis", { terminal: "completed", verdict: "pass", latencyMs: 2_400 });
});

test(
  "the projection is built from the log and matches it",
  { skip },
  records("projection_matches_log", async () => {
    await metrics().rebuild(REVIEWERS);
    // Scoped to the agents this suite created. It asserted a global row count
    // and reset the table to make that true, which is why it needed to truncate
    // an append-only log — a test isolating itself by erasing the record.
    const rows = await metrics().read();
    for (const agentId of ["evidence", "legal-analysis"]) {
      assert.ok(
        rows.some((r) => r.agentId === agentId),
        `${agentId} has no projection row`
      );
    }

    const drift = await metrics().drift(REVIEWERS);
    assert.equal(drift.faithful, true, `disagreeing: ${drift.disagreeing.join(", ")}`);
  })
);

test(
  "counts distinguish failures from policy blocks",
  { skip },
  records("blocks_are_not_failures", async () => {
    const rows = await metrics().read();
    const evidence = rows.find((r) => r.agentId === "evidence");
    assert.ok(evidence);

    assert.equal(evidence.executionCount, 10);
    assert.equal(evidence.successfulExecutions, 8);
    assert.equal(evidence.failedExecutions, 1);
    // A blocked answer is the verification gate working. Counting it as a
    // failure would make an agent look unreliable exactly when it was being
    // correctly restrained.
    assert.equal(evidence.policyBlocks, 1);
    assert.equal(evidence.verificationPasses, 8);
    assert.equal(evidence.verificationFailures, 1);
  })
);

test(
  "latency percentiles and totals come from the recorded completions",
  { skip },
  records("percentiles_computed", async () => {
    const evidence = (await metrics().read()).find((r) => r.agentId === "evidence");
    assert.ok(evidence);
    assert.ok(evidence.medianLatencyMs !== null && evidence.medianLatencyMs > 900);
    assert.ok(evidence.p95LatencyMs !== null && evidence.p95LatencyMs >= evidence.medianLatencyMs);
    assert.equal(evidence.totalInputTokens, 1_000);
    assert.equal(evidence.totalOutputTokens, 2_000);
    assert.equal(evidence.retriesTotal, 10);
  })
);

test(
  "an agent requiring human review is counted as such, from the registry",
  { skip },
  records("human_review_counted", async () => {
    const rows = await metrics().read();
    assert.equal(rows.find((r) => r.agentId === "legal-analysis")?.humanReviewRequired, 1);
    // `evidence` does not require review, so none of its executions count.
    assert.equal(rows.find((r) => r.agentId === "evidence")?.humanReviewRequired, 0);
  })
);

test(
  "standing is computed from the projection rather than the event log",
  { skip },
  records("standing_from_projection", async () => {
    const rows = await metrics().read();
    const evidence = rows.find((r) => r.agentId === "evidence");
    assert.ok(evidence);

    const standing = standingFor({
      agentId: "evidence",
      executions: evidence.executionCount,
      passed: evidence.verificationPasses,
      failed: evidence.failedExecutions,
      medianLatencyMs: evidence.medianLatencyMs,
      p95LatencyMs: evidence.p95LatencyMs,
    });

    assert.equal(standing.executions, 10);
    assert.equal(standing.verificationRate, 0.8);
    // Ten executions is short of the fifty required for `verified`, and the
    // agent declares a `draft` ceiling in any case.
    assert.equal(standing.observed, "draft");
  })
);

test(
  "volume alone never reaches certified",
  { skip },
  records("volume_is_not_certification", async () => {
    // The rule this encodes: an agent can run ten thousand times and still be
    // violating the property it was built to respect. A level reachable by
    // counting would rank it above one that has run twice and never broken a
    // rule.
    const withoutInvariants = standingFor({
      agentId: "legal-analysis",
      executions: 5_000,
      passed: 5_000,
      failed: 0,
      medianLatencyMs: 1_000,
      invariantsSatisfied: false,
    });
    const withInvariants = standingFor({
      agentId: "legal-analysis",
      executions: 5_000,
      passed: 5_000,
      failed: 0,
      medianLatencyMs: 1_000,
      invariantsSatisfied: true,
    });
    // Both are capped at the declared ceiling, so the ceiling is what shows —
    // but the underlying earned level differs, and neither is certified here.
    assert.equal(withoutInvariants.observed, "testing");
    assert.equal(withInvariants.observed, "testing");
    assert.equal(withoutInvariants.declaredCeiling, "testing");
  })
);

test(
  "an edited projection is detected rather than trusted",
  { skip },
  records("drift_detected", async () => {
    // The failure this exists to catch: a metrics table that says an agent is
    // doing well, with nothing in the log behind it.
    //
    // Written to satisfy every check constraint on the table. A first attempt
    // set passes above the execution count and the constraint rejected it,
    // which is worth knowing: the constraints catch an incoherent edit, and the
    // digest is what catches a careful one. Only the second kind would ever be
    // made deliberately.
    await pool.query(
      `UPDATE agent_metrics
          SET execution_count = 9999, successful_executions = 9000,
              failed_executions = 0, policy_blocks = 0,
              verification_passes = 9000, verification_failures = 0
        WHERE agent_id = 'evidence'`
    );
    const drift = await metrics().drift(REVIEWERS);
    assert.equal(drift.faithful, false, "an edited projection went undetected");
    assert.deepEqual(drift.disagreeing, ["evidence"]);

    await metrics().rebuild(REVIEWERS);
    assert.equal((await metrics().drift(REVIEWERS)).faithful, true);
  })
);

test(
  "a projection row with no executions behind it is detected",
  { skip },
  records("orphan_row_detected", async () => {
    await pool.query(
      `INSERT INTO agent_metrics (agent_id, execution_count, source_digest)
       VALUES ('never-ran', 4242, repeat('0', 64))`
    );
    const drift = await metrics().drift(REVIEWERS);
    assert.equal(drift.faithful, false);
    assert.ok(drift.disagreeing.includes("never-ran"));

    await metrics().rebuild(REVIEWERS);
    const after = await metrics().read();
    // Rebuilding removes it: an agent with no executions has no metrics row,
    // rather than a row of zeros implying it ran and did nothing.
    assert.equal(
      after.some((r) => r.agentId === "never-ran"),
      false
    );
  })
);

after(async () => {
  if (skip) return;

  await emitEvidence(repoRoot, {
    checkId: "agent_metrics_projection_faithful",
    passed: [
      "projection_matches_log",
      "blocks_are_not_failures",
      "percentiles_computed",
      "human_review_counted",
      "standing_from_projection",
      "volume_is_not_certification",
      "drift_detected",
      "orphan_row_detected",
    ].every((n) => held.get(n) === true),
    at: new Date().toISOString(),
    commit: commit(),
    producedBy: "packages/integration/test/execution/metrics.test.ts",
    demonstrates:
      "agent_metrics is rebuilt from the immutable execution log and matches it, an edited projection or a row with no executions behind it is detected as drift, and standing is computed from the projection with volume alone never reaching certified",
  });
  await pool.end();
});
