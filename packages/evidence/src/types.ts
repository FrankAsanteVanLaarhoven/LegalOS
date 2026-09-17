/**
 * Evidence ingestion contract.
 *
 * The spine of the ingestion engine, expressed so that the parts which need
 * external services — OCR, image rectification, translation models — plug into
 * a shape that already enforces the properties evidence has to have.
 *
 * Four invariants run through this file:
 *
 *  1. The original is immutable and never replaced. Every derived artefact —
 *     rectified image, OCR text, translation — points back to it by hash.
 *  2. Every derived artefact records which engine and version produced it, so a
 *     result can be reproduced and a bad engine version can be traced.
 *  3. Nothing derived from a document writes to a case. Classification and
 *     extraction produce *proposals* that a human authorises. A misread date
 *     entering a timeline unreviewed is how an appeal deadline gets missed.
 *  4. Quality gates fail closed. An unreadable page is rejected for rescan, not
 *     accepted with a low score attached.
 */

export type CaptureSource =
  | "mobile_camera"
  | "webcam"
  | "scanner"
  | "file_upload"
  | "email_attachment"
  | "cloud_storage"
  | "messaging_export";

export type MediaType =
  | "image/jpeg"
  | "image/png"
  | "image/heic"
  | "image/tiff"
  | "application/pdf"
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export interface CaptureMetadata {
  readonly source: CaptureSource;
  /** ISO-8601. Supplied by the caller so ingestion is deterministic in tests. */
  readonly capturedAt: string;
  /** Free-form device description, e.g. "iPhone 15, iOS 26.1". */
  readonly device: string | null;
  /**
   * Who provided it. Consent matters most for messaging exports, where a
   * thread contains third parties who never agreed to be in a case file.
   */
  readonly providedBy: string;
  /** Recorded consent reference for sources that need one. */
  readonly consentReference: string | null;
}

/** The immutable original. Nothing in the system may modify this record. */
export interface OriginalDocument {
  readonly id: string;
  /** sha-256 of the received bytes. The identity of this evidence. */
  readonly sha256: string;
  readonly byteLength: number;
  readonly mediaType: MediaType;
  readonly filename: string | null;
  readonly capture: CaptureMetadata;
}

/** Which engine produced a derived artefact, and at what version. */
export interface EngineRecord {
  readonly name: string;
  readonly version: string;
  /** ISO-8601 timestamp of the run. */
  readonly ranAt: string;
}

export type QualityIssue =
  | "unreadable"
  | "cropped"
  | "low_resolution"
  | "blurred"
  | "glare"
  | "page_missing"
  | "signature_not_visible";

export interface PageQuality {
  readonly pageNumber: number;
  /**
   * Measured sharpness/legibility in [0,1], or null when no measurement was
   * possible. Null is not a pass — see `assessQuality`.
   */
  readonly legibility: number | null;
  readonly issues: readonly QualityIssue[];
}

export type QualityDecision = "accept" | "rescan_required";

export interface QualityReport {
  readonly decision: QualityDecision;
  readonly pages: readonly PageQuality[];
  /** Pages the user must recapture, with the reason for each. */
  readonly rescan: readonly { pageNumber: number; because: string }[];
}

/* ------------------------------------------------------------------ */
/* Text and translation                                                */
/* ------------------------------------------------------------------ */

/** A recognised text segment, anchored to where it came from. */
export interface TextSegment {
  readonly id: string;
  readonly pageNumber: number;
  readonly text: string;
  /** Normalised [x, y, width, height] within the page, if the engine gives it. */
  readonly bbox: readonly [number, number, number, number] | null;
  readonly kind: "heading" | "paragraph" | "table_cell" | "handwriting" | "stamp" | "signature";
}

export interface OcrResult {
  readonly documentId: string;
  readonly engine: EngineRecord;
  /** BCP-47 tag, or null when detection was inconclusive. */
  readonly detectedLanguage: string | null;
  readonly segments: readonly TextSegment[];
}

export type TranslationFlag =
  | "term_not_in_glossary"
  | "legal_concept_has_no_equivalent"
  | "ambiguous_source_text"
  | "source_illegible"
  | "number_or_date_uncertain";

/**
 * A translated segment, aligned to the source segment it came from.
 *
 * `sourceSegmentId` is required: a translation that cannot be traced to a
 * specific piece of the original cannot be checked against it, which defeats
 * the side-by-side review the whole design exists to support.
 */
export interface TranslatedSegment {
  readonly sourceSegmentId: string;
  readonly text: string;
  readonly flags: readonly TranslationFlag[];
  /** Explanation where a legal concept does not map cleanly between systems. */
  readonly note: string | null;
}

/**
 * A translation is an artefact *alongside* the original, never a replacement.
 *
 * `attestation` is the only thing that can make a translation certified, and it
 * records a human. The system does not issue certification and must never
 * present machine output as certified — a tribunal relies on a named person
 * standing behind the translation.
 */
export interface TranslationArtefact {
  readonly documentId: string;
  readonly engine: EngineRecord;
  readonly sourceLanguage: string;
  readonly targetLanguage: string;
  readonly segments: readonly TranslatedSegment[];
  readonly attestation: TranslationAttestation | null;
}

export interface TranslationAttestation {
  readonly translatorName: string;
  readonly qualification: string;
  readonly attestedAt: string;
  readonly statement: string;
}

/* ------------------------------------------------------------------ */
/* Classification and extraction — proposals only                      */
/* ------------------------------------------------------------------ */

export type DocumentType =
  | "passport"
  | "brp_or_evisa"
  | "visa_letter"
  | "home_office_correspondence"
  | "tribunal_decision"
  | "court_order"
  | "police_report"
  | "nhs_letter"
  | "gp_letter"
  | "therapy_report"
  | "employment_contract"
  | "marriage_certificate"
  | "birth_certificate"
  | "bank_statement"
  | "utility_bill"
  | "university_transcript"
  | "unknown";

/**
 * A classification the system suggests. It is never applied on its own — the
 * document type determines which workflow the evidence enters, and that is a
 * decision with consequences.
 */
export interface ClassificationProposal {
  readonly documentId: string;
  readonly engine: EngineRecord;
  readonly proposed: DocumentType;
  /** Competing candidates, so a reviewer can see what was nearly chosen. */
  readonly alternatives: readonly DocumentType[];
  /** Segments that drove the proposal, so a reviewer can check the basis. */
  readonly evidenceSegmentIds: readonly string[];
}

export type ExtractedFieldName =
  | "case_number"
  | "decision_date"
  | "deadline"
  | "required_action"
  | "applicant_name"
  | "reference_number";

/**
 * An extracted value with the exact text it came from.
 *
 * `sourceSegmentId` is required for the same reason it is on translations: a
 * value nobody can trace to a place in the document cannot be checked, and an
 * uncheckable deadline is worse than no deadline.
 */
export interface ExtractedField {
  readonly name: ExtractedFieldName;
  readonly value: string;
  readonly sourceSegmentId: string;
  /** Verbatim text the value was read from. */
  readonly sourceText: string;
}

export interface ExtractionProposal {
  readonly documentId: string;
  readonly engine: EngineRecord;
  readonly fields: readonly ExtractedField[];
  /**
   * Fields the engine looked for and did not find. Naming the absence is more
   * useful than silently omitting it, because a missing deadline is a fact.
   */
  readonly notFound: readonly ExtractedFieldName[];
}
