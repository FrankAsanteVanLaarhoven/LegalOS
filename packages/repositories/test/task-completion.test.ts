import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ACCEPTING_DECISIONS,
  mayComplete,
  MUTABLE_FIELDS,
  validateTaskCreate,
  type CompletionInput,
} from "../src/index.ts";

/**
 * The completion rule, tested by taking a task that may be completed and
 * blocking it one condition at a time.
 *
 * Completion is the only transition on a task that claims something was done.
 * Every clause below is a way that claim could be made without being true.
 */

const ready: CompletionInput = {
  status: "in_progress",
  requiresProfessional: false,
  unresolvedDependencies: [],
  reviewDecision: null,
  reviewRequestId: null,
};

const check = (over: Partial<CompletionInput> = {}) => mayComplete({ ...ready, ...over });

test("a task with nothing outstanding may be completed", () => {
  const result = check();
  assert.equal(result.permitted, true);
  assert.equal(result.because, null);
});

test("an unfinished predecessor blocks completion", () => {
  // The harm: a bundle is marked filed while the document it depends on has
  // not been obtained, and the list stops showing anyone that it is missing.
  const result = check({ unresolvedDependencies: ["task-a", "task-b"] });
  assert.equal(result.permitted, false);
  assert.match(result.because!, /2 task\(s\) this one depends on are not finished/);
});

test("a task requiring a professional cannot be completed with no review at all", () => {
  // The harm: a task flagged as needing a solicitor is closed by whoever had
  // capacity, and nothing anywhere records that the requirement went unmet.
  const result = check({ requiresProfessional: true });
  assert.equal(result.permitted, false);
  assert.match(result.because!, /no review has been requested/);
});

test("a review that exists but has not been decided is not an approval", () => {
  // The distinction that matters: a request is not a decision. Treating the
  // existence of one as approval is the failure the review repository is
  // arranged to prevent, and it must not be reintroduced here.
  const result = check({ requiresProfessional: true, reviewRequestId: "r1", reviewDecision: null });
  assert.equal(result.permitted, false);
  assert.match(result.because!, /has not been decided/);
});

test("a refused review does not permit completion", () => {
  const result = check({
    requiresProfessional: true,
    reviewRequestId: "r1",
    reviewDecision: "refused",
  });
  assert.equal(result.permitted, false);
  assert.match(result.because!, /was refused, which is not an acceptance/);
});

test("a referred-onward review is not an acceptance either", () => {
  // It means somebody else must look, which is the opposite of acceptance.
  const result = check({
    requiresProfessional: true,
    reviewRequestId: "r1",
    reviewDecision: "referred_onward",
  });
  assert.equal(result.permitted, false);
});

test("an approval, with or without amendments, permits completion", () => {
  for (const decision of ACCEPTING_DECISIONS) {
    const result = check({ requiresProfessional: true, reviewRequestId: "r1", reviewDecision: decision });
    assert.equal(result.permitted, true, `${decision} should permit completion`);
  }
});

test("a completed task cannot be completed again", () => {
  const result = check({ status: "completed" });
  assert.equal(result.permitted, false);
  assert.match(result.because!, /already completed/);
});

test("a cancelled task cannot be completed", () => {
  const result = check({ status: "cancelled" });
  assert.equal(result.permitted, false);
  assert.match(result.because!, /was cancelled/);
});

test("a blocked task may still be completed once its blockers clear", () => {
  // `blocked` describes why nobody is working on it, not a bar on finishing.
  assert.equal(check({ status: "blocked" }).permitted, true);
  assert.equal(check({ status: "awaiting_review" }).permitted, true);
});

test("every combination produces a decision and never throws", () => {
  for (const status of ["open", "in_progress", "blocked", "awaiting_review", "completed", "cancelled"] as const) {
    for (const requiresProfessional of [true, false]) {
      const result = mayComplete({ ...ready, status, requiresProfessional });
      assert.equal(typeof result.permitted, "boolean");
      assert.equal(result.permitted, result.because === null);
    }
  }
});

test("no field the rule returns is a number", () => {
  for (const v of Object.values(check())) assert.notEqual(typeof v, "number");
});

/* -------------------------------------------------------------- */

test("the mutable-field list excludes everything identity-bearing", () => {
  // A caller able to move a task between cases or rewrite its author could
  // relocate work into a tenancy it never belonged to.
  for (const forbidden of [
    "organisationId",
    "caseId",
    "createdBy",
    "createdAt",
    "completedAt",
    "cancelledAt",
    "version",
    "status",
    "assignedTo",
  ]) {
    assert.ok(
      !MUTABLE_FIELDS.includes(forbidden as never),
      `${forbidden} is mutable through updateTask`
    );
  }
});

/* -------------------------------------------------------------- */

const create = (over: Record<string, unknown> = {}) =>
  validateTaskCreate({
    caseId: "c",
    taskType: "evidence",
    title: "Obtain the medical report",
    ...over,
  } as Parameters<typeof validateTaskCreate>[0]);

test("a task a model proposed must cite the execution that proposed it", () => {
  // Without it, a caseworker works through a list believing a solicitor set
  // the priorities when a model did.
  assert.match(create({ source: "agent_proposed" })!, /cite the execution/);
  assert.equal(create({ source: "agent_proposed", proposedByExecution: "e1" }), null);
});

test("a task must have a title and a type", () => {
  assert.match(create({ title: "   " })!, /must have a title/);
  assert.match(create({ taskType: "" })!, /what kind of work/);
});

test("a title is a label, not a description", () => {
  assert.match(create({ title: "x".repeat(501) })!, /not a description/);
});

test("an ordinary task validates", () => {
  assert.equal(create(), null);
});
