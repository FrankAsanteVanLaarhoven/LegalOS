/**
 * The evidence-graph domain model.
 *
 * A graph of unattributed edges is a diagram of conclusions nobody owns. Read
 * quickly — which is how a diagram is read — it looks like established fact
 * about a case, and the reader has no way to tell which lines a person drew and
 * which a model suggested. Everything here exists to keep that distinction on
 * the surface.
 */

export const NODE_TYPES = [
  "evidence",
  "timeline_event",
  "person",
  "issue",
  "claim",
  "document",
  "deadline",
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export const RELATIONSHIPS = [
  "supports",
  "contradicts",
  "corroborates",
  "supersedes",
  "refers_to",
  "derived_from",
  "concerns",
  "precedes",
] as const;
export type Relationship = (typeof RELATIONSHIPS)[number];

/**
 * How a relationship came to be known. The schema's four values, used as they
 * are — no second vocabulary is invented on top of them.
 *
 * They are ordered by the weight a submission can bear. A submission may rest
 * on `source_backed` or `human_confirmed`; it may not rest on
 * `machine_proposed` without a person adopting it, which is a separate
 * assertion by a named person rather than a state change on this one.
 */
export const ASSERTION_TYPES = [
  "machine_proposed",
  "source_backed",
  "human_confirmed",
  "disputed",
] as const;
export type AssertionType = (typeof ASSERTION_TYPES)[number];

export const ASSERTED_BY_TYPES = ["user", "agent"] as const;
export type AssertedByType = (typeof ASSERTED_BY_TYPES)[number];

/** Assertion types that claim documentary backing, and so fall under EV-005. */
export const CLAIMS_DOCUMENTARY_BACKING: readonly AssertionType[] = ["source_backed"];

export const MAY_WRITE_GRAPH = ["caseworker", "adviser", "solicitor", "admin"] as const;

export interface EvidenceLinkRecord {
  readonly evidenceId: string;
  /** Never null and never blank — the schema constraint sees to that. */
  readonly locator: string;
  readonly createdBy: string | null;
  readonly createdAt: string;
}

export interface AssertionRecord {
  readonly id: string;
  readonly edgeId: string;
  readonly organisationId: string;
  readonly caseId: string;
  readonly assertionType: AssertionType;
  readonly assertedByType: AssertedByType;
  readonly assertedById: string;
  /** The execution behind a machine assertion, so it is reproducible. */
  readonly executionId: string | null;
  readonly reason: string;
  readonly assertedAt: string;
  /** The assertion this one replaces, when it replaces one. */
  readonly supersedesId: string | null;
  /** The assertion that replaced this one, when one has. */
  readonly supersededById: string | null;
  /** False once something has replaced it. Derived, never stored. */
  readonly current: boolean;
  readonly evidence: readonly EvidenceLinkRecord[];
  /**
   * Whether this assertion's documentary claim is actually traceable. Null when
   * it makes no documentary claim, so "no document" and "not applicable" stay
   * distinguishable. This is the same rule EV-005 measures.
   */
  readonly traceable: boolean | null;
}

export interface EdgeRecord {
  readonly id: string;
  readonly organisationId: string;
  readonly caseId: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly relationship: Relationship;
  readonly validFrom: string;
  readonly validTo: string | null;
  readonly supersededById: string | null;
  readonly invalidatedBy: string | null;
  readonly invalidationReason: string | null;
  readonly createdAt: string;
  /** Whether this relationship is asserted to hold now. */
  readonly live: boolean;
  /**
   * The weight the edge currently carries, derived from its live assertions.
   * A categorical state from the schema's own vocabulary — never a number.
   */
  readonly verificationState: AssertionType;
  readonly assertions: readonly AssertionRecord[];
}

export interface NodeRecord {
  readonly id: string;
  readonly organisationId: string;
  readonly caseId: string;
  readonly nodeType: NodeType;
  readonly subjectId: string;
  readonly label: string;
  readonly createdAt: string;
}

export interface GraphView {
  readonly nodes: readonly NodeRecord[];
  readonly edges: readonly EdgeRecord[];
}

/**
 * The weight an edge carries, from the assertions currently in force.
 *
 * `disputed` dominates everything. An edge that a person has disputed must not
 * read as confirmed because somebody else confirmed it earlier — the
 * disagreement is the most important thing about it, and a diagram that hides
 * disagreement is worse than one that omits the edge.
 *
 * With no live assertions the answer is `machine_proposed`, the weakest state.
 * That combination should not reach a reader at all — GR-G2 excludes edges with
 * no assertion — and if it ever does, it must not arrive looking strong.
 */
export function verificationStateOf(
  types: readonly AssertionType[]
): AssertionType {
  if (types.includes("disputed")) return "disputed";
  if (types.includes("human_confirmed")) return "human_confirmed";
  if (types.includes("source_backed")) return "source_backed";
  return "machine_proposed";
}

/**
 * Whether an assertion's documentary claim is traceable.
 *
 * Null for assertions that make no documentary claim. The distinction matters:
 * a `machine_proposed` assertion with no evidence is not in breach of anything,
 * whereas a `source_backed` one with no evidence is claiming a document that
 * does not exist.
 */
export function traceabilityOf(
  type: AssertionType,
  usableLinks: number
): boolean | null {
  if (!CLAIMS_DOCUMENTARY_BACKING.includes(type)) return null;
  return usableLinks > 0;
}

/** A locator a reader could actually act on. */
export function isUsableLocator(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Deterministic order for every graph read.
 *
 * Nodes by type then subject, edges by creation then id, assertions oldest
 * first so a supersession chain reads forwards. Without the final key on each,
 * the order is whatever the plan produced, and a rendered graph relabels itself
 * between loads for no reason a reader can see.
 */
export const NODE_ORDER = "ORDER BY n.node_type ASC, n.subject_id ASC, n.id ASC";
export const EDGE_ORDER = "ORDER BY e.created_at ASC, e.id ASC";
export const ASSERTION_ORDER = "ORDER BY a.asserted_at ASC, a.id ASC";

/** Fields that can hold free text a person wrote. Referenced by ADR-002. */
export const PERSONAL_TEXT_FIELDS = {
  graph_nodes: ["label", "subject_id"],
  graph_assertions: ["reason", "asserted_by_id"],
  graph_edges: ["invalidation_reason"],
  graph_evidence_links: ["locator"],
} as const;
