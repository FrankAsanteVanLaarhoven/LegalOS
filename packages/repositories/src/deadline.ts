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
  mayConfirmProfessionally,
  ok,
  refuse,
  type RepositoryContext,
  type Result,
} from "./context.ts";
import {
  CERTAINTY_STATES,
  CLASSIFICATIONS,
  DETERMINISTIC_ORDER,
  DEADLINE_EVENTS,
  deriveAuthority,
  SOURCE_TYPES,
  VERIFICATION_STATES,
  type CertaintyState,
  type Classification,
  type DeadlineEventName,
  type DeadlineEventRecord,
  type DeadlineRecord,
  type SourceResolution,
  type SourceType,
  type VerificationState,
} from "./deadline-model.ts";

/**
 * The deadline repository.
 *
 * A domain boundary, not a table accessor. There is no `findMany`, no way to
 * pass a WHERE clause and no way to get a raw row out — every method is a
 * question somebody actually asks about a case, because a generic query method
 * is a hole through every guarantee this class makes. Tenancy in particular
 * cannot be enforced by a method whose filter the caller supplies.
 *
 * Three things are established before any deadline is read or written, in this
 * order and never any other:
 *
 *   1. which organisation the case actually belongs to, from the database
 *   2. whether that is the organisation the caller claims to be acting in
 *   3. whether the caller's membership of *that case's workspace* permits this
 *
 * Step 1 first is the whole point. Deriving the organisation from the caller's
 * context and then filtering by it would produce an empty result for a foreign
 * case — which looks like the same thing and is not, because the next method
 * written by the next person would forget the filter and nothing would catch it.
 *
 * What this repository will not do: emit a probability, a confidence, a risk
 * score or a percentage under any name. See `deriveAuthority`.
 */

/** Columns selected everywhere, so no read can quietly return less provenance. */
const COLUMNS = `
  d.id, d.case_id, d.organisation_id, d.classification, d.deadline_type,
  d.deadline_at, d.timezone, d.status, d.certainty_state, d.verification_state,
  d.source_type, d.source_id, d.source_locator, d.recorded_by, d.recorded_at,
  d.verified_by, d.verified_at, d.supersedes_id, d.created_at, d.updated_at`;

interface DeadlineRow {
  id: string;
  case_id: string;
  organisation_id: string;
  classification: Classification;
  deadline_type: string;
  deadline_at: Date | string;
  timezone: string;
  status: DeadlineRecord["status"];
  certainty_state: CertaintyState;
  verification_state: VerificationState;
  source_type: SourceType;
  source_id: string | null;
  source_locator: string | null;
  recorded_by: string;
  recorded_at: Date | string;
  verified_by: string | null;
  verified_at: Date | string | null;
  supersedes_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

const iso = (value: Date | string | null): string | null =>
  value === null ? null : value instanceof Date ? value.toISOString() : value;

/** A case, once the database has said which tenancy it belongs to. */
interface ResolvedCase {
  readonly caseId: string;
  readonly workspaceId: string;
  readonly organisationId: string;
  readonly membership: Membership;
}

export interface CreateDeadlineInput {
  readonly caseId: string;
  readonly deadlineType: string;
  readonly deadlineAt: string;
  readonly timezone?: string;
  readonly classification: Classification;
  readonly sourceType: SourceType;
  readonly sourceId?: string | null;
  readonly sourceLocator?: string | null;
  readonly certaintyState: CertaintyState;
  /** Why this is being recorded, kept on the event rather than the row. */
  readonly detail?: string;
}

export interface SupersedeDeadlineInput {
  readonly caseId: string;
  readonly deadlineId: string;
  /** Why the original no longer governs. Required — a correction with no reason is a mystery later. */
  readonly reason: string;
  readonly replacement: Omit<CreateDeadlineInput, "caseId" | "detail">;
}

export interface RecordVerificationInput {
  readonly caseId: string;
  readonly deadlineId: string;
  readonly state: Extract<
    VerificationState,
    "source_matched" | "professional_confirmed" | "disputed"
  >;
  /** What was checked, and where. Written to the event. */
  readonly basis: string;
  /** The locator the verifier actually used, when it differs from the recorded one. */
  readonly sourceLocator?: string;
  /** The row's `updated_at` as the caller last saw it. A stale value is refused. */
  readonly expectedUpdatedAt: string;
}

export interface RecordEventInput {
  readonly caseId: string;
  readonly deadlineId: string;
  readonly event: DeadlineEventName;
  readonly detail?: string;
}

export interface UpcomingOptions {
  readonly before?: string;
  readonly limit?: number;
}

export class DeadlineRepository {
  readonly #pool: PoolLike | null;

  /**
   * `null` means no database is configured.
   *
   * Modelled rather than thrown, because "this instance has no database" and
   * "the database refused" call for different words on a screen, and a surface
   * that cannot tell them apart will show the wrong one. DL-G6.
   */
  constructor(pool: PoolLike | null) {
    this.#pool = pool;
  }

  /* -------------------------------------------------------------- */
  /* Resolution                                                      */
  /* -------------------------------------------------------------- */

  /**
   * Establishes the case, its tenancy and the caller's standing in it.
   *
   * The order is the guarantee. A foreign case and a non-existent case return
   * the same refusal with the same words, so a caller cannot learn that a case
   * exists somewhere they cannot see it.
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
      // One branch, one message. Splitting these is the enumeration channel.
      return refuse({ reason: "NOT_PERSISTED", detail: CASE_NOT_AVAILABLE });
    }

    const membership = membershipFor(context.memberships, context.accountId, row.workspace_id);

    if (!membership) {
      // No membership of this case's workspace. Whether that is worth
      // explaining depends on whether the caller belongs to this organisation
      // at all: to a colleague in another team, "you cannot see this case" is
      // useful and discloses nothing they could not learn by asking. To someone
      // who supplied this organisation's id without belonging to it, the same
      // answer confirms a case exists here — so they get the not-found message
      // instead, and learn nothing.
      const belongs = await this.#belongsToOrganisation(sql, context, row.organization_id);
      return refuse(
        belongs
          ? {
              reason: "FORBIDDEN",
              detail: "no membership of the workspace this case belongs to",
            }
          : { reason: "NOT_PERSISTED", detail: CASE_NOT_AVAILABLE }
      );
    }

    if (!permitted.includes(membership.role)) {
      return refuse({
        reason: "FORBIDDEN",
        detail: `the ${membership.role} role may not perform this operation on this case`,
      });
    }

    return ok({
      caseId: row.id,
      workspaceId: row.workspace_id,
      organisationId: row.organization_id,
      membership,
    });
  }

  /**
   * Whether the caller holds a live membership anywhere in this organisation.
   *
   * Asked only on the refusal path, and only to choose between two refusals —
   * never to grant anything. The organisation id in a context is a claim, and
   * this is what stops the claim alone from confirming that a case exists.
   */
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
   * Resolves source references for a batch of rows.
   *
   * One query per source domain rather than per row, and a set difference
   * afterwards, so a case with forty deadlines does not make forty round trips.
   * A row citing a source id that appears in neither domain is `dangling`,
   * which `deriveAuthority` treats as fatal to authority.
   */
  async #resolveSources(
    sql: SqlExecutor,
    rows: readonly DeadlineRow[]
  ): Promise<Map<string, SourceResolution>> {
    const referenced = [...new Set(rows.map((r) => r.source_id).filter((id): id is string => !!id))];
    const resolution = new Map<string, SourceResolution>();
    if (referenced.length === 0) return resolution;

    // Text ids against uuid columns: cast rather than compare, because a
    // non-uuid string would otherwise raise instead of simply not matching.
    const [evidence, sources] = await Promise.all([
      sql.query<{ id: string }>(
        "SELECT id::text AS id FROM evidence_items WHERE id::text = ANY($1)",
        [referenced]
      ),
      sql.query<{ id: string }>(
        "SELECT id::text AS id FROM legal_sources WHERE id::text = ANY($1)",
        [referenced]
      ),
    ]);

    const known = new Set([...evidence.rows, ...sources.rows].map((r) => r.id));
    for (const id of referenced) resolution.set(id, known.has(id) ? "resolved" : "dangling");
    return resolution;
  }

  #toRecord(row: DeadlineRow, sources: Map<string, SourceResolution>, supersededBy: string | null) {
    const sourceResolution: SourceResolution = row.source_id
      ? (sources.get(row.source_id) ?? "dangling")
      : "unreferenced";

    const authority = deriveAuthority({
      classification: row.classification,
      status: row.status,
      verificationState: row.verification_state,
      sourceType: row.source_type,
      sourceLocator: row.source_locator,
      sourceResolution,
    });

    return {
      id: row.id,
      caseId: row.case_id,
      organisationId: row.organisation_id,
      classification: row.classification,
      deadlineType: row.deadline_type,
      deadlineAt: iso(row.deadline_at)!,
      timezone: row.timezone,
      status: row.status,
      certaintyState: row.certainty_state,
      verificationState: row.verification_state,
      sourceType: row.source_type,
      sourceId: row.source_id,
      sourceLocator: row.source_locator,
      sourceResolution,
      recordedBy: row.recorded_by,
      recordedAt: iso(row.recorded_at)!,
      verifiedBy: row.verified_by,
      verifiedAt: iso(row.verified_at),
      supersedesId: row.supersedes_id,
      supersededById: supersededBy,
      createdAt: iso(row.created_at)!,
      updatedAt: iso(row.updated_at)!,
      authoritative: authority.authoritative,
      authorityWithheldBecause: authority.withheldBecause,
    } satisfies DeadlineRecord;
  }

  async #hydrate(
    sql: SqlExecutor,
    rows: readonly DeadlineRow[]
  ): Promise<readonly DeadlineRecord[]> {
    const sources = await this.#resolveSources(sql, rows);

    // The inverse of `supersedes_id`, so a reader holding a superseded deadline
    // can reach its replacement without a second query they have to remember.
    const ids = rows.map((r) => r.id);
    const replacements = new Map<string, string>();
    if (ids.length > 0) {
      const found = await sql.query<{ id: string; supersedes_id: string }>(
        "SELECT id, supersedes_id FROM deadlines WHERE supersedes_id = ANY($1)",
        [ids]
      );
      for (const r of found.rows) replacements.set(r.supersedes_id, r.id);
    }

    return rows.map((row) => this.#toRecord(row, sources, replacements.get(row.id) ?? null));
  }

  /* -------------------------------------------------------------- */
  /* Reads                                                           */
  /* -------------------------------------------------------------- */

  /** Every deadline on a case, including closed and superseded ones. The history read. */
  async readDeadlinesForCase(
    context: RepositoryContext,
    caseId: string
  ): Promise<Result<readonly DeadlineRecord[]>> {
    return this.#read(context, caseId, "");
  }

  /**
   * The operational read: what is still open.
   *
   * Superseded and withdrawn rows are excluded here and remain reachable
   * through `readDeadlinesForCase`. They are excluded rather than deleted
   * because what was believed on the day of a filing is frequently the
   * question, and they are excluded rather than shown because two dates for one
   * obligation, with nothing saying which governs, is worse than one.
   */
  async readOpenDeadlinesForCase(
    context: RepositoryContext,
    caseId: string
  ): Promise<Result<readonly DeadlineRecord[]>> {
    // Matches `deadlines_case_open_idx`, which is partial on status = 'open'.
    return this.#read(context, caseId, "AND d.status = 'open'");
  }

  async #read(
    context: RepositoryContext,
    caseId: string,
    extra: string
  ): Promise<Result<readonly DeadlineRecord[]>> {
    if (!this.#pool) return this.#noDatabase();
    try {
      const resolved = await this.#resolve(this.#pool, context, caseId, MAY_READ);
      if (!resolved.ok) return refuse(resolved.refusal);

      // Both scoping columns in the predicate, not just the case. The case has
      // already been proved to belong to this organisation; repeating it means
      // a case that was somehow moved cannot leak its old deadlines.
      const rows = await this.#pool.query<DeadlineRow>(
        `SELECT ${COLUMNS} FROM deadlines d
          WHERE d.case_id = $1 AND d.organisation_id = $2 ${extra}
          ${DETERMINISTIC_ORDER}`,
        [resolved.value.caseId, resolved.value.organisationId]
      );

      return ok(await this.#hydrate(this.#pool, rows.rows));
    } catch (error) {
      return this.#unreachable(error);
    }
  }

  /**
   * Open deadlines across the caller's organisation, soonest first.
   *
   * Scoped by organisation in the query and then filtered to the workspaces the
   * caller actually belongs to. Both are necessary: the first keeps another
   * tenancy's rows out of the result, the second keeps a member of one
   * workspace from reading the caseload of another in the same organisation.
   */
  async readUpcomingDeadlines(
    context: RepositoryContext,
    options: UpcomingOptions = {}
  ): Promise<Result<readonly DeadlineRecord[]>> {
    if (!this.#pool) return this.#noDatabase();

    const workspaces = context.memberships
      .filter((m) => m.removedAt === null && MAY_READ.includes(m.role))
      .filter((m) => m.accountId === context.accountId)
      .map((m) => m.workspaceId);

    if (workspaces.length === 0) return ok([]);

    const limit = Math.min(Math.max(options.limit ?? 50, 1), 500);

    try {
      const rows = await this.#pool.query<DeadlineRow>(
        `SELECT ${COLUMNS} FROM deadlines d
           JOIN cases c ON c.id = d.case_id
          WHERE d.organisation_id = $1
            AND c.workspace_id = ANY($2)
            AND d.status = 'open'
            AND ($3::timestamptz IS NULL OR d.deadline_at <= $3::timestamptz)
          ${DETERMINISTIC_ORDER}
          LIMIT $4`,
        [context.organisationId, workspaces, options.before ?? null, limit]
      );
      return ok(await this.#hydrate(this.#pool, rows.rows));
    } catch (error) {
      return this.#unreachable(error);
    }
  }

  /** The recorded history of one deadline. */
  async readDeadlineEvents(
    context: RepositoryContext,
    caseId: string,
    deadlineId: string
  ): Promise<Result<readonly DeadlineEventRecord[]>> {
    if (!this.#pool) return this.#noDatabase();
    try {
      const resolved = await this.#resolve(this.#pool, context, caseId, MAY_READ);
      if (!resolved.ok) return refuse(resolved.refusal);

      const rows = await this.#pool.query<{
        id: string;
        deadline_id: string;
        event: DeadlineEventName;
        actor_id: string | null;
        detail: string | null;
        at: Date | string;
      }>(
        `SELECT e.* FROM deadline_events e
           JOIN deadlines d ON d.id = e.deadline_id
          WHERE e.deadline_id = $1 AND d.case_id = $2 AND d.organisation_id = $3
          ORDER BY e.id ASC`,
        [deadlineId, resolved.value.caseId, resolved.value.organisationId]
      );

      return ok(
        rows.rows.map((r) => ({
          id: Number(r.id),
          deadlineId: r.deadline_id,
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
   * Records a deadline, its first event and its audit entry, or none of them.
   *
   * One transaction covering all three. A deadline with no event is a date
   * nobody can attribute; a deadline with no audit entry is a change to a case
   * file that left no independent trace. Either is worse than the write having
   * failed, because both look like success.
   */
  async createDeadline(
    context: RepositoryContext,
    input: CreateDeadlineInput
  ): Promise<Result<DeadlineRecord>> {
    if (!this.#pool) return this.#noDatabase();

    const invalid = validateCreate(input);
    if (invalid) return refuse({ reason: "INVALID", detail: invalid });

    try {
      return await withTransaction(this.#pool, async (tx) => {
        const resolved = await this.#resolve(tx, context, input.caseId, MAY_WRITE);
        if (!resolved.ok) return refuse<DeadlineRecord>(resolved.refusal);

        // A caller may not create a deadline already claiming to be checked.
        // Verification is a separate act by a separate person, and allowing it
        // in one call would let a caseworker record a professional confirmation
        // that no professional made.
        const inserted = await tx.query<DeadlineRow>(
          `INSERT INTO deadlines (
             organisation_id, case_id, deadline_type, deadline_at, timezone,
             classification, source_type, source_id, source_locator,
             recorded_by, verification_state, certainty_state, status)
           VALUES ($1,$2,$3,$4::timestamptz,$5,$6,$7,$8,$9,$10,'unverified',$11,'open')
           RETURNING ${COLUMNS.replace(/d\./g, "")}`,
          [
            resolved.value.organisationId,
            resolved.value.caseId,
            input.deadlineType,
            input.deadlineAt,
            input.timezone ?? "Europe/London",
            input.classification,
            input.sourceType,
            input.sourceId ?? null,
            input.sourceLocator ?? null,
            context.actorId,
            input.certaintyState,
          ]
        );

        const row = inserted.rows[0]!;
        await this.#event(tx, row.id, "recorded", context, input.detail ?? null);
        await this.#audit(tx, context, "deadline.created", row.id, {
          caseId: resolved.value.caseId,
          classification: input.classification,
          deadlineAt: input.deadlineAt,
          sourceType: input.sourceType,
          sourceLocator: input.sourceLocator ?? null,
        });

        const [record] = await this.#hydrate(tx, [row]);
        return ok(record!);
      });
    } catch (error) {
      return this.#unreachable(error);
    }
  }

  /**
   * Replaces a deadline with a later one, keeping the original intact.
   *
   * The original's date is never edited. A tribunal extending a direction
   * produces a new row pointing back at the old one, and the old one is closed
   * as `superseded` — so the history of what was believed, and when, survives a
   * question asked two years later.
   */
  async supersedeDeadline(
    context: RepositoryContext,
    input: SupersedeDeadlineInput
  ): Promise<Result<{ original: DeadlineRecord; replacement: DeadlineRecord }>> {
    if (!this.#pool) return this.#noDatabase();

    if (!input.reason.trim()) {
      return refuse({ reason: "INVALID", detail: "a supersession must state why" });
    }
    const invalid = validateCreate({ ...input.replacement, caseId: input.caseId });
    if (invalid) return refuse({ reason: "INVALID", detail: invalid });

    try {
      return await withTransaction(this.#pool, async (tx) => {
        const resolved = await this.#resolve(tx, context, input.caseId, MAY_WRITE);
        if (!resolved.ok) return refuse(resolved.refusal);

        const existing = await tx.query<DeadlineRow>(
          `SELECT ${COLUMNS} FROM deadlines d
            WHERE d.id = $1 AND d.case_id = $2 AND d.organisation_id = $3
            FOR UPDATE`,
          [input.deadlineId, resolved.value.caseId, resolved.value.organisationId]
        );
        const original = existing.rows[0];
        if (!original) {
          return refuse({ reason: "NOT_PERSISTED", detail: CASE_NOT_AVAILABLE });
        }
        if (original.status === "superseded") {
          return refuse({
            reason: "CONFLICT",
            detail: "this deadline has already been superseded",
          });
        }

        const replacement = await tx.query<DeadlineRow>(
          `INSERT INTO deadlines (
             organisation_id, case_id, deadline_type, deadline_at, timezone,
             classification, source_type, source_id, source_locator,
             recorded_by, verification_state, certainty_state, status, supersedes_id)
           VALUES ($1,$2,$3,$4::timestamptz,$5,$6,$7,$8,$9,$10,'unverified',$11,'open',$12)
           RETURNING ${COLUMNS.replace(/d\./g, "")}`,
          [
            resolved.value.organisationId,
            resolved.value.caseId,
            input.replacement.deadlineType,
            input.replacement.deadlineAt,
            input.replacement.timezone ?? original.timezone,
            input.replacement.classification,
            input.replacement.sourceType,
            input.replacement.sourceId ?? null,
            input.replacement.sourceLocator ?? null,
            context.actorId,
            input.replacement.certaintyState,
            original.id,
          ]
        );

        // The only permitted change to the original: its status. The date, the
        // provenance and the verification are all untouched.
        //
        // Verification deliberately stays as it was. Moving it to `superseded`
        // was the first version, and it made superseding a professionally
        // confirmed deadline impossible: `verification_names_a_verifier`
        // requires `verified_by` to be set exactly when the state is
        // `professional_confirmed` or `disputed`, so the write violated the
        // constraint — and the only way to satisfy it would have been to null
        // the verifier, erasing the record of which solicitor confirmed the
        // original. A tribunal extending a direction a solicitor had checked is
        // an ordinary Tuesday, and who checked it is the part somebody may have
        // to defend.
        //
        // `superseded_deadlines_are_closed` is one-directional and permits
        // this: it requires a superseded *verification* to have a closed status,
        // not the reverse. Authority is withheld on `status` alone.
        const closed = await tx.query<DeadlineRow>(
          `UPDATE deadlines
              SET status = 'superseded', updated_at = date_trunc('milliseconds', now())
            WHERE id = $1 RETURNING ${COLUMNS.replace(/d\./g, "")}`,
          [original.id]
        );

        await this.#event(tx, original.id, "superseded", context, input.reason);
        await this.#event(
          tx,
          replacement.rows[0]!.id,
          "recorded",
          context,
          `supersedes ${original.id}: ${input.reason}`
        );
        await this.#audit(tx, context, "deadline.superseded", original.id, {
          caseId: resolved.value.caseId,
          replacedBy: replacement.rows[0]!.id,
          reason: input.reason,
          originalDeadlineAt: iso(original.deadline_at),
          replacementDeadlineAt: input.replacement.deadlineAt,
        });

        const hydrated = await this.#hydrate(tx, [closed.rows[0]!, replacement.rows[0]!]);
        return ok({ original: hydrated[0]!, replacement: hydrated[1]! });
      });
    } catch (error) {
      return this.#unreachable(error);
    }
  }

  /**
   * Records that somebody checked a date against its source.
   *
   * Optimistic on `updated_at`: the caller passes the value they last saw, and
   * a write against a row that has moved since is refused rather than applied.
   * Two people verifying the same date from two screens is not a rare case —
   * it is what happens when a deadline matters.
   *
   * The comparison truncates to milliseconds, because that is the resolution
   * the token actually has. `updated_at` is a timestamptz holding microseconds,
   * and a caller only ever sees it after a round trip through a JavaScript
   * date, which cannot hold them. Comparing the untruncated value would refuse
   * every verification ever attempted while looking exactly like correct
   * concurrency control — which is how the first version of this was written,
   * and what the integration test caught.
   *
   * A limitation worth stating: the schema's `verification_names_a_verifier`
   * constraint permits `verified_by` only for `professional_confirmed` and
   * `disputed`. So for `source_matched` the verifier's identity lives in the
   * event rather than on the row, and a reader wanting to know who matched it
   * must read the history.
   */
  async recordDeadlineVerification(
    context: RepositoryContext,
    input: RecordVerificationInput
  ): Promise<Result<DeadlineRecord>> {
    if (!this.#pool) return this.#noDatabase();

    if (!input.basis.trim()) {
      return refuse({ reason: "INVALID", detail: "a verification must state what was checked" });
    }
    if (!["source_matched", "professional_confirmed", "disputed"].includes(input.state)) {
      return refuse({ reason: "INVALID", detail: `${input.state} is not a verification a caller may record` });
    }

    try {
      return await withTransaction(this.#pool, async (tx) => {
        const resolved = await this.#resolve(tx, context, input.caseId, MAY_WRITE);
        if (!resolved.ok) return refuse<DeadlineRecord>(resolved.refusal);

        if (
          input.state === "professional_confirmed" &&
          !mayConfirmProfessionally(resolved.value.membership)
        ) {
          return refuse({
            reason: "FORBIDDEN",
            detail:
              "a professional confirmation requires a regulated role with a registration on record",
          });
        }

        // `verification_names_a_verifier` permits `verified_by` only for
        // `professional_confirmed` and `disputed`, so the statement differs by
        // state. Placeholders are numbered by building the parameter list as
        // the SQL is assembled — writing both numbering schemes by hand is how
        // one branch ends up referring to a parameter that is not passed.
        const names = input.state === "professional_confirmed" || input.state === "disputed";
        const params: unknown[] = [input.state];
        const p = (v: unknown) => `$${params.push(v)}`;

        const verifier = names ? p(context.actorId) : "NULL";
        const updated = await tx.query<DeadlineRow>(
          `UPDATE deadlines
              SET verification_state = $1,
                  verified_by = ${verifier},
                  verified_at = ${names ? "now()" : "NULL"},
                  source_locator = COALESCE(${p(input.sourceLocator ?? null)}::text, source_locator),
                  updated_at = date_trunc('milliseconds', now())
            WHERE id = ${p(input.deadlineId)}
              AND case_id = ${p(resolved.value.caseId)}
              AND organisation_id = ${p(resolved.value.organisationId)}
              AND date_trunc('milliseconds', updated_at) = ${p(input.expectedUpdatedAt)}::timestamptz
            RETURNING ${COLUMNS.replace(/d\./g, "")}`,
          params
        );

        const row = updated.rows[0];
        if (!row) {
          // Either the row is not this caller's to touch, or somebody else
          // wrote to it since this caller read it. Distinguished below, because
          // the two need different words.
          const exists = await tx.query<{ id: string }>(
            "SELECT id FROM deadlines WHERE id = $1 AND case_id = $2 AND organisation_id = $3",
            [input.deadlineId, resolved.value.caseId, resolved.value.organisationId]
          );
          return exists.rows[0]
            ? refuse({
                reason: "CONFLICT",
                detail:
                  "this deadline changed after it was read; re-read it and check the current state before verifying",
              })
            : refuse({ reason: "NOT_PERSISTED", detail: CASE_NOT_AVAILABLE });
        }

        await this.#event(
          tx,
          row.id,
          input.state === "disputed" ? "disputed" : "verified",
          context,
          input.basis
        );
        await this.#audit(tx, context, "deadline.verified", row.id, {
          caseId: resolved.value.caseId,
          state: input.state,
          basis: input.basis,
          role: resolved.value.membership.role,
          regulatoryReference: resolved.value.membership.regulatoryReference,
        });

        const [record] = await this.#hydrate(tx, [row]);
        return ok(record!);
      });
    } catch (error) {
      return this.#unreachable(error);
    }
  }

  /** Appends an event to a deadline's history, with its audit entry. */
  async recordDeadlineEvent(
    context: RepositoryContext,
    input: RecordEventInput
  ): Promise<Result<DeadlineEventRecord>> {
    if (!this.#pool) return this.#noDatabase();
    if (!DEADLINE_EVENTS.includes(input.event)) {
      return refuse({ reason: "INVALID", detail: `${input.event} is not a deadline event` });
    }

    try {
      return await withTransaction(this.#pool, async (tx) => {
        const resolved = await this.#resolve(tx, context, input.caseId, MAY_WRITE);
        if (!resolved.ok) return refuse<DeadlineEventRecord>(resolved.refusal);

        const owned = await tx.query<{ id: string }>(
          "SELECT id FROM deadlines WHERE id = $1 AND case_id = $2 AND organisation_id = $3",
          [input.deadlineId, resolved.value.caseId, resolved.value.organisationId]
        );
        if (!owned.rows[0]) {
          return refuse({ reason: "NOT_PERSISTED", detail: CASE_NOT_AVAILABLE });
        }

        const written = await this.#event(
          tx,
          input.deadlineId,
          input.event,
          context,
          input.detail ?? null
        );
        await this.#audit(tx, context, "deadline.event", input.deadlineId, {
          caseId: resolved.value.caseId,
          event: input.event,
          detail: input.detail ?? null,
        });
        return ok(written);
      });
    } catch (error) {
      return this.#unreachable(error);
    }
  }

  /* -------------------------------------------------------------- */

  async #event(
    sql: SqlExecutor,
    deadlineId: string,
    event: DeadlineEventName,
    context: RepositoryContext,
    detail: string | null
  ): Promise<DeadlineEventRecord> {
    const written = await sql.query<{
      id: string;
      deadline_id: string;
      event: DeadlineEventName;
      actor_id: string | null;
      detail: string | null;
      at: Date | string;
    }>(
      `INSERT INTO deadline_events (deadline_id, event, actor_id, detail)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [deadlineId, event, context.actorId, detail]
    );
    const row = written.rows[0]!;
    return {
      id: Number(row.id),
      deadlineId: row.deadline_id,
      event: row.event,
      actorId: row.actor_id,
      detail: row.detail,
      at: iso(row.at)!,
    };
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
        "no database is configured for this instance, so no deadline is persisted. This is the state of this deployment, not a failure to load.",
    });
  }

  #unreachable<T>(error: unknown): Result<T> {
    return refuse({
      reason: "UNREACHABLE",
      detail: error instanceof Error ? error.message : "the deadline store could not be read",
    });
  }
}

/**
 * Validation that does not need a database.
 *
 * Returns the first problem rather than a list: a caller that cannot proceed
 * needs to know why, and a form showing six simultaneous complaints about one
 * field is not more informative than one.
 */
function validateCreate(input: CreateDeadlineInput): string | null {
  if (!CLASSIFICATIONS.includes(input.classification)) {
    return `${input.classification} is not a deadline classification`;
  }
  if (!SOURCE_TYPES.includes(input.sourceType)) {
    return `${input.sourceType} is not a source type`;
  }
  if (!CERTAINTY_STATES.includes(input.certaintyState)) {
    return `${input.certaintyState} is not a certainty state`;
  }
  if (!input.deadlineType.trim()) return "a deadline must say what kind of obligation it is";
  if (Number.isNaN(Date.parse(input.deadlineAt))) {
    return `${input.deadlineAt} is not a date this system can read`;
  }
  if (input.timezone !== undefined && !isTimezone(input.timezone)) {
    // "4pm on the 14th" is a different moment in London and in Lagos, and a
    // client may be reading it in the second.
    return `${input.timezone} is not a timezone this system recognises`;
  }
  if (input.sourceType === "calculated" && input.certaintyState === "exact") {
    return "a date arrived at by calculation cannot be recorded as exact";
  }
  // Mirrors `authoritative_deadlines_cite_a_source`. Checked here as well as in
  // the database so a caller gets a sentence rather than a constraint name.
  const binding = !["internal_target", "eligibility_monitoring"].includes(input.classification);
  if (binding && (input.sourceType === "unknown" || !input.sourceLocator?.trim())) {
    return "a deadline that binds must say where it came from and where to find it";
  }
  return null;
}

function isTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export { validateCreate as __validateCreate };
