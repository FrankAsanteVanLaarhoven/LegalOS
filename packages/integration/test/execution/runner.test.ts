import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createPool,
  PostgresAgentMetrics,
  PostgresExecutionLifecycle,
  PostgresExecutionStore,
  type PoolLike,
} from "@legalos/database";
import { AGENTS, findAgent } from "@legalos/agentos";
import {
  CapabilityNotDeclaredError,
  ExecutionRunner,
  UnknownAgentError,
  type ExecutionContext,
  type Guardrails,
  type Provider,
  type ProviderResult,
} from "@legalos/execution";

import { guardOrSkip } from "../guard.ts";
import { emitEvidence } from "../../src/index.ts";

/**
 * AU-005: every provider invocation has exactly one execution record.
 *
 * AU-004 proves an execution can be replayed *if* one exists. This proves an
 * execution cannot happen without one — a different and, for an audit trail,
 * more important claim. A recording system that can be bypassed records
 * whatever did not need hiding.
 *
 * The provider here counts its own invocations. Counting at the provider rather
 * than at the runner is the point: the runner is the thing under test, so
 * asking it how many times it ran would prove nothing.
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
let invocations = 0;

/** Counts every call, and can be told to fail or hang. */
class CountingProvider implements Provider {
  behaviour: "ok" | "throw" | "hang" = "ok";

  describe() {
    return { id: "xai", model: "test-model", modelVersion: "2026-07-01" };
  }

  async execute(_context: ExecutionContext, prompt: string): Promise<ProviderResult> {
    invocations += 1;
    if (this.behaviour === "throw") throw new Error("provider exploded");
    if (this.behaviour === "hang") await new Promise((resolve) => setTimeout(resolve, 5_000));
    return {
      response: `answer to: ${prompt}`,
      inputTokens: 12,
      outputTokens: 34,
      latencyMs: 5,
      finishReason: "stop",
      endpoint: "https://example.invalid/v1",
      retries: 0,
      metadata: { test: true },
    };
  }
}

class ConfigurableGuardrails implements Guardrails {
  verdict: "pass" | "flag" | "block" = "pass";

  async check() {
    return { verdict: this.verdict, detail: this.verdict === "pass" ? null : "test verdict" };
  }
}

/**
 * The agents this suite drives.
 *
 * Both halves are needed. Another suite drives legal-analysis, and another
 * writes executions under the same actor id — so neither field alone selects
 * the population the provider counted. The suites used to be isolated by
 * truncating the tables between them, which is why none of this surfaced until
 * the append-only guarantee was enforced against the tooling.
 */
const MY_AGENTS = ["case-companion", "legal-analysis"];

const provider = new CountingProvider();
const guardrails = new ConfigurableGuardrails();

let clock = 1_000;

function runner(): ExecutionRunner {
  return new ExecutionRunner({
    store: new PostgresExecutionStore(pool),
    lifecycle: new PostgresExecutionLifecycle(pool),
    providers: new Map([["xai", provider]]),
    guardrails,
    projection: new PostgresAgentMetrics(pool),
    now: () => (clock += 5),
  });
}

const CONTEXT = {
  workspaceId: null,
  caseId: null,
  organisationId: null,
  actorId: "sabinah",
  actorType: "client",
  sessionId: "sess-1",
  deviceId: "device-1",
  department: "case",
  agentId: "case-companion",
  agentVersion: "0.1.0",
  promptTemplateId: "runner-test",
  promptTemplateVersion: "1.0.0",
  guardrailVersion: "1.0.0",
  registryVersion: "0.2.0-dev",
  requestedAt: "2026-07-26T10:00:00.000Z",
};

function request(overrides: Record<string, unknown> = {}) {
  return {
    capability: "conversation" as const,
    context: CONTEXT,
    prompt: "explain private life grounds",
    userMessage: "explain private life grounds",
    systemPromptHash: sha("system"),
    ...overrides,
  };
}

before(async () => {
  if (skip) return;
  pool = await createPool(DATABASE_URL);
  await emitEvidence(repoRoot, {
    checkId: "provider_selected_by_capability_router",
    passed: ["undeclared_capability_refused", "provider_from_router"].every(
      (n) => held.get(n) === true
    ),
    at: new Date().toISOString(),
    commit: commit(),
    producedBy: "packages/integration/test/execution/runner.test.ts",
    demonstrates:
      "a request supplies a capability and never a provider; the runner resolves one through the routing table and records what actually ran, and a capability the agent does not declare is refused before a provider is reachable",
  });

  await emitEvidence(repoRoot, {
    checkId: "agent_resolved_from_registry",
    passed: ["unknown_agent_refused", "human_review_withholds"].every((n) => held.get(n) === true),
    at: new Date().toISOString(),
    commit: commit(),
    producedBy: "packages/integration/test/execution/runner.test.ts",
    demonstrates:
      "an execution naming an unregistered agent is refused before a provider is reachable, and an agent declaring that it requires human review never has its output released automatically even when the verification gate passes",
  });
  await new PostgresExecutionStore(pool).recordTemplate({
    id: "runner-test",
    version: "1.0.0",
    kind: "system",
    body: "You explain UK immigration processes.",
  });
  invocations = 0;
});

test(
  "a successful execution is recorded, released and replayable",
  { skip },
  records("success_recorded", async () => {
    guardrails.verdict = "pass";
    const outcome = await runner().execute(
      request({
        retrieval: {
          workspaceId: null,
          caseId: null,
          query: "private life grounds",
          filters: {},
          retrievalStrategy: "runner-test",
          chunks: [{ sourceId: "rule-276ADE", rank: 1 }],
          sourceHashes: [sha("a")],
          embeddingsVersion: "e5",
          vectorIndexVersion: "2026-07-01",
        },
      })
    );
    assert.equal(outcome.state, "completed");
    assert.ok(outcome.response, "a passing answer should be released");

    const replay = await new PostgresExecutionStore(pool).replay(outcome.executionId);
    assert.equal(replay.reproducible, true, `not replayable: ${replay.failure}`);
  })
);

test(
  "a provider that throws still leaves a complete record",
  { skip },
  records("failure_recorded", async () => {
    provider.behaviour = "throw";
    const outcome = await runner().execute(request());
    provider.behaviour = "ok";

    assert.equal(outcome.state, "failed");
    const row = await pool.query<{ terminal_state: string; error_code: string }>(
      "SELECT terminal_state, error_code FROM ai_execution_completions WHERE execution_id = $1",
      [outcome.executionId]
    );
    assert.equal(row.rows[0]?.terminal_state, "failed");
    assert.equal(row.rows[0]?.error_code, "PROVIDER_ERROR");
  })
);

test(
  "a timeout is recorded as a timeout rather than lost",
  { skip },
  records("timeout_recorded", async () => {
    provider.behaviour = "hang";
    const outcome = await runner().execute(request({ timeoutMs: 20 }));
    provider.behaviour = "ok";

    assert.equal(outcome.state, "timed_out");
    const row = await pool.query<{ error_code: string }>(
      "SELECT error_code FROM ai_execution_completions WHERE execution_id = $1",
      [outcome.executionId]
    );
    assert.equal(row.rows[0]?.error_code, "TIMEOUT");
  })
);

test(
  "a blocked answer is a recorded execution, not a silence",
  { skip },
  records("blocked_recorded", async () => {
    guardrails.verdict = "block";
    const outcome = await runner().execute(request());
    guardrails.verdict = "pass";

    assert.equal(outcome.state, "blocked");
    assert.equal(outcome.response, null, "a blocked answer must not reach the caller");
    const row = await pool.query<{ terminal_state: string; released: boolean }>(
      "SELECT terminal_state, released FROM ai_execution_completions WHERE execution_id = $1",
      [outcome.executionId]
    );
    assert.equal(row.rows[0]?.terminal_state, "blocked");
    assert.equal(row.rows[0]?.released, false);
  })
);

test(
  "a flagged answer is recorded and withheld rather than softened",
  { skip },
  records("flagged_withheld", async () => {
    guardrails.verdict = "flag";
    const outcome = await runner().execute(request());
    guardrails.verdict = "pass";

    assert.equal(outcome.state, "completed");
    assert.equal(outcome.response, null, "an unverified answer must not be released");
    const row = await pool.query<{ released: boolean; verification_verdict: string }>(
      "SELECT released, verification_verdict FROM ai_execution_completions WHERE execution_id = $1",
      [outcome.executionId]
    );
    assert.equal(row.rows[0]?.released, false);
    assert.equal(row.rows[0]?.verification_verdict, "flag");
  })
);

test(
  "a capability the agent does not declare is refused",
  { skip },
  records("undeclared_capability_refused", async () => {
    // case-companion declares conversation only. Asking it for deep reasoning
    // would make the declared capability list decorative.
    const before = invocations;
    await assert.rejects(
      () => runner().execute(request({ capability: "deep_reasoning" as const })),
      CapabilityNotDeclaredError
    );
    assert.equal(invocations, before);
  })
);

test(
  "the execution records the provider routing chose, not one a caller named",
  { skip },
  records("provider_from_router", async () => {
    const outcome = await runner().execute(request());
    const row = await pool.query<{ provider: string; model: string }>(
      "SELECT provider, model FROM ai_executions WHERE id = $1",
      [outcome.executionId]
    );
    // The caller supplies a capability and nothing else about the model. These
    // values came from the provider the routing table selected.
    assert.equal(row.rows[0]?.provider, "xai");
    assert.equal(row.rows[0]?.model, "test-model");
  })
);

test(
  "an unregistered agent is refused before a provider is reachable",
  { skip },
  records("unknown_agent_refused", async () => {
    const before = invocations;
    await assert.rejects(
      () => runner().execute(request({ context: { ...CONTEXT, agentId: "not-registered" } })),
      UnknownAgentError
    );
    // The substance of the assertion: nothing was asked of a model under a name
    // that is not governed, so no permissions were escaped by not having any.
    assert.equal(invocations, before, "a provider was called for an unregistered agent");
  })
);

test(
  "an agent that requires human review never has its output released automatically",
  { skip },
  records("human_review_withholds", async () => {
    const analysis = findAgent("legal-analysis");
    assert.ok(analysis?.requiresHumanReview, "this test needs an agent that requires review");

    guardrails.verdict = "pass";
    const outcome = await runner().execute(
      request({
        capability: "deep_reasoning" as const,
        context: { ...CONTEXT, agentId: "legal-analysis", department: "legal" },
      })
    );

    assert.equal(outcome.state, "completed");
    assert.equal(outcome.verdict, "pass");
    // Passed the gate and still withheld. The distinction between "failed
    // verification" and "passed but awaits a person" stays visible in the
    // record rather than collapsing into one refusal.
    assert.equal(outcome.response, null);
    assert.match(outcome.reason ?? "", /named qualified human/);

    const row = await pool.query<{ released: boolean; verification_verdict: string }>(
      "SELECT released, verification_verdict FROM ai_execution_completions WHERE execution_id = $1",
      [outcome.executionId]
    );
    assert.equal(row.rows[0]?.verification_verdict, "pass");
    assert.equal(row.rows[0]?.released, false);
  })
);

test(
  "the projection is current without anyone rebuilding it",
  { skip },
  records("projection_updates_continuously", async () => {
    // Every execution in this file has already run. If the projection is
    // event-driven, it is already correct — no rebuild is called here, and
    // calling one would hide the thing being tested.
    const metrics = new PostgresAgentMetrics(pool);
    const rows = await metrics.read();
    assert.ok(rows.length > 0, "no projection rows exist, so nothing refreshed them");

    const companion = rows.find((r) => r.agentId === "case-companion");
    assert.ok(companion, "the agent that ran has no projection row");
    assert.ok(companion.executionCount > 0);

    const drift = await metrics.drift(AGENTS.filter((a) => a.requiresHumanReview).map((a) => a.id));
    assert.equal(drift.faithful, true, `projection drifted: ${drift.disagreeing.join(", ")}`);
  })
);

test(
  "a failed execution updates the projection too, not only a successful one",
  { skip },
  records("failures_reach_the_projection", async () => {
    const metrics = new PostgresAgentMetrics(pool);
    const before = (await metrics.read()).find((r) => r.agentId === "case-companion");
    assert.ok(before);

    provider.behaviour = "throw";
    await runner().execute(request());
    provider.behaviour = "ok";

    const after = (await metrics.read()).find((r) => r.agentId === "case-companion");
    assert.ok(after);
    assert.equal(after.executionCount, before.executionCount + 1);
    assert.equal(after.failedExecutions, before.failedExecutions + 1);
  })
);

test(
  "AU-005 every provider invocation has exactly one execution record",
  { skip },
  records("one_record_per_invocation", async () => {
    // Counted for the agents this suite drives, not for the whole table. The
    // provider counts its own calls and does not know the runner exists, which
    // is the point; the comparison just has to be over the same population.
    // Scoped by the actor this suite uses. Agent id was not enough: another
    // suite in the same database also drives legal-analysis, and a population
    // that includes somebody else's executions is not the one the provider
    // counted.
    const mine = await pool.query<{ n: string }>(
      `SELECT count(*)::int AS n FROM ai_executions
        WHERE actor_id = $1 AND agent_id = ANY($2::text[])`,
      [CONTEXT.actorId, MY_AGENTS]
    );
    const recorded = Number(mine.rows[0]?.n ?? 0);
    assert.equal(
      recorded,
      invocations,
      `${invocations} provider invocations but ${recorded} execution records`
    );
    assert.ok(invocations >= 5, "the count is only meaningful if executions actually ran");
  })
);

test(
  "every execution reached a terminal state and wrote a completion",
  { skip },
  records("all_executions_completed", async () => {
    const orphans = await pool.query<{ id: string }>(
      `SELECT e.id FROM ai_executions e
         LEFT JOIN ai_execution_completions c ON c.execution_id = e.id
        WHERE c.execution_id IS NULL AND e.actor_id = $1 AND e.agent_id = ANY($2::text[])`,
      [CONTEXT.actorId, MY_AGENTS]
    );
    assert.deepEqual(
      orphans.rows.map((r) => r.id),
      [],
      "executions were recorded but never completed"
    );
  })
);

test(
  "the lifecycle is append-only, so a state cannot be rewritten afterwards",
  { skip },
  records("lifecycle_immutable", async () => {
    const row = await pool.query<{ id: string }>(
      "SELECT id FROM ai_execution_transitions ORDER BY id ASC LIMIT 1"
    );
    const id = row.rows[0]?.id;
    assert.ok(id);
    await assert.rejects(
      () =>
        pool.query("UPDATE ai_execution_transitions SET to_state = 'completed' WHERE id = $1", [
          id,
        ]),
      /append-only/
    );
    await assert.rejects(
      () => pool.query("DELETE FROM ai_execution_transitions WHERE id = $1", [id]),
      /append-only/
    );
  })
);

after(async () => {
  if (skip) return;

  await emitEvidence(repoRoot, {
    checkId: "execution_recorded_for_every_invocation",
    passed: [
      "success_recorded",
      "failure_recorded",
      "timeout_recorded",
      "blocked_recorded",
      "flagged_withheld",
      "one_record_per_invocation",
      "all_executions_completed",
      "lifecycle_immutable",
      "unknown_agent_refused",
      "human_review_withholds",
      "projection_updates_continuously",
      "failures_reach_the_projection",
      "undeclared_capability_refused",
      "provider_from_router",
    ].every((n) => held.get(n) === true),
    at: new Date().toISOString(),
    commit: commit(),
    producedBy: "packages/integration/test/execution/runner.test.ts",
    demonstrates:
      "every provider invocation counted at the provider has exactly one immutable execution record, including calls that threw, timed out, were blocked or were withheld; an unregistered agent is refused before a provider is reachable; and every execution reached a terminal state with a completion row",
  });

  await emitEvidence(repoRoot, {
    checkId: "provider_selected_by_capability_router",
    passed: ["undeclared_capability_refused", "provider_from_router"].every(
      (n) => held.get(n) === true
    ),
    at: new Date().toISOString(),
    commit: commit(),
    producedBy: "packages/integration/test/execution/runner.test.ts",
    demonstrates:
      "a request supplies a capability and never a provider; the runner resolves one through the routing table and records what actually ran, and a capability the agent does not declare is refused before a provider is reachable",
  });

  await emitEvidence(repoRoot, {
    checkId: "agent_resolved_from_registry",
    passed: ["unknown_agent_refused", "human_review_withholds"].every((n) => held.get(n) === true),
    at: new Date().toISOString(),
    commit: commit(),
    producedBy: "packages/integration/test/execution/runner.test.ts",
    demonstrates:
      "an execution naming an unregistered agent is refused before a provider is reachable, and an agent declaring that it requires human review never has its output released automatically even when the verification gate passes",
  });
  await pool.end();
});
