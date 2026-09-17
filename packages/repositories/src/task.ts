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
  ACTIVE_TASK_STATUSES,
  EVIDENCE_RELATIONS,
  mayComplete,
  MAY_MANAGE_TASKS,
  MUTABLE_FIELDS,
  TASK_EVENTS,
  TASK_ORDER,
  TASK_PRIORITIES,
  TASK_SOURCES,
  TASK_STATUSES,
  type EvidenceRelation,
  type MutableField,
  type TaskDependencySummary,
  type TaskEventName,
  type TaskEventRecord,
  type TaskEvidenceSummary,
  type TaskPriority,
  type TaskRecord,
  type TaskSource,
  type TaskStatus,
} from "./task-model.ts";

/**
 * The task repository.
 *
 * A task list is where a caseworker decides what to do next, so the guarantees
 * here are mostly about keeping visible who asked for a thing and who is
 * allowed to close it. Two are worth stating up front:
 *
 *   * Completion is the only transition that claims something was done, and it
 *     is the only one with a rule of its own. Assignment, evidence links and
 *     dependency edges never complete a task, individually or together.
 *   * A professional requirement is satisfied by an accepted decision on the
 *     linked review, read from `review_decisions` — not by a review existing,
 *     not by a reviewer being assigned, and not by the request's status column.
 *
 * Dependency writes take a transaction-scoped advisory lock on the case. Cycle
 * detection reads the graph and then writes to it, and two concurrent inserts
 * that each read before the other wrote would both see an acyclic graph and
 * together create a cycle.
 */

const COLUMNS = `
  t.id, t.organisation_id, t.case_id, t.task_type, t.title, t.description,
  t.status, t.priority, t.source, t.proposed_by_execution, t.created_by,
  t.assigned_to, t.requires_professional, t.deadline_id, t.review_request_id,
  t.created_at, t.updated_at, t.completed_at, t.cancelled_at, t.version`;

interface TaskRow {
  id: string;
  organisation_id: string;
  case_id: string;
  task_type: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  source: TaskSource;
  proposed_by_execution: string | null;
  created_by: string;
  assigned_to: string | null;
  requires_professional: boolean;
  deadline_id: string | null;
  review_request_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  completed_at: Date | string | null;
  cancelled_at: Date | string | null;
  version: number;
}

const iso = (value: Date | string | null): string | null =>
  value === null ? null : value instanceof Date ? value.toISOString() : value;

interface ResolvedCase {
  readonly caseId: string;
  readonly workspaceId: string;
  readonly organisationId: string;
  readonly membership: Membership;
}

export interface CreateTaskInput {
  readonly caseId: string;
  readonly taskType: string;
  readonly title: string;
  readonly description?: string | null;
  readonly priority?: TaskPriority;
  readonly source?: TaskSource;
  readonly proposedByExecution?: string | null;
  readonly assignTo?: string | null;
  readonly requiresProfessional?: boolean;
  readonly deadlineId?: string | null;
  readonly reviewRequestId?: string | null;
}

export interface UpdateTaskInput {
  readonly caseId: string;
  readonly taskId: string;
  readonly expectedVersion: number;
  readonly changes: Partial<Record<MutableField, unknown>>;
}

export interface TaskTransitionInput {
  readonly caseId: string;
  readonly taskId: string;
  readonly expectedVersion: number;
  readonly reason?: string;
}

export interface AssignTaskInput {
  readonly caseId: string;
  readonly taskId: string;
  readonly assignTo: string | null;
  readonly expectedVersion: number;
}

export interface DependencyInput {
  readonly caseId: string;
  readonly taskId: string;
  readonly dependsOnId: string;
  readonly reason?: string;
}

export interface EvidenceLinkInput {
  readonly caseId: string;
  readonly taskId: string;
  readonly evidenceId: string;
  readonly relation: EvidenceRelation;
  readonly note?: string;
}

export interface TaskReadOptions {
  readonly includeClosed?: boolean;
  readonly limit?: number;
}

export interface AssignedTaskOptions {
  readonly assignedTo?: string;
  readonly limit?: number;
}

export class TaskRepository {
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
    // The organisation predicate, separate from the membership check. The only
    // case it refuses on its own is one account holding real memberships in two
    // organisations on a session scoped to the first — proved by deleting it.
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

  /**
   * Whether a user may be given work on this case.
   *
   * Checked against the database rather than accepted from the caller: an
   * unknown identifier passed as an assignee would otherwise become a task
   * nobody can see in their queue and nobody is chasing.
   */
  async #assigneeIsEligible(
    sql: SqlExecutor,
    resolved: ResolvedCase,
    assignee: string
  ): Promise<boolean> {
    const found = await sql.query<{ id: string }>(
      "SELECT id FROM users WHERE id = $1 AND workspace_id = $2",
      [assignee, resolved.workspaceId]
    );
    return found.rows.length > 0;
  }

  /* -------------------------------------------------------------- */
  /* Hydration                                                       */
  /* -------------------------------------------------------------- */

  async #hydrate(sql: SqlExecutor, rows: readonly TaskRow[]): Promise<readonly TaskRecord[]> {
    const ids = rows.map((r) => r.id);
    const dependsOn = new Map<string, string[]>();
    const unresolved = new Map<string, string[]>();
    const blocks = new Map<string, string[]>();
    const evidence = new Map<string, TaskEvidenceSummary[]>();

    if (ids.length > 0) {
      const [deps, reverse, links] = await Promise.all([
        sql.query<{ task_id: string; depends_on_id: string; status: TaskStatus }>(
          `SELECT d.task_id, d.depends_on_id, p.status
             FROM task_dependencies d JOIN tasks p ON p.id = d.depends_on_id
            WHERE d.task_id = ANY($1)`,
          [ids]
        ),
        sql.query<{ task_id: string; depends_on_id: string }>(
          "SELECT task_id, depends_on_id FROM task_dependencies WHERE depends_on_id = ANY($1)",
          [ids]
        ),
        sql.query<{
          task_id: string;
          evidence_id: string;
          relation: EvidenceRelation;
          created_by: string | null;
          created_at: Date | string;
          note: string | null;
        }>("SELECT * FROM task_evidence_links WHERE task_id = ANY($1) ORDER BY created_at, evidence_id", [
          ids,
        ]),
      ]);

      for (const d of deps.rows) {
        (dependsOn.get(d.task_id) ?? dependsOn.set(d.task_id, []).get(d.task_id)!).push(
          d.depends_on_id
        );
        // A predecessor is resolved when it is finished, either way. A
        // cancelled predecessor should not block for ever.
        if (d.status !== "completed" && d.status !== "cancelled") {
          (unresolved.get(d.task_id) ?? unresolved.set(d.task_id, []).get(d.task_id)!).push(
            d.depends_on_id
          );
        }
      }
      for (const r of reverse.rows) {
        (blocks.get(r.depends_on_id) ?? blocks.set(r.depends_on_id, []).get(r.depends_on_id)!).push(
          r.task_id
        );
      }
      for (const l of links.rows) {
        (evidence.get(l.task_id) ?? evidence.set(l.task_id, []).get(l.task_id)!).push({
          evidenceId: l.evidence_id,
          relation: l.relation,
          createdBy: l.created_by,
          createdAt: iso(l.created_at)!,
          note: l.note,
        });
      }
    }

    return rows.map((row) => {
      const summary: TaskDependencySummary = {
        dependsOn: (dependsOn.get(row.id) ?? []).sort(),
        unresolved: (unresolved.get(row.id) ?? []).sort(),
        blocks: (blocks.get(row.id) ?? []).sort(),
      };
      return {
        id: row.id,
        organisationId: row.organisation_id,
        caseId: row.case_id,
        taskType: row.task_type,
        title: row.title,
        description: row.description,
        status: row.status,
        priority: row.priority,
        source: row.source,
        proposedByExecution: row.proposed_by_execution,
        createdBy: row.created_by,
        assignedTo: row.assigned_to,
        requiresProfessional: row.requires_professional,
        deadlineId: row.deadline_id,
        reviewRequestId: row.review_request_id,
        createdAt: iso(row.created_at)!,
        updatedAt: iso(row.updated_at)!,
        completedAt: iso(row.completed_at),
        cancelledAt: iso(row.cancelled_at),
        version: Number(row.version),
        dependencies: summary,
        evidence: evidence.get(row.id) ?? [],
      } satisfies TaskRecord;
    });
  }

  /* -------------------------------------------------------------- */
  /* Reads                                                           */
  /* -------------------------------------------------------------- */

  async readTasksForCase(
    context: RepositoryContext,
    caseId: string,
    options: TaskReadOptions = {}
  ): Promise<Result<readonly TaskRecord[]>> {
    return this.#readCase(context, caseId, options.includeClosed ?? true);
  }

  /**
   * The operational read: what still needs doing.
   *
   * Completed and cancelled tasks are excluded, matching `tasks_case_open_idx`.
   * A list that grows without bound buries what needs doing now under what was
   * done last year, and the caseworker stops reading it.
   */
  async readOpenTasksForCase(
    context: RepositoryContext,
    caseId: string
  ): Promise<Result<readonly TaskRecord[]>> {
    return this.#readCase(context, caseId, false);
  }

  async #readCase(
    context: RepositoryContext,
    caseId: string,
    includeClosed: boolean
  ): Promise<Result<readonly TaskRecord[]>> {
    if (!this.#pool) return this.#noDatabase();
    try {
      const resolved = await this.#resolve(this.#pool, context, caseId, MAY_READ);
      if (!resolved.ok) return refuse(resolved.refusal);

      const rows = await this.#pool.query<TaskRow>(
        `SELECT ${COLUMNS} FROM tasks t
          WHERE t.case_id = $1 AND t.organisation_id = $2
            ${includeClosed ? "" : "AND t.status NOT IN ('completed','cancelled')"}
          ${TASK_ORDER}`,
        [resolved.value.caseId, resolved.value.organisationId]
      );
      return ok(await this.#hydrate(this.#pool, rows.rows));
    } catch (error) {
      return this.#unreachable(error);
    }
  }

  /**
   * An assignee's own queue, across the cases they can see.
   *
   * Ordered by priority, then the linked deadline where there is one, then
   * creation. The deadline is used only because the task explicitly links to
   * it — nothing here parses a date out of a title.
   */
  async readAssignedTasks(
    context: RepositoryContext,
    options: AssignedTaskOptions = {}
  ): Promise<Result<readonly TaskRecord[]>> {
    if (!this.#pool) return this.#noDatabase();

    const workspaces = context.memberships
      .filter((m) => m.removedAt === null && m.accountId === context.accountId)
      .filter((m) => MAY_READ.includes(m.role))
      .map((m) => m.workspaceId);
    if (workspaces.length === 0) return ok([]);

    const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
    try {
      const rows = await this.#pool.query<TaskRow>(
        `SELECT ${COLUMNS} FROM tasks t
           JOIN cases c ON c.id = t.case_id
           LEFT JOIN deadlines dl ON dl.id = t.deadline_id
          WHERE t.organisation_id = $1
            AND c.workspace_id = ANY($2)
            AND t.status NOT IN ('completed','cancelled')
            AND ($3::uuid IS NULL OR t.assigned_to = $3::uuid)
          ORDER BY t.priority_rank ASC, dl.deadline_at ASC NULLS LAST,
                   t.created_at ASC, t.id ASC
          LIMIT $4`,
        [context.organisationId, workspaces, options.assignedTo ?? null, limit]
      );
      return ok(await this.#hydrate(this.#pool, rows.rows));
    } catch (error) {
      return this.#unreachable(error);
    }
  }

  async readTaskHistory(
    context: RepositoryContext,
    caseId: string,
    taskId: string
  ): Promise<Result<readonly TaskEventRecord[]>> {
    if (!this.#pool) return this.#noDatabase();
    try {
      const resolved = await this.#resolve(this.#pool, context, caseId, MAY_READ);
      if (!resolved.ok) return refuse(resolved.refusal);

      const rows = await this.#pool.query<{
        id: string;
        task_id: string;
        event: TaskEventName;
        actor_id: string | null;
        detail: string | null;
        at: Date | string;
      }>(
        `SELECT e.* FROM task_events e JOIN tasks t ON t.id = e.task_id
          WHERE e.task_id = $1 AND t.case_id = $2 AND t.organisation_id = $3
          ORDER BY e.id ASC`,
        [taskId, resolved.value.caseId, resolved.value.organisationId]
      );
      return ok(
        rows.rows.map((r) => ({
          id: Number(r.id),
          taskId: r.task_id,
          event: r.event,
          actorId: r.actor_id,
          detail: r.detail,
          at: iso(r.at)!,
        }))
      );
    } catch (error) {
      return this.#unreachable(error);
    }
  }

  /* -------------------------------------------------------------- */
  /* Writes                                                          */
  /* -------------------------------------------------------------- */

  async createTask(
    context: RepositoryContext,
    input: CreateTaskInput
  ): Promise<Result<TaskRecord>> {
    if (!this.#pool) return this.#noDatabase();

    const invalid = validateCreate(input);
    if (invalid) return refuse({ reason: "INVALID", detail: invalid });

    try {
      return await withTransaction(this.#pool, async (tx) => {
        const resolved = await this.#resolve(tx, context, input.caseId, MAY_MANAGE_TASKS);
        if (!resolved.ok) return refuse<TaskRecord>(resolved.refusal);

        if (input.assignTo && !(await this.#assigneeIsEligible(tx, resolved.value, input.assignTo))) {
          return refuse({
            reason: "INVALID",
            detail: "the assignee is not a member of the workspace this case belongs to",
          });
        }

        const inserted = await tx.query<TaskRow>(
          `INSERT INTO tasks (
             organisation_id, case_id, task_type, title, description, status,
             priority, source, proposed_by_execution, created_by, assigned_to,
             requires_professional, deadline_id, review_request_id)
           VALUES ($1,$2,$3,$4,$5,'open',$6,$7,$8,$9,$10,$11,$12,$13)
           RETURNING ${COLUMNS.replace(/t\./g, "")}`,
          [
            resolved.value.organisationId,
            resolved.value.caseId,
            input.taskType,
            input.title,
            input.description ?? null,
            input.priority ?? "normal",
            input.source ?? "human",
            input.proposedByExecution ?? null,
            context.actorId,
            input.assignTo ?? null,
            input.requiresProfessional ?? false,
            input.deadlineId ?? null,
            input.reviewRequestId ?? null,
          ]
        );

        const row = inserted.rows[0]!;
        await this.#event(tx, row.id, "created", context, input.title);
        if (input.assignTo) {
          await this.#event(tx, row.id, "assigned", context, `assigned to ${input.assignTo}`);
        }
        await this.#audit(tx, context, "task.created", row.id, {
          caseId: resolved.value.caseId,
          taskType: input.taskType,
          priority: input.priority ?? "normal",
          source: input.source ?? "human",
          requiresProfessional: input.requiresProfessional ?? false,
        });

        const [record] = await this.#hydrate(tx, [row]);
        return ok(record!);
      });
    } catch (error) {
      return this.#unreachable(error);
    }
  }

  /**
   * Changes the fields a caller is allowed to change.
   *
   * The allow-list is the guarantee. Anything not in `MUTABLE_FIELDS` is
   * refused by name rather than silently ignored, because a silently dropped
   * field looks like a successful write to whoever sent it.
   */
  async updateTask(context: RepositoryContext, input: UpdateTaskInput): Promise<Result<TaskRecord>> {
    if (!this.#pool) return this.#noDatabase();

    const requested = Object.keys(input.changes);
    if (requested.length === 0) {
      return refuse({ reason: "INVALID", detail: "an update must change something" });
    }
    const forbidden = requested.filter((k) => !MUTABLE_FIELDS.includes(k as MutableField));
    if (forbidden.length > 0) {
      return refuse({
        reason: "INVALID",
        detail: `${forbidden.join(", ")} cannot be changed through an update`,
      });
    }
    if (input.changes.priority !== undefined && !TASK_PRIORITIES.includes(input.changes.priority as TaskPriority)) {
      return refuse({ reason: "INVALID", detail: `${input.changes.priority} is not a priority` });
    }
    if (input.changes.title !== undefined && !String(input.changes.title ?? "").trim()) {
      return refuse({ reason: "INVALID", detail: "a task must keep a title" });
    }

    const COLUMN_OF: Record<MutableField, string> = {
      title: "title",
      description: "description",
      priority: "priority",
      taskType: "task_type",
      deadlineId: "deadline_id",
      reviewRequestId: "review_request_id",
    };

    return this.#transition(context, input.caseId, input.taskId, input.expectedVersion, {
      set: (p) =>
        requested.map((k) => `${COLUMN_OF[k as MutableField]} = ${p(input.changes[k as MutableField])}`).join(", "),
      event: "updated",
      // The field names only. Persisting before-and-after values would copy a
      // task's free text into the audit payload, which is exactly the content
      // ADR-002 has no way to erase.
      detail: `changed ${requested.sort().join(", ")}`,
      action: "task.updated",
      payload: { fields: requested.sort() },
      requireActive: true,
    });
  }

  async assignTask(context: RepositoryContext, input: AssignTaskInput): Promise<Result<TaskRecord>> {
    if (!this.#pool) return this.#noDatabase();
    return this.#transition(context, input.caseId, input.taskId, input.expectedVersion, {
      set: (p) => `assigned_to = ${p(input.assignTo)}`,
      event: input.assignTo ? "assigned" : "unassigned",
      detail: input.assignTo ? `assigned to ${input.assignTo}` : "assignment cleared",
      action: "task.assigned",
      payload: { assignedTo: input.assignTo },
      requireActive: true,
      checkAssignee: input.assignTo,
      // Reassignment records who it was before, so the history answers "who was
      // supposed to be doing this in March" rather than only "who is now".
      priorAssignee: true,
    });
  }

  /**
   * Completes a task, if everything it was waiting on is done.
   *
   * The professional-review gate reads `review_decisions` through the linked
   * request. A review existing, a reviewer being assigned, or the request's
   * status column saying `decided` are all insufficient — the first two are not
   * decisions and the third is what an UPDATE last wrote.
   */
  async completeTask(
    context: RepositoryContext,
    input: TaskTransitionInput
  ): Promise<Result<TaskRecord>> {
    return this.#transition(context, input.caseId, input.taskId, input.expectedVersion, {
      set: () => "status = 'completed', completed_at = now()",
      event: "completed",
      detail: input.reason ?? "completed",
      action: "task.completed",
      payload: { reason: input.reason ?? null },
      requireActive: false,
      gate: async (tx, task) => {
        const unresolved = await tx.query<{ depends_on_id: string }>(
          `SELECT d.depends_on_id FROM task_dependencies d JOIN tasks p ON p.id = d.depends_on_id
            WHERE d.task_id = $1 AND p.status NOT IN ('completed','cancelled')`,
          [task.id]
        );

        let decision: string | null = null;
        if (task.review_request_id) {
          const found = await tx.query<{ decision: string }>(
            "SELECT decision FROM review_decisions WHERE request_id = $1",
            [task.review_request_id]
          );
          decision = found.rows[0]?.decision ?? null;
        }

        const verdict = mayComplete({
          status: task.status,
          requiresProfessional: task.requires_professional,
          unresolvedDependencies: unresolved.rows.map((r) => r.depends_on_id),
          reviewDecision: decision,
          reviewRequestId: task.review_request_id,
        });
        return verdict.permitted ? null : verdict.because!;
      },
    });
  }

  async cancelTask(
    context: RepositoryContext,
    input: TaskTransitionInput
  ): Promise<Result<TaskRecord>> {
    if (!input.reason?.trim()) {
      return refuse({ reason: "INVALID", detail: "a cancellation must state why" });
    }
    return this.#transition(context, input.caseId, input.taskId, input.expectedVersion, {
      set: () => "status = 'cancelled', cancelled_at = now()",
      event: "cancelled",
      detail: input.reason,
      action: "task.cancelled",
      payload: { reason: input.reason },
      requireActive: false,
      gate: async (_tx, task) => {
        // A completed task is not abandoned afterwards. Reopening is a separate
        // transition the schema would have to support, and it does not.
        if (task.status === "completed") return "a completed task cannot be cancelled";
        if (task.status === "cancelled") return "this task is already cancelled";
        return null;
      },
    });
  }

  /**
   * The shared shape of every task transition.
   *
   * One implementation, because the parts that must not be forgotten — tenancy,
   * the version token, the event, the audit entry, the transaction — are
   * exactly the parts that get forgotten when each method writes its own.
   */
  async #transition(
    context: RepositoryContext,
    caseId: string,
    taskId: string,
    expectedVersion: number,
    spec: {
      set: (p: (value: unknown) => string) => string;
      event: TaskEventName;
      detail: string;
      action: string;
      payload: Record<string, unknown>;
      requireActive: boolean;
      checkAssignee?: string | null;
      priorAssignee?: boolean;
      gate?: (sql: SqlExecutor, task: TaskRow) => Promise<string | null>;
    }
  ): Promise<Result<TaskRecord>> {
    if (!this.#pool) return this.#noDatabase();
    try {
      return await withTransaction(this.#pool, async (tx) => {
        const resolved = await this.#resolve(tx, context, caseId, MAY_MANAGE_TASKS);
        if (!resolved.ok) return refuse<TaskRecord>(resolved.refusal);

        const found = await tx.query<TaskRow>(
          `SELECT ${COLUMNS} FROM tasks t
            WHERE t.id = $1 AND t.case_id = $2 AND t.organisation_id = $3 FOR UPDATE`,
          [taskId, resolved.value.caseId, resolved.value.organisationId]
        );
        const task = found.rows[0];
        if (!task) return refuse({ reason: "NOT_PERSISTED", detail: CASE_NOT_AVAILABLE });

        if (spec.checkAssignee) {
          if (!(await this.#assigneeIsEligible(tx, resolved.value, spec.checkAssignee))) {
            return refuse({
              reason: "INVALID",
              detail: "the assignee is not a member of the workspace this case belongs to",
            });
          }
        }
        if (spec.requireActive && !ACTIVE_TASK_STATUSES.includes(task.status)) {
          return refuse({
            reason: "CONFLICT",
            detail: `this task is ${task.status} and can no longer be changed`,
          });
        }
        if (Number(task.version) !== expectedVersion) {
          return refuse({
            reason: "CONFLICT",
            detail: "this task changed after it was read; re-read it before changing it",
          });
        }
        if (spec.gate) {
          const because = await spec.gate(tx, task);
          if (because) return refuse({ reason: "CONFLICT", detail: because });
        }

        const params: unknown[] = [];
        const p = (value: unknown) => `$${params.push(value)}`;
        const set = spec.set(p);
        const idParam = p(taskId);
        const versionParam = p(expectedVersion);

        const updated = await tx.query<TaskRow>(
          `UPDATE tasks SET ${set}, version = version + 1, updated_at = now()
            WHERE id = ${idParam} AND version = ${versionParam}
            RETURNING ${COLUMNS.replace(/t\./g, "")}`,
          params
        );
        if (!updated.rows[0]) {
          return refuse({ reason: "CONFLICT", detail: "this task changed before the write landed" });
        }

        const detail =
          spec.priorAssignee && task.assigned_to
            ? `${spec.detail} (previously ${task.assigned_to})`
            : spec.detail;
        await this.#event(tx, taskId, spec.event, context, detail);
        await this.#audit(tx, context, spec.action, taskId, {
          caseId: resolved.value.caseId,
          ...(spec.priorAssignee ? { previousAssignee: task.assigned_to } : {}),
          ...spec.payload,
        });

        const [record] = await this.#hydrate(tx, [updated.rows[0]!]);
        return ok(record!);
      });
    } catch (error) {
      return this.#unreachable(error);
    }
  }

  /* -------------------------------------------------------------- */
  /* Dependencies                                                    */
  /* -------------------------------------------------------------- */

  /**
   * Records that one task must wait for another.
   *
   * Serialised per case with a transaction-scoped advisory lock. Cycle
   * detection reads the graph and then writes to it, and two concurrent inserts
   * that each read before the other wrote would both see an acyclic graph and
   * together create a cycle — after which neither task could ever be completed
   * and nothing in the schema would explain why.
   */
  async addTaskDependency(
    context: RepositoryContext,
    input: DependencyInput
  ): Promise<Result<TaskRecord>> {
    if (!this.#pool) return this.#noDatabase();
    if (input.taskId === input.dependsOnId) {
      return refuse({ reason: "INVALID", detail: "a task cannot depend on itself" });
    }

    try {
      return await withTransaction(this.#pool, async (tx) => {
        const resolved = await this.#resolve(tx, context, input.caseId, MAY_MANAGE_TASKS);
        if (!resolved.ok) return refuse<TaskRecord>(resolved.refusal);

        await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          `task-deps:${resolved.value.caseId}`,
        ]);

        // Both ends must be this case's, in this organisation. A dependency
        // across a tenancy boundary would let one organisation's progress
        // silently gate another's.
        const both = await tx.query<{ id: string }>(
          `SELECT id FROM tasks
            WHERE id = ANY($1) AND case_id = $2 AND organisation_id = $3`,
          [[input.taskId, input.dependsOnId], resolved.value.caseId, resolved.value.organisationId]
        );
        if (both.rows.length !== 2) {
          return refuse({
            reason: "NOT_PERSISTED",
            detail: "both tasks must belong to this case in this organisation",
          });
        }

        const existing = await tx.query<{ task_id: string }>(
          "SELECT task_id FROM task_dependencies WHERE task_id = $1 AND depends_on_id = $2",
          [input.taskId, input.dependsOnId]
        );
        if (existing.rows.length > 0) {
          return refuse({ reason: "CONFLICT", detail: "that dependency is already recorded" });
        }

        // Would the new edge close a cycle? It does if the proposed predecessor
        // already depends, transitively, on this task.
        const reachable = await tx.query<{ id: string }>(
          `WITH RECURSIVE walk(id) AS (
             SELECT depends_on_id FROM task_dependencies WHERE task_id = $1
             UNION
             SELECT d.depends_on_id FROM task_dependencies d JOIN walk w ON d.task_id = w.id)
           SELECT id FROM walk WHERE id = $2`,
          [input.dependsOnId, input.taskId]
        );
        if (reachable.rows.length > 0) {
          return refuse({
            reason: "CONFLICT",
            detail:
              "that dependency would create a cycle, after which neither task could ever be completed",
          });
        }

        await tx.query(
          `INSERT INTO task_dependencies (task_id, depends_on_id, created_by, reason)
           VALUES ($1,$2,$3,$4)`,
          [input.taskId, input.dependsOnId, context.actorId, input.reason ?? null]
        );
        await this.#event(
          tx,
          input.taskId,
          "dependency_added",
          context,
          `waits for ${input.dependsOnId}${input.reason ? `: ${input.reason}` : ""}`
        );
        await this.#audit(tx, context, "task.dependency_added", input.taskId, {
          caseId: resolved.value.caseId,
          dependsOnId: input.dependsOnId,
          reason: input.reason ?? null,
        });

        return ok((await this.#reload(tx, input.taskId))!);
      });
    } catch (error) {
      return this.#unreachable(error);
    }
  }

  /** Removes a dependency, recording who removed it. The edge goes; the fact it existed does not. */
  async removeTaskDependency(
    context: RepositoryContext,
    input: DependencyInput
  ): Promise<Result<TaskRecord>> {
    if (!this.#pool) return this.#noDatabase();
    try {
      return await withTransaction(this.#pool, async (tx) => {
        const resolved = await this.#resolve(tx, context, input.caseId, MAY_MANAGE_TASKS);
        if (!resolved.ok) return refuse<TaskRecord>(resolved.refusal);

        await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          `task-deps:${resolved.value.caseId}`,
        ]);

        const owned = await tx.query<{ id: string }>(
          "SELECT id FROM tasks WHERE id = $1 AND case_id = $2 AND organisation_id = $3",
          [input.taskId, resolved.value.caseId, resolved.value.organisationId]
        );
        if (!owned.rows[0]) {
          return refuse({ reason: "NOT_PERSISTED", detail: CASE_NOT_AVAILABLE });
        }

        const removed = await tx.query(
          "DELETE FROM task_dependencies WHERE task_id = $1 AND depends_on_id = $2",
          [input.taskId, input.dependsOnId]
        );
        if (removed.rowCount === 0) {
          return refuse({ reason: "NOT_PERSISTED", detail: "no such dependency" });
        }

        await this.#event(
          tx,
          input.taskId,
          "dependency_removed",
          context,
          `no longer waits for ${input.dependsOnId}${input.reason ? `: ${input.reason}` : ""}`
        );
        await this.#audit(tx, context, "task.dependency_removed", input.taskId, {
          caseId: resolved.value.caseId,
          dependsOnId: input.dependsOnId,
          reason: input.reason ?? null,
        });

        return ok((await this.#reload(tx, input.taskId))!);
      });
    } catch (error) {
      return this.#unreachable(error);
    }
  }

  /* -------------------------------------------------------------- */
  /* Evidence links                                                  */
  /* -------------------------------------------------------------- */

  async linkTaskEvidence(
    context: RepositoryContext,
    input: EvidenceLinkInput
  ): Promise<Result<TaskRecord>> {
    if (!this.#pool) return this.#noDatabase();
    if (!EVIDENCE_RELATIONS.includes(input.relation)) {
      return refuse({ reason: "INVALID", detail: `${input.relation} is not an evidence relation` });
    }

    try {
      return await withTransaction(this.#pool, async (tx) => {
        const resolved = await this.#resolve(tx, context, input.caseId, MAY_MANAGE_TASKS);
        if (!resolved.ok) return refuse<TaskRecord>(resolved.refusal);

        const task = await tx.query<{ id: string }>(
          "SELECT id FROM tasks WHERE id = $1 AND case_id = $2 AND organisation_id = $3",
          [input.taskId, resolved.value.caseId, resolved.value.organisationId]
        );
        if (!task.rows[0]) return refuse({ reason: "NOT_PERSISTED", detail: CASE_NOT_AVAILABLE });

        // The evidence must be this case's. A dangling identifier would become
        // a task that claims documentary backing pointing at nothing, and a
        // foreign one would attach another client's document to this file.
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

        const existing = await tx.query<{ task_id: string }>(
          "SELECT task_id FROM task_evidence_links WHERE task_id = $1 AND evidence_id = $2 AND relation = $3",
          [input.taskId, input.evidenceId, input.relation]
        );
        if (existing.rows.length > 0) {
          return refuse({ reason: "CONFLICT", detail: "that evidence link is already recorded" });
        }

        await tx.query(
          `INSERT INTO task_evidence_links (task_id, evidence_id, relation, created_by, note)
           VALUES ($1,$2,$3,$4,$5)`,
          [input.taskId, input.evidenceId, input.relation, context.actorId, input.note ?? null]
        );
        await this.#event(
          tx,
          input.taskId,
          "evidence_linked",
          context,
          `${input.relation} ${input.evidenceId}`
        );
        await this.#audit(tx, context, "task.evidence_linked", input.taskId, {
          caseId: resolved.value.caseId,
          evidenceId: input.evidenceId,
          relation: input.relation,
        });

        return ok((await this.#reload(tx, input.taskId))!);
      });
    } catch (error) {
      return this.#unreachable(error);
    }
  }

  /**
   * Removes an evidence link.
   *
   * The link row goes; the record that it existed does not. `evidence_unlinked`
   * is appended to the task's history, which is append-only, so "this document
   * was attached to this task between March and June" survives.
   */
  async unlinkTaskEvidence(
    context: RepositoryContext,
    input: EvidenceLinkInput
  ): Promise<Result<TaskRecord>> {
    if (!this.#pool) return this.#noDatabase();
    try {
      return await withTransaction(this.#pool, async (tx) => {
        const resolved = await this.#resolve(tx, context, input.caseId, MAY_MANAGE_TASKS);
        if (!resolved.ok) return refuse<TaskRecord>(resolved.refusal);

        const task = await tx.query<{ id: string }>(
          "SELECT id FROM tasks WHERE id = $1 AND case_id = $2 AND organisation_id = $3",
          [input.taskId, resolved.value.caseId, resolved.value.organisationId]
        );
        if (!task.rows[0]) return refuse({ reason: "NOT_PERSISTED", detail: CASE_NOT_AVAILABLE });

        const removed = await tx.query(
          "DELETE FROM task_evidence_links WHERE task_id = $1 AND evidence_id = $2 AND relation = $3",
          [input.taskId, input.evidenceId, input.relation]
        );
        if (removed.rowCount === 0) {
          return refuse({ reason: "NOT_PERSISTED", detail: "no such evidence link" });
        }

        await this.#event(
          tx,
          input.taskId,
          "evidence_unlinked",
          context,
          `${input.relation} ${input.evidenceId}${input.note ? `: ${input.note}` : ""}`
        );
        await this.#audit(tx, context, "task.evidence_unlinked", input.taskId, {
          caseId: resolved.value.caseId,
          evidenceId: input.evidenceId,
          relation: input.relation,
        });

        return ok((await this.#reload(tx, input.taskId))!);
      });
    } catch (error) {
      return this.#unreachable(error);
    }
  }

  /* -------------------------------------------------------------- */

  async #reload(sql: SqlExecutor, taskId: string): Promise<TaskRecord | undefined> {
    const rows = await sql.query<TaskRow>(`SELECT ${COLUMNS} FROM tasks t WHERE t.id = $1`, [taskId]);
    const [record] = await this.#hydrate(sql, rows.rows);
    return record;
  }

  async #event(
    sql: SqlExecutor,
    taskId: string,
    event: TaskEventName,
    context: RepositoryContext,
    detail: string | null
  ): Promise<void> {
    await sql.query(
      "INSERT INTO task_events (task_id, event, actor_id, detail) VALUES ($1,$2,$3,$4)",
      [taskId, event, context.actorId, detail]
    );
  }

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
        "no database is configured for this instance, so no task is persisted. This is the state of this deployment, not a failure to load.",
    });
  }

  #unreachable<T>(error: unknown): Result<T> {
    return refuse({
      reason: "UNREACHABLE",
      detail: error instanceof Error ? error.message : "the task store could not be read",
    });
  }
}

export function validateCreate(input: CreateTaskInput): string | null {
  if (!input.taskType.trim()) return "a task must say what kind of work it is";
  if (!input.title.trim()) return "a task must have a title";
  if (input.title.length > 500) return "a task title is a label, not a description";
  if (input.priority !== undefined && !TASK_PRIORITIES.includes(input.priority)) {
    return `${input.priority} is not a priority`;
  }
  if (input.source !== undefined && !TASK_SOURCES.includes(input.source)) {
    return `${input.source} is not a task source`;
  }
  // Mirrors `agent_proposed_tasks_cite_an_execution`. A model-proposed task
  // with no execution behind it is indistinguishable from one a solicitor set.
  if (input.source === "agent_proposed" && !input.proposedByExecution) {
    return "a task a model proposed must cite the execution that proposed it";
  }
  return null;
}

