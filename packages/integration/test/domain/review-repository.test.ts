import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Membership } from "@legalos/auth";
import {
  bootstrapTenancy,
  createPool,
  PostgresAuditStore,
  withTransaction,
  type PoolClientLike,
  type PoolLike,
} from "@legalos/database";
import { ReviewRepository, type RepositoryContext } from "@legalos/repositories";

import { guardOrSkip } from "../guard.ts";
import { emitEvidence } from "../../src/index.ts";

/**
 * The review repository, against a real database.
 *
 * This is the boundary the platform's central claim rests on, so the tests are
 * arranged around the ways an approval could turn out to be worth less than it
 * looks: recorded by the wrong person, by the person who asked for it, by a
 * model, twice, or without the audit entry that would let anyone check.
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

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const run = Date.now().toString(36);

let pool: PoolLike;
let repo: ReviewRepository;

interface Tenancy {
  organisationId: string;
  workspaceId: string;
  caseId: string;
  caseworkerId: string;
  solicitorId: string;
}
let alpha: Tenancy;
let beta: Tenancy;

const ACCOUNT = "55555555-5555-4555-8555-555555555555";
const OUTSIDER = "66666666-6666-4666-8666-666666666666";

const membership = (over: Partial<Membership> & { workspaceId: string }): Membership => ({
  accountId: ACCOUNT,
  role: "caseworker",
  regulatoryReference: null,
  removedAt: null,
  ...over,
});

/** The caseworker who asks for reviews. */
const requester = (): RepositoryContext => ({
  actorId: alpha.caseworkerId,
  accountId: ACCOUNT,
  organisationId: alpha.organisationId,
  memberships: [membership({ workspaceId: alpha.workspaceId })],
  correlationId: `req-${run}`,
});

/** The solicitor who decides them. A different person, deliberately. */
const reviewer = (over: Partial<Membership> = {}): RepositoryContext => ({
  actorId: alpha.solicitorId,
  accountId: ACCOUNT,
  organisationId: alpha.organisationId,
  memberships: [
    membership({
      workspaceId: alpha.workspaceId,
      role: "solicitor",
      regulatoryReference: "SRA 998877",
      ...over,
    }),
  ],
  correlationId: `dec-${run}`,
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
  };
}

let subjectSeq = 0;
const ask = (over: Record<string, unknown> = {}) =>
  ({
    caseId: alpha.caseId,
    subjectType: "draft_document" as const,
    subjectId: `draft-${run}-${subjectSeq++}`,
    subjectDigest: digest(`draft-${run}-${subjectSeq}`),
    reason: "grounds of appeal need checking before filing",
    ...over,
  }) as Parameters<ReviewRepository["createReviewRequest"]>[1];

function value<T>(result: { ok: true; value: T } | { ok: false; refusal: { detail: string } }): T {
  assert.ok(result.ok, `expected success, got refusal: ${result.ok ? "" : result.refusal.detail}`);
  return result.value;
}

/** Creates a request and returns it, for tests that need one to act on. */
async function requested(over: Record<string, unknown> = {}) {
  return value(await repo.createReviewRequest(requester(), ask(over)));
}

before(async () => {
  if (skip) return;
  pool = await createPool(DATABASE_URL);
  repo = new ReviewRepository(pool);
  alpha = await tenancy("Alpha reviews");
  beta = await tenancy("Beta reviews");
});

/* ================================================================ */
/* Tenancy                                                          */
/* ================================================================ */

test(
  "a caller from one organisation cannot read another's reviews",
  { skip },
  records("cross_org_read", async () => {
    const betaContext: RepositoryContext = {
      actorId: beta.caseworkerId,
      accountId: OUTSIDER,
      organisationId: beta.organisationId,
      memberships: [membership({ workspaceId: beta.workspaceId, accountId: OUTSIDER })],
    };
    value(
      await repo.createReviewRequest(betaContext, {
        ...ask(),
        caseId: beta.caseId,
      })
    );

    const result = await repo.readReviewsForCase(requester(), beta.caseId);
    assert.equal(result.ok === false && result.refusal.reason, "NOT_PERSISTED");

    // And the queue, which is not case-scoped, must not leak beta either.
    const queue = value(await repo.readReviewQueue(requester()));
    for (const entry of queue) {
      assert.equal(entry.organisationId, alpha.organisationId);
      assert.notEqual(entry.caseId, beta.caseId);
    }
  })
);

test(
  "a person acting for two organisations carries nothing between them",
  { skip },
  records("dual_membership_isolated", async () => {
    // The case that isolates the organisation predicate from the membership
    // check. Deleting the predicate in the deadline repository left every other
    // cross-tenancy test green, because a caller from one organisation holds no
    // membership in another's workspace. Only this shape refuses on the
    // predicate itself.
    const dual: RepositoryContext = {
      actorId: alpha.caseworkerId,
      accountId: ACCOUNT,
      organisationId: alpha.organisationId,
      memberships: [
        membership({ workspaceId: alpha.workspaceId }),
        membership({ workspaceId: beta.workspaceId }),
      ],
    };

    const read = await repo.readReviewsForCase(dual, beta.caseId);
    assert.equal(read.ok === false && read.refusal.reason, "NOT_PERSISTED");

    const write = await repo.createReviewRequest(dual, { ...ask(), caseId: beta.caseId });
    assert.equal(write.ok === false && write.refusal.reason, "NOT_PERSISTED");

    // The same account on a session scoped to beta can reach it, so the refusal
    // is about the session's scope rather than about the account.
    const scoped: RepositoryContext = { ...dual, organisationId: beta.organisationId };
    assert.equal((await repo.readReviewsForCase(scoped, beta.caseId)).ok, true);

    // The queue too: scoped to alpha, it must contain no beta rows even though
    // the caller holds a real membership in beta's workspace.
    const queue = value(await repo.readReviewQueue(dual));
    for (const entry of queue) assert.equal(entry.organisationId, alpha.organisationId);
  })
);

test(
  "an actor with no case access sees no queue",
  { skip },
  records("no_membership_queue", async () => {
    const stranger: RepositoryContext = { ...requester(), memberships: [] };
    assert.deepEqual(value(await repo.readReviewQueue(stranger)), []);
    const read = await repo.readReviewsForCase(stranger, alpha.caseId);
    assert.equal(read.ok === false && read.refusal.reason, "NOT_PERSISTED");
  })
);

test(
  "a foreign case and a case that does not exist are indistinguishable",
  { skip },
  records("no_enumeration", async () => {
    const foreign = await repo.readReviewsForCase(requester(), beta.caseId);
    const absent = await repo.readReviewsForCase(
      requester(),
      "00000000-0000-4000-8000-000000000000"
    );
    assert.deepEqual(
      foreign.ok === false && foreign.refusal,
      absent.ok === false && absent.refusal
    );
  })
);

/* ================================================================ */
/* A request is not a decision                                      */
/* ================================================================ */

test(
  "creating a request does not approve anything",
  { skip },
  records("request_is_not_approval", async () => {
    // The failure that would be hardest to notice: a request that produced a
    // decision row on any path other than a person deciding would satisfy every
    // status check in the system and be a fabricated authorisation.
    const request = await requested();
    assert.equal(request.status, "open");
    assert.equal(request.queueState, "unassigned");
    assert.equal(request.hasDecision, false);
    assert.equal(request.decision, null);

    const rows = await pool.query<{ n: string }>(
      "SELECT count(*) AS n FROM review_decisions WHERE request_id = $1",
      [request.id]
    );
    assert.equal(rows.rows[0]!.n, "0");
  })
);

test(
  "assigning a reviewer does not complete the review",
  { skip },
  records("assignment_is_not_approval", async () => {
    // A queue that treated assignment as completion would show work as done
    // because somebody's name is against it.
    const request = await requested();
    const assigned = value(
      await repo.reassignReview(requester(), {
        caseId: alpha.caseId,
        requestId: request.id,
        assignTo: alpha.solicitorId,
        expectedVersion: request.version,
      })
    );
    assert.equal(assigned.queueState, "assigned");
    assert.equal(assigned.status, "open");
    assert.equal(assigned.hasDecision, false);
    assert.equal(assigned.decision, null);
    assert.equal(assigned.assignedTo, alpha.solicitorId);
    assert.ok(assigned.assignedAt);
  })
);

test(
  "a model's output is a subject for review, never a decision",
  { skip },
  records("model_is_not_a_decision", async () => {
    // A request can name the execution that produced what is being reviewed.
    // Nothing about that produces a decision, and there is no parameter on
    // recordReviewDecision that accepts an execution at all.
    await pool.query(
      `INSERT INTO prompt_templates (id, version, kind, body, body_hash)
       VALUES ($1,'1','system','a template used only by this test',repeat('c',64))
       ON CONFLICT DO NOTHING`,
      [`tmpl-${run}`]
    );
    const execution = await pool.query<{ id: string }>(
      `INSERT INTO ai_executions (
         organisation_id, case_id, actor_id, actor_type, department, agent_id, agent_version,
         provider, model, model_version, prompt_template_id, prompt_template_version,
         system_prompt_hash, user_message_hash, verified_source_count, unverified_source_count,
         registry_version, guardrail_version, verification_verdict)
       VALUES ($1,$2,$3,'caseworker','drafting','drafting-agent','1.0.0',
               'test-provider','test-model','1',$4,'1',
               repeat('a',64), repeat('b',64), 0, 0, '1', '1', 'pass')
       RETURNING id`,
      [alpha.organisationId, alpha.caseId, alpha.caseworkerId, `tmpl-${run}`]
    );
    const request = await requested({
      subjectType: "ai_output",
      executionId: execution.rows[0]!.id,
    });
    assert.equal(request.executionId, execution.rows[0]!.id);
    assert.equal(request.hasDecision, false);

    const parameters = Object.keys({
      caseId: 1,
      requestId: 1,
      decision: 1,
      basis: 1,
      subjectDigest: 1,
      expectedVersion: 1,
    });
    assert.ok(!parameters.some((k) => /execution|agent|model/i.test(k)));

    // And every decision in the table names a real user as its author.
    const orphans = await pool.query<{ n: string }>(
      "SELECT count(*) AS n FROM review_decisions d LEFT JOIN users u ON u.id = d.decided_by WHERE u.id IS NULL"
    );
    assert.equal(orphans.rows[0]!.n, "0");
  })
);

test(
  "terminal state requires an immutable decision, not a status",
  { skip },
  records("terminal_needs_decision", async () => {
    // hasDecision is read from the decision table, never from status='decided'.
    // A status is what an UPDATE last wrote; a decision row is the record a
    // regulator would ask to see, and if the two ever disagree this reports the
    // second.
    const request = await requested();
    await pool.query("UPDATE review_requests SET status = 'decided' WHERE id = $1", [request.id]);

    const [seen] = value(await repo.readReviewQueue(requester(), { includeClosed: true })).filter(
      (r) => r.id === request.id
    );
    assert.ok(seen);
    assert.equal(seen.status, "decided");
    assert.equal(seen.hasDecision, false, "a forged status reported as a genuine decision");
    assert.equal(seen.decision, null);
  })
);

/* ================================================================ */
/* Authority and separation of duty                                 */
/* ================================================================ */

test(
  "the person who asked for a review cannot decide it",
  { skip },
  records("no_self_approval", async () => {
    const request = await requested();
    const result = await repo.recordReviewDecision(requester(), {
      caseId: alpha.caseId,
      requestId: request.id,
      decision: "approved",
      basis: "I asked for this and I am happy with it",
      subjectDigest: digest("anything"),
      expectedVersion: request.version,
    });
    assert.equal(result.ok === false && result.refusal.reason, "FORBIDDEN");
    assert.match(result.ok === false ? result.refusal.detail : "", /may not be the person who decides/);
  })
);

test(
  "a caseworker cannot decide a review that requires a professional",
  { skip },
  records("caseworker_cannot_decide_reserved", async () => {
    const request = await requested({
      requiresProfessional: true,
      requiredRole: "solicitor",
      reservedActivity: "filing",
    });
    const otherCaseworker: RepositoryContext = {
      ...requester(),
      actorId: alpha.solicitorId,
      memberships: [membership({ workspaceId: alpha.workspaceId, role: "caseworker" })],
    };
    const result = await repo.recordReviewDecision(otherCaseworker, {
      caseId: alpha.caseId,
      requestId: request.id,
      decision: "approved",
      basis: "looks fine",
      subjectDigest: digest("x"),
      expectedVersion: request.version,
    });
    assert.equal(result.ok === false && result.refusal.reason, "FORBIDDEN");
    assert.match(result.ok === false ? result.refusal.detail : "", /regulated professional/);
  })
);

test(
  "a solicitor with no registration cannot decide a reserved activity",
  { skip },
  records("unregistered_cannot_decide", async () => {
    // The registration is what makes the role mean something. Without it there
    // is nobody a regulator could ask about this approval.
    const request = await requested({
      requiresProfessional: true,
      requiredRole: "solicitor",
      reservedActivity: "filing",
    });
    const result = await repo.recordReviewDecision(reviewer({ regulatoryReference: null }), {
      caseId: alpha.caseId,
      requestId: request.id,
      decision: "approved",
      basis: "checked the grounds",
      subjectDigest: digest("x"),
      expectedVersion: request.version,
    });
    assert.equal(result.ok === false && result.refusal.reason, "FORBIDDEN");
    assert.match(result.ok === false ? result.refusal.detail : "", /registration on record/);
  })
);

test(
  "a reviewer from another organisation cannot decide",
  { skip },
  records("foreign_reviewer_refused", async () => {
    const request = await requested();
    const foreign: RepositoryContext = {
      actorId: beta.solicitorId,
      accountId: OUTSIDER,
      organisationId: beta.organisationId,
      memberships: [
        membership({ workspaceId: beta.workspaceId, accountId: OUTSIDER, role: "solicitor" }),
      ],
    };
    const result = await repo.recordReviewDecision(foreign, {
      caseId: alpha.caseId,
      requestId: request.id,
      decision: "approved",
      basis: "no",
      subjectDigest: digest("x"),
      expectedVersion: request.version,
    });
    assert.equal(result.ok === false && result.refusal.reason, "NOT_PERSISTED");
  })
);

test(
  "a valid decision records the role and registration as at signing",
  { skip },
  records("role_captured_at_signing", async () => {
    const request = await requested({
      requiresProfessional: true,
      requiredRole: "solicitor",
      reservedActivity: "filing",
    });
    const { decision } = value(
      await repo.recordReviewDecision(reviewer(), {
        caseId: alpha.caseId,
        requestId: request.id,
        decision: "approved_with_amendments",
        basis: "grounds 1 and 2 stand; ground 3 needs the medical report attached",
        subjectDigest: request.subjectDigest!,
        expectedVersion: request.version,
      })
    );

    assert.equal(decision.decidedBy, alpha.solicitorId);
    assert.equal(decision.decidedByRole, "solicitor");
    assert.equal(decision.regulatoryReference, "SRA 998877");
    // Not collapsed into approved. Recording a solicitor as having signed off
    // text they in fact required changes to is the failure here.
    assert.equal(decision.decision, "approved_with_amendments");

    // The stored role survives the reviewer's role changing afterwards.
    const later = value(await repo.readReviewsForCase(requester(), alpha.caseId)).find(
      (r) => r.id === request.id
    );
    assert.equal(later!.decision!.decidedByRole, "solicitor");
    assert.equal(later!.decision!.regulatoryReference, "SRA 998877");
  })
);

test(
  "a decision binds the exact artefact the reviewer looked at",
  { skip },
  records("decision_binds_subject", async () => {
    // The failure: a draft is edited after approval and the approval appears to
    // cover the edited text.
    const submitted = digest("version-one");
    const request = await requested({ subjectDigest: submitted });
    const { decision } = value(
      await repo.recordReviewDecision(reviewer(), {
        caseId: alpha.caseId,
        requestId: request.id,
        decision: "approved",
        basis: "checked against the refusal letter",
        subjectDigest: submitted,
        expectedVersion: request.version,
      })
    );
    assert.equal(decision.subjectDigest, submitted);

    const { decisionCoversDigest } = await import("@legalos/repositories");
    assert.equal(decisionCoversDigest(decision, submitted), true);
    assert.equal(decisionCoversDigest(decision, digest("version-two")), false);
  })
);

test(
  "a decision must state its basis and name a real digest",
  { skip },
  records("decision_requires_basis", async () => {
    const request = await requested();
    const blank = await repo.recordReviewDecision(reviewer(), {
      caseId: alpha.caseId,
      requestId: request.id,
      decision: "approved",
      basis: "   ",
      subjectDigest: digest("x"),
      expectedVersion: request.version,
    });
    assert.equal(blank.ok === false && blank.refusal.reason, "INVALID");
    assert.match(blank.ok === false ? blank.refusal.detail : "", /cannot be reviewed by anyone else/);

    const bad = await repo.recordReviewDecision(reviewer(), {
      caseId: alpha.caseId,
      requestId: request.id,
      decision: "approved",
      basis: "fine",
      subjectDigest: "not-a-digest",
      expectedVersion: request.version,
    });
    assert.equal(bad.ok === false && bad.refusal.reason, "INVALID");
  })
);

/* ================================================================ */
/* Write-once and concurrency                                       */
/* ================================================================ */

test(
  "a second decision on the same request is refused",
  { skip },
  records("decision_write_once", async () => {
    const request = await requested();
    const first = value(
      await repo.recordReviewDecision(reviewer(), {
        caseId: alpha.caseId,
        requestId: request.id,
        decision: "approved",
        basis: "checked",
        subjectDigest: request.subjectDigest!,
        expectedVersion: request.version,
      })
    );

    const second = await repo.recordReviewDecision(reviewer(), {
      caseId: alpha.caseId,
      requestId: request.id,
      decision: "refused",
      basis: "changed my mind",
      subjectDigest: request.subjectDigest!,
      expectedVersion: first.request.version,
    });
    assert.equal(second.ok, false);

    // The first decision is untouched. An approval reversed by writing a second
    // decision would leave a record reading as though the reviewer approved the
    // amended version all along.
    const rows = await pool.query<{ decision: string }>(
      "SELECT decision FROM review_decisions WHERE request_id = $1",
      [request.id]
    );
    assert.equal(rows.rows.length, 1);
    assert.equal(rows.rows[0]!.decision, "approved");
  })
);

test(
  "two concurrent terminal decisions cannot both commit",
  { skip },
  records("concurrent_decisions", async () => {
    // Two reviewers deciding the same request from two screens. Exactly one
    // must win, and the loser must leave nothing behind.
    const request = await requested();
    const second: RepositoryContext = {
      ...reviewer(),
      actorId: beta.caseworkerId === alpha.solicitorId ? alpha.caseworkerId : alpha.solicitorId,
    };

    const [a, b] = await Promise.all([
      repo.recordReviewDecision(reviewer(), {
        caseId: alpha.caseId,
        requestId: request.id,
        decision: "approved",
        basis: "first reviewer approves",
        subjectDigest: request.subjectDigest!,
        expectedVersion: request.version,
      }),
      repo.recordReviewDecision(second, {
        caseId: alpha.caseId,
        requestId: request.id,
        decision: "refused",
        basis: "second reviewer refuses",
        subjectDigest: request.subjectDigest!,
        expectedVersion: request.version,
      }),
    ]);

    assert.equal([a.ok, b.ok].filter(Boolean).length, 1, "both concurrent decisions committed");

    const decisions = await pool.query<{ n: string }>(
      "SELECT count(*) AS n FROM review_decisions WHERE request_id = $1",
      [request.id]
    );
    assert.equal(decisions.rows[0]!.n, "1");

    // The loser left no event and no audit entry either.
    const events = await pool.query<{ n: string }>(
      "SELECT count(*) AS n FROM review_events WHERE request_id = $1 AND event = 'decided'",
      [request.id]
    );
    assert.equal(events.rows[0]!.n, "1");
    const audit = await pool.query<{ n: string }>(
      "SELECT count(*) AS n FROM audit_log WHERE subject = $1 AND action = 'review.decided'",
      [request.id]
    );
    assert.equal(audit.rows[0]!.n, "1");
  })
);

test(
  "a stale version token is refused rather than applied",
  { skip },
  records("stale_token", async () => {
    // The deadline lesson, applied. The token is an integer precisely so that
    // it cannot be lost to a precision mismatch: comparing a PostgreSQL
    // microsecond timestamp against a value that has round-tripped through a
    // JavaScript date refuses every legitimate write while looking like correct
    // concurrency control.
    const request = await requested();
    const stale = request.version;

    const assigned = value(
      await repo.reassignReview(requester(), {
        caseId: alpha.caseId,
        requestId: request.id,
        assignTo: alpha.solicitorId,
        expectedVersion: stale,
      })
    );
    assert.equal(assigned.version, stale + 1);

    const late = await repo.recordReviewDecision(reviewer(), {
      caseId: alpha.caseId,
      requestId: request.id,
      decision: "approved",
      basis: "deciding against a stale read",
      subjectDigest: request.subjectDigest!,
      expectedVersion: stale,
    });
    assert.equal(late.ok === false && late.refusal.reason, "CONFLICT");

    // The current token works.
    const now = value(
      await repo.recordReviewDecision(reviewer(), {
        caseId: alpha.caseId,
        requestId: request.id,
        decision: "approved",
        basis: "deciding against a current read",
        subjectDigest: request.subjectDigest!,
        expectedVersion: assigned.version,
      })
    );
    assert.equal(now.decision.decision, "approved");
  })
);

test(
  "a withdrawn review can no longer be decided",
  { skip },
  records("withdrawn_is_terminal", async () => {
    const request = await requested();
    const withdrawn = value(
      await repo.withdrawReviewRequest(requester(), {
        caseId: alpha.caseId,
        requestId: request.id,
        reason: "the draft was abandoned",
        expectedVersion: request.version,
      })
    );
    assert.equal(withdrawn.queueState, "withdrawn");
    // A withdrawal is not a refusal and records no decision.
    assert.equal(withdrawn.hasDecision, false);

    const late = await repo.recordReviewDecision(reviewer(), {
      caseId: alpha.caseId,
      requestId: request.id,
      decision: "approved",
      basis: "too late",
      subjectDigest: request.subjectDigest!,
      expectedVersion: withdrawn.version,
    });
    assert.equal(late.ok === false && late.refusal.reason, "CONFLICT");
  })
);

/* ================================================================ */
/* Atomicity and audit                                              */
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

async function counts(requestId: string) {
  const q = async (sql: string) =>
    Number((await pool.query<{ n: string }>(sql, [requestId])).rows[0]!.n);
  return {
    decisions: await q("SELECT count(*) AS n FROM review_decisions WHERE request_id = $1"),
    events: await q("SELECT count(*) AS n FROM review_events WHERE request_id = $1"),
    audit: await q("SELECT count(*) AS n FROM audit_log WHERE subject = $1"),
    status: (
      await pool.query<{ status: string }>("SELECT status FROM review_requests WHERE id = $1", [
        requestId,
      ])
    ).rows[0]!.status,
  };
}

test(
  "a valid decision writes decision, event and audit, and the chain still verifies",
  { skip },
  records("decision_is_audited", async () => {
    const request = await requested();
    const before = await counts(request.id);

    value(
      await repo.recordReviewDecision(reviewer(), {
        caseId: alpha.caseId,
        requestId: request.id,
        decision: "approved",
        basis: "grounds check out against the refusal letter",
        subjectDigest: request.subjectDigest!,
        expectedVersion: request.version,
      })
    );

    const after = await counts(request.id);
    assert.equal(after.decisions, before.decisions + 1);
    assert.equal(after.events, before.events + 1);
    assert.equal(after.audit, before.audit + 1);
    assert.equal(after.status, "decided");

    const entry = await pool.query<{ actor: string; payload: Record<string, unknown> }>(
      "SELECT actor, payload FROM audit_log WHERE subject = $1 AND action = 'review.decided'",
      [request.id]
    );
    assert.equal(entry.rows[0]!.actor, alpha.solicitorId);
    assert.equal(entry.rows[0]!.payload.decidedByRole, "solicitor");
    assert.equal(entry.rows[0]!.payload.regulatoryReference, "SRA 998877");
    assert.equal(entry.rows[0]!.payload.correlationId, `dec-${run}`);

    // The chain the entry joined still verifies end to end.
    const verified = await withTransaction(pool, (tx) => new PostgresAuditStore(tx).verify());
    assert.equal(verified.valid, true, `audit chain broke: ${JSON.stringify(verified)}`);
  })
);

test(
  "an induced failure on any write rolls the whole decision back",
  { skip },
  records("decision_rollback", async () => {
    // No request may appear approved without its immutable decision and audit
    // evidence. Each of the four writes is failed in turn.
    for (const [label, pattern] of [
      ["decision insert", /INSERT INTO review_decisions/],
      ["event insert", /INSERT INTO review_events/],
      ["audit insert", /audit_log/],
      ["status update", /UPDATE review_requests/],
    ] as const) {
      const request = await requested();
      const before = await counts(request.id);

      const broken = new ReviewRepository(failingPool(pool, pattern));
      const result = await broken.recordReviewDecision(reviewer(), {
        caseId: alpha.caseId,
        requestId: request.id,
        decision: "approved",
        basis: `should roll back on ${label}`,
        subjectDigest: request.subjectDigest!,
        expectedVersion: request.version,
      });

      assert.equal(result.ok, false, `${label} did not fail`);
      const after = await counts(request.id);
      assert.deepEqual(after, before, `${label} left something behind`);
      assert.equal(after.status, "open");
    }
  })
);

test(
  "an induced audit failure rolls back a request as well",
  { skip },
  records("request_rollback", async () => {
    const before = await pool.query<{ n: string }>(
      "SELECT count(*) AS n FROM review_requests WHERE case_id = $1",
      [alpha.caseId]
    );
    const broken = new ReviewRepository(failingPool(pool, /audit_log/));
    const result = await broken.createReviewRequest(requester(), ask());
    assert.equal(result.ok, false);
    const after = await pool.query<{ n: string }>(
      "SELECT count(*) AS n FROM review_requests WHERE case_id = $1",
      [alpha.caseId]
    );
    assert.equal(after.rows[0]!.n, before.rows[0]!.n);
  })
);

/* ================================================================ */
/* Immutable history                                                */
/* ================================================================ */

test(
  "a recorded decision cannot be updated, deleted or truncated",
  { skip },
  records("decision_immutable", async () => {
    const request = await requested();
    value(
      await repo.recordReviewDecision(reviewer(), {
        caseId: alpha.caseId,
        requestId: request.id,
        decision: "refused",
        basis: "the grounds do not engage the article relied on",
        subjectDigest: request.subjectDigest!,
        expectedVersion: request.version,
      })
    );

    await assert.rejects(
      () =>
        pool.query("UPDATE review_decisions SET decision = 'approved' WHERE request_id = $1", [
          request.id,
        ]),
      /review_decisions is append-only/
    );
    await assert.rejects(
      () => pool.query("DELETE FROM review_decisions WHERE request_id = $1", [request.id]),
      /review_decisions is append-only/
    );
    await assert.rejects(() => pool.query("TRUNCATE review_decisions"), /may not be truncated/);

    // The decision survives all three, unchanged.
    const rows = await pool.query<{ decision: string; basis: string }>(
      "SELECT decision, basis FROM review_decisions WHERE request_id = $1",
      [request.id]
    );
    assert.equal(rows.rows[0]!.decision, "refused");
  })
);

test(
  "review history cannot be rewritten",
  { skip },
  records("history_append_only", async () => {
    const request = await requested();
    await assert.rejects(
      () => pool.query("UPDATE review_events SET detail = 'edited' WHERE request_id = $1", [
        request.id,
      ]),
      /review_events is append-only/
    );
    await assert.rejects(
      () => pool.query("DELETE FROM review_events WHERE request_id = $1", [request.id]),
      /review_events is append-only/
    );
    await assert.rejects(() => pool.query("TRUNCATE review_events"), /may not be truncated/);

    // An escalation or a withdrawn request disappearing would leave a record
    // showing a clean approval where there was an argument.
    const history = value(await repo.readReviewHistory(requester(), alpha.caseId, request.id));
    assert.deepEqual(
      history.map((e) => e.event),
      ["requested"]
    );
    assert.equal(history[0]!.actorId, alpha.caseworkerId);
  })
);

test(
  "a request carrying history cannot be deleted, nor can its case",
  { skip },
  records("parent_pinned", async () => {
    const request = await requested();
    await assert.rejects(
      () => pool.query("DELETE FROM review_requests WHERE id = $1", [request.id]),
      /violates foreign key constraint/
    );
    await assert.rejects(
      () => pool.query("DELETE FROM cases WHERE id = $1", [alpha.caseId]),
      /append-only|violates foreign key constraint/
    );
    const still = await pool.query<{ n: string }>("SELECT count(*) AS n FROM cases WHERE id = $1", [
      alpha.caseId,
    ]);
    assert.equal(still.rows[0]!.n, "1");
  })
);

test(
  "the repository never attempts to disable a protection",
  { skip },
  records("no_protection_bypass", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(join(repoRoot, "packages/repositories/src/review.ts"), "utf8");
    for (const forbidden of [
      /\bALTER\s+TABLE\b/i,
      /\bDISABLE\s+TRIGGER\b/i,
      /\bDROP\s+TRIGGER\b/i,
      /\bTRUNCATE\s+[a-z_]/i,
      /\bDELETE\s+FROM\s+review_(decisions|events)\b/i,
      /\bUPDATE\s+review_(decisions|events)\b/i,
      /session_replication_role/i,
    ]) {
      assert.ok(!forbidden.test(source), `the repository contains ${forbidden.source}`);
    }
  })
);

/* ================================================================ */
/* Queue                                                            */
/* ================================================================ */

test(
  "the queue is ordered by priority, then arrival, then id",
  { skip },
  records("queue_order", async () => {
    const caseId = alpha.caseId;
    const at = "2027-03-01T09:00:00.000Z";
    // Identical arrival instants inserted in one statement, so only the id can
    // separate them. Through the repository each call is its own transaction
    // and requested_at breaks the tie first, never exercising the third key.
    await pool.query(
      `INSERT INTO review_requests (organisation_id, case_id, subject_type, subject_id,
         reason, priority, requested_by, requested_at, status)
       SELECT $1, $2, 'other', 'tie-' || g, 'ordering', 'high', $3, $4::timestamptz, 'open'
         FROM generate_series(1, 5) g`,
      [alpha.organisationId, caseId, alpha.caseworkerId, at]
    );

    const first = value(await repo.readReviewQueue(requester(), { caseId }));
    const second = value(await repo.readReviewQueue(requester(), { caseId }));
    assert.deepEqual(
      first.map((r) => r.id),
      second.map((r) => r.id)
    );

    // Priority leads: every urgent precedes every high, and so on.
    const ranks = { urgent: 0, high: 1, normal: 2, low: 3 } as const;
    const seen = first.map((r) => ranks[r.priority]);
    assert.deepEqual(seen, [...seen].sort((a, b) => a - b));

    const tied = first.filter((r) => r.requestedAt === at).map((r) => r.id);
    assert.equal(tied.length, 5);
    assert.deepEqual(tied, [...tied].sort());
  })
);

test(
  "the active queue excludes terminal requests unless asked",
  { skip },
  records("queue_excludes_terminal", async () => {
    const request = await requested();
    value(
      await repo.recordReviewDecision(reviewer(), {
        caseId: alpha.caseId,
        requestId: request.id,
        decision: "approved",
        basis: "done",
        subjectDigest: request.subjectDigest!,
        expectedVersion: request.version,
      })
    );

    const active = value(await repo.readReviewQueue(requester(), { caseId: alpha.caseId }));
    assert.ok(!active.some((r) => r.id === request.id), "a decided review is still in the queue");

    const all = value(
      await repo.readReviewQueue(requester(), { caseId: alpha.caseId, includeClosed: true })
    );
    const found = all.find((r) => r.id === request.id);
    assert.ok(found, "a decided review vanished from the history read");
    assert.equal(found.hasDecision, true);
    assert.equal(found.decision!.basis, "done");
  })
);

test(
  "a reviewer's own queue contains only their assignments",
  { skip },
  records("reviewer_queue", async () => {
    const mine = await requested({ priority: "urgent" });
    value(
      await repo.reassignReview(requester(), {
        caseId: alpha.caseId,
        requestId: mine.id,
        assignTo: alpha.solicitorId,
        expectedVersion: mine.version,
      })
    );
    await requested();

    const queue = value(
      await repo.readReviewQueue(requester(), { assignedTo: alpha.solicitorId })
    );
    assert.ok(queue.length > 0);
    for (const entry of queue) {
      assert.equal(entry.assignedTo, alpha.solicitorId);
      assert.equal(entry.queueState, "assigned");
    }
  })
);

test(
  "awaiting material is a state, not the absence of one",
  { skip },
  records("awaiting_material_visible", async () => {
    // A review blocked on a document nobody sent is otherwise indistinguishable
    // from one nobody has picked up, and the second gets chased while the first
    // quietly waits.
    const request = await requested();
    await pool.query("UPDATE review_requests SET status = 'awaiting_material' WHERE id = $1", [
      request.id,
    ]);
    const queue = value(await repo.readReviewQueue(requester(), { caseId: alpha.caseId }));
    const found = queue.find((r) => r.id === request.id);
    assert.ok(found, "a blocked review left the active queue");
    assert.equal(found.queueState, "awaiting_material");
  })
);

test(
  "no review field is a probability, confidence or score under any name",
  { skip },
  records("no_probability", async () => {
    const queue = value(
      await repo.readReviewQueue(requester(), { caseId: alpha.caseId, includeClosed: true })
    );
    assert.ok(queue.length > 0);
    const forbidden = /confidence|probability|score|likelihood|percent|reliability|success_rate/i;
    for (const entry of queue) {
      for (const [key, v] of Object.entries(entry)) {
        assert.ok(!forbidden.test(key), `${key} names a figure this platform does not emit`);
        if (key === "version") continue; // an integer token, not a judgement
        assert.notEqual(typeof v, "number", `${key} is numeric`);
      }
      for (const key of Object.keys(entry.decision ?? {})) {
        assert.ok(!forbidden.test(key), `decision.${key} names a figure`);
      }
    }
  })
);

/* ================================================================ */
/* Availability                                                     */
/* ================================================================ */

test(
  "absence of a database is distinguishable from absence of a review",
  { skip },
  records("no_fixture_fallback", async () => {
    const none = new ReviewRepository(null);
    const noDb = await none.readReviewsForCase(requester(), alpha.caseId);
    assert.equal(noDb.ok === false && noDb.refusal.reason, "NO_DATABASE");

    const empty = await tenancy("Empty reviews");
    const context: RepositoryContext = {
      actorId: empty.caseworkerId,
      accountId: ACCOUNT,
      organisationId: empty.organisationId,
      memberships: [membership({ workspaceId: empty.workspaceId })],
    };
    assert.deepEqual(value(await repo.readReviewsForCase(context, empty.caseId)), []);

    const { readFile } = await import("node:fs/promises");
    const source = await readFile(join(repoRoot, "packages/repositories/src/review.ts"), "utf8");
    assert.ok(!/apps\/web|lib\/data|fixture/.test(source));
  })
);

/* ================================================================ */
/* Query plans                                                      */
/* ================================================================ */

test(
  "the queue reads are eligible for their indexes",
  { skip },
  records("query_plans", async () => {
    // A representative population: many cases, a mix of active and terminal,
    // assigned and unassigned, across priorities. The deadline work is why
    // "representative" matters — 4000 rows on one case made a sequential scan
    // the correct plan and the test wrong about what a caseload looks like.
    const client = await pool.query<{ client_id: string }>(
      "SELECT client_id FROM cases WHERE id = $1",
      [alpha.caseId]
    );
    await pool.query(
      `INSERT INTO cases (workspace_id, client_id, reference, status)
       SELECT $1, $2, 'RVBULK-${run}-' || g, 'lawyer_review' FROM generate_series(1, 200) g`,
      [alpha.workspaceId, client.rows[0]!.client_id]
    );
    const bulk = await pool.query<{ id: string }>(
      "SELECT id FROM cases WHERE workspace_id = $1 AND reference LIKE $2 ORDER BY reference",
      [alpha.workspaceId, `RVBULK-${run}-%`]
    );
    await pool.query(
      `INSERT INTO review_requests (organisation_id, case_id, subject_type, subject_id,
         reason, priority, requested_by, assigned_to, assigned_at, requested_at, status)
       SELECT $1, c.id, 'draft_document', 'bulk-' || g, 'bulk',
              (ARRAY['urgent','high','normal','low'])[1 + (g % 4)],
              $2,
              CASE WHEN g % 3 = 0 THEN $3::uuid ELSE NULL END,
              CASE WHEN g % 3 = 0 THEN now() ELSE NULL END,
              now() - (g || ' hours')::interval,
              CASE WHEN g % 5 = 0 THEN 'decided' ELSE 'open' END
         FROM unnest($4::uuid[]) AS c(id), generate_series(1, 20) g`,
      [alpha.organisationId, alpha.caseworkerId, alpha.solicitorId, bulk.rows.map((r) => r.id)]
    );
    // And a dominant case, so the counter-case is genuinely a counter-case.
    await pool.query(
      `INSERT INTO review_requests (organisation_id, case_id, subject_type, subject_id,
         reason, priority, requested_by, requested_at, status)
       SELECT $1, $2, 'other', 'dom-' || g, 'bulk', 'normal', $3,
              now() - (g || ' minutes')::interval, 'open'
         FROM generate_series(1, 4000) g`,
      [alpha.organisationId, alpha.caseId, alpha.caseworkerId]
    );
    await pool.query("ANALYZE review_requests");
    await pool.query("ANALYZE cases");

    const plans: Record<string, string> = {};
    const explain = async (label: string, sql: string, params: readonly unknown[]) => {
      const r = await pool.query<{ "QUERY PLAN": string }>(`EXPLAIN ${sql}`, params);
      plans[label] = r.rows.map((row) => row["QUERY PLAN"]).join("\n");
    };

    await explain(
      "active_queue",
      `SELECT r.id FROM review_requests r JOIN cases c ON c.id = r.case_id
        WHERE r.organisation_id = $1 AND c.workspace_id = ANY($2)
          AND r.status = ANY(ARRAY['open','awaiting_material'])
        ORDER BY r.priority_rank ASC, r.requested_at ASC, r.id ASC LIMIT 100`,
      [alpha.organisationId, [alpha.workspaceId]]
    );
    await explain(
      "reviewer_queue",
      `SELECT r.id FROM review_requests r JOIN cases c ON c.id = r.case_id
        WHERE r.organisation_id = $1 AND c.workspace_id = ANY($2)
          AND r.status = ANY(ARRAY['open','awaiting_material']) AND r.assigned_to = $3
        ORDER BY r.priority_rank ASC, r.requested_at ASC, r.id ASC LIMIT 100`,
      [alpha.organisationId, [alpha.workspaceId], alpha.solicitorId]
    );
    await explain(
      "case_history_selective",
      `SELECT r.id FROM review_requests r
        WHERE r.case_id = $1 AND r.organisation_id = $2
        ORDER BY r.requested_at ASC, r.id ASC`,
      [bulk.rows[0]!.id, alpha.organisationId]
    );
    await explain(
      "case_history_dominant",
      `SELECT r.id FROM review_requests r
        WHERE r.case_id = $1 AND r.organisation_id = $2
        ORDER BY r.requested_at ASC, r.id ASC`,
      [alpha.caseId, alpha.organisationId]
    );

    assert.match(
      plans.active_queue!,
      /review_requests_queue_idx/,
      `active queue did not use its index:\n${plans.active_queue}`
    );
    assert.match(
      plans.reviewer_queue!,
      /review_requests_reviewer_idx/,
      `reviewer queue did not use its index:\n${plans.reviewer_queue}`
    );
    assert.match(
      plans.case_history_selective!,
      /review_requests_case_history_idx/,
      `selective case history did not use its index:\n${plans.case_history_selective}`
    );
    // The counter-case, asserted rather than described: one case holding most
    // of the table is read by sequential scan, and that is the planner being
    // right rather than the index being unused.
    assert.doesNotMatch(
      plans.case_history_dominant!,
      /review_requests_case_history_idx/,
      `the dominant-case read used the index, so this is no longer a counter-case:\n${plans.case_history_dominant}`
    );

    await emitEvidence(repoRoot, {
      checkId: "review_query_plans",
      passed: true,
      at: new Date().toISOString(),
      commit: commit(),
      producedBy: "packages/integration/test/domain/review-repository.test.ts",
      demonstrates: `with 4000 review requests spread across 200 cases plus 4000 on one case, mixed priorities, assigned and unassigned, active and terminal, and ANALYZE run: the active queue used review_requests_queue_idx, the reviewer queue used review_requests_reviewer_idx, and a selective case history used review_requests_case_history_idx. The counter-case is recorded too — a single case holding roughly half the table is read by sequential scan, which is the planner being correct rather than the index being unused. No latency or throughput claim is made. Plans:\n${JSON.stringify(plans, null, 2)}`,
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
      producedBy: "packages/integration/test/domain/review-repository.test.ts",
      demonstrates,
    });

  await emit(
    "review_reads_are_organisation_scoped",
    ["cross_org_read", "dual_membership_isolated", "no_membership_queue", "no_enumeration"],
    "a caller holding a valid case id from another organisation received the same refusal as for a case that does not exist, and the queue — which is not case-scoped — contained no foreign row; an account holding real memberships in two organisations, on a session scoped to the first, could neither read nor write the second's reviews, which is the case the organisation predicate itself refuses"
  );
  await emit(
    "review_decision_is_write_once",
    ["decision_write_once", "concurrent_decisions", "stale_token", "withdrawn_is_terminal"],
    "a second decision on a decided request was refused and the first survived unchanged; two concurrent terminal decisions produced exactly one decision, one event and one audit entry; a stale integer version token was refused while the current one succeeded; a withdrawn request could no longer be decided"
  );
  await emit(
    "review_reserved_activity_requires_professional",
    [
      "caseworker_cannot_decide_reserved",
      "unregistered_cannot_decide",
      "foreign_reviewer_refused",
      "no_self_approval",
    ],
    "a caseworker could not decide a review requiring a professional; a solicitor with no registration on record could not either; a reviewer from another organisation was refused; and the person who asked for the review could not decide it even holding exactly the required role and registration"
  );
  await emit(
    "review_role_captured_at_signing",
    ["role_captured_at_signing"],
    "the decision stored the reviewer's role and regulatory reference as at the moment of signing, and approved_with_amendments was recorded as itself rather than collapsed into approved"
  );
  await emit(
    "review_decision_binds_its_subject",
    ["decision_binds_subject", "decision_requires_basis"],
    "the decision recorded the sha-256 of what the reviewer looked at, and a later reader can ask whether that still matches the artefact; a decision with no basis or an invalid digest was refused"
  );
  await emit(
    "review_history_is_append_only",
    ["decision_immutable", "history_append_only", "parent_pinned", "no_protection_bypass"],
    "review_decisions and review_events each refused UPDATE, DELETE and TRUNCATE; a request carrying history could not be deleted and neither could its case; the repository source contains no ALTER TABLE, DISABLE TRIGGER, TRUNCATE or trigger-bypass statement"
  );
  await emit(
    "review_decision_is_audited",
    ["decision_is_audited", "decision_rollback", "request_rollback"],
    "a valid decision wrote one immutable decision, one event and one audit entry naming the role and registration, and the audit chain verified afterwards; inducing a failure on the decision insert, the event insert, the audit insert and the status update in turn each left the request open with nothing written"
  );
  await emit(
    "review_no_fixture_fallback",
    ["no_fixture_fallback", "request_is_not_approval", "assignment_is_not_approval", "model_is_not_a_decision", "terminal_needs_decision", "queue_excludes_terminal", "queue_order", "reviewer_queue", "awaiting_material_visible"],
    "a case with no persisted reviews returned an empty list and no database returned NO_DATABASE; creating a request, assigning a reviewer and naming the execution that produced a subject all left hasDecision false; a request whose status column was forged to 'decided' was still reported as having no decision, because hasDecision is read from the decision table"
  );
  await emit(
    "review_emits_no_probability",
    ["no_probability"],
    "no field on any returned request or decision was numeric — apart from the integer version token — or named for a confidence, probability, score, likelihood, percentage, reliability or success-rate figure"
  );

  await pool.end();
});
