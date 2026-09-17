import { test } from "node:test";
import assert from "node:assert/strict";

import { SourceRegistry, type LegalSource } from "@legalos/knowledge";
import { evaluateWorkflow, fact, SKILLED_WORKER_SWITCH } from "@legalos/rules";

import { verify } from "../src/verify.ts";

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

const verified = new SourceRegistry([msa]);
const unverified = new SourceRegistry([{ ...msa, verificationStatus: "unverified" }]);

function codes(text: string, registry = verified): string[] {
  return verify({ text, registry }).findings.map((f) => f.code);
}

test("an invented rule paragraph is blocked", () => {
  const verdict = verify({
    text: "Under paragraph 276ADE(1)(vi) you may apply. I could not verify this.",
    registry: verified,
  });
  assert.equal(verdict.status, "block");
  assert.equal(verdict.releasable, false);
  assert.ok(verdict.findings.some((f) => f.code === "VER-001"));
  assert.equal(
    verdict.findings.find((f) => f.code === "VER-001")?.evidence,
    "paragraph 276ADE(1)(vi)"
  );
});

test("a citation to a registered, verified source resolves", () => {
  const verdict = verify({
    text: "The Modern Slavery Act 2015 sets out the NRM. I could not verify the current guidance.",
    registry: verified,
  });
  assert.ok(!verdict.findings.some((f) => f.code === "VER-001"));
  assert.ok(verdict.resolvedCitations.includes(msa.id));
});

test("a citation to an unverified source is blocked", () => {
  const verdict = verify({
    text: "The Modern Slavery Act 2015 applies here. I could not verify this.",
    registry: unverified,
  });
  assert.ok(verdict.findings.some((f) => f.code === "VER-002"));
  assert.equal(verdict.status, "block");
});

test("outcome guarantees are blocked", () => {
  for (const phrase of [
    "Your appeal will succeed.",
    "I guarantee your visa will be granted.",
    "You will get your status.",
  ]) {
    assert.ok(codes(phrase).includes("VER-005"), phrase);
  }
});

test("telling a user they do not need a solicitor is blocked", () => {
  assert.ok(codes("You do not need a solicitor for this.").includes("VER-006"));
  assert.ok(codes("There is no need to instruct a lawyer.").includes("VER-006"));
});

test("a numeric confidence assertion is blocked", () => {
  assert.ok(codes("Confidence: 94%").includes("VER-007"));
  assert.ok(codes("There is an 80% chance of approval.").includes("VER-007"));
});

test("directing a user to file or appeal is flagged", () => {
  assert.ok(codes("You should appeal within 14 days.").includes("VER-008"));
});

test("empty output blocks and never passes silently", () => {
  const verdict = verify({ text: "   ", registry: verified });
  assert.equal(verdict.status, "block");
  assert.ok(verdict.findings.some((f) => f.code === "VER-009"));
});

test("legal claims with no citation are flagged", () => {
  assert.ok(
    codes("You are eligible for leave to remain, though I cannot confirm the details.").includes(
      "VER-003"
    )
  );
});

test("legal content with no acknowledged limits is flagged", () => {
  assert.ok(codes("The Modern Slavery Act 2015 makes you eligible.").includes("VER-010"));
});

test("asserting eligibility the rule engine does not support is blocked", () => {
  const ruleResult = evaluateWorkflow(SKILLED_WORKER_SWITCH, {
    currentPermission: fact("graduate", ["ev-evisa"]),
  });
  const verdict = verify({
    text: "You are eligible to switch. I could not verify the salary threshold.",
    registry: verified,
    ruleResult,
  });
  assert.ok(verdict.findings.some((f) => f.code === "VER-004"));
  assert.equal(verdict.status, "block");
});

test("neutral, sourced, hedged text passes", () => {
  const verdict = verify({
    text: "The Modern Slavery Act 2015 established the National Referral Mechanism. I could not verify how current Home Office guidance applies to your circumstances — please check with an adviser.",
    registry: verified,
  });
  assert.deepEqual(verdict.findings, []);
  assert.equal(verdict.status, "pass");
  assert.equal(verdict.releasable, true);
});

test("verification is fail-closed: any block finding makes it unreleasable", () => {
  const verdict = verify({
    text: "The Modern Slavery Act 2015 applies and your appeal will succeed.",
    registry: verified,
  });
  assert.equal(verdict.releasable, false);
});
