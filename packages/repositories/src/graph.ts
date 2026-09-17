import { membershipFor, type Membership } from "@legalos/auth";
import {
  PostgresAuditStore,
  withTransaction,
  type PoolLike,
  type SqlExecutor,
} from "@legalos/database";

import {
  CASE_NOT_AVAILABLE,
  MAY_READ,
  ok,
  refuse,
  type RepositoryContext,
  type Result,
} from "./context.ts";
import {
  ASSERTED_BY_TYPES,
  ASSERTION_ORDER,
  ASSERTION_TYPES,
  EDGE_ORDER,
  isUsableLocator,
  MAY_WRITE_GRAPH,
  NODE_ORDER,
  NODE_TYPES,
  RELATIONSHIPS,
  traceabilityOf,
  verificationStateOf,
  type AssertedByType,
  type AssertionRecord,
  type AssertionType,
  type EdgeRecord,
  type EvidenceLinkRecord,
  type GraphView,
  type NodeRecord,
  type NodeType,
  type Relationship,
} from "./graph-model.ts";

/**
 * The evidence graph repository.
 *
 * Two properties do most of the work here, and both are about what a reader is
 * allowed to conclude from a picture:
 *
 *   * No edge is returned without at least one assertion naming who asserted
 *     it. An unattributed line between two documents renders as an established
 *     relationship in the case, and nothing on screen would say otherwise.
 *   * No number is emitted, anywhere, under any name. Not confidence, not
 *     strength, not weight, not trust. A percentage against a relationship gets
 *     read as legal certainty, and a submission would end up resting on a
 *     figure no observation in this system was calibrated to produce.
 *
 * Nothing is ever edited. `graph_assertions` refuses UPDATE by trigger, so a
 * retraction is a new assertion pointing back at the old one, and an edge that
 * stopped holding is closed with `valid_to` rather than deleted. What was
 * believed on the day of a filing is frequently the question.
 */

const NODE_COLUMNS = `n.id, n.organisation_id, n.case_id, n.node_type, n.subject_id, n.label, n.created_at`;
const EDGE_COLUMNS = `
  e.id, e.organisation_id, e.case_id, e.from_node_id, e.to_node_id, e.relationship,
  e.valid_from, e.valid_to, e.superseded_by, e.invalidated_by, e.invalidation_reason,
  e.created_at`;

interface NodeRow {
  id: string;
  organisation_id: string;
  case_id: string;
  node_type: NodeType;
  subject_id: string;
  label: string;
  created_at: Date | string;
}

interface EdgeRow {
  id: string;
  organisation_id: string;
  case_id: string;
  from_node_id: string;
  to_node_id: string;
  relationship: Relationship;
  valid_from: Date | string;
  valid_to: Date | string | null;
  superseded_by: string | null;
  invalidated_by: string | null;
  invalidation_reason: string | null;
  created_at: Date | string;
}

interface AssertionRow {
  id: string;
  edge_id: string;
  assertion_type: AssertionType;
  asserted_by_type: AssertedByType;
  asserted_by_id: string;
  execution_id: string | null;
  reason: string;
  asserted_at: Date | string;
  supersedes_id: string | null;
}

const iso = (v: Date | string | null): string | null =>
  v === null ? null : v instanceof Date ? v.toISOString() : v;

interface ResolvedCase {
  readonly caseId: string;
  readonly workspaceId: string;
  readonly organisationId: string;
  readonly membership: Membership;
}

export interface CreateNodeInput {
  readonly caseId: string;
  readonly nodeType: NodeType;
  readonly subjectId: string;
  readonly label: string;
}

export interface CreateEdgeInput {
  readonly caseId: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly relationship: Relationship;
  /** The first assertion. An edge is never created without one. */
  readonly assertion: {
    readonly assertionType: AssertionType;
    readonly assertedByType: AssertedByType;
    readonly assertedById: string;
    readonly executionId?: string | null;
    readonly reason: string;
  };
}

export interface CreateAssertionInput {
  readonly caseId: string;
  readonly edgeId: string;
  readonly assertionType: AssertionType;
  readonly assertedByType: AssertedByType;
  readonly assertedById: string;
  readonly executionId?: string | null;
  readonly reason: string;
  /** The assertion this one replaces, when it replaces one. */
  readonly supersedesId?: string | null;
}

export interface LinkAssertionEvidenceInput {
  readonly caseId: string;
  readonly assertionId: string;
  readonly evidenceId: string;
  readonly locator: string;
}

export interface SupersedeAssertionInput {
  readonly caseId: string;
  readonly assertionId: string;
  readonly replacement: Omit<CreateAssertionInput, "caseId" | "edgeId" | "supersedesId">;
}

export interface InvalidateEdgeInput {
  readonly caseId: string;
  readonly edgeId: string;
  readonly reason: string;
}

export interface GraphOptions {
  /** Include retired edges. Default false — the live graph is the default view. */
  readonly includeRetired?: boolean;
  /** Include superseded assertions on each edge. Default false. */
  readonly includeSupersededAssertions?: boolean;
}

export class GraphRepository {
  readonly #pool: PoolLike | null;

  /** `null` means no database is configured. Modelled, not thrown. */
  constructor(pool: PoolLike | null) {
    this.#pool = pool;
  }

  /* -------------------------------------------------------------- */
  /* Resolution                                                      */
  /* -------------------------------------------------------------- */

  async #resolve(
    sql: SqlExecutor,
    context: RepositoryContext,
    caseId: string,
    permitted: readonly string[]
  ): Promise<Result<ResolvedCase>> {
    const found = await sql.query<{ id: string; workspace_id: string; organization_id: string }>(
      `SELECT c.id, c.workspace_id, w.organization_id
         FROM cases c JOIN workspaces w ON w.id = c.workspace_id
        WHERE c.id = $1 LIMIT 1`,
      [caseId]
    );

    const row = found.rows[0];
    // The organisation predicate, kept separate from the membership check. The
    // only case it refuses on its own is one account holding real memberships
    // in two organisations on a session scoped to the first.
    if (!row || row.organization_id !== context.organisationId) {
      return refuse({ reason: "NOT_PERSISTED", detail: CASE_NOT_AVAILABLE });
    }

    const membership = membershipFor(context.memberships, context.accountId, row.workspace_id);
    if (!membership) {
      const belongs = await this.#belongsToOrganisation(sql, context, row.organization_id);
      return refuse(
        belongs
          ? { reason: "FORBIDDEN", detail: "no membership of the workspace this case belongs to" }
          : { reason: "NOT_PERSISTED", detail: CASE_NOT_AVAILABLE }
      );
    }
    if (!permitted.includes(membership.role)) {
      return refuse({
        reason: "FORBIDDEN",
        detail: `the ${membership.role} role may not perform this operation on this case`,
      });
    }

    return {
      ok: true,
      value: {
        caseId: row.id,
        workspaceId: row.workspace_id,
        organisationId: row.organization_id,
        membership,
      },
    };
  }

  async #belongsToOrganisation(
    sql: SqlExecutor,
    context: RepositoryContext,
    organisationId: string
  ): Promise<boolean> {
    const workspaces = context.memberships
      .filter((m) => m.removedAt === null && m.accountId === context.accountId)
      .map((m) => m.workspaceId);
    if (workspaces.length === 0) return false;
    const found = await sql.query<{ id: string }>(
      "SELECT id FROM workspaces WHERE id = ANY($1) AND organization_id = $2 LIMIT 1",
      [workspaces, organisationId]
    );
    return found.rows.length > 0;
  }

  /* -------------------------------------------------------------- */
  /* Hydration                                                       */
  /* -------------------------------------------------------------- */

  /**
   * Loads assertions and their evidence for a set of edges.
   *
   * Evidence links are filtered to the same case. A link whose evidence belongs
   * to another matter is dropped rather than shown, and the assertion then
   * reports itself untraceable — which is the truthful answer and the one
   * EV-005 measures.
   */
  async #assertionsFor(
    sql: SqlExecutor,
    edges: readonly EdgeRow[],
    includeSuperseded: boolean
  ): Promise<Map<string, AssertionRecord[]>> {
    const byEdge = new Map<string, AssertionRecord[]>();
    if (edges.length === 0) return byEdge;

    const ids = edges.map((e) => e.id);
    const caseOf = new Map(edges.map((e) => [e.id, e.case_id] as const));
    const orgOf = new Map(edges.map((e) => [e.id, e.organisation_id] as const));

    const [assertions, links] = await Promise.all([
      sql.query<AssertionRow>(
        `SELECT a.* FROM graph_assertions a WHERE a.edge_id = ANY($1) ${ASSERTION_ORDER}`,
        [ids]
      ),
      sql.query<{
        assertion_id: string;
        evidence_id: string;
        locator: string;
        created_by: string | null;
        created_at: Date | string;
        resolved_case: string | null;
      }>(
        `SELECT l.assertion_id, l.evidence_id, l.locator, l.created_by, l.created_at,
                ev.case_id AS resolved_case
           FROM graph_evidence_links l
           JOIN graph_assertions a ON a.id = l.assertion_id
           LEFT JOIN evidence_items ev ON ev.id = l.evidence_id
          WHERE a.edge_id = ANY($1)
          ORDER BY l.created_at ASC, l.evidence_id ASC`,
        [ids]
      ),
    ]);

    const replacedBy = new Map<string, string>();
    for (const a of assertions.rows) {
      if (a.supersedes_id) replacedBy.set(a.supersedes_id, a.id);
    }

    const evidenceOf = new Map<string, EvidenceLinkRecord[]>();
    const usableOf = new Map<string, number>();
    for (const l of links.rows) {
      const list = evidenceOf.get(l.assertion_id) ?? [];
      list.push({
        evidenceId: l.evidence_id,
        locator: l.locator,
        createdBy: l.created_by,
        createdAt: iso(l.created_at)!,
      });
      evidenceOf.set(l.assertion_id, list);
      // Usable means: the evidence row exists, belongs to this edge's case, and
      // the locator says where to look. All three, or it counts for nothing.
      const edgeCase = caseOf.get(
        assertions.rows.find((a) => a.id === l.assertion_id)?.edge_id ?? ""
      );
      const usable =
        l.resolved_case !== null && l.resolved_case === edgeCase && isUsableLocator(l.locator);
      if (usable) usableOf.set(l.assertion_id, (usableOf.get(l.assertion_id) ?? 0) + 1);
    }

    for (const a of assertions.rows) {
      const supersededById = replacedBy.get(a.id) ?? null;
      if (!includeSuperseded && supersededById) continue;

      const record: AssertionRecord = {
        id: a.id,
        edgeId: a.edge_id,
        organisationId: orgOf.get(a.edge_id)!,
        caseId: caseOf.get(a.edge_id)!,
        assertionType: a.assertion_type,
        assertedByType: a.asserted_by_type,
        assertedById: a.asserted_by_id,
        executionId: a.execution_id,
        reason: a.reason,
        assertedAt: iso(a.asserted_at)!,
        supersedesId: a.supersedes_id,
        supersededById,
        current: supersededById === null,
        evidence: evidenceOf.get(a.id) ?? [],
        traceable: traceabilityOf(a.assertion_type, usableOf.get(a.id) ?? 0),
      };
      const list = byEdge.get(a.edge_id) ?? [];
      list.push(record);
      byEdge.set(a.edge_id, list);
    }

    return byEdge;
  }

  #toEdge(row: EdgeRow, assertions: readonly AssertionRecord[]): EdgeRecord {
    const live = assertions.filter((a) => a.current);
    return {
      id: row.id,
      organisationId: row.organisation_id,
      caseId: row.case_id,
      fromNodeId: row.from_node_id,
      toNodeId: row.to_node_id,
      relationship: row.relationship,
      validFrom: iso(row.valid_from)!,
      validTo: iso(row.valid_to),
      supersededById: row.superseded_by,
      invalidatedBy: row.invalidated_by,
      invalidationReason: row.invalidation_reason,
      createdAt: iso(row.created_at)!,
      live: row.valid_to === null,
      verificationState: verificationStateOf(live.map((a) => a.assertionType)),
      assertions,
    };
  }

  /* -------------------------------------------------------------- */
  /* Reads                                                           */
  /* -------------------------------------------------------------- */

  /**
   * The graph for a case.
   *
   * Edges with no assertion are excluded, not rendered blank. GR-G2: a line
   * between two documents with nobody's name on it reads as established fact,
   * and the absence of an author is not something a reader notices.
   */
  async readGraph(
    context: RepositoryContext,
    caseId: string,
    options: GraphOptions = {}
  ): Promise<Result<GraphView>> {
    if (!this.#pool) return this.#noDatabase();
    try {
      const resolved = await this.#resolve(this.#pool, context, caseId, MAY_READ);
      if (!resolved.ok) return refuse(resolved.refusal);

      const [nodes, edges] = await Promise.all([
        this.#pool.query<NodeRow>(
          `SELECT ${NODE_COLUMNS} FROM graph_nodes n
            WHERE n.case_id = $1 AND n.organisation_id = $2 ${NODE_ORDER}`,
          [resolved.value.caseId, resolved.value.organisationId]
        ),
        this.#pool.query<EdgeRow>(
          `SELECT ${EDGE_COLUMNS} FROM graph_edges e
            WHERE e.case_id = $1 AND e.organisation_id = $2
              ${options.includeRetired ? "" : "AND e.valid_to IS NULL"}
            ${EDGE_ORDER}`,
          [resolved.value.caseId, resolved.value.organisationId]
        ),
      ]);

      const assertions = await this.#assertionsFor(
        this.#pool,
        edges.rows,
        options.includeSupersededAssertions ?? false
      );

      return ok({
        nodes: nodes.rows.map((n) => ({
          id: n.id,
          organisationId: n.organisation_id,
          caseId: n.case_id,
          nodeType: n.node_type,
          subjectId: n.subject_id,
          label: n.label,
          createdAt: iso(n.created_at)!,
        })),
        edges: edges.rows
          .map((e) => this.#toEdge(e, assertions.get(e.id) ?? []))
          // GR-G2, enforced on the way out.
          .filter((e) => e.assertions.length > 0),
      });
    } catch (error) {
      return this.#unreachable(error);
    }
  }

  async readNode(
    context: RepositoryContext,
    caseId: string,
    nodeId: string
  ): Promise<Result<NodeRecord>> {
    if (!this.#pool) return this.#noDatabase();
    try {
      const resolved = await this.#resolve(this.#pool, context, caseId, MAY_READ);
      if (!resolved.ok) return refuse(resolved.refusal);

      const found = await this.#pool.query<NodeRow>(
        `SELECT ${NODE_COLUMNS} FROM graph_nodes n
          WHERE n.id = $1 AND n.case_id = $2 AND n.organisation_id = $3`,
        [nodeId, resolved.value.caseId, resolved.value.organisationId]
      );
      const n = found.rows[0];
      if (!n) return refuse({ reason: "NOT_PERSISTED", detail: CASE_NOT_AVAILABLE });
      return ok({
        id: n.id,
        organisationId: n.organisation_id,
        caseId: n.case_id,
        nodeType: n.node_type,
        subjectId: n.subject_id,
        label: n.label,
        createdAt: iso(n.created_at)!,
      });
    } catch (error) {
      return this.#unreachable(error);
    }
  }

  /** Every assertion ever made about one edge, superseded ones included. */
  async readEdgeHistory(
    context: RepositoryContext,
    caseId: string,
    edgeId: string
  ): Promise<Result<EdgeRecord>> {
    if (!this.#pool) return this.#noDatabase();
    try {
      const resolved = await this.#resolve(this.#pool, context, caseId, MAY_READ);
      if (!resolved.ok) return refuse(resolved.refusal);

      const found = await this.#pool.query<EdgeRow>(
        `SELECT ${EDGE_COLUMNS} FROM graph_edges e
          WHERE e.id = $1 AND e.case_id = $2 AND e.organisation_id = $3`,
        [edgeId, resolved.value.caseId, resolved.value.organisationId]
      );
      const row = found.rows[0];
      if (!row) return refuse({ reason: "NOT_PERSISTED", detail: CASE_NOT_AVAILABLE });

      const assertions = await this.#assertionsFor(this.#pool, [row], true);
      return ok(this.#toEdge(row, assertions.get(row.id) ?? []));
    } catch (error) {
      return this.#unreachable(error);
    }
  }

  /* -------------------------------------------------------------- */
  /* Writes                                                          */
  /* -------------------------------------------------------------- */

  async createNode(
    context: RepositoryContext,
    input: CreateNodeInput
  ): Promise<Result<NodeRecord>> {
    if (!this.#pool) return this.#noDatabase();
    if (!NODE_TYPES.includes(input.nodeType)) {
      return refuse({ reason: "INVALID", detail: `${input.nodeType} is not a node type` });
    }
    if (!input.subjectId.trim()) return refuse({ reason: "INVALID", detail: "a node must name its subject" });
    if (!input.label.trim()) return refuse({ reason: "INVALID", detail: "a node must have a label" });

    try {
      return await withTransaction(this.#pool, async (tx) => {
        const resolved = await this.#resolve(tx, context, input.caseId, MAY_WRITE_GRAPH);
        if (!resolved.ok) return refuse<NodeRecord>(resolved.refusal);

        const existing = await tx.query<{ id: string }>(
          "SELECT id FROM graph_nodes WHERE case_id = $1 AND node_type = $2 AND subject_id = $3",
          [resolved.value.caseId, input.nodeType, input.subjectId]
        );
        if (existing.rows[0]) {
          // A graph with two nodes for one document draws two different
          // pictures of one case.
          return refuse({
            reason: "CONFLICT",
            detail: "a node already exists for that subject on this case",
          });
        }

        const inserted = await tx.query<NodeRow>(
          `INSERT INTO graph_nodes (organisation_id, case_id, node_type, subject_id, label)
           VALUES ($1,$2,$3,$4,$5) RETURNING ${NODE_COLUMNS.replace(/n\./g, "")}`,
          [
            resolved.value.organisationId,
            resolved.value.caseId,
            input.nodeType,
            input.subjectId,
            input.label,
          ]
        );
        const n = inserted.rows[0]!;
        await this.#audit(tx, context, "graph.node_created", n.id, {
          caseId: resolved.value.caseId,
          nodeType: input.nodeType,
          subjectId: input.subjectId,
        });
        return ok({
          id: n.id,
          organisationId: n.organisation_id,
          caseId: n.case_id,
          nodeType: n.node_type,
          subjectId: n.subject_id,
          label: n.label,
          createdAt: iso(n.created_at)!,
        });
      });
    } catch (error) {
      return this.#unreachable(error);
    }
  }

  /**
   * Creates an edge together with its first assertion.
   *
   * One method rather than two, because an edge with no assertion is the thing
   * GR-G2 exists to prevent and a two-call API makes it reachable — the second
   * call fails, and a live unattributed edge is left behind.
   */
  async createEdge(context: RepositoryContext, input: CreateEdgeInput): Promise<Result<EdgeRecord>> {
    if (!this.#pool) return this.#noDatabase();

    const invalid =
      validateRelationship(input.relationship) ?? validateAssertion(input.assertion);
    if (invalid) return refuse({ reason: "INVALID", detail: invalid });
    if (input.fromNodeId === input.toNodeId) {
      return refuse({ reason: "INVALID", detail: "an edge cannot loop back to its own node" });
    }

    try {
      return await withTransaction(this.#pool, async (tx) => {
        const resolved = await this.#resolve(tx, context, input.caseId, MAY_WRITE_GRAPH);
        if (!resolved.ok) return refuse<EdgeRecord>(resolved.refusal);

        const nodes = await tx.query<{ id: string }>(
          "SELECT id FROM graph_nodes WHERE id = ANY($1) AND case_id = $2 AND organisation_id = $3",
          [
            [input.fromNodeId, input.toNodeId],
            resolved.value.caseId,
            resolved.value.organisationId,
          ]
        );
        if (nodes.rows.length !== 2) {
          return refuse({
            reason: "NOT_PERSISTED",
            detail: "both nodes must belong to this case in this organisation",
          });
        }

        const edge = await tx.query<EdgeRow>(
          `INSERT INTO graph_edges (organisation_id, case_id, from_node_id, to_node_id, relationship)
           VALUES ($1,$2,$3,$4,$5) RETURNING ${EDGE_COLUMNS.replace(/e\./g, "")}`,
          [
            resolved.value.organisationId,
            resolved.value.caseId,
            input.fromNodeId,
            input.toNodeId,
            input.relationship,
          ]
        );
        const row = edge.rows[0]!;

        await tx.query(
          `INSERT INTO graph_assertions (edge_id, assertion_type, asserted_by_type,
             asserted_by_id, execution_id, reason)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            row.id,
            input.assertion.assertionType,
            input.assertion.assertedByType,
            input.assertion.assertedById,
            input.assertion.executionId ?? null,
            input.assertion.reason,
          ]
        );

        await this.#audit(tx, context, "graph.edge_created", row.id, {
          caseId: resolved.value.caseId,
          relationship: input.relationship,
          assertionType: input.assertion.assertionType,
          assertedByType: input.assertion.assertedByType,
        });

        const assertions = await this.#assertionsFor(tx, [row], true);
        return ok(this.#toEdge(row, assertions.get(row.id) ?? []));
      });
    } catch (error) {
      // The live-edge unique index surfaces here. Reported as a conflict rather
      // than an unreachable store, because it is a domain fact.
      if (error instanceof Error && /graph_edges_live_unique_idx/.test(error.message)) {
        return refuse({
          reason: "CONFLICT",
          detail: "that relationship already exists between those nodes",
        });
      }
      return this.#unreachable(error);
    }
  }

  async createAssertion(
    context: RepositoryContext,
    input: CreateAssertionInput
  ): Promise<Result<AssertionRecord>> {
    if (!this.#pool) return this.#noDatabase();
    const invalid = validateAssertion(input);
    if (invalid) return refuse({ reason: "INVALID", detail: invalid });

    try {
      return await withTransaction(this.#pool, async (tx) => {
        const resolved = await this.#resolve(tx, context, input.caseId, MAY_WRITE_GRAPH);
        if (!resolved.ok) return refuse<AssertionRecord>(resolved.refusal);

        const edge = await tx.query<EdgeRow>(
          `SELECT ${EDGE_COLUMNS} FROM graph_edges e
            WHERE e.id = $1 AND e.case_id = $2 AND e.organisation_id = $3`,
          [input.edgeId, resolved.value.caseId, resolved.value.organisationId]
        );
        if (!edge.rows[0]) return refuse({ reason: "NOT_PERSISTED", detail: CASE_NOT_AVAILABLE });

        if (input.supersedesId) {
          const target = await tx.query<{ id: string }>(
            "SELECT id FROM graph_assertions WHERE id = $1 AND edge_id = $2",
            [input.supersedesId, input.edgeId]
          );
          if (!target.rows[0]) {
            return refuse({
              reason: "NOT_PERSISTED",
              detail: "the assertion being superseded is not on this edge",
            });
          }
        }

        const written = await tx.query<AssertionRow>(
          `INSERT INTO graph_assertions (edge_id, assertion_type, asserted_by_type,
             asserted_by_id, execution_id, reason, supersedes_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [
            input.edgeId,
            input.assertionType,
            input.assertedByType,
            input.assertedById,
            input.executionId ?? null,
            input.reason,
            input.supersedesId ?? null,
          ]
        );

        await this.#audit(
          tx,
          context,
          input.supersedesId ? "graph.assertion_superseded" : "graph.assertion_created",
          written.rows[0]!.id,
          {
            caseId: resolved.value.caseId,
            edgeId: input.edgeId,
            assertionType: input.assertionType,
            supersedesId: input.supersedesId ?? null,
          }
        );

        const assertions = await this.#assertionsFor(tx, [edge.rows[0]!], true);
        const record = (assertions.get(input.edgeId) ?? []).find(
          (a) => a.id === written.rows[0]!.id
        );
        return ok(record!);
      });
    } catch (error) {
      if (error instanceof Error && /graph_assertions_one_replacement_idx/.test(error.message)) {
        return refuse({
          reason: "CONFLICT",
          detail: "that assertion has already been superseded",
        });
      }
      return this.#unreachable(error);
    }
  }

  /** Supersession is an addition, never an edit. The original is untouched. */
  async supersedeAssertion(
    context: RepositoryContext,
    input: SupersedeAssertionInput
  ): Promise<Result<AssertionRecord>> {
    if (!this.#pool) return this.#noDatabase();
    try {
      const edge = await this.#pool.query<{ edge_id: string }>(
        "SELECT edge_id FROM graph_assertions WHERE id = $1",
        [input.assertionId]
      );
      if (!edge.rows[0]) {
        return refuse({ reason: "NOT_PERSISTED", detail: CASE_NOT_AVAILABLE });
      }
      return this.createAssertion(context, {
        ...input.replacement,
        caseId: input.caseId,
        edgeId: edge.rows[0].edge_id,
        supersedesId: input.assertionId,
      });
    } catch (error) {
      return this.#unreachable(error);
    }
  }

  /**
   * Records that a piece of evidence backs an assertion.
   *
   * Every check here exists because the alternative is an assertion claiming
   * documentary backing that a reader cannot follow: a document from another
   * matter, one that was deleted, or a locator saying "somewhere in here".
   */
  async linkAssertionEvidence(
    context: RepositoryContext,
    input: LinkAssertionEvidenceInput
  ): Promise<Result<AssertionRecord>> {
    if (!this.#pool) return this.#noDatabase();
    if (!isUsableLocator(input.locator)) {
      return refuse({
        reason: "INVALID",
        detail: "an evidence link must say where to look; a blank locator is not a citation",
      });
    }

    try {
      return await withTransaction(this.#pool, async (tx) => {
        const resolved = await this.#resolve(tx, context, input.caseId, MAY_WRITE_GRAPH);
        if (!resolved.ok) return refuse<AssertionRecord>(resolved.refusal);

        const assertion = await tx.query<{ id: string; edge_id: string }>(
          `SELECT a.id, a.edge_id FROM graph_assertions a
             JOIN graph_edges e ON e.id = a.edge_id
            WHERE a.id = $1 AND e.case_id = $2 AND e.organisation_id = $3`,
          [input.assertionId, resolved.value.caseId, resolved.value.organisationId]
        );
        if (!assertion.rows[0]) {
          return refuse({ reason: "NOT_PERSISTED", detail: CASE_NOT_AVAILABLE });
        }

        const evidence = await tx.query<{ id: string }>(
          "SELECT id FROM evidence_items WHERE id = $1 AND case_id = $2",
          [input.evidenceId, resolved.value.caseId]
        );
        if (!evidence.rows[0]) {
          return refuse({
            reason: "NOT_PERSISTED",
            detail: "no such evidence item on this case",
          });
        }

        const existing = await tx.query<{ assertion_id: string }>(
          "SELECT assertion_id FROM graph_evidence_links WHERE assertion_id = $1 AND evidence_id = $2",
          [input.assertionId, input.evidenceId]
        );
        if (existing.rows[0]) {
          return refuse({ reason: "CONFLICT", detail: "that evidence is already linked" });
        }

        await tx.query(
          `INSERT INTO graph_evidence_links (assertion_id, evidence_id, locator, created_by)
           VALUES ($1,$2,$3,$4)`,
          [input.assertionId, input.evidenceId, input.locator, context.actorId]
        );
        await this.#audit(tx, context, "graph.evidence_linked", input.assertionId, {
          caseId: resolved.value.caseId,
          evidenceId: input.evidenceId,
          locator: input.locator,
        });

        const edgeRow = await tx.query<EdgeRow>(
          `SELECT ${EDGE_COLUMNS} FROM graph_edges e WHERE e.id = $1`,
          [assertion.rows[0].edge_id]
        );
        const assertions = await this.#assertionsFor(tx, edgeRow.rows, true);
        const record = (assertions.get(assertion.rows[0].edge_id) ?? []).find(
          (a) => a.id === input.assertionId
        );
        return ok(record!);
      });
    } catch (error) {
      return this.#unreachable(error);
    }
  }

  /**
   * Retires a relationship.
   *
   * The edge is closed, never deleted. What was believed on the day of a filing
   * is frequently the question, and an edge that vanishes takes the answer with
   * it. The `valid_to IS NULL` predicate is the state-transition guard: a
   * second invalidation matches nothing and is refused.
   */
  async invalidateEdge(
    context: RepositoryContext,
    input: InvalidateEdgeInput
  ): Promise<Result<EdgeRecord>> {
    if (!this.#pool) return this.#noDatabase();
    if (!input.reason.trim()) {
      return refuse({ reason: "INVALID", detail: "an invalidation must state why" });
    }

    try {
      return await withTransaction(this.#pool, async (tx) => {
        const resolved = await this.#resolve(tx, context, input.caseId, MAY_WRITE_GRAPH);
        if (!resolved.ok) return refuse<EdgeRecord>(resolved.refusal);

        const updated = await tx.query<EdgeRow>(
          `UPDATE graph_edges
              SET valid_to = now(), invalidated_by = $1, invalidation_reason = $2
            WHERE id = $3 AND case_id = $4 AND organisation_id = $5 AND valid_to IS NULL
            RETURNING ${EDGE_COLUMNS.replace(/e\./g, "")}`,
          [
            context.actorId,
            input.reason,
            input.edgeId,
            resolved.value.caseId,
            resolved.value.organisationId,
          ]
        );
        if (!updated.rows[0]) {
          const exists = await tx.query<{ id: string }>(
            "SELECT id FROM graph_edges WHERE id = $1 AND case_id = $2 AND organisation_id = $3",
            [input.edgeId, resolved.value.caseId, resolved.value.organisationId]
          );
          return exists.rows[0]
            ? refuse({ reason: "CONFLICT", detail: "this relationship is already retired" })
            : refuse({ reason: "NOT_PERSISTED", detail: CASE_NOT_AVAILABLE });
        }

        await this.#audit(tx, context, "graph.edge_invalidated", input.edgeId, {
          caseId: resolved.value.caseId,
          reason: input.reason,
        });

        const assertions = await this.#assertionsFor(tx, updated.rows, true);
        return ok(this.#toEdge(updated.rows[0]!, assertions.get(input.edgeId) ?? []));
      });
    } catch (error) {
      return this.#unreachable(error);
    }
  }

  /* -------------------------------------------------------------- */

  async #audit(
    sql: SqlExecutor,
    context: RepositoryContext,
    action: string,
    subject: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    await new PostgresAuditStore(sql).append({
      at: new Date().toISOString(),
      actor: context.actorId,
      action,
      subject,
      payload: context.correlationId
        ? { ...payload, correlationId: context.correlationId }
        : payload,
    });
  }

  #noDatabase<T>(): Result<T> {
    return refuse({
      reason: "NO_DATABASE",
      detail:
        "no database is configured for this instance, so no graph is persisted. This is the state of this deployment, not a failure to load.",
    });
  }

  #unreachable<T>(error: unknown): Result<T> {
    return refuse({
      reason: "UNREACHABLE",
      detail: error instanceof Error ? error.message : "the graph store could not be read",
    });
  }
}

function validateRelationship(relationship: Relationship): string | null {
  return RELATIONSHIPS.includes(relationship)
    ? null
    : `${relationship} is not a relationship this graph records`;
}

export function validateAssertion(input: {
  assertionType: AssertionType;
  assertedByType: AssertedByType;
  assertedById: string;
  executionId?: string | null;
  reason: string;
}): string | null {
  if (!ASSERTION_TYPES.includes(input.assertionType)) {
    return `${input.assertionType} is not an assertion type`;
  }
  if (!ASSERTED_BY_TYPES.includes(input.assertedByType)) {
    return `${input.assertedByType} cannot assert anything`;
  }
  if (!input.assertedById.trim()) return "an assertion must name who made it";
  if (!input.reason.trim()) {
    return "an assertion must say why, in words a reader can check";
  }
  // Mirrors `machine_assertions_cite_an_execution`. An edge a model drew with
  // no execution behind it cannot be reproduced or challenged.
  if (input.assertionType === "machine_proposed" && !input.executionId) {
    return "a machine-proposed relationship must cite the execution that proposed it";
  }
  // Mirrors `human_assertions_name_a_person`.
  if (input.assertionType === "human_confirmed" && input.assertedByType !== "user") {
    return "a human confirmation must be attributed to a person";
  }
  return null;
}
