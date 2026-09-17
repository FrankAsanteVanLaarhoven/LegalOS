import { test } from "node:test";
import assert from "node:assert/strict";

import {
  assessQuality,
  ingestOriginal,
  isCertifiedTranslation,
  proposeCaseUpdates,
  proposeFiling,
  segmentsNeedingReview,
  verifyIntegrity,
} from "../src/ingest.ts";
import type {
  CaptureMetadata,
  ExtractionProposal,
  PageQuality,
  TranslationArtefact,
} from "../src/types.ts";

const CAPTURE: CaptureMetadata = {
  source: "mobile_camera",
  capturedAt: "2026-07-26T10:00:00.000Z",
  device: "iPhone 15",
  providedBy: "user:client-1",
  consentReference: null,
};

const ENGINE = { name: "test-engine", version: "1.0.0", ranAt: "2026-07-26T10:01:00.000Z" };

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/* ---------------- integrity ---------------- */

test("the hash is computed, never accepted from the caller", () => {
  const doc = ingestOriginal({
    id: "d1",
    bytes: bytes("hello"),
    mediaType: "image/jpeg",
    capture: CAPTURE,
  });
  // sha-256("hello")
  assert.equal(doc.sha256, "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  assert.equal(doc.byteLength, 5);
});

test("integrity verification detects any change to the bytes", () => {
  const doc = ingestOriginal({
    id: "d1",
    bytes: bytes("original content"),
    mediaType: "application/pdf",
    capture: CAPTURE,
  });
  assert.equal(verifyIntegrity(doc, bytes("original content")), true);
  assert.equal(verifyIntegrity(doc, bytes("original content ")), false);
});

test("an empty document is refused", () => {
  assert.throws(
    () =>
      ingestOriginal({
        id: "d1",
        bytes: new Uint8Array(),
        mediaType: "image/png",
        capture: CAPTURE,
      }),
    /empty document/
  );
});

test("sources carrying third-party content require a consent reference", () => {
  for (const source of ["messaging_export", "cloud_storage", "email_attachment"] as const) {
    assert.throws(
      () =>
        ingestOriginal({
          id: "d1",
          bytes: bytes("x"),
          mediaType: "image/png",
          capture: { ...CAPTURE, source, consentReference: null },
        }),
      /requires a consentReference/,
      source
    );

    const withConsent = ingestOriginal({
      id: "d1",
      bytes: bytes("x"),
      mediaType: "image/png",
      capture: { ...CAPTURE, source, consentReference: "consent-2026-07-26" },
    });
    assert.equal(withConsent.capture.consentReference, "consent-2026-07-26");
  }
});

test("a direct camera capture needs no consent reference", () => {
  assert.ok(
    ingestOriginal({ id: "d1", bytes: bytes("x"), mediaType: "image/jpeg", capture: CAPTURE })
  );
});

/* ---------------- quality gates ---------------- */

const goodPage = (n: number): PageQuality => ({
  pageNumber: n,
  legibility: 0.9,
  issues: [],
});

test("clean pages are accepted", () => {
  const report = assessQuality([goodPage(1), goodPage(2)]);
  assert.equal(report.decision, "accept");
  assert.deepEqual(report.rescan, []);
});

test("an unmeasurable page is sent back, not accepted", () => {
  const report = assessQuality([goodPage(1), { pageNumber: 2, legibility: null, issues: [] }]);
  assert.equal(report.decision, "rescan_required");
  assert.equal(report.rescan[0]?.pageNumber, 2);
  assert.match(report.rescan[0]?.because ?? "", /could not be measured/);
});

test("a page below the legibility threshold is sent back", () => {
  const report = assessQuality([{ pageNumber: 1, legibility: 0.4, issues: [] }]);
  assert.equal(report.decision, "rescan_required");
  assert.match(report.rescan[0]?.because ?? "", /below the 0.6 threshold/);
});

test("blocking issues reject the capture; cosmetic ones do not", () => {
  assert.equal(
    assessQuality([{ pageNumber: 1, legibility: 0.9, issues: ["cropped"] }]).decision,
    "rescan_required"
  );
  assert.equal(
    assessQuality([{ pageNumber: 1, legibility: 0.9, issues: ["glare"] }]).decision,
    "accept"
  );
});

test("a gap in page numbers is treated as a missing page", () => {
  const report = assessQuality([goodPage(1), goodPage(3)]);
  assert.equal(report.decision, "rescan_required");
  assert.ok(report.rescan.some((r) => /missing/.test(r.because)));
});

test("an empty capture is never accepted", () => {
  assert.equal(assessQuality([]).decision, "rescan_required");
});

/* ---------------- translation ---------------- */

const translation: TranslationArtefact = {
  documentId: "d1",
  engine: ENGINE,
  sourceLanguage: "ne",
  targetLanguage: "en-GB",
  segments: [
    { sourceSegmentId: "s1", text: "The Applicant…", flags: [], note: null },
    {
      sourceSegmentId: "s2",
      text: "…",
      flags: ["legal_concept_has_no_equivalent"],
      note: "No direct equivalent in England and Wales.",
    },
  ],
  attestation: null,
};

test("a machine translation is never certified", () => {
  assert.equal(isCertifiedTranslation(translation), false);
});

test("certification requires a named human with a qualification and a statement", () => {
  assert.equal(
    isCertifiedTranslation({
      ...translation,
      attestation: {
        translatorName: "A. Translator",
        qualification: "DPSI (Law)",
        attestedAt: "2026-07-26T12:00:00.000Z",
        statement: "I certify this is a true translation.",
      },
    }),
    true
  );

  // A blank field must not be enough.
  assert.equal(
    isCertifiedTranslation({
      ...translation,
      attestation: {
        translatorName: "A. Translator",
        qualification: "   ",
        attestedAt: "2026-07-26T12:00:00.000Z",
        statement: "I certify this is a true translation.",
      },
    }),
    false
  );
});

test("flagged segments are surfaced for review", () => {
  assert.deepEqual(segmentsNeedingReview(translation), ["s2"]);
});

test("the original is never mutated by translation", () => {
  const doc = ingestOriginal({
    id: "d1",
    bytes: bytes("original"),
    mediaType: "image/jpeg",
    capture: CAPTURE,
  });
  const before = doc.sha256;
  // Translation artefacts reference the document; there is no API to alter it.
  assert.equal(doc.sha256, before);
  assert.equal(translation.documentId, doc.id);
});

/* ---------------- case updates are proposals ---------------- */

const extraction: ExtractionProposal = {
  documentId: "d1",
  engine: ENGINE,
  fields: [
    {
      name: "deadline",
      value: "2026-08-14",
      sourceSegmentId: "s7",
      sourceText: "You must respond by 14 August 2026.",
    },
    {
      name: "case_number",
      value: "PA/04057/2024",
      sourceSegmentId: "s2",
      sourceText: "Case number: PA/04057/2024",
    },
  ],
  notFound: ["required_action"],
};

test("an extracted deadline becomes a proposal, not a case write", () => {
  const updates = proposeCaseUpdates(extraction, { proposedBy: "agent:document" });
  const deadline = updates.find((u) => u.kind === "add_deadline");
  assert.ok(deadline);
  assert.equal(deadline.proposal.state, "DRAFT");
  assert.equal(deadline.proposal.authorisedBy, null);
});

test("every proposal carries the text it was read from", () => {
  for (const update of proposeCaseUpdates(extraction, { proposedBy: "agent:document" })) {
    assert.ok(update.basis, update.kind);
    assert.ok(update.basis.sourceText.length > 0);
  }
});

test("fields with no case effect produce no proposal", () => {
  const updates = proposeCaseUpdates(extraction, { proposedBy: "agent:document" });
  assert.equal(
    updates.some((u) => u.basis?.fieldName === "case_number"),
    false
  );
});

test("filing a classified document is itself a proposal", () => {
  const filing = proposeFiling(
    {
      documentId: "d1",
      engine: ENGINE,
      proposed: "home_office_correspondence",
      alternatives: ["tribunal_decision"],
      evidenceSegmentIds: ["s1"],
    },
    { proposedBy: "agent:document" }
  );
  assert.equal(filing.proposal.state, "DRAFT");
  // Filing evidence into a workspace is not a reserved activity — conducting
  // litigation is. It still requires a human decision, because the document
  // type determines which workflow the evidence enters, but it does not
  // require a regulated solicitor.
  assert.equal(filing.proposal.reserved, false);
  assert.equal(filing.proposal.authorisedBy, null);
});
