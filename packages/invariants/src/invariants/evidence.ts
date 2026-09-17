import { defineInvariant } from "../invariant.ts";

/** Invariants over the documents a case is built from. */

export const EVIDENCE = [
  defineInvariant({
    id: "EV-001",
    title: "Evidence is immutable once accepted",
    category: "evidence",
    severity: "critical",
    rationale:
      "A document that can change after it was relied on cannot support a submission. A tribunal asking what was filed must get one answer.",
    observations: ["evidence_content_identity_persisted", "evidence_rows_append_only"],
    capability: "ingestion",
    protects: ["packages/evidence", "packages/database"],
    evidenceKinds: ["integration", "audit"],
  }),

  defineInvariant({
    id: "EV-002",
    title: "Checksums are verified, not merely stored",
    category: "evidence",
    severity: "critical",
    rationale:
      "A stored hash nobody recomputes is decoration. Verification has to run and be able to fail.",
    observations: ["evidence_checksums_recomputed"],
    capability: "ingestion",
    protects: ["packages/evidence"],
    evidenceKinds: ["integration"],
  }),

  defineInvariant({
    id: "EV-003",
    title: "OCR provenance is recorded",
    category: "evidence",
    severity: "high",
    rationale:
      "Extracted text carries which engine produced it and at what confidence, because a misread date in a Home Office letter changes a deadline.",
    observations: ["ocr_engine_wired", "ocr_provenance_recorded"],
    capability: "ingestion",
    protects: ["packages/evidence", "packages/evidence-review"],
    evidenceKinds: ["integration"],
  }),

  defineInvariant({
    id: "EV-004",
    title: "Translation is linked to its original",
    category: "evidence",
    severity: "high",
    rationale:
      "A translated passage is always resolvable to the source text and the translator, human or machine. Someone must be able to check the sentence a decision turned on.",
    observations: ["translation_links_to_source"],
    capability: "ingestion",
    protects: ["packages/evidence", "packages/evidence-review"],
    evidenceKinds: ["integration"],
  }),

  defineInvariant({
    id: "EV-005",
    title: "Every assertion is traceable to a document",
    category: "evidence",
    severity: "critical",
    rationale:
      "Nothing asserted about a case exists without a path back to the page it came from. This is what separates a case file from a summary.",
    observations: ["assertions_carry_source_locator"],
    capability: "verification",
    protects: ["packages/evidence", "packages/verification"],
    dependsOn: ["EV-001"],
    evidenceKinds: ["integration", "audit"],
  }),
] as const;
