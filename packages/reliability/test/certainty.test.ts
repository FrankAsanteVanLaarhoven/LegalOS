import { test } from "node:test";
import assert from "node:assert/strict";

import { SourceRegistry, type LegalSource } from "@legalos/knowledge";
import { evaluateWorkflow, fact, SKILLED_WORKER_SWITCH } from "@legalos/rules";
import { verify } from "@legalos/verification";

import { describeCertainty } from "../src/certainty.ts";
import { evidenceCompleteness } from "../src/metrics.ts";

const source: LegalSource = {
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

const registry = new SourceRegistry([source]);

test("a blocked verdict is never releasable and never reassuring", () => {
  const verdict = verify({ text: "Your appeal will succeed.", registry });
  const disclosure = describeCertainty({ verdict });
  assert.equal(disclosure.posture, "not_releasable");
  assert.equal(disclosure.humanReviewRequired, true);
  assert.match(disclosure.statement, /not released/);
});

test("the disclosure carries no numeric confidence anywhere", () => {
  const verdict = verify({
    text: "The Modern Slavery Act 2015 established the NRM. I could not verify current guidance.",
    registry,
  });
  const disclosure = describeCertainty({ verdict });
  const serialised = JSON.stringify(disclosure);
  assert.equal(/\d+(\.\d+)?\s*%/.test(serialised), false, serialised);
  assert.equal(Object.hasOwn(disclosure, "confidence"), false);
  assert.equal(Object.hasOwn(disclosure, "score"), false);
});

test("clean sourced output is informational only and needs no escalation", () => {
  const verdict = verify({
    text: "The Modern Slavery Act 2015 established the National Referral Mechanism. I could not verify how it applies to you — please check with an adviser.",
    registry,
  });
  const disclosure = describeCertainty({ verdict });
  assert.equal(disclosure.posture, "informational_only");
  assert.equal(disclosure.humanReviewRequired, false);
  assert.deepEqual(disclosure.sourcesResolved, [source.id]);
});

test("an unreleasable rule result forces review even when the text is clean", () => {
  const ruleResult = evaluateWorkflow(SKILLED_WORKER_SWITCH, {
    currentPermission: fact("graduate", ["ev-evisa"]),
  });
  const verdict = verify({
    text: "The Modern Slavery Act 2015 established the National Referral Mechanism. I could not verify the rest — check with an adviser.",
    registry,
  });
  const disclosure = describeCertainty({ verdict, ruleResult });
  assert.equal(disclosure.posture, "review_required");
  assert.ok(disclosure.wouldChangeTheAnswer.length > 0);
  assert.ok(disclosure.wouldChangeTheAnswer.some((item) => item.includes("SW-SALARY-THRESHOLD")));
});

test("missing evidence from the engine and the register are merged and deduplicated", () => {
  const ruleResult = evaluateWorkflow(SKILLED_WORKER_SWITCH, {});
  const completeness = evidenceCompleteness(
    ["Passport", "Certificate of Sponsorship"],
    [{ id: "e1", satisfies: "Passport", received: true }]
  );
  const verdict = verify({ text: "General information only. I could not verify this.", registry });
  const disclosure = describeCertainty({ verdict, ruleResult, completeness });
  assert.ok(disclosure.missingEvidence.includes("Certificate of Sponsorship"));
  assert.equal(disclosure.missingEvidence.length, new Set(disclosure.missingEvidence).size);
});
