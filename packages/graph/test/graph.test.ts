import { test } from "node:test";
import assert from "node:assert/strict";

import { edge, LegalGraph } from "../src/graph.ts";
import type { GraphNode } from "../src/types.ts";

const HUMAN = { kind: "human", userId: "user:solicitor-7" } as const;
const AGENT = { kind: "agent", agentId: "agent:evidence" } as const;
const AT = "2026-07-26T10:00:00.000Z";

const NODES: GraphNode[] = [
  { id: "issue-art3", kind: "legal_issue", label: "Article 3 ECHR risk on return" },
  { id: "issue-art8", kind: "legal_issue", label: "Article 8 private and family life" },
  { id: "doc-gp", kind: "document", label: "GP letter — trauma indicators" },
  { id: "ev-gp", kind: "evidence", label: "Medical evidence: GP letter" },
  { id: "ev-employment", kind: "evidence", label: "Employment record" },
  { id: "req-medical", kind: "requirement", label: "Independent medico-legal report" },
  { id: "law-msa", kind: "law_source", label: "Modern Slavery Act 2015" },
  { id: "task-obtain", kind: "task", label: "Instruct medico-legal expert" },
  { id: "risk-credibility", kind: "risk", label: "Credibility finding on return risk" },
];

function build(): LegalGraph {
  const graph = new LegalGraph();
  for (const node of NODES) graph.addNode(node);

  graph.addEdge(
    edge({
      id: "e1",
      from: "doc-gp",
      to: "ev-gp",
      kind: "evidences",
      basis: "The GP letter is the document behind the medical evidence entry.",
      assertedBy: HUMAN,
      assertedAt: AT,
    })
  );
  graph.addEdge(
    edge({
      id: "e2",
      from: "ev-gp",
      to: "issue-art3",
      kind: "supports",
      basis: "Trauma indicators are relevant to risk on return.",
      assertedBy: HUMAN,
      assertedAt: AT,
    })
  );
  graph.addEdge(
    edge({
      id: "e3",
      from: "req-medical",
      to: "ev-gp",
      kind: "requires",
      basis: "A GP letter alone is usually insufficient; a report was requested.",
      assertedBy: HUMAN,
      assertedAt: AT,
    })
  );
  graph.addEdge(
    edge({
      id: "e4",
      from: "issue-art3",
      to: "law-msa",
      kind: "cites",
      basis: "The NRM framework is established by this Act.",
      assertedBy: AGENT,
      assertedAt: AT,
      sourceId: "uk.legislation.modern-slavery-act-2015",
    })
  );
  graph.addEdge(
    edge({
      id: "e5",
      from: "ev-employment",
      to: "issue-art8",
      kind: "supports",
      basis: "Employment history is relevant to private life.",
      assertedBy: AGENT,
      assertedAt: AT,
    })
  );
  graph.addEdge(
    edge({
      id: "e6",
      from: "ev-employment",
      to: "issue-art3",
      kind: "contradicts",
      basis: "Continuous UK employment is in tension with the claimed period of control.",
      assertedBy: HUMAN,
      assertedAt: AT,
    })
  );
  graph.addEdge(
    edge({
      id: "e7",
      from: "task-obtain",
      to: "req-medical",
      kind: "resolves",
      basis: "This task exists to satisfy the outstanding requirement.",
      assertedBy: HUMAN,
      assertedAt: AT,
    })
  );
  graph.addEdge(
    edge({
      id: "e8",
      from: "ev-employment",
      to: "risk-credibility",
      kind: "raises",
      basis: "The tension with the claimed period of control is a credibility risk.",
      assertedBy: HUMAN,
      assertedAt: AT,
    })
  );
  return graph;
}

test("an edge with no stated basis is rejected", () => {
  const graph = new LegalGraph();
  graph.addNode(NODES[2]!);
  graph.addNode(NODES[3]!);
  assert.throws(
    () =>
      graph.addEdge(
        edge({
          id: "x",
          from: "doc-gp",
          to: "ev-gp",
          kind: "evidences",
          basis: "   ",
          assertedBy: HUMAN,
          assertedAt: AT,
        })
      ),
    /must say why it exists/
  );
});

test("edges cannot connect incompatible node kinds", () => {
  const graph = build();
  assert.throws(
    () =>
      graph.addEdge(
        edge({
          id: "bad",
          from: "law-msa",
          to: "issue-art3",
          kind: "supports",
          basis: "law does not 'support' an issue in this model",
          assertedBy: HUMAN,
          assertedAt: AT,
        })
      ),
    /cannot start at a law_source node/
  );
});

test("edges cannot reference unknown nodes", () => {
  const graph = build();
  assert.throws(
    () =>
      graph.addEdge(
        edge({
          id: "bad",
          from: "ev-gp",
          to: "issue-missing",
          kind: "supports",
          basis: "…",
          assertedBy: HUMAN,
          assertedAt: AT,
        })
      ),
    /unknown node issue-missing/
  );
});

test("material for an issue separates supporting from contradicting", () => {
  const graph = build();
  const art3 = graph.materialFor("issue-art3");
  assert.deepEqual(
    art3.supporting.map((s) => s.node.id),
    ["ev-gp"]
  );
  assert.deepEqual(
    art3.contradicting.map((s) => s.node.id),
    ["ev-employment"]
  );
});

test("every returned relationship carries the basis a reviewer needs", () => {
  const graph = build();
  const { supporting, contradicting } = graph.materialFor("issue-art3");
  for (const step of [...supporting, ...contradicting]) {
    assert.ok(step.edge.basis.length > 10, step.edge.id);
    assert.ok(step.edge.assertedBy.kind === "human" || step.edge.assertedBy.kind === "agent");
  }
});

test("'why did we include this?' returns a traceable chain", () => {
  const graph = build();
  const answer = graph.whyIncluded("doc-gp");
  const reached = answer.steps.map((s) => s.node.id);
  assert.ok(reached.includes("ev-gp"), "reaches the evidence entry");
  assert.ok(reached.includes("issue-art3"), "reaches the legal issue it supports");
  assert.ok(reached.includes("req-medical"), "reaches the requirement that asked for it");
  assert.ok(reached.includes("law-msa"), "reaches the cited source");
});

test("a chain resting on an unsourced agent assertion is reported, not asserted", () => {
  const graph = build();
  const answer = graph.whyIncluded("ev-employment");
  assert.equal(answer.fullyAttributable, false);
  assert.deepEqual(answer.unattributableEdgeIds, ["e5"]);
});

test("a human-asserted chain, and an agent chain citing a source, are attributable", () => {
  const graph = build();
  assert.equal(graph.whyIncluded("doc-gp").fullyAttributable, true);
});

test("unsourced agent assertions can be listed for review", () => {
  const graph = build();
  assert.deepEqual(
    graph.unsourcedAgentAssertions().map((e) => e.id),
    ["e5"]
  );
});

test("paths connect a document to the law it ultimately bears on", () => {
  const graph = build();
  const path = graph.pathBetween("doc-gp", "law-msa");
  assert.ok(path);
  assert.deepEqual(
    path.edges.map((e) => e.id),
    ["e1", "e2", "e4"]
  );
  assert.equal(path.nodes.at(-1)?.id, "law-msa");
});

test("no path is reported as null rather than an empty answer", () => {
  const graph = build();
  assert.equal(graph.pathBetween("law-msa", "doc-gp"), null);
  assert.equal(graph.pathBetween("doc-gp", "nope"), null);
});

test("orphan nodes are surfaced", () => {
  const graph = build();
  graph.addNode({ id: "doc-unknown", kind: "document", label: "Unfiled scan" });
  assert.deepEqual(
    graph.orphans().map((n) => n.id),
    ["doc-unknown"]
  );
});

test("duplicate ids are rejected for nodes and edges", () => {
  const graph = build();
  assert.throws(() => graph.addNode(NODES[0]!), /duplicate node id/);
  assert.throws(
    () =>
      graph.addEdge(
        edge({
          id: "e1",
          from: "doc-gp",
          to: "ev-gp",
          kind: "evidences",
          basis: "duplicate",
          assertedBy: HUMAN,
          assertedAt: AT,
        })
      ),
    /duplicate edge id/
  );
});
