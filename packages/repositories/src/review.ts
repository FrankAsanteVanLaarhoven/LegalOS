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
  MAY_WRITE,
  ok,
  refuse,
  type RepositoryContext,
  type Result,
} from "./context.ts";
import {
  ACTIVE_STATUSES,
  DECISIONS,
  isDigest,
  mayDecide,
  PRIORITIES,
  QUEUE_ORDER,
  queueStateOf,
  REVIEW_EVENTS,
  SUBJECT_TYPES,
  type Decision,
  type Priority,
  type ReviewDecisionRecord,
  type ReviewEventName,
  type ReviewEventRecord,
  type ReviewRequestRecord,
  type ReviewStatus,
  type SubjectType,
} from "./review-model.ts";

/**
 * The review repository.
 *
 * This is the boundary the platform's central claim rests on: a machine
 * proposes, a named qualified person authorises. Everything else can be
 * rebuilt; an approval that turns out to have been recorded without a
 * qualified person behind it cannot be un-relied-on.
 *
 * Three separations are structural rather than conventional, and each has a
 * method boundary rather than a flag:
 *
 *   * A request is not a decision. Creating one, assigning it, or moving it
 *     through the queue never produces a decision row, and `hasDecision` is
 *     read from the decision table rather than inferred from a status column.
 *   * A model's output is not a human decision. A request can name the
 *     execution that produced its subject; there is no parameter anywhere on
 *     `recordReviewDecision` that accepts an execution, and `decided_by` is a
 *     user or the write does not happen.
 *   * The person who asks for a review does not decide it. Absolute, checked
 *     before anything is written, and it is the one refusal that would pass
 *     every other check here.
 */

const REQUEST_COLUMNS = `
  r.id, r.organisation_id, r.case_id, r.subject_type, r.subject_id, r.subject_digest,
  r.execution_id, r.requires_professional, r.reserved_activity, r.required_role,
  r.reason, r.priority, r.requested_by, r.requested_at, r.assigned_to, r.assigned_at,
  r.due_deadline_id, r.status, r.version, r.updated_at`;

interface RequestRow {
  id: string;
  organisation_id: string;
  case_id: string;
  subject_type: SubjectType;
  subject_id: string;
  subject_digest: string | null;
  execution_id: string | null;
  requires_professional: boolean;
  reserved_activity: string | null;
  required_role: string | null;
  reason: string | null;
  priority: Priority;
  requested_by: string;
  requested_at: Date | string;
  assigned_to: string | null;
  assigned_at: Date | string | null;
  due_deadline_id: string | null;
  status: ReviewStatus;
  version: number;
  updated_at: Date | string;
}

const iso = (value: Date | string | null): string | null =>
  value === null ? null : value instanceof Date ? value.toISOString() : value;

interface ResolvedCase {
  readonly caseId: string;
  readonly workspaceId: string;
  readonly organisationId: string;
  readonly membership: Membership;
}

export interface CreateReviewRequestInput {
  readonly caseId: string;
  readonly subjectType: SubjectType;
  readonly subjectId: string;
  /** sha-256 of the artefact as submitted, so a later edit is visible. */
  readonly subjectDigest?: string;
  /** The execution that produced the subject, when a model produced it. */
  readonly executionId?: string | null;
  readonly requiresProfessional?: boolean;
  readonly reservedActivity?: string | null;
  readonly requiredRole?: string | null;
  readonly reason: string;
  readonly priority?: Priority;
  readonly assignTo?: string | null;
  readonly dueDeadlineId?: string | null;
}

export interface RecordReviewDecisionInput {
  readonly caseId: string;
  readonly requestId: string;
  readonly decision: Decision;
  /** Why. Written once, never edited. */
  readonly basis: string;
  /** sha-256 of what the reviewer actually looked at. */
  readonly subjectDigest: string;
  /** The request's `version` as the caller last saw it. */
  readonly expectedVersion: number;
}

export interface ReassignReviewInput {
  readonly caseId: string;
  readonly requestId: string;
  readonly assignTo: string | null;
  readonly expectedVersion: number;
  readonly detail?: string;
}

export interface WithdrawReviewInput {
  readonly caseId: string;
  readonly requestId: string;
  readonly reason: string;
  readonly expectedVersion: number;
}

export interface QueueOptions {
  readonly assignedTo?: string;
  readonly caseId?: string;
  readonly includeClosed?: boolean;
  readonly limit?: number;
}

export interface ReviewQueueEntry extends ReviewRequestRecord {
  readonly decision: ReviewDecisionRecord | null;
}

export class ReviewRepository {
  readonly #pool: PoolLike | null;

  /** `null` means no database is configured. Modelled, not thrown. See DL-G6. */
  constructor(pool: PoolLike | null) {
    this.#pool = pool;
  }

  /* -------------------------------------------------------------- */
  /* Resolution                                                      */
  /* -------------------------------------------------------------- */

  /**
   * Establishes the case, its tenancy and the caller's standing in it.
   *
   * The organisation comparison is separate from the membership check on
   * purpose, and the deadline work is why. Deleting it there left the whole
   * suite green, because every cross-tenancy test was satisfied by membership
   * alone — a caller from one organisation holds no membership in another's
   * workspace. The case it actually refuses is one account with real
   * memberships in two organisations on a session scoped to the first, and that
   * is the tenancy boundary that matters.
   */
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
   * Attaches decisions by reading the decision table.
   *
   * Never from `status = 'decided'`. A status is what an UPDATE last wrote; a
   * decision row is the immutable record a regulator would ask to see, and the
   * two can disagree. If they ever do, this reports the second.
   */
  async #hydrate(
    sql: SqlExecutor,
    rows: readonly RequestRow[]
  ): Promise<readonly ReviewQueueEntry[]> {
    const ids = rows.map((r) => r.id);
    const decisions = new Map<string, ReviewDecisionRecord>();
    if (ids.length > 0) {
      const found = await sql.query<{
        id: string;
        request_id: string;
        decision: Decision;
        basis: string;
        decided_by: string;
        decided_by_role: string;
        regulatory_reference: string | null;
        decided_at: Date | string;
        subject_digest: string;
      }>("SELECT * FROM review_decisions WHERE request_id = ANY($1)", [ids]);
      for (const d of found.rows) {
        decisions.set(d.request_id, {
          id: d.id,
          requestId: d.request_id,
          decision: d.decision,
          basis: d.basis,
          decidedBy: d.decided_by,
          decidedByRole: d.decided_by_role,
          regulatoryReference: d.regulatory_reference,
          decidedAt: iso(d.decided_at)!,
          subjectDigest: d.subject_digest,
        });
      }
    }

    return rows.map((row) => {
      const decision = decisions.get(row.id) ?? null;
      return {
        id: row.id,
        organisationId: row.organisation_id,
        caseId: row.case_id,
        subjectType: row.subject_type,
        subjectId: row.subject_id,
        subjectDigest: row.subject_digest,
        executionId: row.execution_id,
        requiresProfessional: row.requires_professional,
        reservedActivity: row.reserved_activity,
        requiredRole: row.required_role,
        reason: row.reason,
        priority: row.priority,
        requestedBy: row.requested_by,
        requestedAt: iso(row.requested_at)!,
        assignedTo: row.assigned_to,
        assignedAt: iso(row.assigned_at),
        dueDeadlineId: row.due_deadline_id,
        status: row.status,
        queueState: queueStateOf({ status: row.status, assignedTo: row.assigned_to }),
        version: Number(row.version),
        createdAt: iso(row.requested_at)!,
        updatedAt: iso(row.updated_at)!,
        hasDecision: decision !== null,
        decision,
      } satisfies ReviewQueueEntry;
    });
  }

  /* -------------------------------------------------------------- */
  /* Reads                                                           */
  /* -------------------------------------------------------------- */

  /**
   * The work queue.
   *
   * Terminal requests are excluded unless asked for. A queue that grows without
   * bound buries what needs doing now under what was decided last year, and the
   * reviewer stops reading it.
   */
  async readReviewQueue(
    context: RepositoryContext,
    options: QueueOptions = {}
  ): Promise<Result<readonly ReviewQueueEntry[]>> {
    if (!this.#pool) return this.#noDatabase();

    const workspaces = context.memberships
      .filter((m) => m.removedAt === null && m.accountId === context.accountId)
      .filter((m) => MAY_READ.includes(m.role))
      .map((m) => m.workspaceId);
    if (workspaces.length === 0) return ok([]);

    const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
    const params: unknown[] = [context.organisationId, workspaces];
    const p = (v: unknown) => `$${params.push(v)}`;

    const clauses = [
      "r.organisation_id = $1",
      "c.workspace_id = ANY($2)",
      options.includeClosed ? "TRUE" : `r.status = ANY(${p(ACTIVE_STATUSES)})`,
    ];
    if (options.assignedTo) clauses.push(`r.assigned_to = ${p(options.assignedTo)}`);
    if (options.caseId) clauses.push(`r.case_id = ${p(options.caseId)}`);

    try {
      const rows = await this.#pool.query<RequestRow>(
        `SELECT ${REQUEST_COLUMNS} FROM review_requests r
           JOIN cases c ON c.id = r.case_id
          WHERE ${clauses.join(" AND ")}
          ${QUEUE_ORDER}
          LIMIT ${p(limit)}`,
        params
      );
      return ok(await this.#hydrate(this.#pool, rows.rows));
    } catch (error) {
      return this.#unreachable(error);
    }
  }

  /** Every review on a case, open and closed. The history read. */
  async readReviewsForCase(
    context: RepositoryContext,
    caseId: string
  ): Promise<Result<readonly ReviewQueueEntry[]>> {
    if (!this.#pool) return this.#noDatabase();
    try {
      const resolved = await this.#resolve(this.#pool, context, caseId, MAY_READ);
      if (!resolved.ok) return refuse(resolved.refusal);

      const rows = await this.#pool.query<RequestRow>(
        `SELECT ${REQUEST_COLUMNS} FROM review_requests r
          WHERE r.case_id = $1 AND r.organisation_id = $2
          ORDER BY r.requested_at ASC, r.id ASC`,
        [resolved.value.caseId, resolved.value.organisationId]
      );
      return ok(await this.#hydrate(this.#pool, rows.rows));
    } catch (error) {
      return this.#unreachable(error);
    }
  }

  /** The recorded history of one request: every event, in order. */
  async readReviewHistory(
    context: RepositoryContext,
    caseId: string,
    requestId: string
  ): Promise<Result<readonly ReviewEventRecord[]>> {
    if (!this.#pool) return this.#noDatabase();
    try {
      const resolved = await this.#resolve(this.#pool, context, caseId, MAY_READ);
      if (!resolved.ok) return refuse(resolved.refusal);

      const rows = await this.#pool.query<{
        id: string;
        request_id: string;
        event: ReviewEventName;
        actor_id: string | null;
        detail: string | null;
        at: Date | string;
      }>(
        `SELECT e.* FROM review_events e
           JOIN review_requests r ON r.id = e.request_id
          WHERE e.request_id = $1 AND r.case_id = $2 AND r.organisation_id = $3
          ORDER BY e.id ASC`,
        [requestId, resolved.value.caseId, resolved.value.organisationId]
      );
      return ok(
        rows.rows.map((r) => ({
          id: Number(r.id),
          requestId: r.request_id,
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

  /**
   * Asks for a review. Never produces a decision.
   *
   * Worth stating because it is the failure that would be hardest to notice: a
   * request that created a decision row on assignment, or on any path other
   * than a person deciding, would satisfy every status check in the system and
   * be a fabricated authorisation.
   */
  async createReviewRequest(
    context: RepositoryContext,
    input: CreateReviewRequestInput
  ): Promise<Result<ReviewQueueEntry>> {
    if (!this.#pool) return this.#noDatabase();

    const invalid = validateRequest(input);
    if (invalid) return refuse({ reason: "INVALID", detail: invalid });

    try {
      return await withTransaction(this.#pool, async (tx) => {
        const resolved = await this.#resolve(tx, context, input.caseId, MAY_WRITE);
        if (!resolved.ok) return refuse<ReviewQueueEntry>(resolved.refusal);

        const assignTo = input.assignTo ?? null;
        const inserted = await tx.query<RequestRow>(
          `INSERT INTO review_requests (
             organisation_id, case_id, subject_type, subject_id, subject_digest,
             execution_id, requires_professional, reserved_activity, required_role,
             reason, priority, requested_by, assigned_to, assigned_at,
             due_deadline_id, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
                   CASE WHEN $13::uuid IS NULL THEN NULL ELSE now() END,$14,'open')
           RETURNING ${REQUEST_COLUMNS.replace(/r\./g, "")}`,
          [
            resolved.value.organisationId,
            resolved.value.caseId,
            input.subjectType,
            input.subjectId,
            input.subjectDigest ?? null,
            input.executionId ?? null,
            input.requiresProfessional ?? false,
            input.reservedActivity ?? null,
            input.requiredRole ?? null,
            input.reason,
            input.priority ?? "normal",
            context.actorId,
            assignTo,
            input.dueDeadlineId ?? null,
          ]
        );

        const row = inserted.rows[0]!;
        await this.#event(tx, row.id, "requested", context, input.reason);
        if (assignTo) {
          await this.#event(tx, row.id, "assigned", context, `assigned to ${assignTo}`);
        }
        await this.#audit(tx, context, "review.requested", row.id, {
          caseId: resolved.value.caseId,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          requiresProfessional: input.requiresProfessional ?? false,
          reservedActivity: input.reservedActivity ?? null,
        });

        const [record] = await this.#hydrate(tx, [row]);
        return ok(record!);
      });
    } catch (error) {
      return this.#unreachable(error);
    }
  }

  /**
   * Records a decision, its event and its audit entry, or none of them.
   *
   * The order below is deliberate. Authority is checked against the request as
   * it exists in the database, not against what the caller believes about it,
   * and the decision row is written before the request's status moves — so a
   * request can never read as decided without the decision that says so.
   */
  async recordReviewDecision(
    context: RepositoryContext,
    input: RecordReviewDecisionInput
  ): Promise<Result<{ request: ReviewQueueEntry; decision: ReviewDecisionRecord }>> {
    if (!this.#pool) return this.#noDatabase();

    if (!DECISIONS.includes(input.decision)) {
      return refuse({ reason: "INVALID", detail: `${input.decision} is not a review decision` });
    }
    if (!input.basis.trim()) {
      return refuse({
        reason: "INVALID",
        detail: "a decision must state its basis; an approval with no reasoning cannot be reviewed by anyone else",
      });
    }
    if (!isDigest(input.subjectDigest)) {
      return refuse({
        reason: "INVALID",
        detail: "a decision must record a sha-256 of what the reviewer looked at",
      });
    }

    try {
      return await withTransaction(this.#pool, async (tx) => {
        const resolved = await this.#resolve(tx, context, input.caseId, MAY_WRITE);
        if (!resolved.ok) return refuse(resolved.refusal);

        const found = await tx.query<RequestRow>(
          `SELECT ${REQUEST_COLUMNS} FROM review_requests r
            WHERE r.id = $1 AND r.case_id = $2 AND r.organisation_id = $3
            FOR UPDATE`,
          [input.requestId, resolved.value.caseId, resolved.value.organisationId]
        );
        const request = found.rows[0];
        if (!request) return refuse({ reason: "NOT_PERSISTED", detail: CASE_NOT_AVAILABLE });

        // Authority against the stored request, including separation of duty.
        const authority = mayDecide({
          requiresProfessional: request.requires_professional,
          reservedActivity: request.reserved_activity,
          requiredRole: request.required_role,
          actorRole: resolved.value.membership.role,
          regulatoryReference: resolved.value.membership.regulatoryReference,
          requestedBy: request.requested_by,
          actorId: context.actorId,
        });
        if (!authority.permitted) {
          return refuse({ reason: "FORBIDDEN", detail: authority.because! });
        }

        if (!ACTIVE_STATUSES.includes(request.status)) {
          return refuse({
            reason: "CONFLICT",
            detail: `this review is ${request.status} and can no longer be decided`,
          });
        }
        if (Number(request.version) !== input.expectedVersion) {
          return refuse({
            reason: "CONFLICT",
            detail:
              "this review changed after it was read; re-read it and check the current state before deciding",
          });
        }

        // The immutable record first. `one_decision_per_request` is the real
        // guard against two terminal decisions and does not depend on the
        // version token, the row lock or anything this code does.
        const written = await tx.query<{
          id: string;
          request_id: string;
          decision: Decision;
          basis: string;
          decided_by: string;
          decided_by_role: string;
          regulatory_reference: string | null;
          decided_at: Date | string;
          subject_digest: string;
        }>(
          `INSERT INTO review_decisions (request_id, decision, basis, decided_by,
             decided_by_role, regulatory_reference, subject_digest)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [
            request.id,
            input.decision,
            input.basis,
            context.actorId,
            // Copied as at signing. A person's role changes, and the question
            // afterwards is what they were when they signed it.
            resolved.value.membership.role,
            resolved.value.membership.regulatoryReference,
            input.subjectDigest,
          ]
        );

        const updated = await tx.query<RequestRow>(
          `UPDATE review_requests
              SET status = 'decided', version = version + 1, updated_at = now()
            WHERE id = $1 AND version = $2
            RETURNING ${REQUEST_COLUMNS.replace(/r\./g, "")}`,
          [request.id, input.expectedVersion]
        );
        if (!updated.rows[0]) {
          throw new Error("the review changed while its decision was being recorded");
        }

        await this.#event(
          tx,
          request.id,
          "decided",
          context,
          `${input.decision}: ${input.basis}`
        );
        await this.#audit(tx, context, "review.decided", request.id, {
          caseId: resolved.value.caseId,
          decision: input.decision,
          basis: input.basis,
          decidedByRole: resolved.value.membership.role,
          regulatoryReference: resolved.value.membership.regulatoryReference,
          subjectDigest: input.subjectDigest,
          requestedBy: request.requested_by,
        });

        const row = written.rows[0]!;
        const [hydrated] = await this.#hydrate(tx, [updated.rows[0]!]);
        return ok({
          request: hydrated!,
          decision: {
            id: row.id,
            requestId: row.request_id,
            decision: row.decision,
            basis: row.basis,
            decidedBy: row.decided_by,
            decidedByRole: row.decided_by_role,
            regulatoryReference: row.regulatory_reference,
            decidedAt: iso(row.decided_at)!,
            subjectDigest: row.subject_digest,
          },
        });
      });
    } catch (error) {
      return this.#unreachable(error);
    }
  }

  /**
   * Assigns or unassigns a reviewer.
   *
   * Assignment is not a decision and never becomes one. It moves a request
   * between queue states and writes an event; nothing here can produce a
   * decision row, which is why the two are separate methods rather than one
   * method with a mode.
   */
  async reassignReview(
    context: RepositoryContext,
    input: ReassignReviewInput
  ): Promise<Result<ReviewQueueEntry>> {
    return this.#transition(context, input.caseId, input.requestId, input.expectedVersion, {
      set: (p) => {
        const to = p(input.assignTo);
        return `assigned_to = ${to}, assigned_at = CASE WHEN ${to}::uuid IS NULL THEN NULL ELSE now() END`;
      },
      event: input.assignTo ? "assigned" : "commented",
      detail: input.assignTo ? `assigned to ${input.assignTo}` : "assignment cleared",
      action: "review.reassigned",
      payload: { assignedTo: input.assignTo, detail: input.detail ?? null },
      requireActive: true,
    });
  }

  /** Withdraws a request. A withdrawal is not a refusal and records no decision. */
  async withdrawReviewRequest(
    context: RepositoryContext,
    input: WithdrawReviewInput
  ): Promise<Result<ReviewQueueEntry>> {
    if (!input.reason.trim()) {
      return refuse({ reason: "INVALID", detail: "a withdrawal must state why" });
    }
    return this.#transition(context, input.caseId, input.requestId, input.expectedVersion, {
      set: () => "status = 'withdrawn'",
      event: "withdrawn",
      detail: input.reason,
      action: "review.withdrawn",
      payload: { reason: input.reason },
      requireActive: true,
    });
  }

  /**
   * The shared shape of every non-decision transition.
   *
   * One implementation rather than three, because the parts that must not be
   * forgotten — tenancy, the version token, the event, the audit entry, the
   * transaction — are exactly the parts that get forgotten when each method
   * writes its own.
   */
  async #transition(
    context: RepositoryContext,
    caseId: string,
    requestId: string,
    expectedVersion: number,
    spec: {
      /** Builds the SET clause, numbering its own placeholders through `p`. */
      set: (p: (value: unknown) => string) => string;
      event: ReviewEventName;
      detail: string;
      action: string;
      payload: Record<string, unknown>;
      requireActive: boolean;
    }
  ): Promise<Result<ReviewQueueEntry>> {
    if (!this.#pool) return this.#noDatabase();
    try {
      return await withTransaction(this.#pool, async (tx) => {
        const resolved = await this.#resolve(tx, context, caseId, MAY_WRITE);
        if (!resolved.ok) return refuse<ReviewQueueEntry>(resolved.refusal);

        const found = await tx.query<RequestRow>(
          `SELECT ${REQUEST_COLUMNS} FROM review_requests r
            WHERE r.id = $1 AND r.case_id = $2 AND r.organisation_id = $3 FOR UPDATE`,
          [requestId, resolved.value.caseId, resolved.value.organisationId]
        );
        const request = found.rows[0];
        if (!request) return refuse({ reason: "NOT_PERSISTED", detail: CASE_NOT_AVAILABLE });

        if (spec.requireActive && !ACTIVE_STATUSES.includes(request.status)) {
          return refuse({
            reason: "CONFLICT",
            detail: `this review is ${request.status} and can no longer be changed`,
          });
        }
        if (Number(request.version) !== expectedVersion) {
          return refuse({
            reason: "CONFLICT",
            detail: "this review changed after it was read; re-read it before changing it",
          });
        }

        const params: unknown[] = [];
        const p = (value: unknown) => `$${params.push(value)}`;
        const set = spec.set(p);
        const idParam = p(requestId);
        const versionParam = p(expectedVersion);

        const updated = await tx.query<RequestRow>(
          `UPDATE review_requests
              SET ${set}, version = version + 1, updated_at = now()
            WHERE id = ${idParam} AND version = ${versionParam}
            RETURNING ${REQUEST_COLUMNS.replace(/r\./g, "")}`,
          params
        );
        if (!updated.rows[0]) {
          return refuse({ reason: "CONFLICT", detail: "this review changed before the write landed" });
        }

        await this.#event(tx, requestId, spec.event, context, spec.detail);
        await this.#audit(tx, context, spec.action, requestId, {
          caseId: resolved.value.caseId,
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

  async #event(
    sql: SqlExecutor,
    requestId: string,
    event: ReviewEventName,
    context: RepositoryContext,
    detail: string | null
  ): Promise<void> {
    await sql.query(
      "INSERT INTO review_events (request_id, event, actor_id, detail) VALUES ($1,$2,$3,$4)",
      [requestId, event, context.actorId, detail]
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
        "no database is configured for this instance, so no review is persisted. This is the state of this deployment, not a failure to load.",
    });
  }

  #unreachable<T>(error: unknown): Result<T> {
    return refuse({
      reason: "UNREACHABLE",
      detail: error instanceof Error ? error.message : "the review store could not be read",
    });
  }
}

export function validateRequest(input: CreateReviewRequestInput): string | null {
  if (!SUBJECT_TYPES.includes(input.subjectType)) {
    return `${input.subjectType} is not a review subject type`;
  }
  if (!input.subjectId.trim()) return "a review must name what is being reviewed";
  if (!input.reason.trim()) return "a review request must say why it is being asked for";
  if (input.priority !== undefined && !PRIORITIES.includes(input.priority)) {
    return `${input.priority} is not a priority`;
  }
  if (input.subjectDigest !== undefined && !isDigest(input.subjectDigest)) {
    return "a subject digest must be a sha-256";
  }
  // Mirrors `reserved_activities_require_a_professional`, so a caller gets a
  // sentence rather than a constraint name.
  if (input.reservedActivity && !input.requiresProfessional) {
    return "a reserved legal activity may only be reviewed under a professional requirement";
  }
  if (input.requiresProfessional && !["solicitor", "adviser"].includes(input.requiredRole ?? "")) {
    return "a review requiring a professional must name which professional role";
  }
  return null;
}

