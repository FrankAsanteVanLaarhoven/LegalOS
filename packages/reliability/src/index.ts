/**
 * @legalos/reliability — measured metrics, and an honest account of certainty.
 *
 * Two separate concerns, deliberately not mixed:
 *  - `metrics.ts` computes aggregate quality over labelled data (precision,
 *    recall, hallucination rate, calibration). Legitimate because it is measured.
 *  - `certainty.ts` describes how much to rely on a single answer, and emits no
 *    number at all, because nothing calibrated produces one.
 */

export {
  brierScore,
  citationPrecision,
  citationRecall,
  evidenceCompleteness,
  expectedCalibrationError,
  hallucinationRate,
  reviewerAgreement,
  type CitationJudgement,
  type CompletenessResult,
  type EvidenceRegisterEntry,
  type Ratio,
} from "./metrics.ts";

export {
  describeCertainty,
  type CertaintyDisclosure,
  type DescribeCertaintyInput,
  type ReliancePosture,
} from "./certainty.ts";
