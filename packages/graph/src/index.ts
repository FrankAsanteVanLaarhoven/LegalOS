/**
 * @legalos/graph — the legal knowledge graph and living case memory.
 *
 * Documents, evidence, events, legal issues, sources, requirements, tasks,
 * decisions and risks in one typed graph where every relationship records why
 * it exists and who asserted it. That is what makes "why did we include this
 * medical report?" and "show all evidence supporting Article 8" answerable with
 * a traceable chain rather than a similarity score.
 */

export { LegalGraph, edge } from "./graph.ts";
export type {
  Asserter,
  EdgeKind,
  GraphEdge,
  GraphNode,
  NodeKind,
  Path,
  ProvenanceAnswer,
  ProvenanceStep,
} from "./types.ts";
