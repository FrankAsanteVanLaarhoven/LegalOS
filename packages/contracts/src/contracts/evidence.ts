import { defineContract } from "../guarantee.ts";

/**
 * The evidence repository contract.
 *
 * Pre-registered before the implementation tests, so the checks are named by
 * what must be true rather than by what turned out to be easy to assert.
 *
 * Evidence is the domain where the difference between "a row exists" and "the
 * thing is what it claims" matters most, because every other domain cites it.
 * A deadline's provenance, a review's subject, a task's output and a graph
 * assertion's documentary backing all resolve here, and each of them is only
 * as good as this layer.
 */
export const EVIDENCE_CONTRACT = defineContract({
  repository: "EvidenceRepository",
  module: "packages/repositories/src/evidence.ts",
  rationale:
    "Every other domain cites evidence: a deadline's source, a review's subject, a task's output, a graph assertion's documentary backing. If an evidence item can claim to be a document that was never stored, or bytes that changed after they were cited, then every citation elsewhere in the system inherits that and nobody downstream can tell.",
  tables: [
    "evidence_items",
    "evidence_files",
    "evidence_provenance",
    "evidence_events",
    "evidence_derivations",
  ],
  surfaces: ["Evidence", "Evidence graph", "Tasks", "Deadlines"],
  invariants: ["INV-001", "EV-001", "EV-005"],
  guarantees: [
    {
      id: "EVR-G1",
      statement: "Every read and write is scoped to one organisation and one case.",
      kind: "scoping",
      refuses:
        "a caseworker scoped to organisation alpha reads a beta document because the same account also holds a valid beta membership, which the membership check alone would permit",
      provedBy: "evidence_reads_are_organisation_scoped",
    },
    {
      id: "EVR-G2",
      statement:
        "Only a role permitted to handle case material may create evidence or attach a file.",
      kind: "permission",
      refuses:
        "a client uploads a document that then appears in the case file as evidence recorded by the firm, indistinguishable from one a caseworker received and checked",
      provedBy: "evidence_writes_require_authority",
    },
    {
      id: "EVR-G3",
      statement:
        "Every file version carries a sha-256 of its bytes, and verification recomputes it.",
      kind: "integrity",
      refuses:
        "a document is altered after it was cited in a filing and nothing detects it, because the stored digest was never recomputed against the bytes it describes",
      provedBy: "evidence_digest_is_recomputed",
    },
    {
      id: "EVR-G4",
      statement:
        "A file that has not been stored and confirmed is never reported as available evidence.",
      kind: "availability",
      refuses:
        "a bundle is assembled from an evidence item whose file was never persisted, and the absence is discovered at the hearing rather than when it happened",
      provedBy: "evidence_availability_is_not_assumed",
    },
    {
      id: "EVR-G5",
      statement: "Provenance is recorded, categorical, and never overwritten.",
      kind: "provenance",
      refuses:
        "a document a client photographed on a phone is indistinguishable in the case file from one a tribunal sent, so nobody can weigh what it is worth",
      provedBy: "evidence_provenance_is_recorded",
    },
    {
      id: "EVR-G6",
      statement:
        "File integrity, source authenticity and professional acceptance are separate states.",
      kind: "provenance",
      refuses:
        "an item reads as verified because its bytes hashed correctly, and a caseworker relies on it as a document a solicitor has accepted",
      provedBy: "evidence_verification_dimensions_are_distinct",
    },
    {
      id: "EVR-G7",
      statement: "Recorded history and provenance are appended, never rewritten.",
      kind: "integrity",
      refuses:
        "a custody note is edited after a dispute arises, so the record of what was said about where a document came from no longer matches what was said at the time",
      provedBy: "evidence_history_is_append_only",
    },
    {
      id: "EVR-G8",
      statement:
        "Creating an item writes its provenance, its first event and its audit entry, or none of them.",
      kind: "integrity",
      refuses:
        "an evidence item exists with no provenance and no audit entry, so a change to a case file left no independent trace and nothing records how the document arrived",
      provedBy: "evidence_creation_is_atomic",
    },
    {
      id: "EVR-G9",
      statement:
        "No probability, confidence, score or percentage is emitted, under any name.",
      kind: "abstention",
      refuses:
        "a caseworker sorts a bundle by an authenticity or quality figure attached to each document, which no observation in this system was calibrated to produce",
      provedBy: "evidence_emits_no_probability",
    },
    {
      id: "EVR-G10",
      statement:
        "Evidence cited by a graph assertion satisfies EV-005 only when it is same-case, available and located.",
      kind: "provenance",
      refuses:
        "an assertion claims documentary backing from a real evidence row whose file was never stored, or whose locator is blank, and EV-005 reports the case fully traceable",
      provedBy: "evidence_satisfies_ev005_only_when_real",
    },
    {
      id: "EVR-G11",
      statement: "No fixture is ever served in place of persisted evidence.",
      kind: "availability",
      refuses:
        "a demonstration document renders as a real one, so a caseworker believes a medical report is on file",
      provedBy: "evidence_no_fixture_fallback",
    },
  ],
});
