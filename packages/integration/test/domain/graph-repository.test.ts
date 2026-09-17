import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Membership } from "@legalos/auth";
import {
  observeAssertionTraceability,
  readingOf,
  TRACEABILITY_SQL,
} from "@legalos/capabilities";
import {
  bootstrapTenancy,
  createPool,
  PostgresAuditStore,
  withTransaction,
  type PoolClientLike,
  type PoolLike,
} from "@legalos/database";
import { GraphRepository, type RepositoryContext } from "@legalos/repositories";

import { guardOrSkip } from "../guard.ts";
import { emitEvidence } from "../../src/index.ts";

/**
 * The evidence graph repository, against a real database.
 *
 * A diagram is read quickly and believed. Most of what follows tries to get
 * something into the picture that a reader would take as established: an edge
 * nobody asserted, a model's suggestion dressed as documentary backing, a
 * citation pointing at a document from another matter, or a number.
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = guardOrSkip(DATABASE_URL);

const held = new Map<string, boolean>();
function records(name: string, fn: () => Promise<void>) {
  return async () => {
    held.set(name, false);
    await fn();
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

const run = Date.now().toString(36);

let pool: PoolLike;
let repo: GraphRepository;

interface Tenancy {
  organisationId: string;
  workspaceId: string;
  caseId: string;
  caseworkerId: string;
  solicitorId: string;
  evidenceIds: readonly string[];
}
let alpha: Tenancy;
let beta: Tenancy;
let executionId = "";

const ACCOUNT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OUTSIDER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const membership = (over: Partial<Membership> & { workspaceId: string }): Membership => ({
  accountId: ACCOUNT,
  role: "caseworker",
  regulatoryReference: null,
  removedAt: null,
  ...over,
});

const worker = (): RepositoryContext => ({
  actorId: alpha.caseworkerId,
  accountId: ACCOUNT,
  organisationId: alpha.organisationId,
  memberships: [membership({ workspaceId: alpha.workspaceId })],
  correlationId: `graph-${run}`,
});

async function tenancy(name: string): Promise<Tenancy> {
  const t = await withTransaction(pool, (tx) =>
    bootstrapTenancy(tx, {
      organisationName: `${name} ${run}`,
      workspaceName: `${name} workspace`,
      caseReference: `${name.toUpperCase()}-${run}`,
      at: "2026-07-27T12:00:00.000Z",
      operator: "test",
    })
  );
  return {
    organisationId: t.organisationId,
    workspaceId: t.workspaceId,
    caseId: t.caseId,
    caseworkerId: t.caseworkerId,
    solicitorId: t.administratorId,
    evidenceIds: t.evidenceIds,
  };
}

function value<T>(r: { ok: true; value: T } | { ok: false; refusal: { detail: string } }): T {
  assert.ok(r.ok, `expected success, got refusal: ${r.ok ? "" : r.refusal.detail}`);
  return r.value;
}

let nodeSeq = 0;
async function node(context = worker(), caseId = alpha.caseId) {
  return value(
    await repo.createNode(context, {
      caseId,
      nodeType: "evidence",
      subjectId: `subject-${run}-${nodeSeq++}`,
      label: `Document ${nodeSeq}`,
    })
  );
}

/** An edge with a human-confirmed first assertion, which is the ordinary case. */
async function edge(over: Record<string, unknown> = {}) {
  const a = await node();
  const b = await node();
  return value(
    await repo.createEdge(worker(), {
      caseId: alpha.caseId,
      fromNodeId: a.id,
      toNodeId: b.id,
      relationship: "supports",
      assertion: {
        assertionType: "human_confirmed",
        assertedByType: "user",
        assertedById: alpha.caseworkerId,
        reason: "both letters name the same employer",
      },
      ...over,
    })
  );
}

const query = (sql: string) => pool.query(sql) as Promise<{ rows: Record<string, unknown>[] }>;

before(async () => {
  if (skip) return;
  pool = await createPool(DATABASE_URL);
  repo = new GraphRepository(pool);
  alpha = await tenancy("Alpha graph");
  beta = await tenancy("Beta graph");

  // EV-005 now requires the cited evidence to have retrievable bytes. The
  // bootstrap seeds evidence items with no file, so this suite gives them one.
  // Written directly rather than through EvidenceRepository, because this is
  // fixture setup for the graph's tests and not a claim about evidence.
  for (const t of [alpha, beta]) {
    for (const id of t.evidenceIds) {
      const f = await pool.query<{ id: string }>(
        `INSERT INTO evidence_files (evidence_id, version, storage_provider, storage_key,
           media_type, byte_size, digest, uploaded_by, availability)
         VALUES ($1, 1, 'development_filesystem', $2, 'application/pdf', 4,
                 repeat('d',64), $3, 'available') RETURNING id`,
        [id, `${id}/1`, t.caseworkerId]
      );
      await pool.query(
        `INSERT INTO evidence_provenance (evidence_id, acquisition, asserted_by)
         VALUES ($1,'client_supplied',$2)`,
        [id, t.caseworkerId]
      );
      await pool.query("UPDATE evidence_items SET current_file_id = $1 WHERE id = $2", [
        f.rows[0]!.id,
        id,
      ]);
    }
  }

  await pool.query(
    `INSERT INTO prompt_templates (id, version, kind, body, body_hash)
     VALUES ($1,'1','system','a template used only by this test',repeat('e',64))
     ON CONFLICT DO NOTHING`,
    [`gtmpl-${run}`]
  );
  const e = await pool.query<{ id: string }>(
    `INSERT INTO ai_executions (
       organisation_id, case_id, actor_id, actor_type, department, agent_id, agent_version,
       provider, model, model_version, prompt_template_id, prompt_template_version,
       system_prompt_hash, user_message_hash, verified_source_count, unverified_source_count,
       registry_version, guardrail_version, verification_verdict)
     VALUES ($1,$2,$3,'caseworker','analysis','graph-agent','1.0.0',
             'test-provider','test-model','1',$4,'1',
             repeat('a',64), repeat('b',64), 0, 0, '1', '1', 'pass')
     RETURNING id`,
    [alpha.organisationId, alpha.caseId, alpha.caseworkerId, `gtmpl-${run}`]
  );
  executionId = e.rows[0]!.id;
});

/* ================================================================ */
/* Tenancy                                                          */
/* ================================================================ */

test(
  "a caller from one organisation cannot read or write another's graph",
  { skip },
  records("cross_org", async () => {
    const betaContext: RepositoryContext = {
      actorId: beta.caseworkerId,
      accountId: OUTSIDER,
      organisationId: beta.organisationId,
      memberships: [membership({ workspaceId: beta.workspaceId, accountId: OUTSIDER })],
    };
    await node(betaContext, beta.caseId);

    const read = await repo.readGraph(worker(), beta.caseId);
    assert.equal(read.ok === false && read.refusal.reason, "NOT_PERSISTED");

    const write = await repo.createNode(worker(), {
      caseId: beta.caseId,
      nodeType: "claim",
      subjectId: `intruder-${run}`,
      label: "should not exist",
    });
    assert.equal(write.ok === false && write.refusal.reason, "NOT_PERSISTED");
  })
);

test(
  "a person acting for two organisations carries nothing between them",
  { skip },
  records("dual_membership_isolated", async () => {
    const dual: RepositoryContext = {
      actorId: alpha.caseworkerId,
      accountId: ACCOUNT,
      organisationId: alpha.organisationId,
      memberships: [
        membership({ workspaceId: alpha.workspaceId }),
        membership({ workspaceId: beta.workspaceId }),
      ],
    };
    const read = await repo.readGraph(dual, beta.caseId);
    assert.equal(read.ok === false && read.refusal.reason, "NOT_PERSISTED");

    const write = await repo.createNode(dual, {
      caseId: beta.caseId,
      nodeType: "claim",
      subjectId: `dual-${run}`,
      label: "should not exist",
    });
    assert.equal(write.ok === false && write.refusal.reason, "NOT_PERSISTED");

    const scoped: RepositoryContext = { ...dual, organisationId: beta.organisationId };
    assert.equal((await repo.readGraph(scoped, beta.caseId)).ok, true);
  })
);

test(
  "a client may read the graph and may not write to it",
  { skip },
  records("client_cannot_write", async () => {
    const client: RepositoryContext = {
      ...worker(),
      memberships: [membership({ workspaceId: alpha.workspaceId, role: "client" })],
    };
    assert.equal((await repo.readGraph(client, alpha.caseId)).ok, true);
    const write = await repo.createNode(client, {
      caseId: alpha.caseId,
      nodeType: "claim",
      subjectId: `client-${run}`,
      label: "no",
    });
    assert.equal(write.ok === false && write.refusal.reason, "FORBIDDEN");
  })
);

/* ================================================================ */
/* Nodes and edges                                                  */
/* ================================================================ */

test(
  "one node per subject, so a case is drawn once",
  { skip },
  records("node_identity", async () => {
    const first = await node();
    const again = await repo.createNode(worker(), {
      caseId: alpha.caseId,
      nodeType: "evidence",
      subjectId: first.subjectId,
      label: "a second picture of the same document",
    });
    assert.equal(again.ok === false && again.refusal.reason, "CONFLICT");
  })
);

test(
  "an edge cannot be created between nodes from another case",
  { skip },
  records("foreign_nodes", async () => {
    const mine = await node();
    const betaContext: RepositoryContext = {
      actorId: beta.caseworkerId,
      accountId: OUTSIDER,
      organisationId: beta.organisationId,
      memberships: [membership({ workspaceId: beta.workspaceId, accountId: OUTSIDER })],
    };
    const theirs = await node(betaContext, beta.caseId);

    const result = await repo.createEdge(worker(), {
      caseId: alpha.caseId,
      fromNodeId: mine.id,
      toNodeId: theirs.id,
      relationship: "supports",
      assertion: {
        assertionType: "human_confirmed",
        assertedByType: "user",
        assertedById: alpha.caseworkerId,
        reason: "no",
      },
    });
    assert.equal(result.ok === false && result.refusal.reason, "NOT_PERSISTED");
  })
);

test(
  "no edge is ever returned without an assertion naming who asserted it",
  { skip },
  records("every_edge_has_an_author", async () => {
    // An unattributed line between two documents renders as an established
    // relationship in the case, and nothing on screen says otherwise. Here one
    // is inserted directly, as a stray script would.
    const a = await node();
    const b = await node();
    const orphan = await pool.query<{ id: string }>(
      `INSERT INTO graph_edges (organisation_id, case_id, from_node_id, to_node_id, relationship)
       VALUES ($1,$2,$3,$4,'concerns') RETURNING id`,
      [alpha.organisationId, alpha.caseId, a.id, b.id]
    );

    const graph = value(await repo.readGraph(worker(), alpha.caseId));
    assert.ok(
      !graph.edges.some((e) => e.id === orphan.rows[0]!.id),
      "an unattributed edge reached the read model"
    );
    for (const e of graph.edges) {
      assert.ok(e.assertions.length > 0);
      for (const a of e.assertions) {
        assert.ok(a.assertedById.trim().length > 0);
        assert.ok(a.reason.trim().length > 0);
      }
    }
  })
);

test(
  "a duplicate live edge is refused",
  { skip },
  records("duplicate_live_edge", async () => {
    // Two edges for one relationship draw two different pictures of one case.
    const a = await node();
    const b = await node();
    const input = {
      caseId: alpha.caseId,
      fromNodeId: a.id,
      toNodeId: b.id,
      relationship: "corroborates" as const,
      assertion: {
        assertionType: "human_confirmed" as const,
        assertedByType: "user" as const,
        assertedById: alpha.caseworkerId,
        reason: "the dates agree",
      },
    };
    value(await repo.createEdge(worker(), input));
    const again = await repo.createEdge(worker(), input);
    assert.equal(again.ok === false && again.refusal.reason, "CONFLICT");
  })
);

test(
  "a machine-proposed edge must cite its execution and stays distinguishable",
  { skip },
  records("machine_assertions", async () => {
    // The failure: a model's suggestion adopted into a bundle because on screen
    // it looked the same as a relationship a solicitor confirmed.
    const a = await node();
    const b = await node();
    const uncited = await repo.createEdge(worker(), {
      caseId: alpha.caseId,
      fromNodeId: a.id,
      toNodeId: b.id,
      relationship: "supports",
      assertion: {
        assertionType: "machine_proposed",
        assertedByType: "agent",
        assertedById: "graph-agent",
        reason: "the dates align",
      },
    });
    assert.equal(uncited.ok === false && uncited.refusal.reason, "INVALID");

    const cited = value(
      await repo.createEdge(worker(), {
        caseId: alpha.caseId,
        fromNodeId: a.id,
        toNodeId: b.id,
        relationship: "supports",
        assertion: {
          assertionType: "machine_proposed",
          assertedByType: "agent",
          assertedById: "graph-agent",
          executionId,
          reason: "the dates align",
        },
      })
    );
    assert.equal(cited.verificationState, "machine_proposed");
    assert.equal(cited.assertions[0]!.assertedByType, "agent");
    assert.equal(cited.assertions[0]!.executionId, executionId);
    // A model-inferred assertion is not document-supported and carries no
    // traceability claim, so `traceable` is null rather than false.
    assert.equal(cited.assertions[0]!.traceable, null);
  })
);

test(
  "a human confirmation cannot be attributed to an agent",
  { skip },
  records("human_needs_a_person", async () => {
    const a = await node();
    const b = await node();
    const result = await repo.createEdge(worker(), {
      caseId: alpha.caseId,
      fromNodeId: a.id,
      toNodeId: b.id,
      relationship: "supports",
      assertion: {
        assertionType: "human_confirmed",
        assertedByType: "agent",
        assertedById: "some-agent",
        reason: "confirmed",
      },
    });
    assert.equal(result.ok === false && result.refusal.reason, "INVALID");
  })
);

test(
  "a disputed assertion dominates the edge's verification state",
  { skip },
  records("dispute_dominates", async () => {
    // A diagram that hides disagreement is worse than one that omits the edge.
    const e = await edge();
    assert.equal(e.verificationState, "human_confirmed");

    value(
      await repo.createAssertion(worker(), {
        caseId: alpha.caseId,
        edgeId: e.id,
        assertionType: "disputed",
        assertedByType: "user",
        assertedById: alpha.solicitorId,
        reason: "the employers are different companies with similar names",
      })
    );

    const graph = value(await repo.readGraph(worker(), alpha.caseId));
    const found = graph.edges.find((x) => x.id === e.id)!;
    assert.equal(found.verificationState, "disputed");
    assert.equal(found.assertions.length, 2);
  })
);

/* ================================================================ */
/* GR-G3 abstention                                                 */
/* ================================================================ */

/** Walks every field of every emitted object, however deeply nested. */
function scan(value: unknown, path: string, found: string[]): void {
  const FORBIDDEN =
    /confidence|probability|likelihood|certainty|credibility|score|risk|strength|weight|trust|quality|reliability/i;
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => scan(v, `${path}[${i}]`, found));
    return;
  }
  if (typeof value === "object") {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      const here = `${path}.${key}`;
      if (FORBIDDEN.test(key)) found.push(`${here} (name)`);
      if (typeof v === "number") found.push(`${here} (numeric: ${v})`);
      scan(v, here, found);
    }
    return;
  }
}

test(
  "no numeric judgement or score-like field is emitted anywhere in the graph",
  { skip },
  records("no_probability", async () => {
    // GR-G3. Checked recursively on the emitted objects rather than on the
    // schema, because the place a figure would appear is a derived field
    // somebody added to be helpful — which the schema would never see.
    const graph = value(
      await repo.readGraph(worker(), alpha.caseId, {
        includeRetired: true,
        includeSupersededAssertions: true,
      })
    );
    assert.ok(graph.edges.length > 0 && graph.nodes.length > 0);

    const found: string[] = [];
    scan(graph, "graph", found);
    assert.deepEqual(found, [], `the graph emitted ${found.join(", ")}`);
  })
);

test(
  "the abstention scan would catch a plausible confidence field",
  { skip },
  records("abstention_scan_works", async () => {
    // A scanner only ever seen returning nothing is indistinguishable from one
    // that cannot find anything. This is the same object with the field a
    // well-meaning contributor would add.
    const graph = value(await repo.readGraph(worker(), alpha.caseId));
    const tampered = {
      ...graph,
      edges: graph.edges.map((e, i) =>
        i === 0 ? { ...e, confidence: 0.84 } : e
      ),
    };
    const found: string[] = [];
    scan(tampered, "graph", found);
    assert.ok(found.length >= 2, "the scan missed an added confidence field");
    assert.ok(found.some((f) => /confidence \(name\)/.test(f)));
    assert.ok(found.some((f) => /numeric: 0.84/.test(f)));
  })
);

/* ================================================================ */
/* EV-005 / GR-G7                                                   */
/* ================================================================ */

test(
  "the EV-005 observer reports violated when a source-backed assertion has no evidence",
  { skip },
  records("observer_violated", async () => {
    // The production observer, called directly — not a re-typed copy. An
    // assertion claiming documentary backing with nothing to turn to is
    // EV-005 failing, and it must say so.
    const e = await edge();
    value(
      await repo.createAssertion(worker(), {
        caseId: alpha.caseId,
        edgeId: e.id,
        assertionType: "source_backed",
        assertedByType: "user",
        assertedById: alpha.caseworkerId,
        reason: "the employment letter says so",
      })
    );

    const observation = await observeAssertionTraceability(query);
    assert.equal(observation.value, false, "the observer reported a green EV-005 with no evidence");
    assert.match(observation.method, /without a same-case, same-organisation, provenanced, available evidence item/);

    const graph = value(await repo.readGraph(worker(), alpha.caseId));
    const assertion = graph.edges
      .flatMap((x) => x.assertions)
      .find((a) => a.assertionType === "source_backed")!;
    assert.equal(assertion.traceable, false);
  })
);

test(
  "linking real evidence with a locator makes the observer satisfied",
  { skip },
  records("observer_satisfied", async () => {
    // Attach evidence to every outstanding source-backed assertion, then check
    // the observer flips. It must be the same function, on the same data.
    const graph = value(await repo.readGraph(worker(), alpha.caseId));
    const untraceable = graph.edges
      .flatMap((x) => x.assertions)
      .filter((a) => a.traceable === false);
    assert.ok(untraceable.length > 0, "nothing was untraceable to fix");

    for (const a of untraceable) {
      value(
        await repo.linkAssertionEvidence(worker(), {
          caseId: alpha.caseId,
          assertionId: a.id,
          evidenceId: alpha.evidenceIds[0]!,
          locator: "page 2, second paragraph",
        })
      );
    }

    const observation = await observeAssertionTraceability(query);
    assert.equal(observation.value, true, `observer still failing: ${observation.method}`);

    const after = value(await repo.readGraph(worker(), alpha.caseId));
    for (const a of after.edges.flatMap((x) => x.assertions)) {
      if (a.assertionType === "source_backed") {
        assert.equal(a.traceable, true);
        assert.ok(a.evidence.length > 0);
        assert.ok(a.evidence.every((l) => l.locator.trim().length > 0));
      }
    }
  })
);

test(
  "evidence on a different assertion does not satisfy this one",
  { skip },
  records("observer_not_fooled", async () => {
    // Two assertions on one edge can say opposite things. One having a document
    // says nothing about the other.
    const e = await edge();
    const backed = value(
      await repo.createAssertion(worker(), {
        caseId: alpha.caseId,
        edgeId: e.id,
        assertionType: "source_backed",
        assertedByType: "user",
        assertedById: alpha.caseworkerId,
        reason: "first reader: the letter supports it",
      })
    );
    const second = value(
      await repo.createAssertion(worker(), {
        caseId: alpha.caseId,
        edgeId: e.id,
        assertionType: "source_backed",
        assertedByType: "user",
        assertedById: alpha.solicitorId,
        reason: "second reader: a different passage supports it",
      })
    );
    value(
      await repo.linkAssertionEvidence(worker(), {
        caseId: alpha.caseId,
        assertionId: backed.id,
        evidenceId: alpha.evidenceIds[0]!,
        locator: "page 4",
      })
    );

    const observation = await observeAssertionTraceability(query);
    assert.equal(observation.value, false, "one assertion's evidence satisfied another's claim");

    // And once the second is backed too, it clears.
    value(
      await repo.linkAssertionEvidence(worker(), {
        caseId: alpha.caseId,
        assertionId: second.id,
        evidenceId: alpha.evidenceIds[0]!,
        locator: "page 5",
      })
    );
    assert.equal((await observeAssertionTraceability(query)).value, true);
  })
);

test(
  "a dangling evidence link does not satisfy the observer",
  { skip },
  records("observer_dangling", async () => {
    // ADR-003 as data, one layer down: `graph_evidence_links.evidence_id` IS a
    // real foreign key, so a dangling row cannot be inserted at all. That is
    // the referential integrity the deadline `source_id` lacks, and it is
    // asserted here rather than assumed.
    const e = await edge();
    const backed = value(
      await repo.createAssertion(worker(), {
        caseId: alpha.caseId,
        edgeId: e.id,
        assertionType: "source_backed",
        assertedByType: "user",
        assertedById: alpha.caseworkerId,
        reason: "cites a document",
      })
    );
    await assert.rejects(
      () =>
        pool.query(
          "INSERT INTO graph_evidence_links (assertion_id, evidence_id, locator) VALUES ($1,$2,'page 1')",
          [backed.id, "00000000-0000-4000-8000-000000000000"]
        ),
      /violates foreign key constraint/
    );

    // Evidence from another case is insertable — the FK only proves existence —
    // and the observer must catch it.
    await pool.query(
      "INSERT INTO graph_evidence_links (assertion_id, evidence_id, locator) VALUES ($1,$2,'page 1')",
      [backed.id, beta.evidenceIds[0]!]
    );
    const observation = await observeAssertionTraceability(query);
    assert.equal(observation.value, false, "evidence from another case satisfied the claim");

    await pool.query("DELETE FROM graph_evidence_links WHERE assertion_id = $1", [backed.id]);
    value(
      await repo.linkAssertionEvidence(worker(), {
        caseId: alpha.caseId,
        assertionId: backed.id,
        evidenceId: alpha.evidenceIds[0]!,
        locator: "page 9",
      })
    );
    assert.equal((await observeAssertionTraceability(query)).value, true);
  })
);

test(
  "a blank locator is refused by the repository and by the database",
  { skip },
  records("blank_locator", async () => {
    const e = await edge();
    const backed = value(
      await repo.createAssertion(worker(), {
        caseId: alpha.caseId,
        edgeId: e.id,
        assertionType: "source_backed",
        assertedByType: "user",
        assertedById: alpha.caseworkerId,
        reason: "cites a document",
      })
    );

    for (const locator of ["", "   "]) {
      const result = await repo.linkAssertionEvidence(worker(), {
        caseId: alpha.caseId,
        assertionId: backed.id,
        evidenceId: alpha.evidenceIds[0]!,
        locator,
      });
      assert.equal(result.ok === false && result.refusal.reason, "INVALID");
    }
    // And the database refuses it independently.
    await assert.rejects(
      () =>
        pool.query(
          "INSERT INTO graph_evidence_links (assertion_id, evidence_id, locator) VALUES ($1,$2,'  ')",
          [backed.id, alpha.evidenceIds[0]!]
        ),
      /evidence_links_carry_a_locator/
    );

    value(
      await repo.linkAssertionEvidence(worker(), {
        caseId: alpha.caseId,
        assertionId: backed.id,
        evidenceId: alpha.evidenceIds[0]!,
        locator: "page 11",
      })
    );
  })
);

test(
  "foreign and duplicate evidence links are refused with nothing written",
  { skip },
  records("evidence_link_validation", async () => {
    const e = await edge();
    const backed = value(
      await repo.createAssertion(worker(), {
        caseId: alpha.caseId,
        edgeId: e.id,
        assertionType: "source_backed",
        assertedByType: "user",
        assertedById: alpha.caseworkerId,
        reason: "cites a document",
      })
    );
    const before = await pool.query<{ n: string }>(
      "SELECT count(*) AS n FROM graph_evidence_links WHERE assertion_id = $1",
      [backed.id]
    );

    const foreign = await repo.linkAssertionEvidence(worker(), {
      caseId: alpha.caseId,
      assertionId: backed.id,
      evidenceId: beta.evidenceIds[0]!,
      locator: "page 1",
    });
    assert.equal(foreign.ok === false && foreign.refusal.reason, "NOT_PERSISTED");

    const dangling = await repo.linkAssertionEvidence(worker(), {
      caseId: alpha.caseId,
      assertionId: backed.id,
      evidenceId: "00000000-0000-4000-8000-000000000000",
      locator: "page 1",
    });
    assert.equal(dangling.ok === false && dangling.refusal.reason, "NOT_PERSISTED");

    const after = await pool.query<{ n: string }>(
      "SELECT count(*) AS n FROM graph_evidence_links WHERE assertion_id = $1",
      [backed.id]
    );
    assert.equal(after.rows[0]!.n, before.rows[0]!.n);

    const input = {
      caseId: alpha.caseId,
      assertionId: backed.id,
      evidenceId: alpha.evidenceIds[0]!,
      locator: "page 12",
    };
    value(await repo.linkAssertionEvidence(worker(), input));
    const again = await repo.linkAssertionEvidence(worker(), input);
    assert.equal(again.ok === false && again.refusal.reason, "CONFLICT");
  })
);

test(
  "the observer's own arithmetic distinguishes not-applicable from satisfied",
  { skip },
  records("observer_vocabulary", async () => {
    // An empty table demonstrates nothing about traceability. Reporting a green
    // invariant on the strength of having no data is the failure this whole
    // repository refuses.
    assert.equal(readingOf(0, 0).outcome, "not_applicable");
    assert.equal(readingOf(3, 0).outcome, "satisfied");
    assert.equal(readingOf(3, 1).outcome, "violated");
    assert.ok(TRACEABILITY_SQL.includes("btrim(l.locator)"));
    assert.ok(TRACEABILITY_SQL.includes("ev.case_id = e.case_id"));
  })
);

/* ================================================================ */
/* Lifecycle                                                        */
/* ================================================================ */

test(
  "supersession adds an assertion and never edits the original",
  { skip },
  records("supersession", async () => {
    const e = await edge();
    const original = e.assertions[0]!;

    const replacement = value(
      await repo.supersedeAssertion(worker(), {
        caseId: alpha.caseId,
        assertionId: original.id,
        replacement: {
          assertionType: "disputed",
          assertedByType: "user",
          assertedById: alpha.solicitorId,
          reason: "on closer reading the employers differ",
        },
      })
    );
    assert.equal(replacement.supersedesId, original.id);

    // Default read shows only what is current.
    const live = value(await repo.readGraph(worker(), alpha.caseId));
    const liveEdge = live.edges.find((x) => x.id === e.id)!;
    assert.ok(!liveEdge.assertions.some((a) => a.id === original.id));
    assert.equal(liveEdge.verificationState, "disputed");

    // History keeps both, with the original's text intact.
    const history = value(await repo.readEdgeHistory(worker(), alpha.caseId, e.id));
    const kept = history.assertions.find((a) => a.id === original.id)!;
    assert.equal(kept.reason, original.reason);
    assert.equal(kept.current, false);
    assert.equal(kept.supersededById, replacement.id);
  })
);

test(
  "an assertion cannot be superseded twice",
  { skip },
  records("double_supersession", async () => {
    const e = await edge();
    const original = e.assertions[0]!;
    const replacement = {
      assertionType: "disputed" as const,
      assertedByType: "user" as const,
      assertedById: alpha.solicitorId,
      reason: "first retraction",
    };
    value(
      await repo.supersedeAssertion(worker(), {
        caseId: alpha.caseId,
        assertionId: original.id,
        replacement,
      })
    );
    const second = await repo.supersedeAssertion(worker(), {
      caseId: alpha.caseId,
      assertionId: original.id,
      replacement: { ...replacement, reason: "second retraction" },
    });
    assert.equal(second.ok === false && second.refusal.reason, "CONFLICT");
  })
);

test(
  "an invalidated edge leaves the live graph and stays in history",
  { skip },
  records("invalidation", async () => {
    const e = await edge();
    const retired = value(
      await repo.invalidateEdge(worker(), {
        caseId: alpha.caseId,
        edgeId: e.id,
        reason: "the second document turned out to concern a different person",
      })
    );
    assert.equal(retired.live, false);
    assert.ok(retired.validTo);
    assert.equal(retired.invalidatedBy, alpha.caseworkerId);
    assert.match(retired.invalidationReason!, /different person/);

    const live = value(await repo.readGraph(worker(), alpha.caseId));
    assert.ok(!live.edges.some((x) => x.id === e.id), "a retired edge is still live");

    const all = value(await repo.readGraph(worker(), alpha.caseId, { includeRetired: true }));
    const found = all.edges.find((x) => x.id === e.id)!;
    assert.equal(found.live, false);
    assert.equal(found.assertions.length, e.assertions.length);

    // A second invalidation is refused by the state transition itself.
    const again = await repo.invalidateEdge(worker(), {
      caseId: alpha.caseId,
      edgeId: e.id,
      reason: "again",
    });
    assert.equal(again.ok === false && again.refusal.reason, "CONFLICT");

    // And the same relationship may be asserted again, because the unique index
    // covers live edges only.
    const revived = await repo.createEdge(worker(), {
      caseId: alpha.caseId,
      fromNodeId: e.fromNodeId,
      toNodeId: e.toNodeId,
      relationship: e.relationship,
      assertion: {
        assertionType: "human_confirmed",
        assertedByType: "user",
        assertedById: alpha.solicitorId,
        reason: "on further reading it does hold",
      },
    });
    assert.equal(revived.ok, true);
  })
);

/* ================================================================ */
/* Concurrency                                                      */
/* ================================================================ */

test(
  "two concurrent identical edges produce exactly one",
  { skip },
  records("concurrent_edges", async () => {
    const a = await node();
    const b = await node();
    const input = {
      caseId: alpha.caseId,
      fromNodeId: a.id,
      toNodeId: b.id,
      relationship: "precedes" as const,
      assertion: {
        assertionType: "human_confirmed" as const,
        assertedByType: "user" as const,
        assertedById: alpha.caseworkerId,
        reason: "the first letter is dated earlier",
      },
    };
    const [x, y] = await Promise.all([
      repo.createEdge(worker(), input),
      repo.createEdge(worker(), input),
    ]);
    assert.equal([x.ok, y.ok].filter(Boolean).length, 1, "both concurrent edges committed");

    const rows = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM graph_edges
        WHERE from_node_id = $1 AND to_node_id = $2 AND relationship = 'precedes' AND valid_to IS NULL`,
      [a.id, b.id]
    );
    assert.equal(rows.rows[0]!.n, "1");

    // The loser left no assertion and no audit entry behind.
    const assertions = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM graph_assertions a JOIN graph_edges e ON e.id = a.edge_id
        WHERE e.from_node_id = $1 AND e.to_node_id = $2 AND e.relationship = 'precedes'`,
      [a.id, b.id]
    );
    assert.equal(assertions.rows[0]!.n, "1");
  })
);

test(
  "two concurrent supersessions of one assertion produce exactly one",
  { skip },
  records("concurrent_supersessions", async () => {
    const e = await edge();
    const original = e.assertions[0]!;
    const replacement = {
      assertionType: "disputed" as const,
      assertedByType: "user" as const,
      assertedById: alpha.solicitorId,
      reason: "retraction",
    };
    const [x, y] = await Promise.all([
      repo.supersedeAssertion(worker(), {
        caseId: alpha.caseId,
        assertionId: original.id,
        replacement,
      }),
      repo.supersedeAssertion(worker(), {
        caseId: alpha.caseId,
        assertionId: original.id,
        replacement: { ...replacement, reason: "other retraction" },
      }),
    ]);
    assert.equal([x.ok, y.ok].filter(Boolean).length, 1);

    const rows = await pool.query<{ n: string }>(
      "SELECT count(*) AS n FROM graph_assertions WHERE supersedes_id = $1",
      [original.id]
    );
    assert.equal(rows.rows[0]!.n, "1");
  })
);

/* ================================================================ */
/* Atomicity                                                        */
/* ================================================================ */

function failingPool(real: PoolLike, pattern: RegExp): PoolLike {
  return {
    query: real.query.bind(real),
    end: real.end.bind(real),
    async connect(): Promise<PoolClientLike> {
      const client = await real.connect();
      return {
        query: (text: string, values?: readonly unknown[]) => {
          if (pattern.test(text)) {
            return Promise.reject(new Error(`induced failure on ${pattern.source}`));
          }
          return client.query(text, values);
        },
        release: client.release.bind(client),
      } as PoolClientLike;
    },
  } as PoolLike;
}

async function graphCounts() {
  const q = async (sql: string) => Number((await pool.query<{ n: string }>(sql)).rows[0]!.n);
  return {
    nodes: await q("SELECT count(*) AS n FROM graph_nodes"),
    edges: await q("SELECT count(*) AS n FROM graph_edges"),
    assertions: await q("SELECT count(*) AS n FROM graph_assertions"),
    links: await q("SELECT count(*) AS n FROM graph_evidence_links"),
    audit: await q("SELECT count(*) AS n FROM audit_log"),
  };
}

test(
  "an induced failure on any write rolls the whole operation back",
  { skip },
  records("atomicity", async () => {
    // No live edge may remain without its assertion; no audit record may
    // describe a write that did not commit.
    const e = await edge();
    const a = await node();
    const b = await node();

    for (const [label, pattern, act] of [
      [
        "node insert",
        /INSERT INTO graph_nodes/,
        (r: GraphRepository) =>
          r.createNode(worker(), {
            caseId: alpha.caseId,
            nodeType: "claim",
            subjectId: `rollback-${run}`,
            label: "x",
          }),
      ],
      [
        "edge insert",
        /INSERT INTO graph_edges/,
        (r: GraphRepository) =>
          r.createEdge(worker(), {
            caseId: alpha.caseId,
            fromNodeId: a.id,
            toNodeId: b.id,
            relationship: "refers_to",
            assertion: {
              assertionType: "human_confirmed",
              assertedByType: "user",
              assertedById: alpha.caseworkerId,
              reason: "x",
            },
          }),
      ],
      [
        "assertion insert",
        /INSERT INTO graph_assertions/,
        (r: GraphRepository) =>
          r.createEdge(worker(), {
            caseId: alpha.caseId,
            fromNodeId: a.id,
            toNodeId: b.id,
            relationship: "derived_from",
            assertion: {
              assertionType: "human_confirmed",
              assertedByType: "user",
              assertedById: alpha.caseworkerId,
              reason: "x",
            },
          }),
      ],
      [
        "evidence link insert",
        /INSERT INTO graph_evidence_links/,
        (r: GraphRepository) =>
          r.linkAssertionEvidence(worker(), {
            caseId: alpha.caseId,
            assertionId: e.assertions[0]!.id,
            evidenceId: alpha.evidenceIds[0]!,
            locator: "page 1",
          }),
      ],
      [
        "audit insert",
        /audit_log/,
        (r: GraphRepository) =>
          r.createEdge(worker(), {
            caseId: alpha.caseId,
            fromNodeId: a.id,
            toNodeId: b.id,
            relationship: "concerns",
            assertion: {
              assertionType: "human_confirmed",
              assertedByType: "user",
              assertedById: alpha.caseworkerId,
              reason: "x",
            },
          }),
      ],
      [
        "invalidation update",
        /UPDATE graph_edges/,
        (r: GraphRepository) =>
          r.invalidateEdge(worker(), {
            caseId: alpha.caseId,
            edgeId: e.id,
            reason: "x",
          }),
      ],
    ] as const) {
      const before = await graphCounts();
      const broken = new GraphRepository(failingPool(pool, pattern));
      const result = await act(broken);
      assert.equal(result.ok, false, `${label} did not fail`);
      assert.deepEqual(await graphCounts(), before, `${label} left something behind`);
    }

    // And the edge is still live and still asserted.
    const graph = value(await repo.readGraph(worker(), alpha.caseId));
    assert.ok(graph.edges.some((x) => x.id === e.id));
  })
);

test(
  "a valid write produces its audit record and the chain still verifies",
  { skip },
  records("audit", async () => {
    const e = await edge();
    value(
      await repo.linkAssertionEvidence(worker(), {
        caseId: alpha.caseId,
        assertionId: e.assertions[0]!.id,
        evidenceId: alpha.evidenceIds[0]!,
        locator: "page 21",
      })
    );

    const actions = await pool.query<{ action: string }>(
      "SELECT DISTINCT action FROM audit_log WHERE action LIKE 'graph.%' ORDER BY action"
    );
    const names = actions.rows.map((r) => r.action);
    for (const expected of [
      "graph.node_created",
      "graph.edge_created",
      "graph.assertion_created",
      "graph.evidence_linked",
      "graph.assertion_superseded",
      "graph.edge_invalidated",
    ]) {
      assert.ok(names.includes(expected), `${expected} was never written`);
    }

    const entry = await pool.query<{ payload: Record<string, unknown> }>(
      "SELECT payload FROM audit_log WHERE action = 'graph.evidence_linked' ORDER BY seq DESC LIMIT 1"
    );
    assert.equal(entry.rows[0]!.payload.correlationId, `graph-${run}`);

    const verified = await withTransaction(pool, (tx) => new PostgresAuditStore(tx).verify());
    assert.equal(verified.valid, true, `audit chain broke: ${JSON.stringify(verified)}`);
  })
);

/* ================================================================ */
/* Immutable history                                                */
/* ================================================================ */

test(
  "assertions cannot be updated or deleted, and TRUNCATE is refused by their own trigger",
  { skip },
  records("assertions_immutable", async () => {
    const e = await edge();
    await assert.rejects(
      () =>
        pool.query("UPDATE graph_assertions SET reason = 'edited' WHERE edge_id = $1", [e.id]),
      /graph_assertions is append-only/
    );
    await assert.rejects(
      () => pool.query("DELETE FROM graph_assertions WHERE edge_id = $1", [e.id]),
      /graph_assertions is append-only/
    );

    // Plain TRUNCATE is refused by the foreign key from graph_evidence_links,
    // which is incidental protection that would disappear with the link table.
    // TRUNCATE ... CASCADE removes that objection and reaches the trigger, so
    // this is the form that proves the guarantee is the trigger's.
    await assert.rejects(
      () => pool.query("TRUNCATE graph_assertions CASCADE"),
      /graph_assertions is append-only and may not be truncated/
    );

    // graph_evidence_links has no such trigger, and truncating it succeeds —
    // which is what makes the contrast above meaningful.
    const guards = await pool.query<{ table: string }>(
      `SELECT c.relname AS table FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        WHERE NOT t.tgisinternal AND t.tgtype & 32 <> 0
          AND c.relname IN ('graph_assertions','graph_evidence_links')`
    );
    assert.deepEqual(
      guards.rows.map((r) => r.table),
      ["graph_assertions"]
    );
  })
);

test(
  "nothing carrying graph history can be deleted",
  { skip },
  records("parents_pinned", async () => {
    const e = await edge();
    await assert.rejects(
      () => pool.query("DELETE FROM graph_edges WHERE id = $1", [e.id]),
      /violates foreign key constraint/
    );
    await assert.rejects(
      () => pool.query("DELETE FROM graph_nodes WHERE id = $1", [e.fromNodeId]),
      /violates foreign key constraint/
    );
    await assert.rejects(
      () => pool.query("DELETE FROM cases WHERE id = $1", [alpha.caseId]),
      /append-only|violates foreign key constraint/
    );
    await assert.rejects(
      () => pool.query("DELETE FROM organizations WHERE id = $1", [alpha.organisationId]),
      /append-only|violates foreign key constraint/
    );
  })
);

test(
  "the repository never attempts to disable a protection",
  { skip },
  records("no_protection_bypass", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(join(repoRoot, "packages/repositories/src/graph.ts"), "utf8");
    for (const forbidden of [
      /\bALTER\s+TABLE\b/i,
      /\bDISABLE\s+TRIGGER\b/i,
      /\bDROP\s+TRIGGER\b/i,
      /\bTRUNCATE\s+[a-z_]/i,
      /\bDELETE\s+FROM\s+graph_assertions\b/i,
      /\bUPDATE\s+graph_assertions\b/i,
      /session_replication_role/i,
    ]) {
      assert.ok(!forbidden.test(source), `the repository contains ${forbidden.source}`);
    }
  })
);

/* ================================================================ */
/* Reads                                                            */
/* ================================================================ */

test(
  "ordering is deterministic across reads",
  { skip },
  records("deterministic_order", async () => {
    const first = value(await repo.readGraph(worker(), alpha.caseId, { includeRetired: true }));
    const second = value(await repo.readGraph(worker(), alpha.caseId, { includeRetired: true }));
    assert.deepEqual(first.nodes.map((n) => n.id), second.nodes.map((n) => n.id));
    assert.deepEqual(first.edges.map((e) => e.id), second.edges.map((e) => e.id));

    const nodeKeys = first.nodes.map((n) => `${n.nodeType} ${n.subjectId}`);
    assert.deepEqual(nodeKeys, [...nodeKeys].sort());

    for (const e of first.edges) {
      const times = e.assertions.map((a) => a.assertedAt);
      assert.deepEqual(times, [...times].sort());
    }
  })
);

test(
  "absence of a database is distinguishable from an empty graph",
  { skip },
  records("no_fixture_fallback", async () => {
    const none = new GraphRepository(null);
    const noDb = await none.readGraph(worker(), alpha.caseId);
    assert.equal(noDb.ok === false && noDb.refusal.reason, "NO_DATABASE");

    const empty = await tenancy("Empty graph");
    const context: RepositoryContext = {
      actorId: empty.caseworkerId,
      accountId: ACCOUNT,
      organisationId: empty.organisationId,
      memberships: [membership({ workspaceId: empty.workspaceId })],
    };
    const view = value(await repo.readGraph(context, empty.caseId));
    assert.deepEqual(view.nodes, []);
    assert.deepEqual(view.edges, []);

    const { readFile } = await import("node:fs/promises");
    const source = await readFile(join(repoRoot, "packages/repositories/src/graph.ts"), "utf8");
    assert.ok(!/apps\/web|lib\/data|fixture/.test(source));
  })
);

/* ================================================================ */
/* Query plans                                                      */
/* ================================================================ */

test(
  "the graph reads are eligible for their indexes",
  { skip },
  records("query_plans", async () => {
    const client = await pool.query<{ client_id: string }>(
      "SELECT client_id FROM cases WHERE id = $1",
      [alpha.caseId]
    );
    await pool.query(
      `INSERT INTO cases (workspace_id, client_id, reference, status)
       SELECT $1, $2, 'GRBULK-${run}-' || g, 'analysis' FROM generate_series(1, 200) g`,
      [alpha.workspaceId, client.rows[0]!.client_id]
    );
    const bulk = await pool.query<{ id: string }>(
      "SELECT id FROM cases WHERE workspace_id = $1 AND reference LIKE $2 ORDER BY reference",
      [alpha.workspaceId, `GRBULK-${run}-%`]
    );
    const ids = bulk.rows.map((r) => r.id);

    await pool.query(
      `INSERT INTO graph_nodes (organisation_id, case_id, node_type, subject_id, label)
       SELECT $1, c.id, 'evidence', 'bulk-' || g, 'Bulk ' || g
         FROM unnest($2::uuid[]) AS c(id), generate_series(1, 20) g`,
      [alpha.organisationId, ids]
    );
    await pool.query(
      `INSERT INTO graph_edges (organisation_id, case_id, from_node_id, to_node_id, relationship, valid_to)
       SELECT $1, n1.case_id, n1.id, n2.id, 'supports',
              CASE WHEN random() < 0 THEN now() ELSE NULL END
         FROM graph_nodes n1
         JOIN graph_nodes n2 ON n2.case_id = n1.case_id AND n2.subject_id = 'bulk-' || (
              (substring(n1.subject_id from 6)::int % 20) + 1)
        WHERE n1.case_id = ANY($2) AND n1.id <> n2.id`,
      [alpha.organisationId, ids]
    );
    await pool.query(
      `INSERT INTO graph_assertions (edge_id, assertion_type, asserted_by_type, asserted_by_id, reason)
       SELECT e.id, 'human_confirmed', 'user', $1, 'bulk assertion'
         FROM graph_edges e WHERE e.case_id = ANY($2)`,
      [alpha.caseworkerId, ids]
    );
    await pool.query("ANALYZE graph_nodes");
    await pool.query("ANALYZE graph_edges");
    await pool.query("ANALYZE graph_assertions");
    await pool.query("ANALYZE graph_evidence_links");

    const plans: Record<string, string> = {};
    const explain = async (label: string, sql: string, params: readonly unknown[]) => {
      const r = await pool.query<{ "QUERY PLAN": string }>(`EXPLAIN ${sql}`, params);
      plans[label] = r.rows.map((row) => row["QUERY PLAN"]).join("\n");
    };

    await explain(
      "live_graph_selective",
      `SELECT e.id FROM graph_edges e
        WHERE e.case_id = $1 AND e.organisation_id = $2 AND e.valid_to IS NULL
        ORDER BY e.created_at ASC, e.id ASC`,
      [ids[0], alpha.organisationId]
    );
    await explain(
      "live_graph_dominant",
      `SELECT e.id FROM graph_edges e
        WHERE e.case_id = $1 AND e.organisation_id = $2 AND e.valid_to IS NULL
        ORDER BY e.created_at ASC, e.id ASC`,
      [alpha.caseId, alpha.organisationId]
    );
    await explain(
      "assertions_by_edge",
      `SELECT a.id FROM graph_assertions a WHERE a.edge_id = $1
        ORDER BY a.asserted_at ASC, a.id ASC`,
      [
        (
          await pool.query<{ id: string }>("SELECT id FROM graph_edges WHERE case_id = $1 LIMIT 1", [
            ids[0],
          ])
        ).rows[0]!.id,
      ]
    );
    await explain(
      "nodes_by_case",
      `SELECT n.id FROM graph_nodes n WHERE n.case_id = $1 AND n.organisation_id = $2`,
      [ids[0], alpha.organisationId]
    );

    assert.match(
      plans.live_graph_selective!,
      /graph_edges_case_idx|graph_edges_org_live_idx/,
      `live graph:\n${plans.live_graph_selective}`
    );
    assert.match(
      plans.assertions_by_edge!,
      /graph_assertions_edge_idx/,
      `assertions:\n${plans.assertions_by_edge}`
    );
    assert.match(plans.nodes_by_case!, /graph_nodes_case_idx/, `nodes:\n${plans.nodes_by_case}`);

    await emitEvidence(repoRoot, {
      checkId: "graph_query_plans",
      passed: true,
      at: new Date().toISOString(),
      commit: commit(),
      producedBy: "packages/integration/test/domain/graph-repository.test.ts",
      demonstrates: `with 4000 graph nodes and their edges and assertions spread across 200 cases, and ANALYZE run: the live-graph read for a selective case used a case index, assertions-by-edge used graph_assertions_edge_idx, and nodes-by-case used graph_nodes_case_idx. The dominant-case plan is recorded for comparison. No latency or throughput claim is made. Plans:\n${JSON.stringify(plans, null, 2)}`,
    });
  })
);

/* ================================================================ */

after(async () => {
  if (skip) return;

  const emit = (checkId: string, names: readonly string[], demonstrates: string) =>
    emitEvidence(repoRoot, {
      checkId,
      passed: names.every((n) => held.get(n) === true),
      at: new Date().toISOString(),
      commit: commit(),
      producedBy: "packages/integration/test/domain/graph-repository.test.ts",
      demonstrates,
    });

  await emit(
    "graph_reads_are_organisation_scoped",
    ["cross_org", "dual_membership_isolated", "foreign_nodes", "client_cannot_write"],
    "a caller holding a valid case id from another organisation was refused on read and write; an account with real memberships in two organisations, scoped to the first, could not reach the second; an edge could not be drawn to a node in another case; a client could read the graph and not write to it"
  );
  await emit(
    "graph_every_edge_carries_an_assertion",
    ["every_edge_has_an_author", "duplicate_live_edge", "node_identity"],
    "an edge inserted directly with no assertion never reached the read model, and every returned edge carried at least one assertion naming who asserted it and why; a duplicate live edge and a duplicate node subject were both refused"
  );
  await emit(
    "graph_emits_no_probability",
    ["no_probability", "abstention_scan_works"],
    "a recursive scan of every emitted node, edge, assertion and evidence link found no numeric field and no field named for confidence, probability, likelihood, certainty, credibility, score, risk, strength, weight, trust, quality or reliability; the same scan applied to the same object with a confidence field added reported it, so the scan can fail"
  );
  await emit(
    "graph_assertion_type_is_visible",
    ["machine_assertions", "human_needs_a_person", "dispute_dominates"],
    "a machine-proposed relationship was refused without its execution and, once cited, was returned as machine_proposed with an agent author and a null traceability claim; a human confirmation could not be attributed to an agent; a disputed assertion dominated the edge's verification state over an earlier confirmation"
  );
  await emit(
    "graph_retired_edges_excluded",
    ["invalidation", "supersession", "double_supersession", "deterministic_order"],
    "an invalidated edge left the default read carrying its actor and reason, stayed in the history read with its assertions intact, refused a second invalidation, and freed the relationship to be asserted again; supersession added an assertion pointing back at the original and never edited it, and could not happen twice"
  );
  await emit(
    "graph_assertion_history_preserved",
    ["assertions_immutable", "parents_pinned", "no_protection_bypass", "atomicity", "audit"],
    "graph_assertions refused UPDATE and DELETE, and refused TRUNCATE CASCADE by its own statement trigger — the form that removes the incidental foreign-key objection, with graph_evidence_links confirmed to carry no such trigger; edges, nodes, cases and organisations carrying graph history could not be deleted; inducing a failure on each of six writes in turn left every graph count unchanged; the audit chain verified after a valid write"
  );
  await emit(
    "graph_assertions_carry_source_locator",
    [
      "observer_violated",
      "observer_satisfied",
      "observer_not_fooled",
      "observer_dangling",
      "blank_locator",
      "evidence_link_validation",
      "observer_vocabulary",
    ],
    "the production EV-005 observer was called directly and reported violated for a source-backed assertion with no evidence, satisfied once real same-case evidence with a non-blank locator was linked, and violated again when the only evidence belonged to another assertion or another case; blank locators were refused by the repository and independently by a database constraint; dangling evidence ids are impossible because graph_evidence_links.evidence_id is a real foreign key, which is asserted rather than assumed"
  );
  await emit(
    "graph_no_fixture_fallback",
    ["no_fixture_fallback", "concurrent_edges", "concurrent_supersessions"],
    "a case with no persisted graph returned empty node and edge lists and no database returned NO_DATABASE; two concurrent identical edges produced exactly one live edge with one assertion, and two concurrent supersessions of one assertion produced exactly one replacement"
  );

  await pool.end();
});
