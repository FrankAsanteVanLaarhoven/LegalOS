import { test } from "node:test";
import assert from "node:assert/strict";

import { reconstructChronologyFromEvidence } from "../src/timeline.ts";

test("extracts chronologically ordered events from evidence text", () => {
  const result = reconstructChronologyFromEvidence("case-chronology-001", [
    {
      documentId: "doc-refusal",
      text: "On 2024-06-15 the Secretary of State issued a refusal decision under paragraph 339F.",
      title: "Home Office Refusal Letter",
    },
    {
      documentId: "doc-entry",
      text: "Valid visa issued on 2022-09-01 for student route entry clearance.",
      title: "Entry Clearance Vignette",
    },
    {
      documentId: "doc-appeal",
      text: "Notice of appeal lodged on 2024-06-25 with First-tier Tribunal.",
      title: "Tribunal Notice of Appeal",
    },
  ]);

  assert.equal(result.events.length, 3);
  assert.equal(result.events[0]?.date, "2022-09-01");
  assert.equal(result.events[0]?.eventType, "entry_clearance");
  assert.equal(result.events[1]?.date, "2024-06-15");
  assert.equal(result.events[1]?.eventType, "refusal_decision");
  assert.equal(result.events[2]?.date, "2024-06-25");
  assert.equal(result.events[2]?.eventType, "appeal_lodged");
});
