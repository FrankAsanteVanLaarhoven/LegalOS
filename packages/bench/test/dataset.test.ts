import { test } from "node:test";
import assert from "node:assert/strict";

import {
  digestSamples,
  verifyDataset,
  MINIMUM_REVIEWERS,
  type DatasetManifest,
  type DatasetSample,
} from "../src/index.ts";

/**
 * Dataset governance, proven against a synthetic fixture.
 *
 * The fixture below is deliberately not legal content. A real benchmark sample
 * is authored and reviewed by qualified people, and inventing one here would
 * produce something indistinguishable from expert-reviewed material that no
 * expert had seen — which is the failure mode the whole platform exists to
 * prevent, committed inside the thing that measures it.
 *
 * What these tests establish is that the mechanism works, so that when real
 * samples arrive the checks around them already have teeth.
 */

const sample: DatasetSample = {
  id: "fixture-001",
  domain: "fixture",
  jurisdiction: "none",
  difficulty: "routine",
  language: "en",
  userQuestion: "A fixture question, standing in for a reviewed sample.",
  groundTruthAnswer: "A fixture answer.",
  verifiedSources: ["fixture-source"],
  expectedCitations: ["fixture-citation"],
  reasoningOutline: ["step one", "step two"],
  requiresHumanReview: true,
  requiresRetrieval: false,
  evaluationNotes: "fixture",
  provenance: {
    reviewers: ["reviewer-a", "reviewer-b"],
    conflictResolution: null,
    approvedAt: "2026-07-27T00:00:00.000Z",
    approvedBy: "reviewer-a",
  },
};

function manifestFor(samples: readonly DatasetSample[]): DatasetManifest {
  return {
    id: "fixture",
    version: "1.0.0",
    licence: "fixture",
    owner: "fixture",
    validatedAt: "2026-07-27T00:00:00.000Z",
    sampleCount: samples.length,
    digest: digestSamples(samples),
  };
}

test("a coherent dataset has no defects", () => {
  assert.deepEqual(verifyDataset(manifestFor([sample]), [sample]), []);
});

test("a sample edited after the manifest was written is detected", () => {
  // The failure this exists to catch: a dataset changed after an evaluation
  // cited it, leaving every routing decision describing a benchmark that no
  // longer exists.
  const manifest = manifestFor([sample]);
  const edited = { ...sample, groundTruthAnswer: "A different answer entirely." };
  const defects = verifyDataset(manifest, [edited]);
  assert.ok(defects.some((d) => d.kind === "DIGEST_MISMATCH"));
});

test("the digest depends on content, not on ordering or storage", () => {
  const second: DatasetSample = { ...sample, id: "fixture-002" };
  assert.equal(digestSamples([sample, second]), digestSamples([second, sample]));
});

test("a sample with one reviewer is refused", () => {
  // One reviewer is an opinion.
  const defects = verifyDataset(manifestFor([sample]), [
    { ...sample, provenance: { ...sample.provenance, reviewers: ["reviewer-a"] } },
  ]);
  assert.ok(
    defects.some((d) => d.kind === "INSUFFICIENT_REVIEW"),
    `${MINIMUM_REVIEWERS} reviewers should be required`
  );
});

test("a sample with no ground truth is refused", () => {
  const defects = verifyDataset(manifestFor([sample]), [{ ...sample, groundTruthAnswer: "  " }]);
  assert.ok(defects.some((d) => d.kind === "MISSING_GROUND_TRUTH"));
});

test("a recorded but unresolved conflict is refused", () => {
  // A disagreement that vanished was resolved by whoever wrote last.
  const defects = verifyDataset(manifestFor([sample]), [
    { ...sample, provenance: { ...sample.provenance, conflictResolution: "" } },
  ]);
  assert.ok(defects.some((d) => d.kind === "UNRESOLVED_CONFLICT"));
});

test("every defect is reported, not only the first", () => {
  const broken = {
    ...sample,
    groundTruthAnswer: "",
    provenance: { ...sample.provenance, reviewers: [] },
  };
  const defects = verifyDataset(manifestFor([sample]), [broken]);
  assert.ok(defects.length >= 3, "digest, review and ground truth should all be reported");
});

test("no dataset is shipped with this package", async () => {
  // Stated as a test so it stays true. The governance is here; the content is
  // authored by qualified people, and its absence is a fact about the
  // repository rather than an oversight.
  const { readDatasets } = await import("../src/index.ts");
  const repoRoot = new URL("../../..", import.meta.url).pathname;
  assert.deepEqual(await readDatasets(repoRoot), []);
});
