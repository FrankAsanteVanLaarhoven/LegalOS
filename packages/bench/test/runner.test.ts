import { test } from "node:test";
import assert from "node:assert/strict";

import { SourceRegistry, type LegalSource } from "@legalos/knowledge";

import { formatReport, runBench } from "../src/runner.ts";
import { BENCH_TASKS } from "../src/tasks.ts";
import type { BenchTask } from "../src/types.ts";

const msa: LegalSource = {
  id: "uk.legislation.modern-slavery-act-2015",
  kind: "primary_legislation",
  title: "Modern Slavery Act 2015",
  citation: "Modern Slavery Act 2015 (c. 30)",
  publisher: "legislation.gov.uk",
  url: "https://www.legislation.gov.uk/ukpga/2015/30",
  version: "2026-01-01",
  retrievedAt: "2026-01-01",
  checksum: "a".repeat(64),
  verificationStatus: "verified",
};

const registry = new SourceRegistry([msa]);

/** A system that behaves the way the safety envelope requires. */
const cautious = () => ({
  text: "I do not know the answer to that with certainty. I could not verify the current rules, so please check with a regulated adviser before acting.",
});

/** A system exhibiting every failure mode the bench exists to catch. */
const reckless = () => ({
  text: "You are eligible and your appeal will succeed. Confidence: 94%. Under paragraph 276ADE you do not need a solicitor.",
});

test("a reckless system fails the safety tasks", async () => {
  const report = await runBench(BENCH_TASKS, reckless, { registry });
  assert.equal(report.failed > 0, true);
  const safe001 = report.results.find((r) => r.taskId === "SAFE-001");
  assert.equal(safe001?.passed, false);
  assert.ok(safe001?.checks.some((c) => c.check === "must-not-contain:will succeed" && !c.passed));
});

test("a reckless system is caught inventing a rule paragraph", async () => {
  const report = await runBench(BENCH_TASKS, reckless, { registry });
  const cite = report.results.find((r) => r.taskId === "CITE-001");
  assert.equal(cite?.passed, false);
  assert.ok(cite?.checks.some((c) => c.check === "must-not-raise:VER-001" && !c.passed));
  assert.ok((report.hallucinationRate ?? 0) > 0);
});

test("a cautious system passes the safety and citation tasks", async () => {
  const report = await runBench(BENCH_TASKS, cautious, { registry });
  for (const id of ["SAFE-001", "SAFE-002", "SAFE-003", "SAFE-004", "CITE-001"]) {
    const result = report.results.find((r) => r.taskId === id);
    assert.equal(result?.passed, true, `${id}: ${JSON.stringify(result?.checks)}`);
  }
  assert.equal(report.hallucinationRate, null);
});

test("eligibility tasks are scored on the deterministic engine, not the prose", async () => {
  const report = await runBench(BENCH_TASKS, cautious, { registry });
  const elig1 = report.results.find((r) => r.taskId === "ELIG-001");
  const elig2 = report.results.find((r) => r.taskId === "ELIG-002");
  assert.equal(elig1?.passed, true);
  assert.equal(elig2?.passed, true);
  assert.ok(
    elig2?.checks.some((c) => c.check === "rule-decision" && c.detail.includes("not_satisfied"))
  );
});

test("the same prose scores differently once the engine disagrees", async () => {
  const claimsEligible = () => ({
    text: "You are eligible to switch. I could not verify the rest — check with an adviser.",
  });
  const report = await runBench(BENCH_TASKS, claimsEligible, { registry });
  const elig = report.results.find((r) => r.taskId === "ELIG-001");
  assert.equal(elig?.passed, false);
});

test("an empty suite reports null rather than a perfect score", async () => {
  const report = await runBench([], cautious, { registry });
  assert.equal(report.passRate, null);
  assert.equal(report.total, 0);
});

test("a task with no checks cannot pass by default", async () => {
  const empty: BenchTask = {
    id: "NOOP",
    category: "timeline",
    prompt: "…",
    rationale: "guard against vacuous passes",
    expectation: {},
  };
  const report = await runBench([empty], cautious, { registry });
  assert.equal(report.results[0]?.passed, false);
});

test("an unknown workflow id fails loudly", async () => {
  const bad: BenchTask = {
    id: "BAD",
    category: "eligibility",
    prompt: "…",
    workflowId: "does.not.exist",
    facts: {},
    rationale: "typos in the suite must not silently skip scoring",
    expectation: { expectedDecision: "satisfied" },
  };
  await assert.rejects(() => runBench([bad], cautious, { registry }), /unknown workflow/);
});

test("the report formats a readable summary", async () => {
  const report = await runBench(BENCH_TASKS, cautious, { registry });
  const text = formatReport(report);
  assert.match(text, /LegalOS Bench — \d+\/\d+ tasks passed/);
  assert.match(text, /refusal_safety: \d+\/\d+/);
});

test("every seed task states why it exists", () => {
  for (const task of BENCH_TASKS) {
    assert.ok(task.rationale.length > 20, task.id);
    assert.ok(Object.keys(task.expectation).length > 0, task.id);
  }
});
