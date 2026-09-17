import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import { bootstrapTenancy, createPool, withTransaction, type PoolLike } from "@legalos/database";

import { guardOrSkip } from "../guard.ts";

/**
 * The domain constraints, tested by trying to violate them.
 *
 * A CHECK constraint nobody has attempted to breach is indistinguishable from a
 * comment. Each test below writes a row that should be refused and asserts that
 * it is — the same discipline the falsification records apply to observations,
 * at the level where the guarantee actually lives.
 *
 * There is no cleanup at the end. The event tables refuse DELETE, which means a
 * tenancy carrying history cannot be removed row by row — that is the point of
 * them, and it is asserted below rather than worked around. Each run creates its
 * own tenancy; `pnpm test:db:setup` drops the database when it should be empty.
 */
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = guardOrSkip(DATABASE_URL);

const run = Date.now().toString(36);
const TENANCY = `Schema test tenancy ${run}`;

let pool: PoolLike;
let caseId = "";
let orgId = "";
let userId = "";
let solicitorId = "";
let evidenceId = "";

before(async () => {
  if (skip) return;
  pool = await createPool(DATABASE_URL);
  const t = await withTransaction(pool, (tx) =>
    bootstrapTenancy(tx, {
      organisationName: TENANCY,
      workspaceName: "Schema test workspace",
      caseReference: `SCHEMA-${run}`,
      at: "2026-07-27T12:00:00.000Z",
      operator: "test",
    })
  );
  caseId = t.caseId;
  orgId = t.organisationId;
  userId = t.caseworkerId;
  solicitorId = t.administratorId;
  evidenceId = t.evidenceIds[0]!;
});

/* ---------------------------------------------------------------- */
/* Deadlines                                                         */
/* ---------------------------------------------------------------- */

async function insertDeadline(over: Record<string, unknown> = {}) {
  const d = {
    classification: "statutory",
    source_type: "document",
    source_locator: "paragraph 4",
    verification_state: "unverified",
    certainty_state: "exact",
    status: "open",
    verified_by: null,
    verified_at: null,
    ...over,
  };
  const r = await pool.query<{ id: string }>(
    `INSERT INTO deadlines (organisation_id, case_id, deadline_type, deadline_at,
       classification, source_type, source_locator, recorded_by,
       verified_by, verified_at, verification_state, certainty_state, status)
     VALUES ($1,$2,'appeal','2026-09-01T16:00:00Z',$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING id`,
    [
      orgId,
      caseId,
      d.classification,
      d.source_type,
      d.source_locator,
      userId,
      d.verified_by,
      d.verified_at,
      d.verification_state,
      d.certainty_state,
      d.status,
    ]
  );
  return r.rows[0]!.id;
}

test("a statutory deadline citing no source is refused", { skip }, async () => {
  // The invariant this table exists for: no deadline is presented as
  // authoritative unless its source is visible. A date rendered without
  // provenance looks exactly like one that has been checked.
  await assert.rejects(
    () => insertDeadline({ source_type: "unknown", source_locator: null }),
    /authoritative_deadlines_cite_a_source/
  );
});

test("a statutory deadline that cites its source is accepted", { skip }, async () => {
  // The other half. A constraint that refuses everything would pass the test
  // above and be useless.
  const id = await insertDeadline({ source_locator: "rule 19(2), paragraph 4" });
  assert.ok(id);
});

test("an internal target may omit a source, because nobody is bound by it", { skip }, async () => {
  await insertDeadline({
    classification: "internal_target",
    source_type: "unknown",
    source_locator: null,
  });
});

test("a professional confirmation without a named verifier is refused", { skip }, async () => {
  // A verification with no verifier is an assertion.
  await assert.rejects(
    () => insertDeadline({ verification_state: "professional_confirmed" }),
    /verification_names_a_verifier/
  );
});

test("a named verifier without a verified state is refused too", { skip }, async () => {
  // The constraint is an equivalence, not an implication: recording a verifier
  // on an unverified deadline would put a solicitor's name against a date
  // nobody checked.
  await assert.rejects(
    () =>
      insertDeadline({
        verification_state: "unverified",
        verified_by: solicitorId,
        verified_at: "2026-07-27T12:00:00Z",
      }),
    /verification_names_a_verifier/
  );
});

test("a calculated date may not claim to be exact", { skip }, async () => {
  await assert.rejects(
    () => insertDeadline({ source_type: "calculated", certainty_state: "exact" }),
    /calculated_dates_are_not_exact/
  );
});

test("a superseded deadline may not still read as open", { skip }, async () => {
  await assert.rejects(
    () => insertDeadline({ verification_state: "superseded", status: "open" }),
    /superseded_deadlines_are_closed/
  );
});

test("supersession replaces rather than edits", { skip }, async () => {
  // A tribunal extending a direction creates a new row pointing at the old one,
  // so what was believed on the day of a filing survives.
  const original = await insertDeadline({ source_locator: "direction 3" });
  const replacement = await pool.query<{ id: string }>(
    `INSERT INTO deadlines (organisation_id, case_id, deadline_type, deadline_at,
       classification, source_type, source_locator, recorded_by, supersedes_id)
     VALUES ($1,$2,'appeal','2026-10-01T16:00:00Z','tribunal_directed','direction',
             'direction 7',$3,$4) RETURNING id`,
    [orgId, caseId, userId, original]
  );
  assert.ok(replacement.rows[0]!.id);

  // And the original cannot then be removed to tidy up.
  await assert.rejects(
    () => pool.query("DELETE FROM deadlines WHERE id = $1", [original]),
    /violates foreign key constraint/
  );
});

test("deadline history cannot be rewritten", { skip }, async () => {
  const id = await insertDeadline({ source_locator: "paragraph 9" });
  await pool.query(
    "INSERT INTO deadline_events (deadline_id, event, actor_id, detail) VALUES ($1,'recorded',$2,'first record')",
    [id, userId]
  );
  await assert.rejects(
    () => pool.query("UPDATE deadline_events SET detail = 'edited' WHERE deadline_id = $1", [id]),
    /deadline_events is append-only/
  );
  await assert.rejects(
    () => pool.query("DELETE FROM deadline_events WHERE deadline_id = $1", [id]),
    /deadline_events is append-only/
  );
});

/* ---------------------------------------------------------------- */
/* Reviews                                                           */
/* ---------------------------------------------------------------- */

async function insertRequest(over: Record<string, unknown> = {}) {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO review_requests (organisation_id, case_id, subject_type, subject_id,
       requires_professional, reserved_activity, requested_by)
     VALUES ($1,$2,'ai_output',$3,$4,$5,$6) RETURNING id`,
    [
      orgId,
      caseId,
      `subject-${run}-${Math.random().toString(36).slice(2, 8)}`,
      over.requires_professional ?? false,
      over.reserved_activity ?? null,
      userId,
    ]
  );
  return r.rows[0]!.id;
}

test("a reserved activity cannot be reviewed by just anyone", { skip }, async () => {
  // A caseworker may not authorise a reserved legal activity. That is a legal
  // constraint, not a staffing preference.
  await assert.rejects(
    () => insertRequest({ requires_professional: false, reserved_activity: "filing" }),
    /reserved_activities_require_a_professional/
  );
});

test("a solicitor's decision names the registration it was made under", { skip }, async () => {
  const requestId = await insertRequest({ requires_professional: true });
  await assert.rejects(
    () =>
      pool.query(
        `INSERT INTO review_decisions (request_id, decision, basis, decided_by,
           decided_by_role, regulatory_reference, subject_digest)
         VALUES ($1,'approved','looked fine',$2,'solicitor',NULL,repeat('a',64))`,
        [requestId, solicitorId]
      ),
    /professional_decisions_cite_registration/
  );
});

test("a decision is written once and never edited", { skip }, async () => {
  const requestId = await insertRequest();
  await pool.query(
    `INSERT INTO review_decisions (request_id, decision, basis, decided_by,
       decided_by_role, subject_digest)
     VALUES ($1,'approved','evidence checked against the register',$2,'caseworker',repeat('b',64))`,
    [requestId, userId]
  );
  // The question afterwards is never "what does it say now" — it is who
  // approved this, on what basis, and what were they looking at.
  await assert.rejects(
    () =>
      pool.query("UPDATE review_decisions SET decision = 'refused' WHERE request_id = $1", [
        requestId,
      ]),
    /review_decisions is append-only/
  );
  await assert.rejects(
    () => pool.query("DELETE FROM review_decisions WHERE request_id = $1", [requestId]),
    /review_decisions is append-only/
  );
});

test("one request carries one decision", { skip }, async () => {
  const requestId = await insertRequest();
  const insert = () =>
    pool.query(
      `INSERT INTO review_decisions (request_id, decision, basis, decided_by,
         decided_by_role, subject_digest)
       VALUES ($1,'approved','first',$2,'caseworker',repeat('c',64))`,
      [requestId, userId]
    );
  await insert();
  await assert.rejects(insert, /one_decision_per_request/);
});

test("a decided request keeps the history that led to it", { skip }, async () => {
  const requestId = await insertRequest();
  for (const event of ["requested", "assigned", "commented", "decided"]) {
    await pool.query(
      "INSERT INTO review_events (request_id, event, actor_id) VALUES ($1,$2,$3)",
      [requestId, event, userId]
    );
  }
  const events = await pool.query<{ event: string }>(
    "SELECT event FROM review_events WHERE request_id = $1 ORDER BY id",
    [requestId]
  );
  assert.deepEqual(
    events.rows.map((r) => r.event),
    ["requested", "assigned", "commented", "decided"]
  );
  await assert.rejects(
    () => pool.query("DELETE FROM review_events WHERE request_id = $1", [requestId]),
    /review_events is append-only/
  );
});

/* ---------------------------------------------------------------- */
/* Tasks                                                             */
/* ---------------------------------------------------------------- */

async function insertTask(over: Record<string, unknown> = {}) {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO tasks (organisation_id, case_id, task_type, title, status, source,
       proposed_by_execution, created_by, review_request_id, completed_at)
     VALUES ($1,$2,'evidence','Obtain the medical report',$3,$4,$5,$6,$7,$8)
     RETURNING id`,
    [
      orgId,
      caseId,
      over.status ?? "open",
      over.source ?? "human",
      over.proposed_by_execution ?? null,
      userId,
      over.review_request_id ?? null,
      over.completed_at ?? null,
    ]
  );
  return r.rows[0]!.id;
}

test("a task a model proposed must cite the execution that proposed it", { skip }, async () => {
  await assert.rejects(
    () => insertTask({ source: "agent_proposed" }),
    /agent_proposed_tasks_cite_an_execution/
  );
});

test("a task awaiting review must say which review", { skip }, async () => {
  await assert.rejects(
    () => insertTask({ status: "awaiting_review" }),
    /awaiting_review_names_the_review/
  );
});

test("a task awaiting a named review is accepted", { skip }, async () => {
  const requestId = await insertRequest();
  const id = await insertTask({ status: "awaiting_review", review_request_id: requestId });
  assert.ok(id);
});

test("a completed task carries the time it was completed", { skip }, async () => {
  await assert.rejects(() => insertTask({ status: "completed" }), /completed_tasks_have_a_time/);
  // And the inverse: a completion time on an open task would make "completed"
  // unreadable from either column alone.
  await assert.rejects(
    () => insertTask({ status: "open", completed_at: "2026-07-27T12:00:00Z" }),
    /completed_tasks_have_a_time/
  );
});

test("a task cannot depend on itself", { skip }, async () => {
  const id = await insertTask();
  await assert.rejects(
    () => pool.query("INSERT INTO task_dependencies (task_id, depends_on_id) VALUES ($1,$1)", [id]),
    /a_task_does_not_depend_on_itself/
  );
});

test("a task links to the evidence it concerns", { skip }, async () => {
  const id = await insertTask();
  await pool.query(
    "INSERT INTO task_evidence_links (task_id, evidence_id, relation) VALUES ($1,$2,'produces')",
    [id, evidenceId]
  );
  const linked = await pool.query<{ n: string }>(
    "SELECT count(*) AS n FROM task_evidence_links WHERE task_id = $1",
    [id]
  );
  assert.equal(linked.rows[0]!.n, "1");
});

test("task history cannot be rewritten", { skip }, async () => {
  const id = await insertTask();
  await pool.query("INSERT INTO task_events (task_id, event, actor_id) VALUES ($1,'created',$2)", [
    id,
    userId,
  ]);
  await assert.rejects(
    () => pool.query("UPDATE task_events SET event = 'completed' WHERE task_id = $1", [id]),
    /task_events is append-only/
  );
});

/* ---------------------------------------------------------------- */
/* Graph                                                             */
/* ---------------------------------------------------------------- */

let nodeSeq = 0;
async function node() {
  const subject = `doc-${run}-${nodeSeq++}`;
  const r = await pool.query<{ id: string }>(
    `INSERT INTO graph_nodes (organisation_id, case_id, node_type, subject_id, label)
     VALUES ($1,$2,'evidence',$3,$3) RETURNING id`,
    [orgId, caseId, subject]
  );
  return { id: r.rows[0]!.id, subject };
}

async function edge(from: string, to: string, relationship = "supports") {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO graph_edges (organisation_id, case_id, from_node_id, to_node_id, relationship)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [orgId, caseId, from, to, relationship]
  );
  return r.rows[0]!.id;
}

test("one node per subject, so a case is drawn once", { skip }, async () => {
  const first = await node();
  await assert.rejects(
    () =>
      pool.query(
        `INSERT INTO graph_nodes (organisation_id, case_id, node_type, subject_id, label)
         VALUES ($1,$2,'evidence',$3,$3)`,
        [orgId, caseId, first.subject]
      ),
    /one_node_per_subject/
  );
});

test("an edge may not loop", { skip }, async () => {
  const a = await node();
  await assert.rejects(() => edge(a.id, a.id), /an_edge_does_not_loop/);
});

test("a retired edge must say when it stopped holding", { skip }, async () => {
  const a = await node();
  const b = await node();
  const c = await node();
  const original = await edge(a.id, b.id);
  const replacement = await edge(a.id, c.id);
  await assert.rejects(
    () =>
      pool.query("UPDATE graph_edges SET superseded_by = $2 WHERE id = $1", [
        original,
        replacement,
      ]),
    /retired_edges_have_an_end/
  );
  await pool.query("UPDATE graph_edges SET valid_to = now(), superseded_by = $2 WHERE id = $1", [
    original,
    replacement,
  ]);
});

test("a machine-proposed relationship must cite its execution", { skip }, async () => {
  const a = await node();
  const b = await node();
  const e = await edge(a.id, b.id);
  // An edge drawn without its author reads as a fact about the case.
  await assert.rejects(
    () =>
      pool.query(
        `INSERT INTO graph_assertions (edge_id, assertion_type, asserted_by_type,
           asserted_by_id, reason)
         VALUES ($1,'machine_proposed','agent','evidence-agent','dates align')`,
        [e]
      ),
    /machine_assertions_cite_an_execution/
  );
});

test("a human confirmation must be attributed to a person", { skip }, async () => {
  const a = await node();
  const b = await node();
  const e = await edge(a.id, b.id, "corroborates");
  await assert.rejects(
    () =>
      pool.query(
        `INSERT INTO graph_assertions (edge_id, assertion_type, asserted_by_type,
           asserted_by_id, reason)
         VALUES ($1,'human_confirmed','agent','some-agent','confirmed')`,
        [e]
      ),
    /human_assertions_name_a_person/
  );
});

test("a source-backed assertion carries the evidence it rests on", { skip }, async () => {
  const a = await node();
  const b = await node();
  const e = await edge(a.id, b.id, "corroborates");
  const assertion = await pool.query<{ id: string }>(
    `INSERT INTO graph_assertions (edge_id, assertion_type, asserted_by_type,
       asserted_by_id, reason)
     VALUES ($1,'source_backed','user',$2,'both letters name the same employer')
     RETURNING id`,
    [e, userId]
  );
  await pool.query(
    "INSERT INTO graph_evidence_links (assertion_id, evidence_id, locator) VALUES ($1,$2,'page 2')",
    [assertion.rows[0]!.id, evidenceId]
  );

  // Retraction is a new assertion, not an edit to the old one.
  await assert.rejects(
    () =>
      pool.query("UPDATE graph_assertions SET assertion_type = 'disputed' WHERE id = $1", [
        assertion.rows[0]!.id,
      ]),
    /graph_assertions is append-only/
  );
  await pool.query(
    `INSERT INTO graph_assertions (edge_id, assertion_type, asserted_by_type,
       asserted_by_id, reason)
     VALUES ($1,'disputed','user',$2,'the employers are different companies')`,
    [e, solicitorId]
  );
  const history = await pool.query<{ n: string }>(
    "SELECT count(*) AS n FROM graph_assertions WHERE edge_id = $1",
    [e]
  );
  assert.equal(history.rows[0]!.n, "2");
});

test("no column anywhere stores a model probability", { skip }, async () => {
  // Stated as a test so it stays true as the schema grows. A percentage is not
  // a state a person can act on, and this platform shows no confidence figures.
  const cols = await pool.query<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (column_name ILIKE '%confidence%' OR column_name ILIKE '%probability%'
             OR column_name ILIKE '%score%' OR column_name ILIKE '%likelihood%')
      ORDER BY table_name, column_name`
  );
  assert.deepEqual(
    cols.rows.map((r) => `${r.table_name}.${r.column_name}`),
    []
  );
});

/* ---------------------------------------------------------------- */
/* Destructive-operation policy                                      */
/* ---------------------------------------------------------------- */

const APPEND_ONLY = [
  "deadline_events",
  "review_decisions",
  "review_events",
  "task_events",
  "graph_assertions",
];

test("TRUNCATE is refused on every append-only table", { skip }, async () => {
  // Row triggers do not fire on TRUNCATE. Without a statement-level trigger the
  // whole append-only guarantee is one command away from being untrue.
  for (const table of APPEND_ONLY) {
    await assert.rejects(() => pool.query(`TRUNCATE ${table}`), `${table} accepted TRUNCATE`);
  }
});

test("the TRUNCATE refusal is the guard, not a side effect of a foreign key", { skip }, async () => {
  // `graph_assertions` is also refused because `graph_evidence_links` points at
  // it — Postgres raises before any trigger runs. That protection is real but
  // incidental: it would disappear with the link table. The guarantee has to be
  // the trigger, so the trigger is what gets asserted.
  const guards = await pool.query<{ table: string }>(
    `SELECT c.relname AS table
       FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      WHERE NOT t.tgisinternal
        AND t.tgtype & 32 <> 0            -- TRUNCATE
        AND c.relname = ANY($1)`,
    [APPEND_ONLY]
  );
  assert.deepEqual(guards.rows.map((r) => r.table).sort(), [...APPEND_ONLY].sort());
});

test("a case carrying recorded history cannot be deleted", { skip }, async () => {
  // The policy, stated where it is enforced: there is no row-level erasure path
  // for a case with history. Erasure under a data-protection request is a
  // separate, audited operator procedure that does not exist yet — and its
  // absence should look like an error, not like a delete that quietly worked.
  await assert.rejects(
    () => pool.query("DELETE FROM cases WHERE id = $1", [caseId]),
    /append-only|violates foreign key constraint/
  );
  const stillThere = await pool.query<{ n: string }>(
    "SELECT count(*) AS n FROM cases WHERE id = $1",
    [caseId]
  );
  assert.equal(stillThere.rows[0]!.n, "1");
});

test("every new table is scoped to an organisation and a case", { skip }, async () => {
  // Tenant isolation cannot be added by a repository that forgets a WHERE
  // clause. The columns have to be there for the clause to be writable.
  const scoped = ["deadlines", "review_requests", "tasks", "graph_nodes", "graph_edges"];
  for (const table of scoped) {
    const cols = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
          AND column_name IN ('organisation_id', 'case_id')`,
      [table]
    );
    assert.equal(cols.rows.length, 2, `${table} is not scoped to both organisation and case`);
  }
});

after(async () => {
  if (skip) return;
  await pool.end();
});
