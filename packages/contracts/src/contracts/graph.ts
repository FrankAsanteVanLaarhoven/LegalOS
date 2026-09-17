import { defineContract } from "../guarantee.ts";

/**
 * The evidence graph repository contract.
 *
 * GR-G3 is the one worth reading twice. It is a guarantee about what the
 * repository will *never* emit, and it is the only kind of guarantee that can
 * hold a line against a feature request — because "show the confidence score"
 * is a reasonable-sounding thing to ask for right up until somebody submits on
 * the strength of one.
 */
export const GRAPH_CONTRACT = defineContract({
  repository: "GraphRepository",
  module: "packages/repositories/src/graph.ts",
  rationale:
    "A graph of unattributed edges is a diagram of conclusions nobody owns. Read quickly — which is how a diagram is read — it looks like established fact about a case, and the reader has no way to tell which lines a person drew and which a model suggested.",
  tables: ["graph_nodes", "graph_edges", "graph_assertions", "graph_evidence_links"],
  surfaces: ["Evidence graph", "Evidence", "AI analysis"],
  invariants: ["INV-001", "EV-005", "AI-001"],
  guarantees: [
    {
      id: "GR-G1",
      statement: "Every read is scoped to one organisation and one case.",
      kind: "scoping",
      refuses:
        "a node from another case joins the graph because nodes were fetched by subject id rather than by case",
      provedBy: "graph_reads_are_organisation_scoped",
    },
    {
      id: "GR-G2",
      statement: "No edge is returned without at least one assertion naming who asserted it.",
      kind: "provenance",
      refuses:
        "an unattributed line between two documents renders as an established relationship in the case",
      provedBy: "graph_every_edge_carries_an_assertion",
    },
    {
      id: "GR-G3",
      statement:
        "No probability, confidence or score is emitted, in any field, under any name.",
      kind: "abstention",
      refuses:
        "a percentage against a relationship is read as legal certainty, and a submission rests on a number the model was never calibrated to produce",
      provedBy: "graph_emits_no_probability",
    },
    {
      id: "GR-G4",
      statement:
        "A machine-proposed relationship is returned distinguishable from a human-confirmed one.",
      kind: "provenance",
      refuses:
        "a model's suggestion is adopted into a bundle because on screen it looked the same as a relationship a solicitor confirmed",
      provedBy: "graph_assertion_type_is_visible",
    },
    {
      id: "GR-G5",
      statement: "Retired edges are excluded from a default read, and remain readable by date.",
      kind: "filtering",
      refuses:
        "a relationship that stopped holding still renders, or — worse — is deleted, so what was believed on the day of a filing cannot be reconstructed",
      provedBy: "graph_retired_edges_excluded",
    },
    {
      id: "GR-G6",
      statement: "Assertion history is returned whole; a retraction is an addition, not an edit.",
      kind: "integrity",
      refuses:
        "a disputed relationship shows only the dispute, hiding that it was relied on earlier",
      provedBy: "graph_assertion_history_preserved",
    },
    {
      id: "GR-G7",
      statement:
        "A source-backed assertion is returned with the evidence and locator it rests on.",
      kind: "provenance",
      refuses:
        "an assertion claims documentary backing with no page to turn to, which is EV-005 failing quietly",
      provedBy: "graph_assertions_carry_source_locator",
    },
    {
      id: "GR-G8",
      statement: "No fixture is ever served in place of a persisted graph.",
      kind: "availability",
      refuses:
        "the in-memory demonstration graph renders as this client's case, showing relationships that were invented for a screenshot",
      provedBy: "graph_no_fixture_fallback",
    },
  ],
});
