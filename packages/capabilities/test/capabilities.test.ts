import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CapabilityRegistry, resolve } from "../src/registry.ts";
import { AGENT_CAPABILITY, PLATFORM_CAPABILITIES } from "../src/platform.ts";
import { createPlatformRegistry } from "../src/index.ts";
import { observed, observeSystem, unavailable, type Observation } from "../src/observe.ts";
import type { CapabilityCheck, CapabilityDefinition, ObservationSet } from "../src/types.ts";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function observations(...entries: Observation[]): ObservationSet {
  return new Map(entries.map((o) => [o.id, o]));
}

function check(overrides: Partial<CapabilityCheck>): CapabilityCheck {
  return {
    id: "c",
    label: "check",
    dimension: "implementation",
    gates: "implemented",
    satisfied: true,
    detail: "",
    nextAction: "do the thing",
    observationId: null,
    method: null,
    unmeasured: false,
    ...overrides,
  };
}

function definition(overrides: Partial<CapabilityDefinition>): CapabilityDefinition {
  return {
    id: "x",
    name: "X",
    description: "",
    declaredImplementation: "certified",
    declaredEvidence: "none",
    checks: () => [],
    ...overrides,
  };
}

/* ---------------- observation semantics ---------------- */

test("an unmeasurable observation fails its check rather than passing it", async () => {
  const status = resolve(
    definition({
      checks: () => [
        check({ satisfied: false, unmeasured: true, gates: "operational", detail: "unmeasured" }),
      ],
    }),
    observations()
  );
  assert.equal(status.implementation, "implemented");
  assert.equal(status.unmeasured.length, 1);
});

test("unmeasured checks are distinguishable from measured failures", () => {
  const status = resolve(
    definition({
      checks: () => [
        check({ id: "a", satisfied: false, unmeasured: true, gates: "operational" }),
        check({ id: "b", satisfied: false, unmeasured: false, gates: "certified" }),
      ],
    }),
    observations()
  );
  assert.deepEqual(
    status.unmeasured.map((c) => c.id),
    ["a"]
  );
  assert.equal(status.failing.length, 2);
});

test("a failing implementation check caps the implementation axis", () => {
  const status = resolve(
    definition({
      checks: () => [
        check({ id: "a", gates: "implemented", satisfied: true }),
        check({
          id: "b",
          gates: "operational",
          satisfied: false,
          detail: "no deps",
          nextAction: "configure the dependency",
        }),
      ],
    }),
    observations()
  );
  assert.equal(status.implementation, "implemented");
  assert.equal(status.nextAction, "configure the dependency");
});

test("the two axes move independently", () => {
  const def = definition({
    declaredImplementation: "verified",
    declaredEvidence: "external_audit",
    checks: (o: ObservationSet) => [
      check({ id: "impl", gates: "implemented", satisfied: true }),
      check({
        id: "audit",
        dimension: "evidence",
        gates: "external_audit",
        satisfied: o.get("audit")?.value === true,
      }),
    ],
  });
  const without = resolve(def, observations());
  assert.equal(without.implementation, "verified", "evidence failure must not cap implementation");
  // No evidence check passes, so no evidence level has been earned. Absence of
  // a failing check at a lower level is not evidence for that level.
  assert.equal(without.evidence, "none");

  const with_ = resolve(def, observations(observed("audit", true, "filesystem", "m")));
  assert.equal(with_.evidence, "external_audit");
});

test("implementation blocks before evidence", () => {
  const status = resolve(
    definition({
      declaredEvidence: "external_audit",
      checks: () => [
        check({
          id: "audit",
          dimension: "evidence",
          gates: "external_audit",
          satisfied: false,
          nextAction: "commission an audit",
        }),
        check({ id: "impl", gates: "implemented", satisfied: false, nextAction: "build it" }),
      ],
    }),
    observations()
  );
  assert.equal(status.nextAction, "build it");
});

/* ---------------- real observations of this repository ---------------- */

test("observing this repository measures real state, not declarations", async () => {
  const observed_ = await observeSystem({ repoRoot: REPO_ROOT });

  // Measured from the shipped registry file: every source is unverified.
  assert.equal(observed_.get("verified_source_count")?.value, 0);
  assert.equal(observed_.get("verified_source_count")?.source, "registry");

  // Measured from the filesystem: middleware now exists, and a separate
  // observation records that no handler yet verifies a session — the
  // difference between a gate at the edge and a real identity.
  assert.equal(observed_.get("auth_middleware_present")?.value, true);
  assert.equal(observed_.get("auth_middleware_present")?.source, "filesystem");
  assert.equal(observed_.get("session_verified_in_route")?.value, true);
  // Verified in a handler, but held in memory and obtainable only through the
  // development route — which is what still separates this from certified.
  assert.equal(observed_.get("session_store_durable")?.value, false);
  assert.equal(observed_.get("real_sign_in_exists")?.value, false);

  // Measured: packages/workflows really is a stub.
  const workflowLines = observed_.get("workflow_lines")?.value;
  assert.equal(typeof workflowLines, "number");
  assert.ok((workflowLines as number) < 30, `workflows is ${workflowLines} lines`);

  // Measured: the rules workflow still has null locators.
  assert.equal(observed_.get("rule_locators_recorded")?.value, false);
});

test("what cannot be measured reports unavailable, never a default", async () => {
  const observed_ = await observeSystem({ repoRoot: REPO_ROOT });
  for (const id of ["source_chunk_count", "bench_pass_rate", "external_audit_record"]) {
    const observation = observed_.get(id);
    assert.equal(observation?.source, "unavailable", id);
    assert.equal(observation?.value, null, id);
    assert.ok((observation?.unavailableReason ?? "").length > 10, id);
  }
});

test("every observation records how it was taken", async () => {
  for (const observation of (await observeSystem({ repoRoot: REPO_ROOT })).values()) {
    assert.ok(observation.method.length > 10, `${observation.id} has no method`);
  }
});

test("a database-backed observation overrides the filesystem fallback", async () => {
  const observed_ = await observeSystem({
    repoRoot: REPO_ROOT,
    query: async () => ({ rows: [{ n: 7 }] }),
  });
  assert.equal(observed_.get("verified_source_count")?.value, 7);
  assert.equal(observed_.get("verified_source_count")?.source, "database");
  assert.equal(observed_.get("source_chunk_count")?.value, 7);
});

test("a failing database query is unavailable, not zero", async () => {
  const observed_ = await observeSystem({
    repoRoot: REPO_ROOT,
    query: async () => {
      throw new Error("connection refused");
    },
  });
  assert.equal(observed_.get("source_chunk_count")?.source, "unavailable");
  assert.match(observed_.get("source_chunk_count")?.unavailableReason ?? "", /connection refused/);
});

/* ---------------- platform capabilities under real observation ---------------- */

test("the platform reports honestly about itself when observed", async () => {
  const o = await observeSystem({ repoRoot: REPO_ROOT });
  const registry = createPlatformRegistry();

  assert.equal(registry.status("research_retrieval", o)?.implementation, "prototype");
  assert.equal(registry.status("workflow_engine", o)?.implementation, "prototype");
  assert.equal(registry.status("knowledge_sources", o)?.implementation, "implemented");

  // Authentication has climbed prototype -> implemented -> verified as the
  // package, rate limiting and middleware landed, with no status edited by
  // hand. It stops short of certified because no handler verifies a session,
  // which is the difference between gating a route and knowing who is calling.
  assert.equal(registry.status("authentication", o)?.implementation, "verified");
});

test("verification reaches certified once requests carry a verified identity", async () => {
  const o = await observeSystem({ repoRoot: REPO_ROOT });
  const status = createPlatformRegistry().status("verification", o);
  // Its implementation checks are satisfied; evidence is what holds it back,
  // and that is the axis the benchmark moves rather than more plumbing.
  assert.equal(status?.implementation, "certified");
  assert.equal(status?.evidence, "unit_tests");
});

test("evidence cannot reach benchmark_validated with no benchmark report", async () => {
  const o = await observeSystem({ repoRoot: REPO_ROOT });
  const status = createPlatformRegistry().status("rule_engine", o);
  // Only the unit-test check passes, so that is the level earned.
  assert.equal(status?.evidence, "unit_tests");
});

test("evidence is earned by a passing check, never inferred from silence", async () => {
  const o = await observeSystem({ repoRoot: REPO_ROOT });
  // The audit trail's only failing evidence check gates production telemetry.
  // Under a cumulative model it would have been reported as externally audited
  // purely because nothing below that level failed.
  const status = createPlatformRegistry().status("audit", o);
  assert.equal(status?.evidence, "unit_tests");
});

test("a passing benchmark raises the evidence level with no code change", async () => {
  const base = await observeSystem({ repoRoot: REPO_ROOT });
  const raised = new Map(base);
  raised.set("bench_pass_rate", observed("bench_pass_rate", 0.97, "benchmark", "bench report"));
  const status = createPlatformRegistry().status("rule_engine", raised);
  assert.equal(status?.evidence, "benchmark_validated");
});

test("roadmap() lists an action for every blocked capability", async () => {
  const o = await observeSystem({ repoRoot: REPO_ROOT });
  const roadmap = createPlatformRegistry().roadmap(o);
  assert.ok(roadmap.length > 0);
  for (const entry of roadmap) {
    assert.ok(entry.action.length > 10, entry.capability);
  }
});

test("every failing check explains itself and says what would fix it", async () => {
  const o = await observeSystem({ repoRoot: REPO_ROOT });
  for (const status of createPlatformRegistry().all(o)) {
    for (const failing of status.failing) {
      assert.ok(failing.detail.length > 10, `${status.id}/${failing.id} has no explanation`);
      assert.ok(failing.nextAction.length > 10, `${status.id}/${failing.id} has no next action`);
    }
  }
});

test("every agent maps to a capability that exists", () => {
  const ids = new Set(PLATFORM_CAPABILITIES.map((c) => c.id));
  for (const [agent, capability] of Object.entries(AGENT_CAPABILITY)) {
    assert.ok(ids.has(capability), `${agent} -> unknown capability ${capability}`);
  }
});

test("duplicate capability ids are rejected", () => {
  const registry = new CapabilityRegistry([PLATFORM_CAPABILITIES[0]!]);
  assert.throws(() => registry.register(PLATFORM_CAPABILITIES[0]!), /duplicate capability id/);
});

test("unavailable() and observed() are mutually exclusive shapes", () => {
  const u = unavailable("x", "method here", "because reasons");
  assert.equal(u.value, null);
  assert.equal(u.source, "unavailable");
  const v = observed("x", 3, "database", "method here");
  assert.equal(v.unavailableReason, null);
});
