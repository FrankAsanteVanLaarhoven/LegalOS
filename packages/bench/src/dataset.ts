import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Benchmark dataset governance.
 *
 * This file governs datasets. It does not contain one, and cannot: a legal
 * ground-truth dataset is authored and reviewed by qualified people, and
 * generating plausible questions and answers would produce something that looks
 * exactly like expert-reviewed material and is not. Every model ranking derived
 * from it would then be an unverified claim wearing a benchmark's clothes.
 *
 * So what is here is the part that can be built without them: the schema a
 * sample must satisfy, the provenance it must carry, and the checks that catch
 * a dataset edited after the evaluation that cited it.
 *
 * The provenance rules mirror evidence handling elsewhere in the platform. Two
 * independent reviewers, because one reviewer is an opinion. A recorded
 * resolution where they disagreed, because a disagreement that vanished was
 * resolved by whoever wrote last. And a digest over the samples, because a
 * dataset edited without its digest changing leaves every routing decision that
 * cited it describing an evaluation that no longer exists.
 */

export interface DatasetSample {
  readonly id: string;
  readonly domain: string;
  readonly jurisdiction: string;
  readonly difficulty: "routine" | "contested" | "novel";
  readonly language: string;
  readonly userQuestion: string;
  /** Authored by a qualified reviewer. Never model output. */
  readonly groundTruthAnswer: string;
  readonly verifiedSources: readonly string[];
  readonly expectedCitations: readonly string[];
  readonly reasoningOutline: readonly string[];
  readonly requiresHumanReview: boolean;
  readonly requiresRetrieval: boolean;
  readonly evaluationNotes: string;
  readonly provenance: SampleProvenance;
}

export interface SampleProvenance {
  /** Two independent reviewers. One reviewer is an opinion. */
  readonly reviewers: readonly string[];
  /** Present when reviewers disagreed and someone settled it. */
  readonly conflictResolution: string | null;
  readonly approvedAt: string;
  readonly approvedBy: string;
}

export interface DatasetManifest {
  readonly id: string;
  readonly version: string;
  readonly licence: string;
  readonly owner: string;
  readonly validatedAt: string;
  readonly sampleCount: number;
  /** sha-256 over every sample, in id order. */
  readonly digest: string;
}

export type DatasetDefect =
  | { readonly kind: "DIGEST_MISMATCH"; readonly detail: string }
  | { readonly kind: "SAMPLE_COUNT_MISMATCH"; readonly detail: string }
  | { readonly kind: "INSUFFICIENT_REVIEW"; readonly sampleId: string; readonly detail: string }
  | { readonly kind: "UNRESOLVED_CONFLICT"; readonly sampleId: string; readonly detail: string }
  | { readonly kind: "MISSING_GROUND_TRUTH"; readonly sampleId: string; readonly detail: string }
  | { readonly kind: "UNREADABLE"; readonly detail: string };

/** Reviewers required before a sample may be used as ground truth. */
export const MINIMUM_REVIEWERS = 2;

/**
 * The digest a manifest must match.
 *
 * Computed over the sample content in id order, so it depends on what the
 * samples say and not on how they were stored or the order a directory listing
 * happened to return.
 */
export function digestSamples(samples: readonly DatasetSample[]): string {
  const ordered = [...samples].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const material = ordered
    .map((sample) =>
      JSON.stringify({
        id: sample.id,
        domain: sample.domain,
        jurisdiction: sample.jurisdiction,
        difficulty: sample.difficulty,
        language: sample.language,
        userQuestion: sample.userQuestion,
        groundTruthAnswer: sample.groundTruthAnswer,
        verifiedSources: [...sample.verifiedSources],
        expectedCitations: [...sample.expectedCitations],
        reasoningOutline: [...sample.reasoningOutline],
        requiresHumanReview: sample.requiresHumanReview,
        requiresRetrieval: sample.requiresRetrieval,
      })
    )
    .join("\n");
  return createHash("sha256").update(material, "utf8").digest("hex");
}

/**
 * Checks a dataset against its manifest and the provenance rules.
 *
 * Returns every defect rather than the first, because a dataset with two
 * problems and one reported reads as a dataset with one problem.
 */
export function verifyDataset(
  manifest: DatasetManifest,
  samples: readonly DatasetSample[]
): readonly DatasetDefect[] {
  const defects: DatasetDefect[] = [];

  const computed = digestSamples(samples);
  if (computed !== manifest.digest) {
    defects.push({
      kind: "DIGEST_MISMATCH",
      detail: `manifest declares ${manifest.digest.slice(0, 12)}…, samples hash to ${computed.slice(0, 12)}…`,
    });
  }
  if (manifest.sampleCount !== samples.length) {
    defects.push({
      kind: "SAMPLE_COUNT_MISMATCH",
      detail: `manifest declares ${manifest.sampleCount}, found ${samples.length}`,
    });
  }

  for (const sample of samples) {
    const reviewers = new Set(sample.provenance?.reviewers ?? []);
    if (reviewers.size < MINIMUM_REVIEWERS) {
      defects.push({
        kind: "INSUFFICIENT_REVIEW",
        sampleId: sample.id,
        detail: `${reviewers.size} independent reviewer(s); ${MINIMUM_REVIEWERS} required`,
      });
    }
    if (!sample.groundTruthAnswer?.trim()) {
      defects.push({
        kind: "MISSING_GROUND_TRUTH",
        sampleId: sample.id,
        detail: "no ground-truth answer, so nothing can be scored against it",
      });
    }
    // A sample reviewed by people who disagreed, with no recorded resolution,
    // was settled by whoever wrote last.
    if (sample.provenance?.conflictResolution === "") {
      defects.push({
        kind: "UNRESOLVED_CONFLICT",
        sampleId: sample.id,
        detail: "a conflict was recorded as unresolved",
      });
    }
  }

  return defects;
}

export function datasetDirectory(repoRoot: string): string {
  return join(repoRoot, "datasets");
}

/** Reads every dataset present. None being present is a valid state. */
export async function readDatasets(
  repoRoot: string
): Promise<readonly { manifest: DatasetManifest; samples: readonly DatasetSample[] }[]> {
  const root = datasetDirectory(repoRoot);
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return [];
  }

  const datasets: { manifest: DatasetManifest; samples: readonly DatasetSample[] }[] = [];
  for (const name of entries) {
    try {
      const manifest = JSON.parse(
        await readFile(join(root, name, "manifest.json"), "utf8")
      ) as DatasetManifest;
      const sampleNames = await readdir(join(root, name, "samples"));
      const samples: DatasetSample[] = [];
      for (const sampleName of sampleNames) {
        if (!sampleName.endsWith(".json")) continue;
        samples.push(
          JSON.parse(
            await readFile(join(root, name, "samples", sampleName), "utf8")
          ) as DatasetSample
        );
      }
      datasets.push({ manifest, samples });
    } catch {
      // Not a dataset directory.
    }
  }
  return datasets;
}
