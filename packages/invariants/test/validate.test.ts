import { test } from "node:test";
import assert from "node:assert/strict";

import { defineInvariant, INVARIANTS, validateRegistry } from "../src/index.ts";

/**
 * The validator has to be shown catching things.
 *
 * A validator that has only ever been run against a clean registry is in
 * exactly the position of the five authentication checks that passed while
 * asking nothing. Each case below constructs the defect and asserts it is
 * found, so the validator is exercised in the direction that matters.
 */

const ok = {
  id: "TEST-001",
  title: "A property",
  category: "security" as const,
  severity: "medium" as const,
  rationale: "A rationale long enough to explain to a reviewer why this property matters at all.",
  observations: ["some_observation"],
  capability: "authentication",
  protects: ["packages/invariants"],
  evidenceKinds: ["integration" as const],
};

test("the declared registry has no structural defects", () => {
  assert.deepEqual(validateRegistry(), []);
});

test("the registry is not empty, so a clean result means something", () => {
  assert.ok(INVARIANTS.length > 20);
});

test("a duplicate id is caught", () => {
  const defects = validateRegistry([defineInvariant(ok), defineInvariant(ok)]);
  assert.ok(defects.some((d) => d.problem === "duplicate id"));
});

test("an invariant naming no observation is caught — this is GV-000 structurally", () => {
  const defects = validateRegistry([defineInvariant({ ...ok, observations: [] })]);
  assert.ok(defects.some((d) => d.problem === "names no observation"));
});

test("a dependency on an invariant that does not exist is caught", () => {
  const defects = validateRegistry([defineInvariant({ ...ok, dependsOn: ["NOPE-999"] })]);
  assert.ok(defects.some((d) => d.problem.includes("unknown invariant NOPE-999")));
});

test("a dependency cycle is caught rather than hanging the evaluator", () => {
  const a = defineInvariant({ ...ok, id: "A", dependsOn: ["B"] });
  const b = defineInvariant({ ...ok, id: "B", dependsOn: ["A"] });
  const defects = validateRegistry([a, b]);
  assert.ok(defects.some((d) => d.problem.startsWith("dependency cycle")));
});

test("an invariant no evidence kind may raise is caught", () => {
  // security and static can lower an invariant and never raise one, so this
  // invariant could never be satisfied however much evidence was produced.
  const defects = validateRegistry([
    defineInvariant({ ...ok, evidenceKinds: ["security", "static"] }),
  ]);
  assert.ok(defects.some((d) => d.problem.includes("never be satisfied")));
});

test("a rationale too thin to review is caught", () => {
  const defects = validateRegistry([defineInvariant({ ...ok, rationale: "Because." })]);
  assert.ok(defects.some((d) => d.problem === "rationale too thin to review"));
});

test("the same observation named twice is caught", () => {
  const defects = validateRegistry([defineInvariant({ ...ok, observations: ["x", "x"] })]);
  assert.ok(defects.some((d) => d.problem.includes("same observation twice")));
});

test("an invariant protecting a path that does not exist is caught", async () => {
  // Traceability is validated rather than trusted. A stale list is worse than
  // no list, because it is followed.
  const { validateProtectedPaths } = await import("../src/index.ts");
  const defects = await validateProtectedPaths(process.cwd(), [
    defineInvariant({ ...ok, protects: ["packages/does-not-exist"] }),
  ]);
  assert.ok(defects.some((d) => d.problem.includes("does not exist")));
});

test("every declared invariant protects paths that are really there", async () => {
  const { validateProtectedPaths } = await import("../src/index.ts");
  const repoRoot = new URL("../../..", import.meta.url).pathname;
  assert.deepEqual(await validateProtectedPaths(repoRoot), []);
});

test("a measured failure outranks a missing observer", async () => {
  // The precedence bug this test was written for: an invariant with one
  // observation false and another never built reported no_observer, hiding the
  // failure behind the gap.
  const { evaluateInvariant, STATUS_PRECEDENCE } = await import("../src/index.ts");
  const inv = defineInvariant({ ...ok, observations: ["measured", "never_built"] });
  const result = evaluateInvariant(inv, {
    observations: {
      get: (id) => (id === "measured" ? { id, value: false, method: "test" } : undefined),
    },
    falsifications: new Map(),
  });
  assert.equal(result.status, "failed");
  assert.ok(STATUS_PRECEDENCE.indexOf("failed") < STATUS_PRECEDENCE.indexOf("no_observer"));
});
