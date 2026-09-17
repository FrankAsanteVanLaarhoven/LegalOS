import { test } from "node:test";
import assert from "node:assert/strict";

import { SourceRegistry, type LegalSource } from "@legalos/knowledge";
import { evaluateWorkflow, fact, SKILLED_WORKER_SWITCH } from "@legalos/rules";
import { verify } from "@legalos/verification";

import { decide } from "../src/index.ts";

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

const CLEAN =
  "The Modern Slavery Act 2015 established the National Referral Mechanism. I could not verify how current guidance applies to you — please check with a regulated adviser.";

function decideOn(text: string, extra: Record<string, unknown> = {}) {
  return decide({ verdict: verify({ text, registry }), ...extra });
}

test("clean, sourced, hedged text is released", () => {
  const decision = decideOn(CLEAN);
  assert.equal(decision.disposition, "release");
  assert.equal(decision.releasable, true);
  assert.equal(decision.displayable, true);
  assert.equal(decision.humanReviewRequired, false);
  assert.deepEqual(decision.reasons, []);
});

test("harmful content is withheld, not caveated", () => {
  for (const text of [
    "Your appeal will succeed.",
    "You do not need a solicitor.",
    "Confidence: 94%.",
  ]) {
    const decision = decideOn(text);
    assert.equal(decision.disposition, "withhold", text);
    assert.equal(decision.displayable, false, text);
    assert.equal(decision.humanReviewRequired, true, text);
  }
});

test("unresolvable citations are shown with caveats, not withheld", () => {
  const decision = decideOn("Under paragraph 276ADE you may qualify for leave to remain.");
  assert.equal(decision.disposition, "release_with_caveats");
  assert.equal(decision.displayable, true, "unverified is not the same as dangerous");
  assert.equal(decision.releasable, false);
  assert.ok(decision.reasons.some((r) => r.code === "POL-UNVERIFIED-SOURCING"));
});

test("a reserved-activity request escalates even when the text is clean", () => {
  const decision = decideOn(CLEAN, { requestedActivity: "file_application" });
  assert.equal(decision.disposition, "escalate");
  assert.equal(decision.displayable, false);
  assert.equal(decision.humanReviewRequired, true);
  assert.ok(decision.reasons.some((r) => r.code === "POL-RESERVED-ACTIVITY"));
});

test("a non-reserved activity does not escalate", () => {
  assert.equal(
    decideOn(CLEAN, { requestedActivity: "summarise_documents" }).disposition,
    "release"
  );
});

test("an out-of-jurisdiction question escalates", () => {
  const decision = decideOn(CLEAN, { jurisdiction: "Scotland" });
  assert.equal(decision.disposition, "escalate");
  assert.ok(decision.reasons.some((r) => r.code === "POL-OUT-OF-JURISDICTION"));
});

test("supported jurisdictions are accepted in any casing or spacing", () => {
  for (const j of ["England and Wales", "england-and-wales", "  UK  "]) {
    assert.equal(decideOn(CLEAN, { jurisdiction: j }).disposition, "release", j);
  }
});

test("harmful content outranks a reserved-activity escalation", () => {
  // The reviewer must not receive a payload containing an outcome guarantee.
  const decision = decideOn("Your appeal will succeed.", {
    requestedActivity: "file_application",
  });
  assert.equal(decision.disposition, "withhold");
  assert.equal(decision.displayable, false);
});

test("disagreement with the rule engine is withheld", () => {
  const ruleResult = evaluateWorkflow(SKILLED_WORKER_SWITCH, {
    currentPermission: fact("graduate", ["ev-evisa"]),
  });
  const decision = decide({
    verdict: verify({
      text: "You are eligible to switch. I could not verify the salary threshold.",
      registry,
      ruleResult,
    }),
    ruleResult,
  });
  assert.equal(decision.disposition, "withhold");
  assert.ok(decision.reasons.some((r) => r.code === "POL-ENGINE-DISAGREEMENT"));
});

test("an unreleasable rule result caveats clean text rather than withholding it", () => {
  const ruleResult = evaluateWorkflow(SKILLED_WORKER_SWITCH, {});
  const decision = decide({ verdict: verify({ text: CLEAN, registry }), ruleResult });
  assert.equal(decision.disposition, "release_with_caveats");
  assert.equal(decision.displayable, true);
  assert.ok(decision.reasons.some((r) => r.code === "POL-NO-CONCLUSION-AVAILABLE"));
});

test("every reason carries an explanation a reviewer can act on", () => {
  const decision = decideOn("Your appeal will succeed under paragraph 276ADE.", {
    jurisdiction: "Scotland",
  });
  assert.ok(decision.reasons.length > 1);
  for (const reason of decision.reasons) {
    assert.ok(reason.detail.length > 20, reason.code);
  }
});

test("release is the only disposition that sets releasable", () => {
  const dispositions = [
    decideOn(CLEAN),
    decideOn("Your appeal will succeed."),
    decideOn("Under paragraph 276ADE you qualify."),
    decideOn(CLEAN, { requestedActivity: "lodge_appeal" }),
  ];
  for (const decision of dispositions) {
    assert.equal(decision.releasable, decision.disposition === "release", decision.disposition);
  }
});
