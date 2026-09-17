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
import { NoStorage, sha256, type EvidenceStorage } from "./evidence-storage.ts";

/**
 * The evidence repository.
 *
 * Everything else in the platform cites this domain, so the distinctions it
 * keeps are the ones every other citation inherits:
 *
 *   * The logical item is not the file. A corrected scan is a new version of
 *     the same item, and every citation to that item stays valid.
 *   * A row is not availability. A file is `pending` until its bytes are
 *     written, and nothing reports an item as available evidence before then.
 *   * Digest verification is not source authenticity is not professional
 *     acceptance. Three claims, three states, and the weakest may never stand
 *     in for the strongest.
 *
 * Storage and the database are two systems with no shared transaction. See
 * `evidence-storage.ts` for the order and what it costs.
 */

export const EVIDENCE_TYPES = [
  "identity_document",
  "correspondence",
  "decision_letter",
  "medical_report",
  "expert_report",
  "witness_statement",
  "financial_record",
  "employment_record",
  "photograph",
  "audio",
  "video",
  "messaging_export",
  "country_evidence",
  "court_document",
  "other",
] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

/** How an item is known to be what it claims. The refined vocabulary. */
export const SOURCE_CLASSIFICATIONS = [
  "person_reported",
  "document_supported",
  "professional_confirmed",
  "model_inferred",
] as const;
export type SourceClassification = (typeof SOURCE_CLASSIFICATIONS)[number];

/**
 * Four separate claims, never one flag.
 *
 * `digest_verified` says the bytes are the bytes. It says nothing about whether
 * the document is genuine (`source_verified`) or whether a qualified person
 * accepts what it shows (`professionally_verified`). Collapsing them would let
 * a hash comparison stand in for a solicitor's judgement.
 */
export const VERIFICATION_STATES = [
  "unverified",
  "digest_verified",
  "source_verified",
  "professionally_verified",
  "disputed",
  "unavailable",
  "superseded",
] as const;
export type EvidenceVerificationState = (typeof VERIFICATION_STATES)[number];

export const ACQUISITIONS = [
  "client_supplied",
  "solicitor_supplied",
  "authority_supplied",
  "court_supplied",
  "system_generated",
  "model_derived",
  "imported",
  "photographed",
  "scanned",
] as const;
export type Acquisition = (typeof ACQUISITIONS)[number];

export const AVAILABILITY = ["pending", "available", "unavailable", "quarantined"] as const;
export type Availability = (typeof AVAILABILITY)[number];

export const EVIDENCE_EVENTS = [
  "created",
  "provenance_recorded",
  "file_attached",
  "file_available",
  "file_superseded",
  "digest_verified",
  "source_verified",
  "professionally_verified",
  "disputed",
  "unavailable",
  "derivation_recorded",
  "commented",
] as const;
export type EvidenceEventName = (typeof EVIDENCE_EVENTS)[number];

export const MAY_HANDLE_EVIDENCE = ["caseworker", "adviser", "solicitor", "admin"] as const;

export interface EvidenceFileRecord {
  readonly id: string;
  readonly evidenceId: string;
  readonly version: number;
  readonly storageProvider: string;
  readonly originalFilename: string | null;
  readonly mediaType: string;
  readonly byteSize: number;
  readonly digest: string;
  readonly digestAlgorithm: string;
  readonly uploadedBy: string;
  readonly uploadedAt: string;
  readonly availability: Availability;
  readonly scanState: string;
  readonly encryptionState: string;
  readonly supersededById: string | null;
}

export interface EvidenceProvenanceRecord {
  readonly id: string;
  readonly evidenceId: string;
  readonly acquisition: Acquisition;
  readonly sourceActor: string | null;
  readonly sourceOrganisation: string | null;
  readonly acquiredAt: string | null;
  readonly originalLocator: string | null;
  readonly custodyNote: string | null;
  readonly assertedBy: string;
  readonly assertedAt: string;
  readonly externalReference: string | null;
  readonly executionId: string | null;
  readonly supersedesId: string | null;
  readonly current: boolean;
}

export interface EvidenceRecord {
  readonly id: string;
  readonly organisationId: string;
  readonly caseId: string;
  readonly evidenceType: EvidenceType;
  readonly title: string;
  readonly description: string | null;
  readonly status: string;
  readonly sourceClassification: SourceClassification;
  readonly verificationState: EvidenceVerificationState;
  readonly sensitivity: string;
  readonly retentionState: string;
  readonly createdBy: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
  readonly currentFileId: string | null;
  readonly files: readonly EvidenceFileRecord[];
  readonly provenance: readonly EvidenceProvenanceRecord[];
  /**
   * Whether retrievable bytes back this item now. Derived on every read from
   * the current file's availability — never stored, because a stored flag goes
   * on saying yes after the file it described stopped being there.
   */
  readonly available: boolean;
}

export interface EvidenceEventRecord {
  readonly id: number;
  readonly evidenceId: string;
  readonly event: EvidenceEventName;
  readonly actorId: string | null;
  readonly detail: string | null;
  readonly at: string;
}

const ITEM_COLUMNS = `
  e.id, e.organisation_id, e.case_id, e.evidence_type, e.title, e.description,
  e.status, e.source_classification, e.verification_state, e.sensitivity,
  e.retention_state, e.created_by, e.created_at, e.updated_at, e.version,
  e.current_file_id`;

interface ItemRow {
  id: string;
  organisation_id: string;
  case_id: string;
  evidence_type: EvidenceType;
  title: string;
  description: string | null;
  status: string;
  source_classification: SourceClassification;
  verification_state: EvidenceVerificationState;
  sensitivity: string;
  retention_state: string;
  created_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  version: number;
  current_file_id: string | null;
}

const iso = (v: Date | string | null): string | null =>
  v === null ? null : v instanceof Date ? v.toISOString() : v;

interface ResolvedCase {
  readonly caseId: string;
  readonly workspaceId: string;
  readonly organisationId: string;
  readonly membership: Membership;
}

export interface CreateEvidenceInput {
  readonly caseId: string;
  readonly evidenceType: EvidenceType;
  readonly title: string;
  readonly description?: string | null;
  readonly sourceClassification?: SourceClassification;
  readonly sensitivity?: "standard" | "sensitive" | "special_category";
  readonly provenance: {
    readonly acquisition: Acquisition;
    readonly sourceActor?: string | null;
    readonly sourceOrganisation?: string | null;
    readonly acquiredAt?: string | null;
    readonly originalLocator?: string | null;
    readonly custodyNote?: string | null;
    readonly externalReference?: string | null;
    readonly executionId?: string | null;
  };
}

export interface AttachFileInput {
  readonly caseId: string;
  readonly evidenceId: string;
  readonly bytes: Uint8Array;
  readonly mediaType: string;
  readonly originalFilename?: string | null;
  readonly expectedVersion: number;
}

export interface VerifyEvidenceInput {
  readonly caseId: string;
  readonly evidenceId: string;
  readonly expectedVersion: number;
  /** Which claim is being made. Digest verification recomputes; the others are judgements. */
  readonly dimension: "digest" | "source" | "professional";
  readonly basis?: string;
}

export interface RecordProvenanceInput {
  readonly caseId: string;
  readonly evidenceId: string;
  readonly acquisition: Acquisition;
  readonly sourceActor?: string | null;
  readonly custodyNote?: string | null;
  readonly originalLocator?: string | null;
  readonly executionId?: string | null;
  /** The provenance statement this corrects, when it corrects one. */
  readonly supersedesId?: string | null;
}

export interface DerivationInput {
  readonly caseId: string;
  readonly derivedId: string;
  readonly sourceId: string;
  readonly kind: "ocr" | "translation" | "redaction" | "extract" | "transcript";
  readonly engine?: string | null;
  readonly engineVersion?: string | null;
  readonly executionId?: string | null;
}

export class EvidenceRepository {
  readonly #pool: PoolLike | null;
  readonly #storage: EvidenceStorage;

  constructor(pool: PoolLike | null, storage: EvidenceStorage = new NoStorage()) {
    this.#pool = pool;
    this.#storage = storage;
  }

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

  async #hydrate(sql: SqlExecutor, rows: readonly ItemRow[]): Promise<readonly EvidenceRecord[]> {
    const ids = rows.map((r) => r.id);
    const files = new Map<string, EvidenceFileRecord[]>();
    const provenance = new Map<string, EvidenceProvenanceRecord[]>();

    if (ids.length > 0) {
      const [f, p] = await Promise.all([
        sql.query<Record<string, unknown>>(
          "SELECT * FROM evidence_files WHERE evidence_id = ANY($1) ORDER BY version DESC, uploaded_at DESC, id ASC",
          [ids]
        ),
        sql.query<Record<string, unknown>>(
          "SELECT * FROM evidence_provenance WHERE evidence_id = ANY($1) ORDER BY asserted_at ASC, id ASC",
          [ids]
        ),
      ]);
      for (const r of f.rows) {
        const list = files.get(r.evidence_id as string) ?? [];
        list.push({
          id: r.id as string,
          evidenceId: r.evidence_id as string,
          version: Number(r.version),
          storageProvider: r.storage_provider as string,
          originalFilename: (r.original_filename as string) ?? null,
          mediaType: r.media_type as string,
          byteSize: Number(r.byte_size),
          digest: r.digest as string,
          digestAlgorithm: r.digest_algorithm as string,
          uploadedBy: r.uploaded_by as string,
          uploadedAt: iso(r.uploaded_at as Date)!,
          availability: r.availability as Availability,
          scanState: r.scan_state as string,
          encryptionState: r.encryption_state as string,
          supersededById: (r.superseded_by as string) ?? null,
        });
        files.set(r.evidence_id as string, list);
      }
      const replaced = new Set(
        p.rows.map((r) => r.supersedes_id as string | null).filter((v): v is string => !!v)
      );
      for (const r of p.rows) {
        const list = provenance.get(r.evidence_id as string) ?? [];
        list.push({
          id: r.id as string,
          evidenceId: r.evidence_id as string,
          acquisition: r.acquisition as Acquisition,
          sourceActor: (r.source_actor as string) ?? null,
          sourceOrganisation: (r.source_organisation as string) ?? null,
          acquiredAt: iso((r.acquired_at as Date) ?? null),
          originalLocator: (r.original_locator as string) ?? null,
          custodyNote: (r.custody_note as string) ?? null,
          assertedBy: r.asserted_by as string,
          assertedAt: iso(r.asserted_at as Date)!,
          externalReference: (r.external_reference as string) ?? null,
          executionId: (r.execution_id as string) ?? null,
          supersedesId: (r.supersedes_id as string) ?? null,
          current: !replaced.has(r.id as string),
        });
        provenance.set(r.evidence_id as string, list);
      }
    }

    return rows.map((row) => {
      const itemFiles = files.get(row.id) ?? [];
      const current = itemFiles.find((f) => f.id === row.current_file_id) ?? null;
      return {
        id: row.id,
        organisationId: row.organisation_id,
        caseId: row.case_id,
        evidenceType: row.evidence_type,
        title: row.title,
        description: row.description,
        status: row.status,
        sourceClassification: row.source_classification,
        verificationState: row.verification_state,
        sensitivity: row.sensitivity,
        retentionState: row.retention_state,
        createdBy: row.created_by,
        createdAt: iso(row.created_at)!,
        updatedAt: iso(row.updated_at)!,
        version: Number(row.version),
        currentFileId: row.current_file_id,
        files: itemFiles,
        provenance: provenance.get(row.id) ?? [],
        // Derived, never stored. A file row is not bytes.
        available: current !== null && current.availability === "available",
      } satisfies EvidenceRecord;
    });
  }

  /* -------------------------------------------------------------- */
  /* Reads                                                           */
  /* -------------------------------------------------------------- */

  async readEvidenceForCase(
    context: RepositoryContext,
    caseId: string
  ): Promise<Result<readonly EvidenceRecord[]>> {
    if (!this.#pool) return this.#noDatabase();
    try {
      const resolved = await this.#resolve(this.#pool, context, caseId, MAY_READ);
      if (!resolved.ok) return refuse(resolved.refusal);
      const rows = await this.#pool.query<ItemRow>(
        `SELECT ${ITEM_COLUMNS} FROM evidence_items e
          WHERE e.case_id = $1 AND e.organisation_id = $2
          ORDER BY e.status ASC, e.evidence_type ASC, e.created_at ASC, e.id ASC`,
        [resolved.value.caseId, resolved.value.organisationId]
      );
      return ok(await this.#hydrate(this.#pool, rows.rows));
    } catch (error) {
      return this.#unreachable(error);
    }
  }

  async readEvidenceItem(
    context: RepositoryContext,
    caseId: string,
    evidenceId: string
  ): Promise<Result<EvidenceRecord>> {
    if (!this.#pool) return this.#noDatabase();
    try {
      const resolved = await this.#resolve(this.#pool, context, caseId, MAY_READ);
      if (!resolved.ok) return refuse(resolved.refusal);
      const rows = await this.#pool.query<ItemRow>(
        `SELECT ${ITEM_COLUMNS} FROM evidence_items e
          WHERE e.id = $1 AND e.case_id = $2 AND e.organisation_id = $3`,
        [evidenceId, resolved.value.caseId, resolved.value.organisationId]
      );
      if (!rows.rows[0]) return refuse({ reason: "NOT_PERSISTED", detail: CASE_NOT_AVAILABLE });
      const [record] = await this.#hydrate(this.#pool, rows.rows);
      return ok(record!);
    } catch (error) {
      return this.#unreachable(error);
    }
  }

  async readEvidenceHistory(
    context: RepositoryContext,
    caseId: string,
    evidenceId: string
  ): Promise<Result<readonly EvidenceEventRecord[]>> {
    if (!this.#pool) return this.#noDatabase();
    try {
      const resolved = await this.#resolve(this.#pool, context, caseId, MAY_READ);
      if (!resolved.ok) return refuse(resolved.refusal);
      const rows = await this.#pool.query<Record<string, unknown>>(
        `SELECT ev.* FROM evidence_events ev JOIN evidence_items e ON e.id = ev.evidence_id
          WHERE ev.evidence_id = $1 AND e.case_id = $2 AND e.organisation_id = $3
          ORDER BY ev.id ASC`,
        [evidenceId, resolved.value.caseId, resolved.value.organisationId]
      );
      return ok(
        rows.rows.map((r) => ({
          id: Number(r.id),
          evidenceId: r.evidence_id as string,
          event: r.event as EvidenceEventName,
          actorId: (r.actor_id as string) ?? null,
          detail: (r.detail as string) ?? null,
          at: iso(r.at as Date)!,
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
   * Creates an item together with its first provenance record, its first event
   * and its audit entry. All four or none.
   *
   * Provenance is required at creation rather than optional afterwards: an
   * evidence item with no account of how it arrived is a document nobody can
   * weigh, and "we will add that later" is how it never gets added.
   */
  async createEvidenceItem(
    context: RepositoryContext,
    input: CreateEvidenceInput
  ): Promise<Result<EvidenceRecord>> {
    if (!this.#pool) return this.#noDatabase();
    const invalid = validateCreate(input);
    if (invalid) return refuse({ reason: "INVALID", detail: invalid });

    try {
      return await withTransaction(this.#pool, async (tx) => {
        const resolved = await this.#resolve(tx, context, input.caseId, MAY_HANDLE_EVIDENCE);
        if (!resolved.ok) return refuse<EvidenceRecord>(resolved.refusal);

        const item = await tx.query<ItemRow>(
          `INSERT INTO evidence_items (
             organisation_id, case_id, title, category, status, evidence_type,
             description, source_classification, sensitivity, created_by)
           VALUES ($1,$2,$3,$4,'requested',$5,$6,$7,$8,$9)
           RETURNING ${ITEM_COLUMNS.replace(/e\./g, "")}`,
          [
            resolved.value.organisationId,
            resolved.value.caseId,
            input.title,
            input.evidenceType,
            input.evidenceType,
            input.description ?? null,
            input.sourceClassification ?? "person_reported",
            input.sensitivity ?? "standard",
            context.actorId,
          ]
        );
        const row = item.rows[0]!;

        await tx.query(
          `INSERT INTO evidence_provenance (evidence_id, acquisition, source_actor,
             source_organisation, acquired_at, original_locator, custody_note,
             asserted_by, external_reference, execution_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            row.id,
            input.provenance.acquisition,
            input.provenance.sourceActor ?? null,
            input.provenance.sourceOrganisation ?? null,
            input.provenance.acquiredAt ?? null,
            input.provenance.originalLocator ?? null,
            input.provenance.custodyNote ?? null,
            context.actorId,
            input.provenance.externalReference ?? null,
            input.provenance.executionId ?? null,
          ]
        );

        await this.#event(tx, row.id, "created", context, input.title);
        await this.#event(
          tx,
          row.id,
          "provenance_recorded",
          context,
          input.provenance.acquisition
        );
        await this.#audit(tx, context, "evidence.created", row.id, {
          caseId: resolved.value.caseId,
          evidenceType: input.evidenceType,
          sourceClassification: input.sourceClassification ?? "person_reported",
          acquisition: input.provenance.acquisition,
          sensitivity: input.sensitivity ?? "standard",
        });

        const [record] = await this.#hydrate(tx, [row]);
        return ok(record!);
      });
    } catch (error) {
      return this.#unreachable(error);
    }
  }

  /**
   * Attaches a file version.
   *
   * Bytes first, then the database, with the object removed as compensation if
   * the database write fails. That order is chosen deliberately: it can leave
   * an orphaned object, and it can never leave a row claiming bytes that were
   * never written. Unreferenced bytes cost disk; a referenced row with no bytes
   * is discovered at a hearing.
   */
  async attachFileVersion(
    context: RepositoryContext,
    input: AttachFileInput
  ): Promise<Result<EvidenceRecord>> {
    if (!this.#pool) return this.#noDatabase();
    if (input.bytes.length === 0) {
      return refuse({ reason: "INVALID", detail: "an empty file is not evidence" });
    }
    if (!input.mediaType.trim()) {
      return refuse({ reason: "INVALID", detail: "a file version must record its media type" });
    }

    const digest = sha256(input.bytes);
    let writtenKey: string | null = null;

    try {
      const resolved = await withTransaction(this.#pool, (tx) =>
        this.#resolve(tx, context, input.caseId, MAY_HANDLE_EVIDENCE)
      );
      if (!resolved.ok) return refuse(resolved.refusal);

      const existing = await this.#pool.query<{ version: number; item_version: number }>(
        `SELECT COALESCE(max(f.version), 0) AS version,
                (SELECT version FROM evidence_items WHERE id = $1) AS item_version
           FROM evidence_files f
          WHERE f.evidence_id = $1`,
        [input.evidenceId]
      );
      const owned = await this.#pool.query<{ id: string }>(
        "SELECT id FROM evidence_items WHERE id = $1 AND case_id = $2 AND organisation_id = $3",
        [input.evidenceId, resolved.value.caseId, resolved.value.organisationId]
      );
      if (!owned.rows[0]) return refuse({ reason: "NOT_PERSISTED", detail: CASE_NOT_AVAILABLE });

      const nextVersion = Number(existing.rows[0]?.version ?? 0) + 1;
      const key = `${resolved.value.organisationId}/${input.evidenceId}/${nextVersion}`;

      // 1. Bytes. A failure here records nothing at all.
      await this.#storage.put(key, input.bytes);
      writtenKey = key;

      // 2. Database. `available` only because the bytes are already there.
      return await withTransaction(this.#pool, async (tx) => {
        const file = await tx.query<{ id: string }>(
          `INSERT INTO evidence_files (evidence_id, version, storage_provider, storage_key,
             original_filename, media_type, byte_size, digest, uploaded_by, availability)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'available') RETURNING id`,
          [
            input.evidenceId,
            nextVersion,
            this.#storage.provider,
            key,
            input.originalFilename ?? null,
            input.mediaType,
            input.bytes.length,
            digest,
            context.actorId,
          ]
        );

        const updated = await tx.query<ItemRow>(
          `UPDATE evidence_items
              SET current_file_id = $1, status = 'received',
                  received_at = COALESCE(received_at, now()),
                  version = version + 1, updated_at = now()
            WHERE id = $2 AND version = $3
            RETURNING ${ITEM_COLUMNS.replace(/e\./g, "")}`,
          [file.rows[0]!.id, input.evidenceId, input.expectedVersion]
        );
        if (!updated.rows[0]) {
          throw new Error(
            "this evidence item changed after it was read; re-read it before attaching a file"
          );
        }

        // Supersede the previous current file rather than overwriting it.
        if (nextVersion > 1) {
          await tx.query(
            `UPDATE evidence_files SET superseded_by = $1, availability = 'unavailable'
              WHERE evidence_id = $2 AND version = $3`,
            [file.rows[0]!.id, input.evidenceId, nextVersion - 1]
          );
          await this.#event(tx, input.evidenceId, "file_superseded", context, `version ${nextVersion - 1}`);
        }

        await this.#event(tx, input.evidenceId, "file_attached", context, `version ${nextVersion}`);
        await this.#event(tx, input.evidenceId, "file_available", context, digest);
        await this.#audit(tx, context, "evidence.file_attached", input.evidenceId, {
          caseId: resolved.value.caseId,
          fileVersion: nextVersion,
          digest,
          digestAlgorithm: "sha-256",
          byteSize: input.bytes.length,
          mediaType: input.mediaType,
          storageProvider: this.#storage.provider,
        });

        const [record] = await this.#hydrate(tx, [updated.rows[0]!]);
        return ok(record!);
      });
    } catch (error) {
      // Compensation. If this also fails the object is orphaned, which is
      // stated in evidence-storage.ts and is the lesser failure.
      if (writtenKey) await this.#storage.remove(writtenKey).catch(() => undefined);
      if (error instanceof Error && /changed after it was read/.test(error.message)) {
        return refuse({ reason: "CONFLICT", detail: error.message });
      }
      return this.#unreachable(error);
    }
  }

  /**
   * Records a verification, in one named dimension.
   *
   * `digest` recomputes the hash from the stored bytes. `source` and
   * `professional` are judgements a person makes, and neither may be recorded
   * without the digest having been checked first — bytes that might have
   * changed cannot be the thing a solicitor accepted.
   */
  async verifyEvidence(
    context: RepositoryContext,
    input: VerifyEvidenceInput
  ): Promise<Result<EvidenceRecord>> {
    if (!this.#pool) return this.#noDatabase();
    try {
      const resolved = await withTransaction(this.#pool, (tx) =>
        this.#resolve(tx, context, input.caseId, MAY_HANDLE_EVIDENCE)
      );
      if (!resolved.ok) return refuse(resolved.refusal);

      const found = await this.#pool.query<ItemRow & { storage_key: string; digest: string }>(
        `SELECT ${ITEM_COLUMNS}, f.storage_key, f.digest
           FROM evidence_items e LEFT JOIN evidence_files f ON f.id = e.current_file_id
          WHERE e.id = $1 AND e.case_id = $2 AND e.organisation_id = $3`,
        [input.evidenceId, resolved.value.caseId, resolved.value.organisationId]
      );
      const row = found.rows[0];
      if (!row) return refuse({ reason: "NOT_PERSISTED", detail: CASE_NOT_AVAILABLE });

      let state: EvidenceVerificationState;
      let detail: string;

      if (input.dimension === "digest") {
        if (!row.current_file_id) {
          return refuse({
            reason: "CONFLICT",
            detail: "there is no file to verify against",
          });
        }
        const bytes = await this.#storage.get(row.storage_key);
        if (!bytes) {
          state = "unavailable";
          detail = "the stored bytes could not be read";
        } else {
          const actual = sha256(bytes);
          state = actual === row.digest ? "digest_verified" : "disputed";
          detail =
            actual === row.digest
              ? `sha-256 recomputed and matched`
              : `sha-256 mismatch: stored ${row.digest.slice(0, 12)}…, recomputed ${actual.slice(0, 12)}…`;
        }
      } else {
        // A judgement, not a computation — and it may not be made on bytes
        // nobody has checked.
        if (row.verification_state === "unverified") {
          return refuse({
            reason: "CONFLICT",
            detail:
              "the file's digest has not been verified, so there is nothing stable for a person to accept",
          });
        }
        if (input.dimension === "professional" && !["solicitor", "adviser"].includes(resolved.value.membership.role)) {
          return refuse({
            reason: "FORBIDDEN",
            detail: "a professional verification requires a regulated role",
          });
        }
        state = input.dimension === "source" ? "source_verified" : "professionally_verified";
        detail = input.basis ?? state;
      }

      return await withTransaction(this.#pool, async (tx) => {
        const updated = await tx.query<ItemRow>(
          `UPDATE evidence_items SET verification_state = $1, version = version + 1, updated_at = now()
            WHERE id = $2 AND version = $3 RETURNING ${ITEM_COLUMNS.replace(/e\./g, "")}`,
          [state, input.evidenceId, input.expectedVersion]
        );
        if (!updated.rows[0]) {
          return refuse<EvidenceRecord>({
            reason: "CONFLICT",
            detail: "this evidence item changed after it was read; re-read it before verifying",
          });
        }
        const eventName: EvidenceEventName =
          state === "disputed"
            ? "disputed"
            : state === "unavailable"
              ? "unavailable"
              : state === "digest_verified"
                ? "digest_verified"
                : state === "source_verified"
                  ? "source_verified"
                  : "professionally_verified";
        await this.#event(tx, input.evidenceId, eventName, context, detail);
        await this.#audit(tx, context, "evidence.verified", input.evidenceId, {
          caseId: resolved.value.caseId,
          dimension: input.dimension,
          state,
          role: resolved.value.membership.role,
        });
        const [record] = await this.#hydrate(tx, [updated.rows[0]!]);
        return ok(record!);
      });
    } catch (error) {
      return this.#unreachable(error);
    }
  }

  /** Adds a provenance statement, optionally correcting an earlier one. */
  async recordProvenance(
    context: RepositoryContext,
    input: RecordProvenanceInput
  ): Promise<Result<EvidenceRecord>> {
    if (!this.#pool) return this.#noDatabase();
    if (!ACQUISITIONS.includes(input.acquisition)) {
      return refuse({ reason: "INVALID", detail: `${input.acquisition} is not an acquisition` });
    }
    try {
      return await withTransaction(this.#pool, async (tx) => {
        const resolved = await this.#resolve(tx, context, input.caseId, MAY_HANDLE_EVIDENCE);
        if (!resolved.ok) return refuse<EvidenceRecord>(resolved.refusal);

        const owned = await tx.query<ItemRow>(
          `SELECT ${ITEM_COLUMNS} FROM evidence_items e
            WHERE e.id = $1 AND e.case_id = $2 AND e.organisation_id = $3`,
          [input.evidenceId, resolved.value.caseId, resolved.value.organisationId]
        );
        if (!owned.rows[0]) return refuse({ reason: "NOT_PERSISTED", detail: CASE_NOT_AVAILABLE });

        await tx.query(
          `INSERT INTO evidence_provenance (evidence_id, acquisition, source_actor,
             original_locator, custody_note, asserted_by, execution_id, supersedes_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            input.evidenceId,
            input.acquisition,
            input.sourceActor ?? null,
            input.originalLocator ?? null,
            input.custodyNote ?? null,
            context.actorId,
            input.executionId ?? null,
            input.supersedesId ?? null,
          ]
        );
        await this.#event(tx, input.evidenceId, "provenance_recorded", context, input.acquisition);
        await this.#audit(tx, context, "evidence.provenance_recorded", input.evidenceId, {
          caseId: resolved.value.caseId,
          acquisition: input.acquisition,
          supersedesId: input.supersedesId ?? null,
        });

        const [record] = await this.#hydrate(tx, owned.rows);
        return ok(record!);
      });
    } catch (error) {
      return this.#unreachable(error);
    }
  }

  /** Records that one item was derived from another — OCR, translation, redaction. */
  async recordEvidenceDerivation(
    context: RepositoryContext,
    input: DerivationInput
  ): Promise<Result<EvidenceRecord>> {
    if (!this.#pool) return this.#noDatabase();
    try {
      return await withTransaction(this.#pool, async (tx) => {
        const resolved = await this.#resolve(tx, context, input.caseId, MAY_HANDLE_EVIDENCE);
        if (!resolved.ok) return refuse<EvidenceRecord>(resolved.refusal);

        const both = await tx.query<{ id: string }>(
          "SELECT id FROM evidence_items WHERE id = ANY($1) AND case_id = $2 AND organisation_id = $3",
          [
            [input.derivedId, input.sourceId],
            resolved.value.caseId,
            resolved.value.organisationId,
          ]
        );
        if (both.rows.length !== 2) {
          return refuse({
            reason: "NOT_PERSISTED",
            detail: "both evidence items must belong to this case in this organisation",
          });
        }

        await tx.query(
          `INSERT INTO evidence_derivations (derived_id, source_id, kind, engine,
             engine_version, execution_id, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            input.derivedId,
            input.sourceId,
            input.kind,
            input.engine ?? null,
            input.engineVersion ?? null,
            input.executionId ?? null,
            context.actorId,
          ]
        );
        await this.#event(
          tx,
          input.derivedId,
          "derivation_recorded",
          context,
          `${input.kind} of ${input.sourceId}`
        );
        await this.#audit(tx, context, "evidence.derivation_recorded", input.derivedId, {
          caseId: resolved.value.caseId,
          sourceId: input.sourceId,
          kind: input.kind,
        });

        const rows = await tx.query<ItemRow>(
          `SELECT ${ITEM_COLUMNS} FROM evidence_items e WHERE e.id = $1`,
          [input.derivedId]
        );
        const [record] = await this.#hydrate(tx, rows.rows);
        return ok(record!);
      });
    } catch (error) {
      return this.#unreachable(error);
    }
  }

  /** Marks the current file as no longer retrievable. */
  async markEvidenceUnavailable(
    context: RepositoryContext,
    input: { caseId: string; evidenceId: string; reason: string; expectedVersion: number }
  ): Promise<Result<EvidenceRecord>> {
    if (!this.#pool) return this.#noDatabase();
    if (!input.reason.trim()) {
      return refuse({ reason: "INVALID", detail: "marking evidence unavailable must state why" });
    }
    try {
      return await withTransaction(this.#pool, async (tx) => {
        const resolved = await this.#resolve(tx, context, input.caseId, MAY_HANDLE_EVIDENCE);
        if (!resolved.ok) return refuse<EvidenceRecord>(resolved.refusal);

        const updated = await tx.query<ItemRow>(
          `UPDATE evidence_items SET verification_state = 'unavailable',
                  version = version + 1, updated_at = now()
            WHERE id = $1 AND case_id = $2 AND organisation_id = $3 AND version = $4
            RETURNING ${ITEM_COLUMNS.replace(/e\./g, "")}`,
          [
            input.evidenceId,
            resolved.value.caseId,
            resolved.value.organisationId,
            input.expectedVersion,
          ]
        );
        if (!updated.rows[0]) {
          return refuse({ reason: "CONFLICT", detail: "this evidence item changed after it was read" });
        }
        if (updated.rows[0].current_file_id) {
          await tx.query("UPDATE evidence_files SET availability = 'unavailable' WHERE id = $1", [
            updated.rows[0].current_file_id,
          ]);
        }
        await this.#event(tx, input.evidenceId, "unavailable", context, input.reason);
        await this.#audit(tx, context, "evidence.unavailable", input.evidenceId, {
          caseId: resolved.value.caseId,
          reason: input.reason,
        });
        const [record] = await this.#hydrate(tx, updated.rows);
        return ok(record!);
      });
    } catch (error) {
      return this.#unreachable(error);
    }
  }

  /* -------------------------------------------------------------- */

  async #event(
    sql: SqlExecutor,
    evidenceId: string,
    event: EvidenceEventName,
    context: RepositoryContext,
    detail: string | null
  ): Promise<void> {
    await sql.query(
      "INSERT INTO evidence_events (evidence_id, event, actor_id, detail) VALUES ($1,$2,$3,$4)",
      [evidenceId, event, context.actorId, detail]
    );
  }

  async #audit(
    sql: SqlExecutor,
    context: RepositoryContext,
    action: string,
    subject: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    // Structural identifiers and classifications only. No file contents, no
    // title, no custody note: the audit chain cannot be rewritten, so anything
    // erasable must not enter it.
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
        "no database is configured for this instance, so no evidence is persisted. This is the state of this deployment, not a failure to load.",
    });
  }

  #unreachable<T>(error: unknown): Result<T> {
    return refuse({
      reason: "UNREACHABLE",
      detail: error instanceof Error ? error.message : "the evidence store could not be read",
    });
  }
}

export function validateCreate(input: CreateEvidenceInput): string | null {
  if (!EVIDENCE_TYPES.includes(input.evidenceType)) {
    return `${input.evidenceType} is not an evidence type`;
  }
  if (!input.title.trim()) return "an evidence item must have a title";
  if (
    input.sourceClassification !== undefined &&
    !SOURCE_CLASSIFICATIONS.includes(input.sourceClassification)
  ) {
    return `${input.sourceClassification} is not a source classification`;
  }
  if (!ACQUISITIONS.includes(input.provenance.acquisition)) {
    return `${input.provenance.acquisition} is not an acquisition method`;
  }
  // Mirrors `model_derived_provenance_cites_an_execution`.
  if (input.provenance.acquisition === "model_derived" && !input.provenance.executionId) {
    return "model-derived material must cite the execution that produced it";
  }
  return null;
}

