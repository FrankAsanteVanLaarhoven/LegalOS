import { test } from "node:test";
import assert from "node:assert/strict";

import {
  generateCaseTasks,
  generateCaseDeadlines,
  assembleBundleSpecification,
  generateEvidenceRequests,
} from "../src/index.ts";

test("generates intake compliance and evidence collection tasks", () => {
  const tasks = generateCaseTasks({
    caseId: "case-001",
    category: "skilled_worker",
    stage: "intake",
    missingEvidence: ["Certificate of Sponsorship", "Degree Certificate"],
  });

  assert.ok(tasks.some((t) => t.id.includes("id-verify")));
  assert.ok(tasks.some((t) => t.title.includes("Certificate of Sponsorship")));
  assert.ok(tasks.some((t) => t.title.includes("Degree Certificate")));
});

test("enforces solicitor review task with regulated sign-off on drafting stage", () => {
  const tasks = generateCaseTasks({
    caseId: "case-002",
    category: "asylum",
    stage: "review",
  });

  const reviewTask = tasks.find((t) => t.category === "review");
  assert.ok(reviewTask);
  assert.equal(reviewTask?.requiresRegulatedSignOff, true);
  assert.equal(reviewTask?.assignedRole, "solicitor");
});

test("calculates FTT-IAC 14-day statutory appeal deadline", () => {
  const now = new Date("2026-09-01T12:00:00Z");
  const deadlines = generateCaseDeadlines(
    {
      caseId: "case-003",
      category: "appeal",
      stage: "drafting",
      decisionDate: "2026-09-01T00:00:00Z",
    },
    now
  );

  const appealDeadline = deadlines.find((d) => d.id.includes("appeal-notice"));
  assert.ok(appealDeadline);
  assert.equal(appealDeadline?.dueDate, "2026-09-15");
  assert.equal(appealDeadline?.daysRemaining, 14);
});

test("assembles 5-part Practice Direction bundle specification", () => {
  const bundle = assembleBundleSpecification("case-004", "First-tier Tribunal (IAC)", "2026-10-15", [
    { evidenceId: "ev-1", title: "Timeline", section: "chronology", pageCount: 3, verified: true },
    { evidenceId: "ev-2", title: "Appellant Statement", section: "statements", pageCount: 12, verified: true },
    { evidenceId: "ev-3", title: "Refusal Letter", section: "primary_evidence", pageCount: 8, verified: true },
  ]);

  assert.equal(bundle.sections.length, 5);
  assert.equal(bundle.totalPages, 23);
  assert.equal(bundle.sections[0]?.items.length, 1);
});

test("generates targeted evidence requests with legal justifications", () => {
  const requests = generateEvidenceRequests("case-005", [
    {
      id: "REQ-01",
      item: "Medical Expert Report on Torture Trajectory",
      justification: "Satisfies Rule 35 detention audit and Istanbul Protocol threshold.",
    },
  ]);

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.recipient, "medical_expert");
  assert.ok(requests[0]?.legalJustification.includes("Istanbul Protocol"));
});
