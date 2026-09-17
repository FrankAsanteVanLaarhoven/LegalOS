import { test } from "node:test";
import assert from "node:assert/strict";

import {
  brierScore,
  citationPrecision,
  citationRecall,
  evidenceCompleteness,
  expectedCalibrationError,
  hallucinationRate,
  reviewerAgreement,
} from "../src/metrics.ts";

test("citation precision counts supported over emitted", () => {
  const result = citationPrecision({
    emitted: ["a", "b", "c", "d"],
    supported: ["a", "b", "c"],
    required: [],
  });
  assert.equal(result.value, 0.75);
  assert.equal(result.numerator, 3);
  assert.equal(result.denominator, 4);
});

test("metrics return null rather than a misleading zero when undefined", () => {
  assert.equal(citationPrecision({ emitted: [], supported: [], required: [] }).value, null);
  assert.equal(citationRecall({ emitted: [], supported: [], required: [] }).value, null);
  assert.equal(hallucinationRate([]).value, null);
  assert.equal(brierScore([]), null);
  assert.equal(expectedCalibrationError([]), null);
});

test("citation recall counts required citations actually emitted", () => {
  const result = citationRecall({
    emitted: ["a", "z"],
    supported: ["a"],
    required: ["a", "b"],
  });
  assert.equal(result.value, 0.5);
});

test("hallucination rate aggregates unsupported citations across runs", () => {
  const rate = hallucinationRate([
    { emitted: ["a", "b"], supported: ["a"], required: [] },
    { emitted: ["c", "d"], supported: ["c", "d"], required: [] },
  ]);
  assert.equal(rate.value, 0.25);
});

test("evidence completeness is derived from the register and carries its basis", () => {
  const result = evidenceCompleteness(
    ["Passport", "Payslips", "Certificate of Sponsorship"],
    [
      { id: "e1", satisfies: "Passport", received: true },
      { id: "e2", satisfies: "Payslips", received: false },
    ]
  );
  assert.deepEqual(result.satisfied, ["Passport"]);
  assert.deepEqual(result.missing, ["Payslips", "Certificate of Sponsorship"]);
  assert.equal(result.ratio.value, 1 / 3);
  assert.equal(result.basis, "1 of 3 required evidence types received");
});

test("completeness with nothing required is null, not 100%", () => {
  assert.equal(evidenceCompleteness([], []).ratio.value, null);
});

test("completeness deduplicates repeated requirements", () => {
  const result = evidenceCompleteness(
    ["Passport", "Passport"],
    [{ id: "e1", satisfies: "Passport", received: true }]
  );
  assert.equal(result.required.length, 1);
  assert.equal(result.ratio.value, 1);
});

test("perfectly calibrated predictions have zero calibration error", () => {
  const predictions = [
    ...Array.from({ length: 8 }, () => ({ confidence: 1, correct: true })),
    ...Array.from({ length: 8 }, () => ({ confidence: 0, correct: false })),
  ];
  assert.equal(expectedCalibrationError(predictions), 0);
});

test("confident-and-wrong predictions score badly on both measures", () => {
  const predictions = Array.from({ length: 4 }, () => ({ confidence: 0.95, correct: false }));
  assert.ok((expectedCalibrationError(predictions) ?? 0) > 0.9);
  assert.ok((brierScore(predictions) ?? 0) > 0.9);
});

test("out-of-range confidence is rejected rather than clamped", () => {
  assert.throws(
    () => expectedCalibrationError([{ confidence: 1.4, correct: true }]),
    /out of range/
  );
});

test("reviewer agreement compares system and human decisions", () => {
  const result = reviewerAgreement([
    { system: "escalate", reviewer: "escalate" },
    { system: "escalate", reviewer: "resolve" },
  ]);
  assert.equal(result.value, 0.5);
});
