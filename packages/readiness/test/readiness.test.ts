import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CHECKS,
  REQUIRED_CHECKS,
  evaluate,
  validateManifest,
  verdict,
  type Measurement,
  type ReadinessCheck,
} from "../src/index.ts";

const ok: ReadinessCheck = {
  id: "test_check",
  label: "A check",
  owner: "platform_operator",
  tier: "deployment",
  remedy: "Do the thing that would make this check pass, in enough words to act on.",
};

test("the declared manifest has no structural defects", () => {
  assert.deepEqual(validateManifest(), []);
});

test("a required check that no longer exists is caught", () => {
  // The defect this manifest exists for: a refactor removes a check and the
  // model is quietly weaker than it was.
  const defects = validateManifest([ok], ["test_check", "database"]);
  assert.ok(defects.some((d) => d.problem.includes("no longer defined")));
});

test("a duplicate id is caught", () => {
  assert.ok(validateManifest([ok, ok], []).some((d) => d.problem === "duplicate id"));
});

test("a dependency on a check that does not exist is caught", () => {
  const defects = validateManifest([{ ...ok, dependsOn: ["nope"] }], []);
  assert.ok(defects.some((d) => d.problem.includes("unknown check nope")));
});

test("a dependency cycle is caught rather than hanging", () => {
  const a: ReadinessCheck = { ...ok, id: "a", dependsOn: ["b"] };
  const b: ReadinessCheck = { ...ok, id: "b", dependsOn: ["a"] };
  assert.ok(validateManifest([a, b], []).some((d) => d.problem.startsWith("dependency cycle")));
});

test("a remedy too thin to act on is caught", () => {
  assert.ok(
    validateManifest([{ ...ok, remedy: "fix it" }], []).some((d) => d.problem.includes("remedy"))
  );
});

test("every required check is defined", () => {
  const ids = new Set(CHECKS.map((c) => c.id));
  for (const id of REQUIRED_CHECKS) assert.ok(ids.has(id), `${id} is required but not defined`);
});

const measurements = (state: Measurement["state"]): Measurement[] =>
  CHECKS.map((c) => ({ id: c.id, state, detail: "test" }));

test("not_measurable never blocks at structural or environment tier", () => {
  // Collapsing not_measurable into fail would give every contributor without
  // production secrets a permanently red pipeline, and a pipeline that is
  // always red teaches people to stop reading it.
  for (const tier of ["structural", "environment"] as const) {
    const results = evaluate({ tier, measurements: measurements("not_measurable") });
    assert.equal(verdict(results).ready, true, `${tier} blocked on an absence`);
  }
});

test("not_measurable blocks at deployment tier", () => {
  // A release is exactly when "we could not tell" is not an acceptable answer
  // about the audit chain.
  const results = evaluate({ tier: "deployment", measurements: measurements("not_measurable") });
  assert.equal(verdict(results).ready, false);
});

test("a measured failure blocks a deployment", () => {
  const results = evaluate({ tier: "deployment", measurements: measurements("fail") });
  assert.equal(verdict(results).ready, false);
});

test("everything passing is ready at every tier", () => {
  for (const tier of ["structural", "environment", "deployment"] as const) {
    const results = evaluate({ tier, measurements: measurements("pass") });
    assert.equal(verdict(results).ready, true);
  }
});

test("a conditional check nobody opted into does not block a deployment", () => {
  // Benchmark evidence is owed once a second provider is configured, and not
  // before. Failing on it permanently would train an operator to ignore it.
  const results = evaluate({
    tier: "deployment",
    measurements: measurements("pass").map((m) =>
      m.id === "benchmark_evidence" ? { ...m, state: "not_measurable" as const } : m
    ),
  });
  assert.equal(verdict(results).ready, true);
});

test("a conditional check that was opted into does block", () => {
  const results = evaluate({
    tier: "deployment",
    applicable: ["benchmark_evidence"],
    measurements: measurements("pass").map((m) =>
      m.id === "benchmark_evidence" ? { ...m, state: "fail" as const } : m
    ),
  });
  assert.equal(verdict(results).ready, false);
});

test("a check with no measurement at all is not_measurable, never a silent pass", () => {
  const results = evaluate({ tier: "deployment", measurements: [] });
  assert.ok(results.every((r) => r.state === "not_measurable"));
  assert.match(results[0]!.detail, /no measurement was taken/);
});
