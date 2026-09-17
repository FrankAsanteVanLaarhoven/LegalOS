/**
 * Measured reliability metrics.
 *
 * Everything here is computed from labelled data. Nothing here produces a
 * per-answer confidence percentage — see `certainty.ts` for why that is a
 * separate, deliberately non-numeric concern.
 */

export interface CitationJudgement {
  /** Citations the system emitted. */
  readonly emitted: readonly string[];
  /** Citations that resolved to a verified source AND support the statement. */
  readonly supported: readonly string[];
  /** Citations a reviewer says should have been present. */
  readonly required: readonly string[];
}

export interface Ratio {
  readonly value: number | null;
  readonly numerator: number;
  readonly denominator: number;
}

function ratio(numerator: number, denominator: number): Ratio {
  return {
    value: denominator === 0 ? null : numerator / denominator,
    numerator,
    denominator,
  };
}

/** Of the citations emitted, how many were real and on point. */
export function citationPrecision(j: CitationJudgement): Ratio {
  return ratio(j.supported.length, j.emitted.length);
}

/** Of the citations that should have appeared, how many did. */
export function citationRecall(j: CitationJudgement): Ratio {
  const found = j.required.filter((c) => j.emitted.includes(c)).length;
  return ratio(found, j.required.length);
}

/** Proportion of emitted citations that resolved to nothing. */
export function hallucinationRate(judgements: readonly CitationJudgement[]): Ratio {
  const emitted = judgements.reduce((n, j) => n + j.emitted.length, 0);
  const supported = judgements.reduce((n, j) => n + j.supported.length, 0);
  return ratio(emitted - supported, emitted);
}

export interface EvidenceRegisterEntry {
  readonly id: string;
  /** The evidence type this artefact satisfies, e.g. "Certificate of Sponsorship". */
  readonly satisfies: string;
  readonly received: boolean;
}

export interface CompletenessResult {
  readonly required: readonly string[];
  readonly satisfied: readonly string[];
  readonly missing: readonly string[];
  readonly ratio: Ratio;
  /**
   * Human-readable derivation, so the number on screen can always be traced.
   * A completeness figure with no `basis` must not be rendered.
   */
  readonly basis: string;
}

/**
 * Evidence completeness, computed — not typed into a fixture.
 *
 * Replaces the pattern of a hardcoded `completenessScore` rendered as a
 * tribunal-readiness percentage. If nothing is required, the ratio is null
 * rather than a misleading 100%.
 */
export function evidenceCompleteness(
  required: readonly string[],
  register: readonly EvidenceRegisterEntry[]
): CompletenessResult {
  const uniqueRequired = [...new Set(required)];
  const received = new Set(
    register.filter((entry) => entry.received).map((entry) => entry.satisfies)
  );
  const satisfied = uniqueRequired.filter((item) => received.has(item));
  const missing = uniqueRequired.filter((item) => !received.has(item));
  return {
    required: uniqueRequired,
    satisfied,
    missing,
    ratio: ratio(satisfied.length, uniqueRequired.length),
    basis: `${satisfied.length} of ${uniqueRequired.length} required evidence types received`,
  };
}

/**
 * Expected calibration error over labelled predictions.
 * Only meaningful once a system emits probabilities AND outcomes are observed —
 * which is why it lives in the benchmark path, not in a request path.
 */
export function expectedCalibrationError(
  predictions: readonly { confidence: number; correct: boolean }[],
  bucketCount = 10
): number | null {
  if (predictions.length === 0) return null;
  if (bucketCount < 1) throw new Error("bucketCount must be >= 1");

  const buckets: { confidence: number; correct: boolean }[][] = Array.from(
    { length: bucketCount },
    () => []
  );
  for (const prediction of predictions) {
    if (prediction.confidence < 0 || prediction.confidence > 1) {
      throw new Error(`confidence out of range: ${prediction.confidence}`);
    }
    const index = Math.min(bucketCount - 1, Math.floor(prediction.confidence * bucketCount));
    buckets[index]!.push(prediction);
  }

  let error = 0;
  for (const bucket of buckets) {
    if (bucket.length === 0) continue;
    const meanConfidence = bucket.reduce((sum, p) => sum + p.confidence, 0) / bucket.length;
    const accuracy = bucket.filter((p) => p.correct).length / bucket.length;
    error += (bucket.length / predictions.length) * Math.abs(meanConfidence - accuracy);
  }
  return error;
}

/** Brier score: mean squared error of probabilistic predictions. */
export function brierScore(
  predictions: readonly { confidence: number; correct: boolean }[]
): number | null {
  if (predictions.length === 0) return null;
  const total = predictions.reduce((sum, p) => sum + (p.confidence - (p.correct ? 1 : 0)) ** 2, 0);
  return total / predictions.length;
}

/** Agreement between the system's recommendation and a human reviewer's. */
export function reviewerAgreement(pairs: readonly { system: string; reviewer: string }[]): Ratio {
  const agreed = pairs.filter((p) => p.system === p.reviewer).length;
  return ratio(agreed, pairs.length);
}
