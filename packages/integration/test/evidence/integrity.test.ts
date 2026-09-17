import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ingestOriginal, verifyIntegrity } from "@legalos/evidence";

import { emitEvidence } from "../../src/index.ts";

/**
 * Evidence integrity.
 *
 * EV-002 states that checksums are verified rather than merely stored. A stored
 * hash nobody recomputes is decoration, and the way that fails in practice is
 * silent: the column is populated, the code path that would compare it is never
 * called, and nothing looks wrong until a document is challenged.
 *
 * So the tests below flip a byte. Anything that passes with a single byte
 * changed is not verifying anything, whatever it stores.
 *
 * No database here on purpose. This is a property of the ingestion code, and
 * the separate question of whether the checksum is persisted at all is measured
 * against the schema by `evidence_content_identity_persisted`.
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

const held = new Map<string, boolean>();

function records(name: string, fn: () => void) {
  return () => {
    held.set(name, false);
    fn();
    held.set(name, true);
  };
}

function commit(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

const capture = {
  source: "mobile_camera" as const,
  capturedAt: "2026-07-26T10:00:00.000Z",
  device: "test",
  providedBy: "applicant",
  consentReference: null,
};

const bytes = new TextEncoder().encode(
  "Home Office decision letter, 26 July 2026. Application refused under paragraph 276ADE."
);

test(
  "an unmodified document verifies",
  records("unmodified_verifies", () => {
    const doc = ingestOriginal({ id: "doc-1", bytes, mediaType: "application/pdf", capture });
    assert.equal(verifyIntegrity(doc, bytes), true);
  })
);

test(
  "a single flipped byte fails verification",
  records("single_byte_detected", () => {
    const doc = ingestOriginal({ id: "doc-2", bytes, mediaType: "application/pdf", capture });
    const tampered = new Uint8Array(bytes);
    // "refused" -> "refuseD". One bit in one byte, in the word the whole case
    // turns on. If this passes, nothing is being recomputed.
    const index = tampered.indexOf("refused".charCodeAt(6), 0);
    tampered[index] = tampered[index]! ^ 0x20;
    assert.notDeepEqual(tampered, bytes, "the test must actually change the bytes");
    assert.equal(verifyIntegrity(doc, tampered), false);
  })
);

test(
  "truncation fails verification",
  records("truncation_detected", () => {
    const doc = ingestOriginal({ id: "doc-3", bytes, mediaType: "application/pdf", capture });
    assert.equal(verifyIntegrity(doc, bytes.slice(0, bytes.length - 1)), false);
  })
);

test(
  "two different documents do not share an identity",
  records("distinct_documents_distinct_hashes", () => {
    const a = ingestOriginal({ id: "doc-4", bytes, mediaType: "application/pdf", capture });
    const b = ingestOriginal({
      id: "doc-5",
      bytes: new TextEncoder().encode("A different letter entirely."),
      mediaType: "application/pdf",
      capture,
    });
    assert.notEqual(a.sha256, b.sha256);
  })
);

test(
  "an empty document is refused rather than ingested with the hash of nothing",
  records("empty_refused", () => {
    assert.throws(() =>
      ingestOriginal({
        id: "doc-6",
        bytes: new Uint8Array(0),
        mediaType: "application/pdf",
        capture,
      })
    );
  })
);

test(
  "a source requiring consent is refused without a consent reference",
  records("consent_enforced", () => {
    // A messaging export contains third parties who never agreed to be in a
    // case file. This is part of evidence integrity, not paperwork around it.
    assert.throws(() =>
      ingestOriginal({
        id: "doc-7",
        bytes,
        mediaType: "application/pdf",
        capture: { ...capture, source: "messaging_export", consentReference: null },
      })
    );
  })
);

after(async () => {
  const expected = [
    "unmodified_verifies",
    "single_byte_detected",
    "truncation_detected",
    "distinct_documents_distinct_hashes",
    "empty_refused",
    "consent_enforced",
  ];
  await emitEvidence(repoRoot, {
    checkId: "evidence_checksums_recomputed",
    passed: expected.every((name) => held.get(name) === true),
    at: new Date().toISOString(),
    commit: commit(),
    producedBy: "packages/integration/test/evidence/integrity.test.ts",
    demonstrates:
      "ingestion records a sha-256 that is recomputed on verification, detecting a single flipped byte and truncation, and refuses empty documents and consent-requiring sources with no consent reference",
  });
});
