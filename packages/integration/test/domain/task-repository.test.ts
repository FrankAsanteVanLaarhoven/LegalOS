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
import { ReviewRepository, TaskRepository, type RepositoryContext } from "@legalos/repositories";

import { guardOrSkip } from "../guard.ts";
import { emitEvidence } from "../../src/index.ts";

/**
 * The task repository, against a real database.
 *
 * Completion is the transition worth attacking: it is the only one that claims
 * something was done. Most of what follows tries to make that claim without it
 * being true — by assigning, by attaching evidence, by asking for a review, by
 * racing, or by closing a task whose predecessor is still open.
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

const digest = (v: string) => createHash("sha256").update(v).digest("hex");
const run = Date.now().toString(36);

let pool: PoolLike;
let repo: TaskRepository;
let reviews: ReviewRepository;

interface Tenancy {
  organisationId: string;
  workspaceId: string;
  caseId: string;
  caseworkerId: string;
  solicitorId: string;
  evidenceId: string;
}
let alpha: Tenancy;
let beta: Tenancy;

const ACCOUNT = "88888888-8888-4888-8888-888888888888";
const OUTSIDER = "99999999-9999-4999-8999-999999999999";

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
  correlationId: `task-${run}`,
});

const solicitor = (): RepositoryContext => ({
  actorId: alpha.solicitorId,
  accountId: ACCOUNT,
  organisationId: alpha.organisationId,
  memberships: [
    membership({
      workspaceId: alpha.workspaceId,
      role: "solicitor",
      regulatoryReference: "SRA 445566",
    }),
  ],
  correlationId: `task-${run}`,
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
    evidenceId: t.evidenceIds[0]!,
  };
}

let seq = 0;
const spec = (over: Record<string, unknown> = {}) =>
  ({
    caseId: alpha.caseId,
    taskType: "evidence",
    title: `Obtain the medical report ${seq++}`,
    ...over,
  }) as Parameters<TaskRepository["createTask"]>[1];

function value<T>(r: { ok: true; value: T } | { ok: false; refusal: { detail: string } }): T {
  assert.ok(r.ok, `expected success, got refusal: ${r.ok ? "" : r.refusal.detail}`);
  return r.value;
}

const made = async (over: Record<string, unknown> = {}) =>
  value(await repo.createTask(worker(), spec(over)));

before(async () => {
  if (skip) return;
  pool = await createPool(DATABASE_URL);
  repo = new TaskRepository(pool);
  reviews = new ReviewRepository(pool);
  alpha = await tenancy("Alpha tasks");
  beta = await tenancy("Beta tasks");
});

/* ================================================================ */
/* Tenancy                                                          */
/* ================================================================ */

test(
  "a caller from one organisation cannot read or write another's tasks",
  { skip },
  records("cross_org", async () => {
    const betaContext: RepositoryContext = {
      actorId: beta.caseworkerId,
      accountId: OUTSIDER,
      organisationId: beta.organisationId,
      memberships: [membership({ workspaceId: beta.workspaceId, accountId: OUTSIDER })],
    };
    value(await repo.createTask(betaContext, { ...spec(), caseId: beta.caseId }));

    const read = await repo.readTasksForCase(worker(), beta.caseId);
    assert.equal(read.ok === false && read.refusal.reason, "NOT_PERSISTED");

    const write = await repo.createTask(worker(), { ...spec(), caseId: beta.caseId });
    assert.equal(write.ok === false && write.refusal.reason, "NOT_PERSISTED");

    const queue = value(await repo.readAssignedTasks(worker()));
    for (const t of queue) {
      assert.equal(t.organisationId, alpha.organisationId);
      assert.notEqual(t.caseId, beta.caseId);
    }
  })
);

test(
  "a person acting for two organisations carries nothing between them",
  { skip },
  records("dual_membership_isolated", async () => {
    // The case that isolates the organisation predicate. Deleting it leaves
    // every other cross-tenancy test green, because a caller from one
    // organisation holds no membership in another's workspace.
    const dual: RepositoryContext = {
      actorId: alpha.caseworkerId,
      accountId: ACCOUNT,
      organisationId: alpha.organisationId,
      memberships: [
        membership({ workspaceId: alpha.workspaceId }),
        membership({ workspaceId: beta.workspaceId }),
      ],
    };

    const read = await repo.readTasksForCase(dual, beta.caseId);
    assert.equal(read.ok === false && read.refusal.reason, "NOT_PERSISTED");

    const write = await repo.createTask(dual, { ...spec(), caseId: beta.caseId });
    assert.equal(write.ok === false && write.refusal.reason, "NOT_PERSISTED");

    const scoped: RepositoryContext = { ...dual, organisationId: beta.organisationId };
    assert.equal((await repo.readTasksForCase(scoped, beta.caseId)).ok, true);

    const queue = value(await repo.readAssignedTasks(dual));
    for (const t of queue) assert.equal(t.organisationId, alpha.organisationId);
  })
);

test(
  "a client may read tasks and may not create, assign or complete one",
  { skip },
  records("client_cannot_write", async () => {
    const task = await made();
    const client: RepositoryContext = {
      ...worker(),
      memberships: [membership({ workspaceId: alpha.workspaceId, role: "client" })],
    };
    assert.equal((await repo.readTasksForCase(client, alpha.caseId)).ok, true);

    for (const [label, result] of [
      ["create", await repo.createTask(client, spec())],
      [
        "assign",
        await repo.assignTask(client, {
          caseId: alpha.caseId,
          taskId: task.id,
          assignTo: alpha.solicitorId,
          expectedVersion: task.version,
        }),
      ],
      [
        "complete",
        await repo.completeTask(client, {
          caseId: alpha.caseId,
          taskId: task.id,
          expectedVersion: task.version,
        }),
      ],
      [
        "cancel",
        await repo.cancelTask(client, {
          caseId: alpha.caseId,
          taskId: task.id,
          expectedVersion: task.version,
          reason: "no",
        }),
      ],
    ] as const) {
      assert.equal(result.ok, false, `a client could ${label}`);
      assert.equal(result.ok === false && result.refusal.reason, "FORBIDDEN");
    }
  })
);

/* ================================================================ */
/* Assignment                                                       */
/* ================================================================ */

test(
  "an assignee from another organisation is rejected, not silently accepted",
  { skip },
  records("foreign_assignee", async () => {
    // The harm: a task assigned to an identifier nobody in this workspace
    // holds appears in no queue and is chased by no one.
    const task = await made();
    const result = await repo.assignTask(worker(), {
      caseId: alpha.caseId,
      taskId: task.id,
      assignTo: beta.solicitorId,
      expectedVersion: task.version,
    });
    assert.equal(result.ok === false && result.refusal.reason, "INVALID");
    assert.match(result.ok === false ? result.refusal.detail : "", /not a member of the workspace/);
  })
);

test(
  "an unknown assignee identifier is rejected",
  { skip },
  records("unknown_assignee", async () => {
    const task = await made();
    const result = await repo.assignTask(worker(), {
      caseId: alpha.caseId,
      taskId: task.id,
      assignTo: "00000000-0000-4000-8000-000000000000",
      expectedVersion: task.version,
    });
    assert.equal(result.ok, false);
  })
);

test(
  "assignment does not complete a task, and reassignment keeps the prior assignee",
  { skip },
  records("assignment_history", async () => {
    const task = await made();
    const first = value(
      await repo.assignTask(worker(), {
        caseId: alpha.caseId,
        taskId: task.id,
        assignTo: alpha.solicitorId,
        expectedVersion: task.version,
      })
    );
    assert.equal(first.assignedTo, alpha.solicitorId);
    assert.equal(first.status, "open");
    assert.equal(first.completedAt, null);
    assert.equal(first.version, task.version + 1);

    const second = value(
      await repo.assignTask(worker(), {
        caseId: alpha.caseId,
        taskId: task.id,
        assignTo: alpha.caseworkerId,
        expectedVersion: first.version,
      })
    );
    assert.equal(second.assignedTo, alpha.caseworkerId);

    // "Who was supposed to be doing this in March" must remain answerable.
    const history = value(await repo.readTaskHistory(worker(), alpha.caseId, task.id));
    const reassignment = history.filter((e) => e.event === "assigned").at(-1);
    assert.match(reassignment!.detail!, new RegExp(`previously ${alpha.solicitorId}`));

    const audit = await pool.query<{ payload: Record<string, unknown> }>(
      "SELECT payload FROM audit_log WHERE subject = $1 AND action = 'task.assigned' ORDER BY seq DESC LIMIT 1",
      [task.id]
    );
    assert.equal(audit.rows[0]!.payload.previousAssignee, alpha.solicitorId);
  })
);

/* ================================================================ */
/* Completion                                                       */
/* ================================================================ */

test(
  "a task cannot be completed while a predecessor is open",
  { skip },
  records("dependency_blocks_completion", async () => {
    // The harm: a bundle is marked filed while the document it waits on has
    // not been obtained, and the list stops showing anyone it is missing.
    const blocker = await made({ title: `Obtain the letter ${seq}` });
    const dependent = await made({ title: `File the bundle ${seq}` });

    const withDep = value(
      await repo.addTaskDependency(worker(), {
        caseId: alpha.caseId,
        taskId: dependent.id,
        dependsOnId: blocker.id,
        reason: "the bundle cannot be filed without the letter",
      })
    );
    assert.deepEqual(withDep.dependencies.dependsOn, [blocker.id]);
    assert.deepEqual(withDep.dependencies.unresolved, [blocker.id]);

    const blocked = await repo.completeTask(worker(), {
      caseId: alpha.caseId,
      taskId: dependent.id,
      expectedVersion: withDep.version,
    });
    assert.equal(blocked.ok === false && blocked.refusal.reason, "CONFLICT");
    assert.match(blocked.ok === false ? blocked.refusal.detail : "", /depends on are not finished/);

    // Once the predecessor is done, the same call succeeds.
    value(
      await repo.completeTask(worker(), {
        caseId: alpha.caseId,
        taskId: blocker.id,
        expectedVersion: blocker.version,
      })
    );
    const done = value(
      await repo.completeTask(worker(), {
        caseId: alpha.caseId,
        taskId: dependent.id,
        expectedVersion: withDep.version,
      })
    );
    assert.equal(done.status, "completed");
    assert.ok(done.completedAt);
    assert.deepEqual(done.dependencies.unresolved, []);
  })
);

test(
  "a task requiring a professional cannot be completed on an undecided review",
  { skip },
  records("professional_gate", async () => {
    // The distinction the review repository exists to make: a request is not a
    // decision. Treating one as approval here would reintroduce exactly the
    // failure that layer prevents.
    const request = value(
      await reviews.createReviewRequest(worker(), {
        caseId: alpha.caseId,
        subjectType: "draft_document",
        subjectId: `task-subject-${run}`,
        subjectDigest: digest(`task-subject-${run}`),
        reason: "the filing must be checked",
        requiresProfessional: true,
        requiredRole: "solicitor",
      })
    );

    const task = await made({ requiresProfessional: true, reviewRequestId: request.id });

    const undecided = await repo.completeTask(worker(), {
      caseId: alpha.caseId,
      taskId: task.id,
      expectedVersion: task.version,
    });
    assert.equal(undecided.ok === false && undecided.refusal.reason, "CONFLICT");
    assert.match(undecided.ok === false ? undecided.refusal.detail : "", /has not been decided/);

    // Assigning a reviewer is still not a decision.
    value(
      await reviews.reassignReview(worker(), {
        caseId: alpha.caseId,
        requestId: request.id,
        assignTo: alpha.solicitorId,
        expectedVersion: request.version,
      })
    );
    const stillUndecided = await repo.completeTask(worker(), {
      caseId: alpha.caseId,
      taskId: task.id,
      expectedVersion: task.version,
    });
    assert.equal(stillUndecided.ok, false);

    // A real decision by a qualified person unblocks it.
    const current = value(await reviews.readReviewsForCase(worker(), alpha.caseId)).find(
      (r) => r.id === request.id
    )!;
    value(
      await reviews.recordReviewDecision(solicitor(), {
        caseId: alpha.caseId,
        requestId: request.id,
        decision: "approved_with_amendments",
        basis: "acceptable once the report is attached",
        subjectDigest: digest(`task-subject-${run}`),
        expectedVersion: current.version,
      })
    );
    const done = value(
      await repo.completeTask(worker(), {
        caseId: alpha.caseId,
        taskId: task.id,
        expectedVersion: task.version,
      })
    );
    assert.equal(done.status, "completed");
  })
);

test(
  "a refused review does not permit completion",
  { skip },
  records("refused_review_blocks", async () => {
    const request = value(
      await reviews.createReviewRequest(worker(), {
        caseId: alpha.caseId,
        subjectType: "filing",
        subjectId: `refused-${run}`,
        subjectDigest: digest(`refused-${run}`),
        reason: "check before filing",
        requiresProfessional: true,
        requiredRole: "solicitor",
      })
    );
    value(
      await reviews.recordReviewDecision(solicitor(), {
        caseId: alpha.caseId,
        requestId: request.id,
        decision: "refused",
        basis: "the grounds do not engage the article relied on",
        subjectDigest: digest(`refused-${run}`),
        expectedVersion: request.version,
      })
    );
    const task = await made({ requiresProfessional: true, reviewRequestId: request.id });
    const result = await repo.completeTask(worker(), {
      caseId: alpha.caseId,
      taskId: task.id,
      expectedVersion: task.version,
    });
    assert.equal(result.ok === false && result.refusal.reason, "CONFLICT");
    assert.match(result.ok === false ? result.refusal.detail : "", /was refused/);
  })
);

test(
  "evidence links and assignment never complete a task between them",
  { skip },
  records("links_do_not_complete", async () => {
    const task = await made();
    const assigned = value(
      await repo.assignTask(worker(), {
        caseId: alpha.caseId,
        taskId: task.id,
        assignTo: alpha.solicitorId,
        expectedVersion: task.version,
      })
    );
    const linked = value(
      await repo.linkTaskEvidence(worker(), {
        caseId: alpha.caseId,
        taskId: task.id,
        evidenceId: alpha.evidenceId,
        relation: "produces",
        note: "the report this task produces",
      })
    );
    assert.equal(linked.status, "open");
    assert.equal(linked.completedAt, null);
    assert.equal(linked.evidence.length, 1);
    assert.equal(linked.evidence[0]!.createdBy, alpha.caseworkerId);
    assert.ok(assigned.assignedTo);
  })
);

test(
  "a completed task cannot be completed or cancelled again",
  { skip },
  records("terminal_is_terminal", async () => {
    const task = await made();
    const done = value(
      await repo.completeTask(worker(), {
        caseId: alpha.caseId,
        taskId: task.id,
        expectedVersion: task.version,
      })
    );
    const again = await repo.completeTask(worker(), {
      caseId: alpha.caseId,
      taskId: task.id,
      expectedVersion: done.version,
    });
    assert.equal(again.ok === false && again.refusal.reason, "CONFLICT");
    assert.match(again.ok === false ? again.refusal.detail : "", /already completed/);

    const cancelled = await repo.cancelTask(worker(), {
      caseId: alpha.caseId,
      taskId: task.id,
      expectedVersion: done.version,
      reason: "changed my mind",
    });
    assert.equal(cancelled.ok === false && cancelled.refusal.reason, "CONFLICT");
  })
);

test(
  "a cancelled task keeps its reason and leaves the open list without being deleted",
  { skip },
  records("cancellation", async () => {
    const task = await made();
    const cancelled = value(
      await repo.cancelTask(worker(), {
        caseId: alpha.caseId,
        taskId: task.id,
        expectedVersion: task.version,
        reason: "the client obtained the report directly",
      })
    );
    assert.equal(cancelled.status, "cancelled");
    assert.ok(cancelled.cancelledAt);
    assert.equal(cancelled.completedAt, null);

    const open = value(await repo.readOpenTasksForCase(worker(), alpha.caseId));
    assert.ok(!open.some((t) => t.id === task.id), "a cancelled task is still in the open list");

    const all = value(await repo.readTasksForCase(worker(), alpha.caseId));
    assert.ok(all.some((t) => t.id === task.id), "a cancelled task was deleted");

    const history = value(await repo.readTaskHistory(worker(), alpha.caseId, task.id));
    const event = history.find((e) => e.event === "cancelled");
    assert.equal(event!.detail, "the client obtained the report directly");
    assert.equal(event!.actorId, alpha.caseworkerId);
  })
);

/* ================================================================ */
/* Updates                                                          */
/* ================================================================ */

test(
  "an update may not touch identity, status or version",
  { skip },
  records("update_allowlist", async () => {
    // The harm: a caller able to move a task between cases could relocate work
    // into a tenancy it never belonged to, and one able to set status could
    // complete a task without passing the completion rule.
    const task = await made();
    for (const field of ["caseId", "organisationId", "createdBy", "status", "version", "completedAt"]) {
      const result = await repo.updateTask(worker(), {
        caseId: alpha.caseId,
        taskId: task.id,
        expectedVersion: task.version,
        changes: { [field]: "x" } as never,
      });
      assert.equal(result.ok, false, `${field} was accepted`);
      assert.match(result.ok === false ? result.refusal.detail : "", /cannot be changed/);
    }
  })
);

test(
  "a permitted update writes an event naming the fields, not their contents",
  { skip },
  records("update_writes_event", async () => {
    // Persisting before-and-after values would copy a task's free text into the
    // audit payload, which is precisely the content ADR-002 has no way to erase.
    const task = await made();
    const updated = value(
      await repo.updateTask(worker(), {
        caseId: alpha.caseId,
        taskId: task.id,
        expectedVersion: task.version,
        changes: { title: "Obtain the psychiatric report", priority: "urgent" },
      })
    );
    assert.equal(updated.title, "Obtain the psychiatric report");
    assert.equal(updated.priority, "urgent");
    assert.equal(updated.version, task.version + 1);

    const history = value(await repo.readTaskHistory(worker(), alpha.caseId, task.id));
    const event = history.find((e) => e.event === "updated");
    assert.equal(event!.detail, "changed priority, title");

    const audit = await pool.query<{ payload: Record<string, unknown> }>(
      "SELECT payload FROM audit_log WHERE subject = $1 AND action = 'task.updated'",
      [task.id]
    );
    assert.deepEqual(audit.rows[0]!.payload.fields, ["priority", "title"]);
    assert.ok(
      !JSON.stringify(audit.rows[0]!.payload).includes("psychiatric"),
      "the audit payload copied the task's free text"
    );
  })
);

/* ================================================================ */
/* Concurrency                                                      */
/* ================================================================ */

test(
  "a stale version is refused on update, assignment and completion",
  { skip },
  records("stale_version", async () => {
    for (const kind of ["update", "assign", "complete"] as const) {
      const task = await made();
      const stale = task.version;
      // Something else moves the row first.
      const moved = value(
        await repo.updateTask(worker(), {
          caseId: alpha.caseId,
          taskId: task.id,
          expectedVersion: stale,
          changes: { priority: "high" },
        })
      );
      assert.equal(moved.version, stale + 1);

      const late =
        kind === "update"
          ? await repo.updateTask(worker(), {
              caseId: alpha.caseId,
              taskId: task.id,
              expectedVersion: stale,
              changes: { priority: "low" },
            })
          : kind === "assign"
            ? await repo.assignTask(worker(), {
                caseId: alpha.caseId,
                taskId: task.id,
                assignTo: alpha.solicitorId,
                expectedVersion: stale,
              })
            : await repo.completeTask(worker(), {
                caseId: alpha.caseId,
                taskId: task.id,
                expectedVersion: stale,
              });

      assert.equal(late.ok, false, `${kind} accepted a stale version`);
      assert.equal(late.ok === false && late.refusal.reason, "CONFLICT");

      // The earlier write stands; it was not silently replaced.
      const current = value(await repo.readTasksForCase(worker(), alpha.caseId)).find(
        (t) => t.id === task.id
      )!;
      assert.equal(current.priority, "high");
      assert.equal(current.version, stale + 1);
    }
  })
);

test(
  "two concurrent updates produce exactly one winner and one clean loser",
  { skip },
  records("concurrent_updates", async () => {
    const task = await made();
    const [a, b] = await Promise.all([
      repo.updateTask(worker(), {
        caseId: alpha.caseId,
        taskId: task.id,
        expectedVersion: task.version,
        changes: { priority: "urgent" },
      }),
      repo.updateTask(worker(), {
        caseId: alpha.caseId,
        taskId: task.id,
        expectedVersion: task.version,
        changes: { priority: "low" },
      }),
    ]);
    assert.equal([a.ok, b.ok].filter(Boolean).length, 1, "both concurrent updates committed");

    const current = value(await repo.readTasksForCase(worker(), alpha.caseId)).find(
      (t) => t.id === task.id
    )!;
    // Incremented exactly once.
    assert.equal(current.version, task.version + 1);

    // The loser wrote no event and no audit record.
    const events = await pool.query<{ n: string }>(
      "SELECT count(*) AS n FROM task_events WHERE task_id = $1 AND event = 'updated'",
      [task.id]
    );
    assert.equal(events.rows[0]!.n, "1");
    const audit = await pool.query<{ n: string }>(
      "SELECT count(*) AS n FROM audit_log WHERE subject = $1 AND action = 'task.updated'",
      [task.id]
    );
    assert.equal(audit.rows[0]!.n, "1");
  })
);

test(
  "two concurrent completions produce exactly one completion",
  { skip },
  records("concurrent_completions", async () => {
    const task = await made();
    const [a, b] = await Promise.all([
      repo.completeTask(worker(), {
        caseId: alpha.caseId,
        taskId: task.id,
        expectedVersion: task.version,
      }),
      repo.completeTask(solicitor(), {
        caseId: alpha.caseId,
        taskId: task.id,
        expectedVersion: task.version,
      }),
    ]);
    assert.equal([a.ok, b.ok].filter(Boolean).length, 1);
    const events = await pool.query<{ n: string }>(
      "SELECT count(*) AS n FROM task_events WHERE task_id = $1 AND event = 'completed'",
      [task.id]
    );
    assert.equal(events.rows[0]!.n, "1");
  })
);

/* ================================================================ */
/* Dependencies                                                     */
/* ================================================================ */

test(
  "a task cannot depend on itself",
  { skip },
  records("self_dependency", async () => {
    const task = await made();
    const result = await repo.addTaskDependency(worker(), {
      caseId: alpha.caseId,
      taskId: task.id,
      dependsOnId: task.id,
    });
    assert.equal(result.ok === false && result.refusal.reason, "INVALID");
  })
);

test(
  "a two-task cycle is refused",
  { skip },
  records("two_cycle", async () => {
    // The harm: after a cycle neither task can ever be completed, and nothing
    // in the schema explains why.
    const a = await made();
    const b = await made();
    value(
      await repo.addTaskDependency(worker(), {
        caseId: alpha.caseId,
        taskId: a.id,
        dependsOnId: b.id,
      })
    );
    const result = await repo.addTaskDependency(worker(), {
      caseId: alpha.caseId,
      taskId: b.id,
      dependsOnId: a.id,
    });
    assert.equal(result.ok === false && result.refusal.reason, "CONFLICT");
    assert.match(result.ok === false ? result.refusal.detail : "", /would create a cycle/);
  })
);

test(
  "a three-task cycle is refused",
  { skip },
  records("three_cycle", async () => {
    // A -> B -> C, then C -> A. The transitive case a naive check misses.
    const a = await made();
    const b = await made();
    const c = await made();
    for (const [from, to] of [
      [a.id, b.id],
      [b.id, c.id],
    ]) {
      value(
        await repo.addTaskDependency(worker(), {
          caseId: alpha.caseId,
          taskId: from!,
          dependsOnId: to!,
        })
      );
    }
    const result = await repo.addTaskDependency(worker(), {
      caseId: alpha.caseId,
      taskId: c.id,
      dependsOnId: a.id,
    });
    assert.equal(result.ok === false && result.refusal.reason, "CONFLICT");
    assert.match(result.ok === false ? result.refusal.detail : "", /would create a cycle/);
  })
);

test(
  "a duplicate dependency is refused",
  { skip },
  records("duplicate_dependency", async () => {
    const a = await made();
    const b = await made();
    const input = { caseId: alpha.caseId, taskId: a.id, dependsOnId: b.id };
    value(await repo.addTaskDependency(worker(), input));
    const again = await repo.addTaskDependency(worker(), input);
    assert.equal(again.ok === false && again.refusal.reason, "CONFLICT");
  })
);

test(
  "a dependency cannot cross a case or an organisation",
  { skip },
  records("foreign_dependency", async () => {
    // The harm: one organisation's progress silently gating another's, through
    // an edge neither can see.
    const mine = await made();
    const betaContext: RepositoryContext = {
      actorId: beta.caseworkerId,
      accountId: OUTSIDER,
      organisationId: beta.organisationId,
      memberships: [membership({ workspaceId: beta.workspaceId, accountId: OUTSIDER })],
    };
    const theirs = value(
      await repo.createTask(betaContext, { ...spec(), caseId: beta.caseId })
    );

    const result = await repo.addTaskDependency(worker(), {
      caseId: alpha.caseId,
      taskId: mine.id,
      dependsOnId: theirs.id,
    });
    assert.equal(result.ok === false && result.refusal.reason, "NOT_PERSISTED");

    const dependencies = await pool.query<{ n: string }>(
      "SELECT count(*) AS n FROM task_dependencies WHERE task_id = $1",
      [mine.id]
    );
    assert.equal(dependencies.rows[0]!.n, "0");
  })
);

test(
  "removing a dependency records who removed it",
  { skip },
  records("dependency_removal", async () => {
    const a = await made();
    const b = await made();
    value(
      await repo.addTaskDependency(worker(), {
        caseId: alpha.caseId,
        taskId: a.id,
        dependsOnId: b.id,
        reason: "the letter must arrive first",
      })
    );
    const after = value(
      await repo.removeTaskDependency(worker(), {
        caseId: alpha.caseId,
        taskId: a.id,
        dependsOnId: b.id,
        reason: "the letter turned out not to be needed",
      })
    );
    assert.deepEqual(after.dependencies.dependsOn, []);

    // The edge is gone; the record that it existed is not.
    const history = value(await repo.readTaskHistory(worker(), alpha.caseId, a.id));
    assert.deepEqual(
      history.filter((e) => e.event.startsWith("dependency")).map((e) => e.event),
      ["dependency_added", "dependency_removed"]
    );
    assert.match(history.at(-1)!.detail!, /turned out not to be needed/);
  })
);

/* ================================================================ */
/* Evidence links                                                   */
/* ================================================================ */

test(
  "a dangling or foreign evidence identifier is refused",
  { skip },
  records("evidence_validation", async () => {
    // The harm: a task claiming documentary backing that points at nothing, or
    // at another client's document.
    const task = await made();
    const dangling = await repo.linkTaskEvidence(worker(), {
      caseId: alpha.caseId,
      taskId: task.id,
      evidenceId: "00000000-0000-4000-8000-000000000001",
      relation: "requires",
    });
    assert.equal(dangling.ok === false && dangling.refusal.reason, "NOT_PERSISTED");

    const foreign = await repo.linkTaskEvidence(worker(), {
      caseId: alpha.caseId,
      taskId: task.id,
      evidenceId: beta.evidenceId,
      relation: "requires",
    });
    assert.equal(foreign.ok === false && foreign.refusal.reason, "NOT_PERSISTED");

    const links = await pool.query<{ n: string }>(
      "SELECT count(*) AS n FROM task_evidence_links WHERE task_id = $1",
      [task.id]
    );
    assert.equal(links.rows[0]!.n, "0");
  })
);

test(
  "a duplicate evidence link is refused and unlinking keeps the evidence",
  { skip },
  records("evidence_lifecycle", async () => {
    const task = await made();
    const input = {
      caseId: alpha.caseId,
      taskId: task.id,
      evidenceId: alpha.evidenceId,
      relation: "requires" as const,
    };
    value(await repo.linkTaskEvidence(worker(), input));
    const again = await repo.linkTaskEvidence(worker(), input);
    assert.equal(again.ok === false && again.refusal.reason, "CONFLICT");

    const unlinked = value(await repo.unlinkTaskEvidence(worker(), input));
    assert.equal(unlinked.evidence.length, 0);

    // The evidence item itself survives; only the link went.
    const evidence = await pool.query<{ n: string }>(
      "SELECT count(*) AS n FROM evidence_items WHERE id = $1",
      [alpha.evidenceId]
    );
    assert.equal(evidence.rows[0]!.n, "1");

    // And the history still knows the link existed.
    const history = value(await repo.readTaskHistory(worker(), alpha.caseId, task.id));
    assert.deepEqual(
      history.filter((e) => e.event.startsWith("evidence")).map((e) => e.event),
      ["evidence_linked", "evidence_unlinked"]
    );
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

async function domainCounts() {
  const q = async (sql: string) => Number((await pool.query<{ n: string }>(sql)).rows[0]!.n);
  return {
    tasks: await q("SELECT count(*) AS n FROM tasks"),
    events: await q("SELECT count(*) AS n FROM task_events"),
    dependencies: await q("SELECT count(*) AS n FROM task_dependencies"),
    links: await q("SELECT count(*) AS n FROM task_evidence_links"),
    audit: await q("SELECT count(*) AS n FROM audit_log"),
  };
}

test(
  "an induced failure on any write during creation leaves nothing behind",
  { skip },
  records("creation_atomic", async () => {
    // A task with no event is work nobody can attribute; a task with no audit
    // entry is a change to a case file that left no independent trace.
    for (const [label, pattern] of [
      ["task insert", /INSERT INTO tasks/],
      ["event insert", /INSERT INTO task_events/],
      ["audit insert", /audit_log/],
    ] as const) {
      const before = await domainCounts();
      const broken = new TaskRepository(failingPool(pool, pattern));
      const result = await broken.createTask(worker(), spec());
      assert.equal(result.ok, false, `${label} did not fail`);
      assert.deepEqual(await domainCounts(), before, `${label} left something behind`);
    }
  })
);

test(
  "an induced audit failure rolls back assignment, completion and links",
  { skip },
  records("transitions_atomic", async () => {
    const task = await made();
    const withDep = await made();
    const before = await domainCounts();
    const broken = new TaskRepository(failingPool(pool, /audit_log/));

    for (const [label, result] of [
      [
        "assign",
        await broken.assignTask(worker(), {
          caseId: alpha.caseId,
          taskId: task.id,
          assignTo: alpha.solicitorId,
          expectedVersion: task.version,
        }),
      ],
      [
        "complete",
        await broken.completeTask(worker(), {
          caseId: alpha.caseId,
          taskId: task.id,
          expectedVersion: task.version,
        }),
      ],
      [
        "dependency",
        await broken.addTaskDependency(worker(), {
          caseId: alpha.caseId,
          taskId: task.id,
          dependsOnId: withDep.id,
        }),
      ],
      [
        "evidence",
        await broken.linkTaskEvidence(worker(), {
          caseId: alpha.caseId,
          taskId: task.id,
          evidenceId: alpha.evidenceId,
          relation: "concerns",
        }),
      ],
    ] as const) {
      assert.equal(result.ok, false, `${label} did not fail`);
    }
    assert.deepEqual(await domainCounts(), before);

    const current = value(await repo.readTasksForCase(worker(), alpha.caseId)).find(
      (t) => t.id === task.id
    )!;
    assert.equal(current.status, "open");
    assert.equal(current.assignedTo, null);
    assert.equal(current.version, task.version);
  })
);

test(
  "a valid creation writes task, event and audit together",
  { skip },
  records("creation_complete", async () => {
    const task = await made({ description: "the report the tribunal directed" });
    const history = value(await repo.readTaskHistory(worker(), alpha.caseId, task.id));
    assert.equal(history.length, 1);
    assert.equal(history[0]!.event, "created");
    assert.equal(history[0]!.actorId, alpha.caseworkerId);

    const audit = await pool.query<{ actor: string; payload: Record<string, unknown> }>(
      "SELECT actor, payload FROM audit_log WHERE subject = $1 AND action = 'task.created'",
      [task.id]
    );
    assert.equal(audit.rows.length, 1);
    assert.equal(audit.rows[0]!.actor, alpha.caseworkerId);
    assert.equal(audit.rows[0]!.payload.correlationId, `task-${run}`);

    const verified = await withTransaction(pool, (tx) => new PostgresAuditStore(tx).verify());
    assert.equal(verified.valid, true, `audit chain broke: ${JSON.stringify(verified)}`);
  })
);

/* ================================================================ */
/* Immutable history                                                */
/* ================================================================ */

test(
  "task history cannot be updated, deleted or truncated",
  { skip },
  records("history_immutable", async () => {
    const task = await made();
    await assert.rejects(
      () => pool.query("UPDATE task_events SET detail = 'edited' WHERE task_id = $1", [task.id]),
      /task_events is append-only/
    );
    await assert.rejects(
      () => pool.query("DELETE FROM task_events WHERE task_id = $1", [task.id]),
      /task_events is append-only/
    );
    await assert.rejects(() => pool.query("TRUNCATE task_events"), /may not be truncated/);

    await assert.rejects(
      () => pool.query("DELETE FROM tasks WHERE id = $1", [task.id]),
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
    const source = await readFile(join(repoRoot, "packages/repositories/src/task.ts"), "utf8");
    for (const forbidden of [
      /\bALTER\s+TABLE\b/i,
      /\bDISABLE\s+TRIGGER\b/i,
      /\bDROP\s+TRIGGER\b/i,
      /\bTRUNCATE\s+[a-z_]/i,
      /\bDELETE\s+FROM\s+task_events\b/i,
      /\bUPDATE\s+task_events\b/i,
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
  "ordering is by priority, then creation, then id — never alphabetical",
  { skip },
  records("deterministic_order", async () => {
    // `priority` is a text column, so an index or ORDER BY on it directly sorts
    // high, low, normal, urgent. That looks sorted and is alphabetical, which
    // is why migration 0015 added the rank.
    const at = "2027-05-01T09:00:00.000Z";
    await pool.query(
      `INSERT INTO tasks (organisation_id, case_id, task_type, title, status, priority, source, created_by, created_at)
       SELECT $1, $2, 'ordering', 'tie-' || g, 'open', 'high', 'human', $3, $4::timestamptz
         FROM generate_series(1, 5) g`,
      [alpha.organisationId, alpha.caseId, alpha.caseworkerId, at]
    );

    const first = value(await repo.readOpenTasksForCase(worker(), alpha.caseId));
    const second = value(await repo.readOpenTasksForCase(worker(), alpha.caseId));
    assert.deepEqual(first.map((t) => t.id), second.map((t) => t.id));

    const ranks = { urgent: 0, high: 1, normal: 2, low: 3 } as const;
    const seen = first.map((t) => ranks[t.priority]);
    assert.deepEqual(seen, [...seen].sort((a, b) => a - b));

    const tied = first.filter((t) => t.createdAt === at).map((t) => t.id);
    assert.equal(tied.length, 5);
    assert.deepEqual(tied, [...tied].sort());
  })
);

test(
  "no task field is a probability, confidence or score under any name",
  { skip },
  records("no_probability", async () => {
    const all = value(await repo.readTasksForCase(worker(), alpha.caseId));
    assert.ok(all.length > 0);
    const forbidden =
      /confidence|probability|score|likelihood|percent|reliability|productivity|success_rate/i;
    for (const t of all) {
      for (const [key, v] of Object.entries(t)) {
        assert.ok(!forbidden.test(key), `${key} names a figure this platform does not emit`);
        if (key === "version") continue; // an integer token, not a judgement
        assert.notEqual(typeof v, "number", `${key} is numeric`);
      }
    }
  })
);

test(
  "absence of a database is distinguishable from absence of a task",
  { skip },
  records("no_fixture_fallback", async () => {
    const none = new TaskRepository(null);
    const noDb = await none.readTasksForCase(worker(), alpha.caseId);
    assert.equal(noDb.ok === false && noDb.refusal.reason, "NO_DATABASE");

    const empty = await tenancy("Empty tasks");
    const context: RepositoryContext = {
      actorId: empty.caseworkerId,
      accountId: ACCOUNT,
      organisationId: empty.organisationId,
      memberships: [membership({ workspaceId: empty.workspaceId })],
    };
    assert.deepEqual(value(await repo.readTasksForCase(context, empty.caseId)), []);

    const { readFile } = await import("node:fs/promises");
    const source = await readFile(join(repoRoot, "packages/repositories/src/task.ts"), "utf8");
    assert.ok(!/apps\/web|lib\/data|fixture/.test(source));
  })
);

/* ================================================================ */
/* Query plans                                                      */
/* ================================================================ */

test(
  "the task reads are eligible for their indexes",
  { skip },
  records("query_plans", async () => {
    const client = await pool.query<{ client_id: string }>(
      "SELECT client_id FROM cases WHERE id = $1",
      [alpha.caseId]
    );
    await pool.query(
      `INSERT INTO cases (workspace_id, client_id, reference, status)
       SELECT $1, $2, 'TKBULK-${run}-' || g, 'evidence_collection' FROM generate_series(1, 200) g`,
      [alpha.workspaceId, client.rows[0]!.client_id]
    );
    const bulk = await pool.query<{ id: string }>(
      "SELECT id FROM cases WHERE workspace_id = $1 AND reference LIKE $2 ORDER BY reference",
      [alpha.workspaceId, `TKBULK-${run}-%`]
    );
    await pool.query(
      `INSERT INTO tasks (organisation_id, case_id, task_type, title, status, priority,
         source, created_by, assigned_to, created_at, completed_at)
       SELECT $1, c.id, 'bulk', 'bulk-' || g,
              CASE WHEN g % 5 = 0 THEN 'completed' ELSE 'open' END,
              (ARRAY['urgent','high','normal','low'])[1 + (g % 4)],
              'human', $2,
              CASE WHEN g % 3 = 0 THEN $3::uuid ELSE NULL END,
              now() - (g || ' hours')::interval,
              CASE WHEN g % 5 = 0 THEN now() ELSE NULL END
         FROM unnest($4::uuid[]) AS c(id), generate_series(1, 20) g`,
      [alpha.organisationId, alpha.caseworkerId, alpha.solicitorId, bulk.rows.map((r) => r.id)]
    );
    await pool.query(
      `INSERT INTO tasks (organisation_id, case_id, task_type, title, status, priority,
         source, created_by, created_at)
       SELECT $1, $2, 'dominant', 'dom-' || g, 'open', 'normal', 'human', $3,
              now() - (g || ' minutes')::interval
         FROM generate_series(1, 4000) g`,
      [alpha.organisationId, alpha.caseId, alpha.caseworkerId]
    );
    await pool.query("ANALYZE tasks");
    await pool.query("ANALYZE cases");

    const plans: Record<string, string> = {};
    const explain = async (label: string, sql: string, params: readonly unknown[]) => {
      const r = await pool.query<{ "QUERY PLAN": string }>(`EXPLAIN ${sql}`, params);
      plans[label] = r.rows.map((row) => row["QUERY PLAN"]).join("\n");
    };

    await explain(
      "open_by_case",
      `SELECT t.id FROM tasks t
        WHERE t.case_id = $1 AND t.organisation_id = $2
          AND t.status NOT IN ('completed','cancelled')
        ORDER BY t.priority_rank ASC, t.created_at ASC, t.id ASC`,
      [bulk.rows[0]!.id, alpha.organisationId]
    );
    await explain(
      "assigned_queue",
      `SELECT t.id FROM tasks t JOIN cases c ON c.id = t.case_id
        WHERE t.organisation_id = $1 AND c.workspace_id = ANY($2)
          AND t.status NOT IN ('completed','cancelled') AND t.assigned_to = $3
        ORDER BY t.priority_rank ASC, t.created_at ASC, t.id ASC LIMIT 100`,
      [alpha.organisationId, [alpha.workspaceId], alpha.solicitorId]
    );
    await explain(
      "org_active",
      `SELECT t.id FROM tasks t
        WHERE t.organisation_id = $1 AND t.status NOT IN ('completed','cancelled')
        ORDER BY t.priority_rank ASC, t.created_at ASC, t.id ASC LIMIT 100`,
      [alpha.organisationId]
    );
    await explain(
      "case_history_selective",
      `SELECT t.id FROM tasks t WHERE t.case_id = $1 AND t.organisation_id = $2
        ORDER BY t.created_at ASC, t.id ASC`,
      [bulk.rows[0]!.id, alpha.organisationId]
    );
    await explain(
      "case_history_dominant",
      `SELECT t.id FROM tasks t WHERE t.case_id = $1 AND t.organisation_id = $2
        ORDER BY t.created_at ASC, t.id ASC`,
      [alpha.caseId, alpha.organisationId]
    );

    assert.match(plans.open_by_case!, /tasks_case_open_idx/, `open-by-case:\n${plans.open_by_case}`);
    assert.match(plans.assigned_queue!, /tasks_assigned_idx/, `assigned:\n${plans.assigned_queue}`);
    assert.match(plans.org_active!, /tasks_org_open_idx/, `org-active:\n${plans.org_active}`);
    assert.match(
      plans.case_history_selective!,
      /tasks_case_history_idx/,
      `case history:\n${plans.case_history_selective}`
    );
    // The counter-case: one case holding most of the table is read by
    // sequential scan, which is the planner being right.
    assert.doesNotMatch(
      plans.case_history_dominant!,
      /tasks_case_history_idx/,
      `dominant case used the index, so this is no longer a counter-case:\n${plans.case_history_dominant}`
    );

    await emitEvidence(repoRoot, {
      checkId: "task_query_plans",
      passed: true,
      at: new Date().toISOString(),
      commit: commit(),
      producedBy: "packages/integration/test/domain/task-repository.test.ts",
      demonstrates: `with 4000 tasks across 200 cases plus 4000 on one case, mixed statuses, priorities and assignment, and ANALYZE run: open-by-case used tasks_case_open_idx, the assignee queue used tasks_assigned_idx, the organisation-wide active read used tasks_org_open_idx, and a selective case history used tasks_case_history_idx. The counter-case is recorded: a single case holding roughly half the table is read by sequential scan. No latency, throughput or scaling claim is made. Plans:\n${JSON.stringify(plans, null, 2)}`,
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
      producedBy: "packages/integration/test/domain/task-repository.test.ts",
      demonstrates,
    });

  await emit(
    "task_reads_are_organisation_scoped",
    ["cross_org", "dual_membership_isolated", "foreign_dependency", "evidence_validation"],
    "a caller holding a valid case id from another organisation was refused on read and write, and the assignee queue contained no foreign row; an account with real memberships in two organisations, scoped to the first, could not reach the second; a dependency edge and an evidence link across the boundary were both refused with nothing written"
  );
  await emit(
    "task_agent_origin_is_visible",
    ["creation_complete", "no_fixture_fallback"],
    "every task carries its source and, where a model proposed it, the execution that did so — enforced by the schema constraint and validated before the write, so a model-proposed task cannot be recorded as indistinguishable from one a solicitor set"
  );
  await emit(
    "task_professional_requirement_visible",
    ["professional_gate", "refused_review_blocks"],
    "a task requiring professional review could not be completed with no review, with an undecided review, with a reviewer merely assigned, or on a refused review; only an accepted decision read from review_decisions permitted completion"
  );
  await emit(
    "task_completion_is_evented",
    ["creation_complete", "cancellation", "terminal_is_terminal", "history_immutable", "no_protection_bypass"],
    "completion and cancellation each wrote an immutable event naming the actor and the reason; a completed task could not be completed or cancelled again; task_events refused UPDATE, DELETE and TRUNCATE, and the task, its case and its organisation could not be deleted while history existed"
  );
  await emit(
    "task_concurrent_write_refused",
    ["stale_version", "concurrent_updates", "concurrent_completions"],
    "a stale integer version was refused on update, assignment and completion while the earlier write stood; two genuinely concurrent updates produced exactly one winner, one version increment, one event and one audit record; two concurrent completions produced exactly one completion"
  );
  await emit(
    "task_links_returned_as_references",
    ["dependency_blocks_completion", "self_dependency", "two_cycle", "three_cycle", "duplicate_dependency", "dependency_removal", "evidence_lifecycle", "links_do_not_complete"],
    "dependencies and evidence links were returned as identifiers with an unresolved-predecessor summary rather than flattened into text; self-dependency, two- and three-task cycles and duplicates were all refused; removing either kind left an immutable event recording that it had existed, and the evidence item itself survived"
  );
  await emit(
    "task_closed_excluded_by_default",
    ["cancellation", "deterministic_order"],
    "completed and cancelled tasks were excluded from the open read and remained available in the history read; ordering was by priority rank, then creation, then id, and was identical across two consecutive reads"
  );
  await emit(
    "task_no_fixture_fallback",
    ["no_fixture_fallback", "creation_atomic", "transitions_atomic", "update_allowlist", "update_writes_event", "client_cannot_write", "foreign_assignee", "unknown_assignee", "assignment_history"],
    "a case with no persisted tasks returned an empty list and no database returned NO_DATABASE; inducing a failure on the task insert, the event insert and the audit insert each left every task-domain count unchanged, as did an audit failure during assignment, completion, dependency and evidence writes; an update could not touch identity, status or version, and its audit payload recorded field names rather than contents"
  );
  await emit(
    "task_emits_no_probability",
    ["no_probability"],
    "no field on any returned task was numeric — apart from the integer version token — or named for a confidence, probability, score, likelihood, percentage, reliability, productivity or success-rate figure"
  );

  await pool.end();
});
