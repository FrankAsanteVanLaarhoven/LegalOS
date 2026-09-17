import { test } from "node:test";
import assert from "node:assert/strict";

import {
  assess,
  assessCandour,
  detectConflicts,
  inspectConfidentiality,
  redact,
  type Matter,
} from "../src/index.ts";

test("direct identifiers block external transmission", () => {
  const report = inspectConfidentiality(
    "Client reference AB1234567, contact sam@example.com, postcode NE1 7RU."
  );
  assert.equal(report.safeToSendExternally, false);
  assert.ok(report.identifiers.some((i) => i.label === "email address"));
  assert.ok(report.identifiers.some((i) => i.label === "UK postcode"));
  assert.equal(
    report.breaches.every((b) => b.code === "FID-CONFIDENTIALITY"),
    true
  );
});

test("special-category terms are surfaced but are not themselves a breach", () => {
  const report = inspectConfidentiality("The client has a trafficking claim and PTSD indicators.");
  assert.ok(report.specialCategoryTerms.includes("trafficking"));
  assert.ok(report.specialCategoryTerms.includes("ptsd"));
  assert.equal(report.safeToSendExternally, true);
  assert.deepEqual(report.breaches, []);
});

test("redaction removes identifiers while preserving the surrounding text", () => {
  const redacted = redact("Email sam@example.com about ref AB1234567.");
  assert.ok(!redacted.includes("sam@example.com"));
  assert.ok(!redacted.includes("AB1234567"));
  assert.ok(redacted.includes("[redacted: email address]"));
  assert.ok(redacted.startsWith("Email "));
  assert.equal(inspectConfidentiality(redacted).safeToSendExternally, true);
});

test("neutral text is safe to send", () => {
  const report = inspectConfidentiality("What are the general requirements for this route?");
  assert.equal(report.safeToSendExternally, true);
});

const existing: readonly Matter[] = [
  {
    id: "m-1",
    clientId: "client-a",
    adverseParties: ["client-b"],
    assignedTo: ["adviser-1"],
  },
];

test("acting for a client who is an adverse party elsewhere is a conflict", () => {
  const breaches = detectConflicts(
    { id: "m-2", clientId: "client-b", adverseParties: [], assignedTo: ["adviser-1"] },
    existing
  );
  assert.equal(breaches.length, 1);
  assert.equal(breaches[0]?.code, "FID-CONFLICT");
});

test("no shared adviser means no conflict", () => {
  const breaches = detectConflicts(
    { id: "m-2", clientId: "client-b", adverseParties: [], assignedTo: ["adviser-9"] },
    existing
  );
  assert.deepEqual(breaches, []);
});

test("a matter never conflicts with itself", () => {
  assert.deepEqual(detectConflicts(existing[0]!, existing), []);
});

test("an unevidenced assertion stated as fact breaches candour", () => {
  const report = assessCandour([
    { text: "The client entered the UK on 4 March 2021.", evidenceIds: [] },
  ]);
  assert.equal(report.breaches.length, 1);
  assert.equal(report.breaches[0]?.code, "FID-CANDOUR");
  assert.deepEqual(report.facts, []);
});

test("the same assertion is acceptable when hedged or evidenced", () => {
  const hedged = assessCandour([
    { text: "The client states she entered the UK on 4 March 2021.", evidenceIds: [] },
  ]);
  assert.deepEqual(hedged.breaches, []);
  assert.equal(hedged.assumptions.length, 1);

  const evidenced = assessCandour([
    { text: "The client entered the UK on 4 March 2021.", evidenceIds: ["ev-passport"] },
  ]);
  assert.deepEqual(evidenced.breaches, []);
  assert.equal(evidenced.facts.length, 1);
});

test("the combined assessment aggregates every duty", () => {
  const result = assess({
    text: "Reference AB1234567.",
    matter: {
      candidate: { id: "m-2", clientId: "client-b", adverseParties: [], assignedTo: ["adviser-1"] },
      existing,
    },
    assertions: [{ text: "She is eligible.", evidenceIds: [] }],
  });
  assert.equal(result.clear, false);
  const codes = new Set(result.breaches.map((b) => b.code));
  assert.ok(codes.has("FID-CONFIDENTIALITY"));
  assert.ok(codes.has("FID-CONFLICT"));
  assert.ok(codes.has("FID-CANDOUR"));
});

test("an empty assessment is clear", () => {
  assert.equal(assess({}).clear, true);
});
