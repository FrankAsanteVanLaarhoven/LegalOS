/**
 * @legalos/verification — the gate between model output and a user.
 *
 * Nothing a model says is trusted. Every citation-shaped token must resolve to
 * a verified source; guarantees, fabricated confidence, and advice to go without
 * representation are blocked outright; disagreement with the deterministic rule
 * engine blocks. The verdict is fail-closed — `releasable` is true only when
 * there is not a single finding.
 */

export {
  extractCitations,
  normaliseCitation,
  type CitationKind,
  type ExtractedCitation,
} from "./citations.ts";
export { REASON_CODES, specFor, type ReasonCodeSpec, type Severity } from "./codes.ts";
export {
  verify,
  type Finding,
  type Verdict,
  type VerdictStatus,
  type VerifyInput,
} from "./verify.ts";
