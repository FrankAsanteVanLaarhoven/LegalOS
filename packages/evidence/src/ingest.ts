import { createHash } from "node:crypto";

import { isReserved, propose, type Proposal } from "@legalos/governance";

import type {
  CaptureMetadata,
  ClassificationProposal,
  ExtractionProposal,
  MediaType,
  OriginalDocument,
  PageQuality,
  QualityReport,
  TranslationArtefact,
} from "./types.ts";

/** Sources whose provenance depends on a recorded consent reference. */
const CONSENT_REQUIRED: readonly CaptureMetadata["source"][] = [
  "messaging_export",
  "cloud_storage",
  "email_attachment",
];

/**
 * Registers an original document.
 *
 * The hash is computed here rather than accepted from the caller: a
 * caller-supplied hash is an assertion, and the identity of a piece of evidence
 * is the one thing that must be measured.
 */
export function ingestOriginal(input: {
  id: string;
  bytes: Uint8Array;
  mediaType: MediaType;
  filename?: string | null;
  capture: CaptureMetadata;
}): OriginalDocument {
  if (input.bytes.byteLength === 0) {
    throw new Error("refusing to ingest an empty document");
  }

  if (CONSENT_REQUIRED.includes(input.capture.source) && !input.capture.consentReference?.trim()) {
    // A messaging export or shared drive contains third parties who never
    // agreed to appear in a case file. Recording where consent came from is
    // part of the evidence, not paperwork around it.
    throw new Error(
      `source "${input.capture.source}" requires a consentReference before ingestion`
    );
  }

  return {
    id: input.id,
    sha256: createHash("sha256").update(input.bytes).digest("hex"),
    byteLength: input.bytes.byteLength,
    mediaType: input.mediaType,
    filename: input.filename ?? null,
    capture: input.capture,
  };
}

/** True when `bytes` still hash to what was recorded at ingestion. */
export function verifyIntegrity(document: OriginalDocument, bytes: Uint8Array): boolean {
  return createHash("sha256").update(bytes).digest("hex") === document.sha256;
}

export interface QualityThresholds {
  /** Below this, a page is not legible enough to rely on. */
  readonly minimumLegibility: number;
}

export const DEFAULT_THRESHOLDS: QualityThresholds = { minimumLegibility: 0.6 };

/**
 * Decides whether pages are good enough to keep.
 *
 * Fails closed in both directions that matter: a page whose legibility could
 * not be measured is sent back for rescan rather than accepted, and any page
 * carrying a blocking issue rejects the whole capture. Accepting a marginal
 * page with a low score attached just moves the problem to whoever reads it
 * later, by which time the document may no longer be re-obtainable.
 */
export function assessQuality(
  pages: readonly PageQuality[],
  thresholds: QualityThresholds = DEFAULT_THRESHOLDS
): QualityReport {
  const rescan: { pageNumber: number; because: string }[] = [];

  if (pages.length === 0) {
    return { decision: "rescan_required", pages, rescan: [] };
  }

  for (const page of pages) {
    if (page.legibility === null) {
      rescan.push({
        pageNumber: page.pageNumber,
        because: "legibility could not be measured, so the page cannot be relied on",
      });
      continue;
    }
    if (page.legibility < thresholds.minimumLegibility) {
      rescan.push({
        pageNumber: page.pageNumber,
        because: `legibility ${page.legibility.toFixed(2)} is below the ${thresholds.minimumLegibility} threshold`,
      });
      continue;
    }
    const blocking = page.issues.filter(
      (issue) => issue !== "glare" && issue !== "signature_not_visible"
    );
    if (blocking.length > 0) {
      rescan.push({
        pageNumber: page.pageNumber,
        because: `page has blocking issues: ${blocking.join(", ")}`,
      });
    }
  }

  // A gap in page numbers means something was not captured at all.
  const numbers = pages.map((p) => p.pageNumber).sort((a, b) => a - b);
  for (let i = 1; i < numbers.length; i += 1) {
    if (numbers[i]! !== numbers[i - 1]! + 1) {
      rescan.push({
        pageNumber: numbers[i - 1]! + 1,
        because: "page appears to be missing from the capture",
      });
    }
  }

  return {
    decision: rescan.length === 0 ? "accept" : "rescan_required",
    pages,
    rescan,
  };
}

/**
 * True when a translation may be described as certified.
 *
 * Only a human attestation can make it so. This function exists to be the one
 * place that answers the question, so no surface can decide otherwise.
 */
export function isCertifiedTranslation(translation: TranslationArtefact): boolean {
  const attestation = translation.attestation;
  return Boolean(
    attestation &&
    attestation.translatorName.trim() !== "" &&
    attestation.qualification.trim() !== "" &&
    attestation.statement.trim() !== ""
  );
}

/** Segments a reviewer must look at before the translation is relied on. */
export function segmentsNeedingReview(translation: TranslationArtefact): readonly string[] {
  return translation.segments
    .filter((segment) => segment.flags.length > 0)
    .map((segment) => segment.sourceSegmentId);
}

/* ------------------------------------------------------------------ */
/* Case updates — proposals, never writes                              */
/* ------------------------------------------------------------------ */

export type CaseUpdateKind = "add_timeline_event" | "add_deadline" | "add_task" | "file_evidence";

export interface CaseUpdateProposal {
  readonly proposal: Proposal;
  readonly kind: CaseUpdateKind;
  readonly documentId: string;
  /** The extracted field this update rests on, so a reviewer can check it. */
  readonly basis: { fieldName: string; value: string; sourceText: string } | null;
}

/**
 * Turns an extraction into proposed case updates.
 *
 * Nothing here writes to a case. A deadline read off a Home Office letter by
 * OCR is a suggestion that a human confirms — a misread date entering a
 * timeline unreviewed is how somebody misses an appeal deadline, and the
 * document that caused it looks perfectly normal afterwards.
 */
export function proposeCaseUpdates(
  extraction: ExtractionProposal,
  options: { proposedBy: string }
): readonly CaseUpdateProposal[] {
  const updates: CaseUpdateProposal[] = [];

  for (const field of extraction.fields) {
    const kind = updateKindFor(field.name);
    if (!kind) continue;

    updates.push({
      proposal: propose({
        id: `${extraction.documentId}:${field.name}`,
        activity: "record_extracted_field",
        proposedBy: options.proposedBy,
        summary: `Add ${field.name.replace(/_/g, " ")} "${field.value}" from ${extraction.documentId}`,
      }),
      kind,
      documentId: extraction.documentId,
      basis: {
        fieldName: field.name,
        value: field.value,
        sourceText: field.sourceText,
      },
    });
  }

  return updates;
}

function updateKindFor(name: ExtractionProposal["fields"][number]["name"]): CaseUpdateKind | null {
  switch (name) {
    case "deadline":
      return "add_deadline";
    case "decision_date":
      return "add_timeline_event";
    case "required_action":
      return "add_task";
    default:
      return null;
  }
}

/**
 * Filing a classified document into a case workflow is a proposal too — the
 * document type decides which workflow the evidence enters.
 */
export function proposeFiling(
  classification: ClassificationProposal,
  options: { proposedBy: string }
): CaseUpdateProposal {
  return {
    proposal: propose({
      id: `${classification.documentId}:filing`,
      activity: "file_evidence",
      proposedBy: options.proposedBy,
      summary: `File ${classification.documentId} as ${classification.proposed.replace(/_/g, " ")}`,
    }),
    kind: "file_evidence",
    documentId: classification.documentId,
    basis: null,
  };
}

/** Reserved-activity guard, re-exported so callers cannot forget it exists. */
export { isReserved };
