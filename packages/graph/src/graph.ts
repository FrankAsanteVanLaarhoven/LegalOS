import type {
  Asserter,
  EdgeKind,
  GraphEdge,
  GraphNode,
  NodeKind,
  Path,
  ProvenanceAnswer,
  ProvenanceStep,
} from "./types.ts";

/** Which node kinds an edge is allowed to connect. */
const EDGE_RULES: Readonly<Record<EdgeKind, { from: NodeKind[]; to: NodeKind[] }>> = {
  supports: { from: ["evidence", "document", "timeline_event"], to: ["legal_issue"] },
  contradicts: { from: ["evidence", "document", "timeline_event"], to: ["legal_issue"] },
  evidences: { from: ["document"], to: ["evidence", "timeline_event"] },
  cites: { from: ["legal_issue", "decision", "requirement"], to: ["law_source"] },
  requires: { from: ["requirement"], to: ["evidence"] },
  derived_from: {
    from: ["document", "evidence", "timeline_event", "decision", "risk", "task"],
    to: ["document", "evidence", "timeline_event", "decision", "requirement", "risk"],
  },
  resolves: { from: ["task"], to: ["requirement", "risk"] },
  raises: { from: ["evidence", "timeline_event", "document"], to: ["risk"] },
};

export class LegalGraph {
  readonly #nodes = new Map<string, GraphNode>();
  readonly #edges = new Map<string, GraphEdge>();
  readonly #outgoing = new Map<string, GraphEdge[]>();
  readonly #incoming = new Map<string, GraphEdge[]>();

  addNode(node: GraphNode): void {
    if (this.#nodes.has(node.id)) throw new Error(`duplicate node id: ${node.id}`);
    this.#nodes.set(node.id, node);
  }

  addEdge(edge: GraphEdge): void {
    if (this.#edges.has(edge.id)) throw new Error(`duplicate edge id: ${edge.id}`);

    const from = this.#nodes.get(edge.from);
    const to = this.#nodes.get(edge.to);
    if (!from) throw new Error(`edge ${edge.id} references unknown node ${edge.from}`);
    if (!to) throw new Error(`edge ${edge.id} references unknown node ${edge.to}`);

    if (edge.basis.trim() === "") {
      throw new Error(`edge ${edge.id} has no basis: every relationship must say why it exists`);
    }

    const rule = EDGE_RULES[edge.kind];
    if (!rule.from.includes(from.kind)) {
      throw new Error(`edge ${edge.id}: ${edge.kind} cannot start at a ${from.kind} node`);
    }
    if (!rule.to.includes(to.kind)) {
      throw new Error(`edge ${edge.id}: ${edge.kind} cannot end at a ${to.kind} node`);
    }

    this.#edges.set(edge.id, edge);
    this.#push(this.#outgoing, edge.from, edge);
    this.#push(this.#incoming, edge.to, edge);
  }

  #push(index: Map<string, GraphEdge[]>, key: string, edge: GraphEdge): void {
    const existing = index.get(key);
    if (existing) existing.push(edge);
    else index.set(key, [edge]);
  }

  node(id: string): GraphNode | null {
    return this.#nodes.get(id) ?? null;
  }

  nodes(kind?: NodeKind): readonly GraphNode[] {
    const all = [...this.#nodes.values()];
    return kind ? all.filter((node) => node.kind === kind) : all;
  }

  edges(): readonly GraphEdge[] {
    return [...this.#edges.values()];
  }

  outgoing(nodeId: string): readonly GraphEdge[] {
    return this.#outgoing.get(nodeId) ?? [];
  }

  incoming(nodeId: string): readonly GraphEdge[] {
    return this.#incoming.get(nodeId) ?? [];
  }

  /**
   * "Show me all evidence supporting Article 8."
   *
   * Returns supporting and contradicting material separately — a graph that
   * surfaces only what supports a position is an advocacy tool, not a case
   * file, and the contradicting material is what a reviewer most needs.
   */
  materialFor(issueId: string): {
    supporting: readonly ProvenanceStep[];
    contradicting: readonly ProvenanceStep[];
  } {
    const supporting: ProvenanceStep[] = [];
    const contradicting: ProvenanceStep[] = [];

    for (const edge of this.incoming(issueId)) {
      const node = this.#nodes.get(edge.from);
      if (!node) continue;
      if (edge.kind === "supports") supporting.push({ edge, node });
      if (edge.kind === "contradicts") contradicting.push({ edge, node });
    }

    return { supporting, contradicting };
  }

  /**
   * "Why did we include this medical report?"
   *
   * Walks outward from the node along the relationships that explain its
   * presence, and reports whether the whole chain is attributable.
   */
  whyIncluded(nodeId: string): ProvenanceAnswer {
    const node = this.#nodes.get(nodeId);
    if (!node) throw new Error(`unknown node: ${nodeId}`);

    const steps: ProvenanceStep[] = [];
    const unattributable: string[] = [];
    const seen = new Set<string>([nodeId]);
    const queue: string[] = [nodeId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const edge of this.outgoing(current)) {
        if (seen.has(edge.to)) continue;
        const target = this.#nodes.get(edge.to);
        if (!target) continue;
        seen.add(edge.to);
        steps.push({ edge, node: target });
        if (!isAttributable(edge)) unattributable.push(edge.id);
        queue.push(edge.to);
      }
      // A requirement that asked for this node also explains its presence.
      for (const edge of this.incoming(current)) {
        if (edge.kind !== "requires" || seen.has(edge.from)) continue;
        const source = this.#nodes.get(edge.from);
        if (!source) continue;
        seen.add(edge.from);
        steps.push({ edge, node: source });
        if (!isAttributable(edge)) unattributable.push(edge.id);
        queue.push(edge.from);
      }
    }

    return {
      node,
      steps,
      fullyAttributable: unattributable.length === 0,
      unattributableEdgeIds: unattributable,
    };
  }

  /** Shortest relationship path between two nodes, or null when none exists. */
  pathBetween(fromId: string, toId: string): Path | null {
    if (!this.#nodes.has(fromId) || !this.#nodes.has(toId)) return null;
    if (fromId === toId) {
      return { nodes: [this.#nodes.get(fromId)!], edges: [] };
    }

    const previous = new Map<string, GraphEdge>();
    const seen = new Set<string>([fromId]);
    const queue: string[] = [fromId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const edge of this.outgoing(current)) {
        if (seen.has(edge.to)) continue;
        seen.add(edge.to);
        previous.set(edge.to, edge);
        if (edge.to === toId) return this.#reconstruct(fromId, toId, previous);
        queue.push(edge.to);
      }
    }
    return null;
  }

  #reconstruct(fromId: string, toId: string, previous: Map<string, GraphEdge>): Path {
    const edges: GraphEdge[] = [];
    let walker = toId;
    while (walker !== fromId) {
      const edge = previous.get(walker);
      if (!edge) break;
      edges.unshift(edge);
      walker = edge.from;
    }
    const nodes = [this.#nodes.get(fromId)!, ...edges.map((e) => this.#nodes.get(e.to)!)];
    return { nodes, edges };
  }

  /**
   * Nodes nothing explains — no incoming requirement and no outgoing
   * relationship. In a case file these are the documents nobody can account for.
   */
  orphans(): readonly GraphNode[] {
    return this.nodes().filter(
      (node) => this.outgoing(node.id).length === 0 && this.incoming(node.id).length === 0
    );
  }

  /** Every relationship an agent asserted without citing a source. */
  unsourcedAgentAssertions(): readonly GraphEdge[] {
    return this.edges().filter((edge) => !isAttributable(edge));
  }
}

function isAttributable(edge: GraphEdge): boolean {
  if (edge.assertedBy.kind === "human") return true;
  return typeof edge.sourceId === "string" && edge.sourceId.trim() !== "";
}

/** Convenience constructor keeping call sites readable. */
export function edge(input: {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  basis: string;
  assertedBy: Asserter;
  assertedAt: string;
  sourceId?: string;
}): GraphEdge {
  return input.sourceId === undefined
    ? {
        id: input.id,
        from: input.from,
        to: input.to,
        kind: input.kind,
        basis: input.basis,
        assertedBy: input.assertedBy,
        assertedAt: input.assertedAt,
      }
    : { ...input, sourceId: input.sourceId };
}
