import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AGENTS,
  findAgent,
  may,
  route,
  standingFor,
  validateAgents,
  type AgentDefinition,
} from "../src/index.ts";

const ok: AgentDefinition = {
  id: "test-agent",
  name: "Test",
  department: "platform",
  version: "0.1.0",
  declaredCeiling: "draft",
  description: "An agent whose description is long enough to be reviewable by a person.",
  capabilities: ["conversation"],
  permissions: ["read_case"],
  retrievalDomains: [],
  requiresVerification: true,
  requiresHumanReview: false,
  observableInvariants: ["AU-005"],
};

test("the declared registry has no structural defects", () => {
  assert.deepEqual(validateAgents(), []);
});

test("an agent declaring a permission no agent may hold is a defect, not a setting", () => {
  for (const permission of ["submit_filing", "delete_evidence"] as const) {
    const defects = validateAgents([{ ...ok, permissions: [permission] }]);
    assert.ok(
      defects.some((d) => d.problem.includes("no agent may hold")),
      `${permission} was accepted`
    );
  }
});

test("an agent omitting AU-005 is caught, since every agent reaches a model through the runner", () => {
  const defects = validateAgents([{ ...ok, observableInvariants: ["AI-001"] }]);
  assert.ok(defects.some((d) => d.problem === "does not declare AU-005"));
});

test("a duplicate id is caught", () => {
  assert.ok(validateAgents([ok, ok]).some((d) => d.problem === "duplicate id"));
});

test("an agent with no capability is caught, since nothing could route to it", () => {
  assert.ok(
    validateAgents([{ ...ok, capabilities: [] }]).some((d) => d.problem.includes("no capability"))
  );
});

test("permissions are explicit: absence is refusal, not a default", () => {
  const agent = findAgent("public-companion");
  assert.ok(agent);
  assert.equal(agent.permissions.length, 0);
  assert.equal(may(agent, "read_case"), false);
  assert.equal(may(agent, "read_evidence"), false);
});

test("no agent in the registry holds a never-grantable permission", () => {
  for (const agent of AGENTS) {
    assert.equal(may(agent, "submit_filing"), false, `${agent.id} may submit a filing`);
    assert.equal(may(agent, "delete_evidence"), false, `${agent.id} may delete evidence`);
  }
});

test("an unregistered agent resolves to null rather than to a default", () => {
  assert.equal(findAgent("not-an-agent"), null);
});

const EVIDENCE = [
  {
    benchmarkId: "BENCH-TEST",
    capability: "deep_reasoning",
    datasetId: "legal-reasoning",
    datasetVersion: "1.0.0",
    expiresAt: "2099-01-01T00:00:00.000Z",
    samples: 500,
    repeats: 5,
    scores: { alpha: 91, beta: 74 },
  },
];

const NOW = Date.parse("2026-07-27T00:00:00.000Z");

test("one configured provider is used without claiming a ranking", () => {
  // Nothing is being chosen between, so no evidence is needed to justify it.
  const result = route({ capability: "conversation", configured: ["xai"], evidence: [], now: NOW });
  assert.equal(result.provider, "xai");
  assert.equal(result.basis.kind, "sole_provider");
});

test("no configured provider is refused", () => {
  const result = route({ capability: "ocr", configured: [], evidence: [], now: NOW });
  assert.equal(result.provider, null);
  assert.equal(result.failure, "NO_CONFIGURED_PROVIDER");
});

test("choosing between providers with no evidence is refused", () => {
  // The rule that matters. Picking one silently would look identical to a
  // measured decision, and would be deciding which model answers a question
  // about someone's immigration status on the order of a list.
  const result = route({
    capability: "deep_reasoning",
    configured: ["alpha", "beta"],
    evidence: [],
    now: NOW,
  });
  assert.equal(result.provider, null);
  assert.equal(result.failure, "NO_EVIDENCE_FOR_CHOICE");
});

test("evidence ranks providers and the decision cites it", () => {
  const result = route({
    capability: "deep_reasoning",
    configured: ["alpha", "beta"],
    evidence: EVIDENCE,
    now: NOW,
  });
  assert.equal(result.provider, "alpha");
  assert.equal(result.basis.kind, "benchmark");
  if (result.basis.kind === "benchmark") {
    assert.equal(result.basis.benchmarkId, "BENCH-TEST");
    assert.equal(result.basis.datasetVersion, "1.0.0");
  }
});

test("expired evidence supports nothing", () => {
  const result = route({
    capability: "deep_reasoning",
    configured: ["alpha", "beta"],
    evidence: [{ ...EVIDENCE[0]!, expiresAt: "2020-01-01T00:00:00.000Z" }],
    now: NOW,
  });
  assert.equal(result.provider, null);
  assert.equal(result.failure, "EVIDENCE_EXPIRED");
});

test("a single run over few samples cannot rank providers", () => {
  const result = route({
    capability: "deep_reasoning",
    configured: ["alpha", "beta"],
    evidence: [{ ...EVIDENCE[0]!, samples: 12, repeats: 1 }],
    now: NOW,
  });
  assert.equal(result.provider, null);
  assert.equal(result.failure, "EVIDENCE_INADEQUATE");
});

test("an agent with no executions stands at draft whatever it declares", () => {
  const standing = standingFor({
    agentId: "legal-analysis",
    executions: 0,
    passed: 0,
    failed: 0,
    medianLatencyMs: null,
  });
  assert.equal(standing.observed, "draft");
  assert.match(standing.reason, /no execution has been recorded/);
});

test("standing rises with evidence and is capped by the declared ceiling", () => {
  // Enough executions and a high enough pass rate for `verified`; the agent
  // declares `testing`, so that is where it sits. The cap only ever lowers.
  const standing = standingFor({
    agentId: "legal-analysis",
    executions: 100,
    passed: 99,
    failed: 1,
    medianLatencyMs: 2_800,
  });
  assert.equal(standing.observed, "testing");
  assert.match(standing.reason, /held at the declared ceiling/);
});

test("a poor verification rate holds an agent down however many executions it has", () => {
  const standing = standingFor({
    agentId: "legal-analysis",
    executions: 5_000,
    passed: 2_000,
    failed: 3_000,
    medianLatencyMs: 2_800,
  });
  assert.equal(standing.observed, "testing");
  assert.equal(standing.verificationRate, 0.4);
});

test("an unregistered agent has no standing at all", () => {
  const standing = standingFor({
    agentId: "ghost",
    executions: 10_000,
    passed: 10_000,
    failed: 0,
    medianLatencyMs: 10,
  });
  assert.equal(standing.observed, "draft");
  assert.match(standing.reason, /not in the registry/);
});
