import type { SqlExecutor } from "./client.ts";

/**
 * Operational bootstrap.
 *
 * Creates a whole tenancy — organisation, workspace, members, client, case,
 * evidence, timeline — rather than a row. The difference matters: a seeded case
 * becomes another fixture within months, because it is a fixed shape somebody
 * eventually edits by hand. A bootstrap is a procedure, and running it twice on
 * a fresh database produces the same tenancy.
 *
 * Three rules, each of which exists to stop demonstration data being mistaken
 * for a real matter.
 *
 * **Everything is marked.** Cases carry `is_demo`, and every record created
 * here belongs to a workspace whose name says what it is. The schema has had
 * that column since the first migration and nothing set it; a demonstration
 * case that reads as a real matter is how somebody acts on an invented
 * deadline.
 *
 * **No invented personal data.** The client has a preferred name and languages
 * and nothing else. Fabricating a plausible asylum history — dates, countries,
 * medical detail — produces a record indistinguishable from a real one, in a
 * database that will later hold real ones.
 *
 * **It is audited.** Creating a case is an action, and an unaudited creation is
 * exactly what the chain exists to catch. Bootstrapping writes its own entries.
 */

export interface BootstrapResult {
  readonly organisationId: string;
  readonly workspaceId: string;
  readonly administratorId: string;
  readonly caseworkerId: string;
  readonly clientId: string;
  readonly caseId: string;
  readonly caseReference: string;
  readonly evidenceIds: readonly string[];
  readonly timelineIds: readonly string[];
  /** True when this run created the tenancy; false when it already existed. */
  readonly created: boolean;
}

export interface BootstrapInput {
  /** Names the tenancy. Reused on a second run rather than duplicated. */
  readonly organisationName: string;
  readonly workspaceName: string;
  readonly caseReference: string;
  /** ISO-8601, passed in so a bootstrap is deterministic. */
  readonly at: string;
  /** Who ran it, recorded in the audit chain. */
  readonly operator: string;
}

interface AuditAppender {
  append(input: {
    at: string;
    actor: string;
    action: string;
    subject: string;
    payload: unknown;
  }): Promise<unknown>;
}

/**
 * Creates the tenancy, or returns the existing one.
 *
 * Idempotent by natural key rather than by a flag: the organisation is found by
 * name and the case by workspace and reference, which are the uniqueness
 * constraints the schema already declares. A bootstrap that tracked its own
 * "already ran" state would be a second source of truth about whether it had.
 */
export async function bootstrapTenancy(
  sql: SqlExecutor,
  input: BootstrapInput,
  audit?: AuditAppender
): Promise<BootstrapResult> {
  const existing = await sql.query<{ id: string }>(
    "SELECT id FROM organizations WHERE name = $1 LIMIT 1",
    [input.organisationName]
  );

  if (existing.rows[0]) {
    return resolveExisting(sql, existing.rows[0].id, input);
  }

  const organisation = await sql.query<{ id: string }>(
    "INSERT INTO organizations (name, type) VALUES ($1, 'ngo') RETURNING id",
    [input.organisationName]
  );
  const organisationId = organisation.rows[0]!.id;

  const workspace = await sql.query<{ id: string }>(
    "INSERT INTO workspaces (organization_id, name) VALUES ($1, $2) RETURNING id",
    [organisationId, input.workspaceName]
  );
  const workspaceId = workspace.rows[0]!.id;

  // Two members, because one role cannot demonstrate a permission boundary. The
  // solicitor carries a regulatory reference; without one they may not
  // authorise a reserved activity, and the schema is where that is enforced.
  const administrator = await sql.query<{ id: string }>(
    `INSERT INTO users (workspace_id, display_name, role, regulatory_reference)
     VALUES ($1, 'Bootstrap administrator', 'admin', NULL) RETURNING id`,
    [workspaceId]
  );
  const caseworker = await sql.query<{ id: string }>(
    `INSERT INTO users (workspace_id, display_name, role, regulatory_reference)
     VALUES ($1, 'Bootstrap caseworker', 'caseworker', NULL) RETURNING id`,
    [workspaceId]
  );

  // A preferred name and languages, and nothing else. Requiring a legal name to
  // open a record excludes people whose safety depends on not disclosing one,
  // and inventing a history would produce a record indistinguishable from a
  // real one.
  const client = await sql.query<{ id: string }>(
    `INSERT INTO clients (workspace_id, preferred_name, languages)
     VALUES ($1, 'Demonstration client', ARRAY['en']) RETURNING id`,
    [workspaceId]
  );
  const clientId = client.rows[0]!.id;

  const legalCase = await sql.query<{ id: string }>(
    `INSERT INTO cases (workspace_id, client_id, reference, status, matter_types, risk_level, is_demo)
     VALUES ($1, $2, $3, 'evidence_collection', ARRAY['immigration'], 'low', true)
     RETURNING id`,
    [workspaceId, clientId, input.caseReference]
  );
  const caseId = legalCase.rows[0]!.id;

  // Evidence in several states, because a register where everything is received
  // cannot demonstrate completeness counting, and completeness is derived from
  // these rows rather than stored.
  const evidenceIds: string[] = [];
  for (const item of [
    { title: "Identity document", category: "identity", status: "received" },
    { title: "Home Office correspondence", category: "correspondence", status: "received" },
    { title: "Supporting statement", category: "statement", status: "requested" },
    { title: "Medical report", category: "medical", status: "missing" },
  ] as const) {
    const row = await sql.query<{ id: string }>(
      `INSERT INTO evidence_items (organisation_id, case_id, title, category, status,
         summary, received_at, evidence_type, created_by)
       VALUES ($1, $2, $3, $4, $5, NULL, $6, 'other', $7) RETURNING id`,
      [
        organisationId,
        caseId,
        item.title,
        item.category,
        item.status,
        item.status === "received" ? input.at : null,
        caseworker.rows[0]!.id,
      ]
    );
    evidenceIds.push(row.rows[0]!.id);
  }

  // Each event records how it came to be known. `ai_inferred` is present
  // deliberately: an interface that cannot show the difference between what a
  // person said, what a document shows and what a model concluded is missing
  // the distinction that matters most.
  const timelineIds: string[] = [];
  for (const event of [
    { on: "2026-01-15", title: "Application submitted", source: "document" },
    { on: "2026-03-02", title: "Home Office acknowledgement", source: "document" },
    { on: "2026-05-20", title: "Client reported a change of address", source: "client_stated" },
  ] as const) {
    const row = await sql.query<{ id: string }>(
      `INSERT INTO timeline_events (case_id, occurred_on, title, description, source)
       VALUES ($1, $2, $3, NULL, $4) RETURNING id`,
      [caseId, event.on, event.title, event.source]
    );
    timelineIds.push(row.rows[0]!.id);
  }

  if (audit) {
    // Creating a case is an action. An unaudited creation is what the chain
    // exists to catch, and a bootstrap is not exempt from it.
    await audit.append({
      at: input.at,
      actor: input.operator,
      action: "TENANCY_BOOTSTRAPPED",
      subject: workspaceId,
      payload: {
        organisation: input.organisationName,
        workspace: input.workspaceName,
        caseReference: input.caseReference,
        isDemo: true,
      },
    });
  }

  return {
    organisationId,
    workspaceId,
    administratorId: administrator.rows[0]!.id,
    caseworkerId: caseworker.rows[0]!.id,
    clientId,
    caseId,
    caseReference: input.caseReference,
    evidenceIds,
    timelineIds,
    created: true,
  };
}

async function resolveExisting(
  sql: SqlExecutor,
  organisationId: string,
  input: BootstrapInput
): Promise<BootstrapResult> {
  const workspace = await sql.query<{ id: string }>(
    "SELECT id FROM workspaces WHERE organization_id = $1 ORDER BY created_at LIMIT 1",
    [organisationId]
  );
  const workspaceId = workspace.rows[0]?.id ?? "";

  const users = await sql.query<{ id: string; role: string }>(
    "SELECT id, role FROM users WHERE workspace_id = $1",
    [workspaceId]
  );
  const legalCase = await sql.query<{ id: string; client_id: string }>(
    "SELECT id, client_id FROM cases WHERE workspace_id = $1 AND reference = $2 LIMIT 1",
    [workspaceId, input.caseReference]
  );
  const caseId = legalCase.rows[0]?.id ?? "";

  const evidence = await sql.query<{ id: string }>(
    "SELECT id FROM evidence_items WHERE case_id = $1 ORDER BY created_at",
    [caseId]
  );
  const timeline = await sql.query<{ id: string }>(
    "SELECT id FROM timeline_events WHERE case_id = $1 ORDER BY occurred_on",
    [caseId]
  );

  return {
    organisationId,
    workspaceId,
    administratorId: users.rows.find((u) => u.role === "admin")?.id ?? "",
    caseworkerId: users.rows.find((u) => u.role === "caseworker")?.id ?? "",
    clientId: legalCase.rows[0]?.client_id ?? "",
    caseId,
    caseReference: input.caseReference,
    evidenceIds: evidence.rows.map((r) => r.id),
    timelineIds: timeline.rows.map((r) => r.id),
    created: false,
  };
}
