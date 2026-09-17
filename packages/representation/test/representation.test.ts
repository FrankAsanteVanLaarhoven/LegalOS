import { test } from "node:test";
import assert from "node:assert/strict";

import { assessReadiness, missingEvidence, type CaseFacts } from "../src/readiness.ts";
import { isRegulatedDocument, reviewDraft, type Draft } from "../src/drafting.ts";
import { PRACTICE_TOPICS, scoreDemeanour, summariseSession } from "../src/practice.ts";

const FACTS: CaseFacts = {
  evidenceRequired: ["Passport", "GP letter", "Medico-legal report"],
  evidenceReceived: ["Passport", "GP letter"],
  evidenceAwaited: [{ item: "Medico-legal report", from: "Dr Chen", chasedAt: "2026-07-20" }],
  witnessStatementState: "in_progress",
  deadlines: [
    { label: "Appeal lodged", dueBy: "2026-06-01", met: true },
    { label: "Bundle filed", dueBy: "2026-09-01", met: false },
  ],
  practiceSessionsCompleted: 4,
  professionalReviewState: "not_started",
  asOf: "2026-07-26",
};

/* ---------------- readiness describes, never predicts ---------------- */

test("readiness emits no score, percentage or likelihood anywhere", () => {
  const report = assessReadiness(FACTS);
  const serialised = JSON.stringify(report);
  assert.equal(/\d+(\.\d+)?\s*%/.test(serialised), false, serialised);
  assert.equal(Object.hasOwn(report, "score"), false);
  assert.equal(Object.hasOwn(report, "likelihood"), false);
  assert.equal(Object.hasOwn(report, "strength"), false);
});

test("the summary says what it is describing", () => {
  assert.match(assessReadiness(FACTS).summary, /describes the file, not the outcome/);
});

test("every item states the basis a reviewer can check", () => {
  for (const item of assessReadiness(FACTS).items) {
    assert.ok(item.basis.length > 5, item.label);
  }
});

test("outstanding evidence is named, not counted into a rating", () => {
  assert.deepEqual(missingEvidence(FACTS), ["Medico-legal report"]);
  const report = assessReadiness(FACTS);
  const awaited = report.items.find((i) => i.label === "Medico-legal report");
  assert.equal(awaited?.state, "awaiting_third_party");
  assert.equal(awaited?.waitingOn, "Dr Chen");
});

test("a passed deadline is overdue and leads the summary", () => {
  const report = assessReadiness({
    ...FACTS,
    deadlines: [{ label: "Bundle filed", dueBy: "2026-07-01", met: false }],
  });
  assert.equal(report.overdue.length, 1);
  assert.match(report.summary, /Speak to an adviser now/);
});

test("a met deadline is complete regardless of date", () => {
  const report = assessReadiness({
    ...FACTS,
    deadlines: [{ label: "Appeal lodged", dueBy: "2020-01-01", met: true }],
  });
  assert.equal(report.overdue.length, 0);
});

test("practice sessions are reported as a count, not an assessment", () => {
  const item = assessReadiness(FACTS).items.find((i) => i.area === "hearing_preparation");
  assert.equal(item?.basis, "4 completed");
  assert.equal(item?.state, "in_progress");
});

/* ---------------- drafting requires backing ---------------- */

const witnessStatement: Draft = {
  id: "d1",
  documentType: "witness_statement",
  audience: "tribunal",
  assertions: [
    {
      id: "a1",
      kind: "fact",
      text: "The applicant entered the UK on 10 September 2020.",
      backing: [{ evidenceId: "doc-visa-entry", quote: "Entry stamp dated 10 September 2020" }],
    },
  ],
};

test("a fully backed draft is renderable", () => {
  const review = reviewDraft(witnessStatement);
  assert.equal(review.renderable, true);
  assert.deepEqual(review.findings, []);
});

test("professional review is required even for a clean draft", () => {
  assert.equal(reviewDraft(witnessStatement).humanReviewRequired, true);
});

test("an unbacked fact blocks the whole draft", () => {
  const review = reviewDraft({
    ...witnessStatement,
    assertions: [
      ...witnessStatement.assertions,
      { id: "a2", kind: "fact", text: "The applicant was detained for six weeks.", backing: [] },
    ],
  });
  assert.equal(review.renderable, false);
  assert.ok(review.findings.some((f) => f.code === "UNBACKED_FACT"));
});

test("a legal proposition without a registered source blocks the draft", () => {
  const review = reviewDraft({
    ...witnessStatement,
    assertions: [
      {
        id: "a1",
        kind: "legal_proposition",
        text: "Paragraph 276ADE applies.",
        backing: [{ quote: "as I recall" }],
      },
    ],
  });
  assert.equal(review.renderable, false);
  assert.ok(review.findings.some((f) => f.code === "UNSOURCED_LAW"));
});

test("evidence backing does not satisfy a legal proposition", () => {
  const review = reviewDraft({
    ...witnessStatement,
    assertions: [
      {
        id: "a1",
        kind: "legal_proposition",
        text: "The Act applies.",
        backing: [{ evidenceId: "doc-gp", quote: "GP letter" }],
      },
    ],
  });
  assert.ok(review.findings.some((f) => f.code === "UNSOURCED_LAW"));
});

test("a submission resting on nothing is blocked", () => {
  const review = reviewDraft({
    ...witnessStatement,
    assertions: [{ id: "a1", kind: "submission", text: "The refusal was unlawful.", backing: [] }],
  });
  assert.ok(review.findings.some((f) => f.code === "SUBMISSION_WITHOUT_BASIS"));
});

test("regulated document types are flagged regardless of how good the draft is", () => {
  for (const documentType of ["appeal_grounds", "skeleton_argument", "n244"]) {
    const review = reviewDraft({ ...witnessStatement, documentType });
    assert.equal(review.renderable, false, documentType);
    assert.ok(
      review.findings.some((f) => f.code === "RESERVED_ACTIVITY"),
      documentType
    );
  }
  assert.equal(isRegulatedDocument("witness_statement"), false);
});

/* ---------------- practice covers procedure, never demeanour ---------------- */

test("demeanour scoring throws, with the reason", () => {
  assert.throws(() => scoreDemeanour(), /Demeanour is not scored/);
  assert.throws(() => scoreDemeanour(), /appear rehearsed/);
});

test("a session summary reports procedure and nothing about the person", () => {
  const summary = summariseSession({
    id: "s1",
    startedAt: "2026-07-26T10:00:00.000Z",
    endedAt: "2026-07-26T10:20:00.000Z",
    questions: [
      { id: "q1", role: "judge", text: "…", purpose: "opening" },
      { id: "q2", role: "presenting_officer", text: "…", purpose: "cross-examination" },
    ],
    questionsAnswered: 1,
    interpreterUsed: false,
  });

  assert.equal(summary.durationSeconds, 1200);
  assert.equal(summary.questionsAsked, 2);

  const serialised = JSON.stringify(summary).toLowerCase();
  for (const forbidden of ["eye contact", "confidence", "body language", "credibility", "score"]) {
    assert.equal(serialised.includes(forbidden), false, forbidden);
  }
  assert.match(summary.disclaimer, /Answer truthfully/);
});

test("every practice topic is procedural, not about the content of evidence", () => {
  for (const topic of PRACTICE_TOPICS) {
    for (const forbidden of ["say that", "answer that", "explain your", "convince"]) {
      assert.equal(topic.toLowerCase().includes(forbidden), false, topic);
    }
  }
  assert.ok(PRACTICE_TOPICS.some((t) => t.includes("do not remember")));
});
