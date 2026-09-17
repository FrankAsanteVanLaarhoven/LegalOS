/**
 * The legal knowledge graph.
 *
 * The distinguishing property is not that things are connected — it is that
 * every connection records *why it exists and who asserted it*. A graph that
 * merely links a medical report to an Article 3 argument can show you the link;
 * it cannot answer "why did we include this report?", which is the question a
 * solicitor, a reviewer, or a tribunal actually asks.
 *
 * So an edge without a stated basis is not a valid edge here, and an edge
 * asserted by an agent stays distinguishable from one a human asserted.
 */

export type NodeKind =
  | "person"
  | "document"
  | "evidence"
  | "legal_issue"
  | "timeline_event"
  | "law_source"
  | "requirement"
  | "task"
  | "decision"
  | "risk";

export type EdgeKind =
  | "supports" // evidence -> legal_issue
  | "contradicts" // evidence -> legal_issue
  | "evidences" // document -> timeline_event / evidence
  | "cites" // legal_issue / decision -> law_source
  | "requires" // requirement -> evidence
  | "derived_from" // any -> any, for material produced from other material
  | "resolves" // task -> requirement / risk
  | "raises"; // evidence / timeline_event -> risk

/** Who asserted a relationship. Never collapse these two. */
export type Asserter =
  | { readonly kind: "human"; readonly userId: string }
  | { readonly kind: "agent"; readonly agentId: string };

export interface GraphNode {
  readonly id: string;
  readonly kind: NodeKind;
  readonly label: string;
  /** Free-form attributes; kept opaque so the graph does not duplicate schemas. */
  readonly attributes?: Readonly<Record<string, string | number | boolean>>;
}

export interface GraphEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly kind: EdgeKind;
  /**
   * Why this relationship exists, in words a reviewer can assess.
   * Empty or whitespace-only is rejected: an unexplained link is how a graph
   * turns into a pile of plausible-looking associations nobody can audit.
   */
  readonly basis: string;
  readonly assertedBy: Asserter;
  /** ISO-8601. Supplied by the caller so construction stays deterministic. */
  readonly assertedAt: string;
  /** Registered legal source backing the assertion, where one applies. */
  readonly sourceId?: string;
}

export interface Path {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
}

/** One step in an answer to "why is this here?". */
export interface ProvenanceStep {
  readonly edge: GraphEdge;
  readonly node: GraphNode;
}

export interface ProvenanceAnswer {
  readonly node: GraphNode;
  readonly steps: readonly ProvenanceStep[];
  /**
   * True when every step was asserted by a human, or by an agent whose
   * assertion cites a registered source. A chain that rests on an unsourced
   * agent assertion is reported as such rather than presented as established.
   */
  readonly fullyAttributable: boolean;
  readonly unattributableEdgeIds: readonly string[];
}
