import { test } from "node:test";
import assert from "node:assert/strict";

import { SourceRegistry, type LegalSource } from "@legalos/knowledge";

import { evaluateWorkflow, fact } from "../src/engine.ts";
import type { LegalWorkflow } from "../src/types.ts";
import { SKILLED_WORKER_SWITCH } from "../src/workflows/skilled-worker-switch.ts";

const verifiedSource: LegalSource = {
  id: "test.rule",
  kind: "immigration_rule",
  title: "Test rule",
  citation: "Test rule",
  publisher: "test",
  url: "https://example.invalid/rule",
  version: "2026-01-01",
  retrievedAt: "2026-01-01",
  checksum: "0".repeat(64),
  verificationStatus: "verified",
};

const registry = new SourceRegistry([verifiedSource]);

const sourcedWorkflow: LegalWorkflow = {
  id: "test.workflow",
  title: "Test",
  description: "Fully sourced workflow used to exercise the release gate.",
  combine: "all",
  requirements: [
    {
      id: "R1",
      sourceId: "test.rule",
      locator: "para 1",
      description: "Age is at least 18",
      requires: ["age"],
      evidenceRequired: ["Passport"],
      evaluate: (facts) => ((facts.number("age") ?? 0) >= 18 ? "satisfied" : "not_satisfied"),
    },
  ],
};

test("missing facts yield insufficient_evidence, not a refusal", () => {
  const result = evaluateWorkflow(sourcedWorkflow, {}, { registry });
  assert.equal(result.decision, "insufficient_evidence");
  assert.deepEqual(result.missingFacts, ["age"]);
  assert.deepEqual(result.missingEvidence, ["Passport"]);
});

test("a fully evidenced, fully sourced pass is releasable", () => {
  const result = evaluateWorkflow(
    sourcedWorkflow,
    { age: fact(21, ["ev-passport"]) },
    { registry }
  );
  assert.equal(result.decision, "satisfied");
  assert.equal(result.releasable, true);
  assert.deepEqual(result.blockers, []);
});

test("an asserted fact with no evidence blocks release", () => {
  const result = evaluateWorkflow(sourcedWorkflow, { age: fact(21) }, { registry });
  assert.equal(result.decision, "satisfied");
  assert.equal(result.releasable, false);
  assert.ok(result.blockers.includes("UNEVIDENCED_FACTS"));
});

test("omitting the registry forces the result to be unreleasable", () => {
  const result = evaluateWorkflow(sourcedWorkflow, { age: fact(21, ["ev-passport"]) });
  assert.equal(result.releasable, false);
  assert.ok(result.blockers.includes("SOURCE_UNUSABLE"));
});

test("a missing paragraph locator blocks release even when everything else passes", () => {
  const noLocator: LegalWorkflow = {
    ...sourcedWorkflow,
    requirements: [{ ...sourcedWorkflow.requirements[0]!, locator: null }],
  };
  const result = evaluateWorkflow(noLocator, { age: fact(21, ["ev-passport"]) }, { registry });
  assert.equal(result.releasable, false);
  assert.ok(result.blockers.includes("LOCATOR_MISSING"));
});

test("the shipped skilled-worker workflow can never release today without verified sources", () => {
  // Sources in strict mode are unverified, so even a complete, fully evidenced
  // fact sheet must not produce a legal conclusion until sources are verified.
  const facts = {
    currentPermission: fact("graduate", ["ev-evisa"]),
    permissionExpiryDate: fact("2027-01-01", ["ev-evisa"]),
    applicationDate: fact("2026-08-01", ["ev-application"]),
    sponsorLicensed: fact(true, ["ev-cos"]),
    certificateOfSponsorshipRef: fact("C2G1234567", ["ev-cos"]),
    occupationCode: fact("2136", ["ev-cos"]),
    eligibleOccupationCodes: fact("2136,2137", ["ev-occupation-table"]),
    annualSalary: fact(42000, ["ev-contract"]),
    applicableSalaryThreshold: fact(38700, ["ev-threshold-source"]),
    englishRequirementMet: fact(true, ["ev-degree"]),
  };
  const result = evaluateWorkflow(SKILLED_WORKER_SWITCH, facts, {
    registry: new SourceRegistry([], { strict: true }),
  });
  assert.equal(result.decision, "satisfied");
  assert.equal(result.releasable, false);
  assert.ok(result.blockers.includes("SOURCE_UNUSABLE"));
});

test("an expired permission fails rather than reporting ignorance", () => {
  const result = evaluateWorkflow(SKILLED_WORKER_SWITCH, {
    currentPermission: fact("graduate", ["ev-evisa"]),
    permissionExpiryDate: fact("2026-01-01", ["ev-evisa"]),
    applicationDate: fact("2026-08-01", ["ev-application"]),
  });
  const expiry = result.outcomes.find((o) => o.requirementId === "SW-PERMISSION-UNEXPIRED");
  assert.equal(expiry?.result, "not_satisfied");
  assert.equal(result.decision, "not_satisfied");
});

test("no salary threshold is hardcoded — absent threshold means insufficient evidence", () => {
  const result = evaluateWorkflow(SKILLED_WORKER_SWITCH, {
    annualSalary: fact(42000, ["ev-contract"]),
  });
  const salary = result.outcomes.find((o) => o.requirementId === "SW-SALARY-THRESHOLD");
  assert.equal(salary?.result, "insufficient_evidence");
  assert.ok(salary?.missingFacts.includes("applicableSalaryThreshold"));
});

test("unparseable dates report ignorance rather than guessing", () => {
  const result = evaluateWorkflow(SKILLED_WORKER_SWITCH, {
    permissionExpiryDate: fact("not-a-date", ["ev-evisa"]),
    applicationDate: fact("2026-08-01", ["ev-application"]),
  });
  const expiry = result.outcomes.find((o) => o.requirementId === "SW-PERMISSION-UNEXPIRED");
  assert.equal(expiry?.result, "insufficient_evidence");
});
