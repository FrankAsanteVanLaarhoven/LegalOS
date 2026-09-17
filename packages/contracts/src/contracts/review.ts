import { defineContract } from "../guarantee.ts";

/**
 * The review repository contract.
 *
 * This is the boundary the platform is arranged around — a machine proposes, a
 * named qualified person authorises — so it is the one where a quietly broken
 * guarantee does the most damage. An approval is the thing somebody may have to
 * defend to a regulator.
 */
export const REVIEW_CONTRACT = defineContract({
  repository: "ReviewRepository",
  module: "packages/repositories/src/review.ts",
  rationale:
    "Every claim this platform makes about human oversight rests here. If a decision can be edited, or made by someone unqualified, or recorded without the basis it was made on, then the oversight is a workflow step rather than a safeguard and the platform's central claim is false.",
  tables: ["review_requests", "review_decisions", "review_events"],
  surfaces: ["Lawyer review", "Overview", "AI analysis"],
  invariants: ["INV-004", "AI-002", "AU-001"],
  guarantees: [
    {
      id: "RV-G1",
      statement: "Every read and write is scoped to one organisation and one case.",
      kind: "scoping",
      refuses:
        "a review queue shows a decision belonging to another organisation's case because scoping was applied in the panel rather than the query",
      provedBy: "review_reads_are_organisation_scoped",
    },
    {
      id: "RV-G2",
      statement: "A decision is written once. A second decision on the same request is refused.",
      kind: "integrity",
      refuses:
        "an approval is reversed by writing a second decision, leaving a record that reads as though the reviewer approved the amended version all along",
      provedBy: "review_decision_is_write_once",
    },
    {
      id: "RV-G3",
      statement:
        "A reserved legal activity cannot be authorised by a caller without the professional role for it.",
      kind: "permission",
      refuses:
        "a caseworker authorises a filing because the queue offered them the button and the constraint lived in the UI",
      provedBy: "review_reserved_activity_requires_professional",
    },
    {
      id: "RV-G4",
      statement:
        "The reviewer's role and regulatory reference are recorded as at the moment of the decision.",
      kind: "provenance",
      refuses:
        "a reviewer's later change of role rewrites the record of who authorised a filing and under what registration",
      provedBy: "review_role_captured_at_signing",
    },
    {
      id: "RV-G5",
      statement:
        "The decision records what the reviewer was looking at, so a later reader sees the same thing.",
      kind: "provenance",
      refuses:
        "a draft is edited after approval and the approval appears to cover the edited text",
      provedBy: "review_decision_binds_its_subject",
    },
    {
      id: "RV-G6",
      statement: "Request history is appended, never overwritten.",
      kind: "integrity",
      refuses:
        "an escalation or a withdrawn request disappears, so the record shows a clean approval where there was an argument",
      provedBy: "review_history_is_append_only",
    },
    {
      id: "RV-G7",
      statement: "Recording a decision writes an audit entry and the chain still verifies.",
      kind: "integrity",
      refuses:
        "an authorisation of reserved work leaves no entry in the audit chain, so the one action most needing an independent record has none",
      provedBy: "review_decision_is_audited",
    },
    {
      id: "RV-G8",
      statement: "No fixture is ever served in place of a persisted review.",
      kind: "availability",
      refuses:
        "a demonstration approval renders as a real one, so a caseworker believes a document has been signed off",
      provedBy: "review_no_fixture_fallback",
    },
    {
      // Added with the implementation, not renamed from anything. The same
      // abstention as DL-G9 and GR-G3: a reviewer reliability figure, or a
      // predicted-approval percentage, is exactly the number somebody would
      // triage by and exactly the number nothing here could justify.
      id: "RV-G9",
      statement: "No probability, confidence, score or percentage is emitted, under any name.",
      kind: "abstention",
      refuses:
        "a queue is triaged by a predicted-approval figure or a reviewer reliability score, neither of which any observation in this system was calibrated to produce",
      provedBy: "review_emits_no_probability",
    },
  ],
});
