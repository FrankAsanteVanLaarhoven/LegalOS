/**
 * @legalos/evidence — the ingestion spine.
 *
 * Scope note, deliberately explicit: this package is the contract and the
 * integrity layer, not the engines. Edge detection, de-skewing, OCR, language
 * detection and translation are external services. What lives here is what has
 * to be true regardless of which engine is plugged in — the original is
 * immutable and hashed, every derived artefact names the engine and version
 * that produced it, quality gates fail closed, and nothing derived from a
 * document writes to a case without a human authorising it.
 */

export {
  assessQuality,
  DEFAULT_THRESHOLDS,
  ingestOriginal,
  isCertifiedTranslation,
  isReserved,
  proposeCaseUpdates,
  proposeFiling,
  segmentsNeedingReview,
  verifyIntegrity,
  type CaseUpdateKind,
  type CaseUpdateProposal,
  type QualityThresholds,
} from "./ingest.ts";

export type {
  CaptureMetadata,
  CaptureSource,
  ClassificationProposal,
  DocumentType,
  EngineRecord,
  ExtractedField,
  ExtractedFieldName,
  ExtractionProposal,
  MediaType,
  OcrResult,
  OriginalDocument,
  PageQuality,
  QualityDecision,
  QualityIssue,
  QualityReport,
  TextSegment,
  TranslatedSegment,
  TranslationArtefact,
  TranslationAttestation,
  TranslationFlag,
} from "./types.ts";
