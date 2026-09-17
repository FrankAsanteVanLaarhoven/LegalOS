import { createHash } from "node:crypto";

import type { SqlExecutor } from "./client.ts";

/**
 * AI execution records, and replay.
 *
 * Replay here means reconstructing the inputs and confirming they are still
 * the ones cited — not re-running the model. That distinction is deliberate and
 * worth stating plainly, because "deterministic replay" of a language model is
 * not a thing anyone can offer: temperature aside, providers change weights
 * behind a version string. A replay that re-invoked the model and got a
 * different answer would read as a failure of the record when it is a property
 * of the model.
 *
 * What is genuinely reproducible is what was sent and what state the system was
 * in: the prompt bodies at the versions cited, the retrieval snapshot as it was
 * ordered, the sources, the guardrail and registry versions. That is what an
 * appeal, an incident review or an external auditor needs, and it is checkable.
 */

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Canonical JSON: keys sorted, so a hash depends on content and not on the
 * order a driver happened to return columns in.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export interface RetrievalSnapshotInput {
  readonly workspaceId: string | null;
  readonly caseId: string | null;
  readonly query: string;
  readonly filters: Record<string, unknown>;
  readonly retrievalStrategy: string;
  /** What the model saw, in the order it saw it. Ordering is part of the input. */
  readonly chunks: readonly unknown[];
  readonly sourceHashes: readonly string[];
  readonly embeddingsVersion: string;
  readonly vectorIndexVersion: string;
}

/** The hash a snapshot is identified by. Recomputed on replay. */
export function snapshotContentHash(input: RetrievalSnapshotInput): string {
  return sha256(
    canonicalJson({
      query: input.query,
      filters: input.filters,
      retrievalStrategy: input.retrievalStrategy,
      chunks: input.chunks,
      sourceHashes: [...input.sourceHashes],
      embeddingsVersion: input.embeddingsVersion,
      vectorIndexVersion: input.vectorIndexVersion,
    })
  );
}

export interface ExecutionInput {
  readonly workspaceId: string | null;
  readonly caseId: string | null;
  readonly organisationId: string | null;
  readonly actorId: string;
  readonly actorType: string;
  readonly sessionId: string | null;
  readonly deviceId: string | null;
  readonly department: string;
  readonly agentId: string;
  readonly agentVersion: string;
  readonly provider: string;
  readonly model: string;
  readonly modelVersion: string;
  readonly promptTemplateId: string;
  readonly promptTemplateVersion: string;
  readonly systemPromptHash: string;
  readonly developerPromptHash: string | null;
  readonly userMessageHash: string;
  readonly retrievalSnapshotId: string | null;
  readonly retrievalContextHash: string | null;
  readonly resolvedSources: readonly string[];
  readonly toolCalls: readonly unknown[];
  readonly verifiedSourceCount: number;
  readonly unverifiedSourceCount: number;
  readonly registryVersion: string;
  readonly guardrailVersion: string;
  // Nullable since 0006: these are outcomes, and the record is created before
  // the provider is called so that a failure is still recorded. The completion
  // row carries the settled values.
  readonly verificationVerdict: "pass" | "flag" | "block" | null;
  readonly released: boolean | null;
  readonly responseHash: string | null;
}

export type ReplayFailure =
  | "EXECUTION_NOT_FOUND"
  | "PROMPT_TEMPLATE_MISSING"
  | "PROMPT_TEMPLATE_ALTERED"
  | "RETRIEVAL_SNAPSHOT_MISSING"
  | "RETRIEVAL_SNAPSHOT_ALTERED"
  | "RETRIEVAL_CONTEXT_HASH_MISMATCH";

export interface ReplayResult {
  readonly reproducible: boolean;
  readonly failure: ReplayFailure | null;
  /** What was checked, so a passing replay is inspectable rather than a boolean. */
  readonly reconstructed: {
    readonly promptTemplateBody: string | null;
    readonly retrievalChunks: readonly unknown[] | null;
    readonly sourceHashes: readonly string[] | null;
  } | null;
  readonly reason: string | null;
}

export class PostgresExecutionStore {
  readonly #sql: SqlExecutor;

  constructor(sql: SqlExecutor) {
    this.#sql = sql;
  }

  /** Registers a prompt template version. The body is stored once, by version. */
  async recordTemplate(input: {
    id: string;
    version: string;
    kind: "system" | "developer" | "user_template";
    body: string;
  }): Promise<string> {
    const hash = sha256(input.body);
    await this.#sql.query(
      `INSERT INTO prompt_templates (id, version, kind, body, body_hash)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id, version) DO NOTHING`,
      [input.id, input.version, input.kind, input.body, hash]
    );
    return hash;
  }

  async recordSnapshot(input: RetrievalSnapshotInput): Promise<{ id: string; hash: string }> {
    const hash = snapshotContentHash(input);
    const result = await this.#sql.query<{ id: string }>(
      `INSERT INTO retrieval_snapshots
         (workspace_id, case_id, query, filters, retrieval_strategy, chunks,
          source_hashes, embeddings_version, vector_index_version, content_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        input.workspaceId,
        input.caseId,
        input.query,
        JSON.stringify(input.filters),
        input.retrievalStrategy,
        JSON.stringify(input.chunks),
        [...input.sourceHashes],
        input.embeddingsVersion,
        input.vectorIndexVersion,
        hash,
      ]
    );
    return { id: result.rows[0]!.id, hash };
  }

  async record(input: ExecutionInput): Promise<string> {
    const result = await this.#sql.query<{ id: string }>(
      `INSERT INTO ai_executions (
         workspace_id, case_id, organisation_id,
         actor_id, actor_type, session_id, device_id,
         department, agent_id, agent_version,
         provider, model, model_version,
         prompt_template_id, prompt_template_version,
         system_prompt_hash, developer_prompt_hash, user_message_hash,
         retrieval_snapshot_id, retrieval_context_hash,
         resolved_sources, tool_calls,
         verified_source_count, unverified_source_count,
         registry_version, guardrail_version, verification_verdict, released,
         response_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
               $19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)
       RETURNING id`,
      [
        input.workspaceId,
        input.caseId,
        input.organisationId,
        input.actorId,
        input.actorType,
        input.sessionId,
        input.deviceId,
        input.department,
        input.agentId,
        input.agentVersion,
        input.provider,
        input.model,
        input.modelVersion,
        input.promptTemplateId,
        input.promptTemplateVersion,
        input.systemPromptHash,
        input.developerPromptHash,
        input.userMessageHash,
        input.retrievalSnapshotId,
        input.retrievalContextHash,
        [...input.resolvedSources],
        JSON.stringify(input.toolCalls),
        input.verifiedSourceCount,
        input.unverifiedSourceCount,
        input.registryVersion,
        input.guardrailVersion,
        input.verificationVerdict,
        input.released,
        input.responseHash,
      ]
    );
    return result.rows[0]!.id;
  }

  /**
   * Reconstructs an execution's inputs and confirms nothing they cite has
   * changed underneath them.
   *
   * Every hash is recomputed from the stored artefact rather than compared to
   * another stored hash. Comparing two stored values would pass happily after
   * both were edited, which is the failure this is here to catch.
   */
  async replay(executionId: string): Promise<ReplayResult> {
    const none = { promptTemplateBody: null, retrievalChunks: null, sourceHashes: null };

    const execution = await this.#sql.query<{
      prompt_template_id: string;
      prompt_template_version: string;
      system_prompt_hash: string;
      retrieval_snapshot_id: string | null;
      retrieval_context_hash: string | null;
    }>(
      `SELECT prompt_template_id, prompt_template_version, system_prompt_hash,
              retrieval_snapshot_id, retrieval_context_hash
         FROM ai_executions WHERE id = $1`,
      [executionId]
    );
    const row = execution.rows[0];
    if (!row) {
      return {
        reproducible: false,
        failure: "EXECUTION_NOT_FOUND",
        reconstructed: null,
        reason: `no execution ${executionId}`,
      };
    }

    const template = await this.#sql.query<{ body: string; body_hash: string }>(
      "SELECT body, body_hash FROM prompt_templates WHERE id = $1 AND version = $2",
      [row.prompt_template_id, row.prompt_template_version]
    );
    const templateRow = template.rows[0];
    if (!templateRow) {
      return {
        reproducible: false,
        failure: "PROMPT_TEMPLATE_MISSING",
        reconstructed: { ...none },
        reason: `${row.prompt_template_id}@${row.prompt_template_version} is no longer stored`,
      };
    }
    if (sha256(templateRow.body) !== templateRow.body_hash) {
      return {
        reproducible: false,
        failure: "PROMPT_TEMPLATE_ALTERED",
        reconstructed: { ...none, promptTemplateBody: templateRow.body },
        reason: "the stored prompt body no longer hashes to its recorded hash",
      };
    }

    let chunks: readonly unknown[] | null = null;
    let sourceHashes: readonly string[] | null = null;

    if (row.retrieval_snapshot_id) {
      const snapshot = await this.#sql.query<{
        query: string;
        filters: Record<string, unknown>;
        retrieval_strategy: string;
        chunks: unknown[];
        source_hashes: string[];
        embeddings_version: string;
        vector_index_version: string;
        content_hash: string;
      }>("SELECT * FROM retrieval_snapshots WHERE id = $1", [row.retrieval_snapshot_id]);
      const snap = snapshot.rows[0];
      if (!snap) {
        return {
          reproducible: false,
          failure: "RETRIEVAL_SNAPSHOT_MISSING",
          reconstructed: { ...none, promptTemplateBody: templateRow.body },
          reason: "the retrieval snapshot this execution cites has gone",
        };
      }

      const recomputed = snapshotContentHash({
        workspaceId: null,
        caseId: null,
        query: snap.query,
        filters: snap.filters,
        retrievalStrategy: snap.retrieval_strategy,
        chunks: snap.chunks,
        sourceHashes: snap.source_hashes,
        embeddingsVersion: snap.embeddings_version,
        vectorIndexVersion: snap.vector_index_version,
      });
      if (recomputed !== snap.content_hash) {
        return {
          reproducible: false,
          failure: "RETRIEVAL_SNAPSHOT_ALTERED",
          reconstructed: {
            promptTemplateBody: templateRow.body,
            retrievalChunks: snap.chunks,
            sourceHashes: snap.source_hashes,
          },
          reason: "what the model saw has been edited since the execution",
        };
      }
      if (row.retrieval_context_hash !== snap.content_hash) {
        return {
          reproducible: false,
          failure: "RETRIEVAL_CONTEXT_HASH_MISMATCH",
          reconstructed: {
            promptTemplateBody: templateRow.body,
            retrievalChunks: snap.chunks,
            sourceHashes: snap.source_hashes,
          },
          reason: "the execution cites a different snapshot than the one it is linked to",
        };
      }
      chunks = snap.chunks;
      sourceHashes = snap.source_hashes;
    }

    return {
      reproducible: true,
      failure: null,
      reconstructed: {
        promptTemplateBody: templateRow.body,
        retrievalChunks: chunks,
        sourceHashes,
      },
      reason: null,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

export const EXECUTION_STATES = [
  "created",
  "retrieving",
  "verified",
  "executing",
  "guardrails",
  "completed",
  "failed",
  "cancelled",
  "timed_out",
  "blocked",
] as const;

export type ExecutionState = (typeof EXECUTION_STATES)[number];

export const TERMINAL_STATES = [
  "completed",
  "failed",
  "cancelled",
  "timed_out",
  "blocked",
] as const;

export type TerminalState = (typeof TERMINAL_STATES)[number];

export function isTerminal(state: ExecutionState): state is TerminalState {
  return (TERMINAL_STATES as readonly string[]).includes(state);
}

export interface CompletionInput {
  readonly terminalState: TerminalState;
  /**
   * What actually answered, as distinct from what was requested.
   *
   * A gateway resolves an alias to a concrete model, and that resolution can
   * change without the alias changing. Recording only the requested id would
   * leave a replay citing a model that may not be the one that ran.
   */
  readonly resolvedProvider?: string | null;
  readonly resolvedModel?: string | null;
  readonly providerResponseId?: string | null;
  readonly providerApiVersion?: string | null;
  readonly responseHash: string | null;
  readonly verificationVerdict: "pass" | "flag" | "block" | null;
  readonly released: boolean;
  readonly latencyMs: number | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly estimatedCostPence: number | null;
  readonly retries: number;
  readonly providerEndpoint: string | null;
  readonly finishReason: string | null;
  readonly providerMetadata: Record<string, unknown>;
  readonly errorCode: string | null;
  readonly errorDetail: string | null;
}

/**
 * Lifecycle and outcome, both append-only.
 *
 * Kept apart from the request record so the execution row stays an immutable
 * statement of what was asked with what inputs, and the outcome is a separate
 * immutable row. Nothing is edited, so nothing has to be trusted not to have
 * been.
 */
export class PostgresExecutionLifecycle {
  readonly #sql: SqlExecutor;

  constructor(sql: SqlExecutor) {
    this.#sql = sql;
  }

  async transition(
    executionId: string,
    from: ExecutionState | null,
    to: ExecutionState,
    detail?: string
  ): Promise<void> {
    await this.#sql.query(
      `INSERT INTO ai_execution_transitions (execution_id, from_state, to_state, detail)
       VALUES ($1, $2, $3, $4)`,
      [executionId, from, to, detail ?? null]
    );
  }

  async states(executionId: string): Promise<ExecutionState[]> {
    const result = await this.#sql.query<{ to_state: ExecutionState }>(
      "SELECT to_state FROM ai_execution_transitions WHERE execution_id = $1 ORDER BY id ASC",
      [executionId]
    );
    return result.rows.map((r) => r.to_state);
  }

  async complete(executionId: string, input: CompletionInput): Promise<void> {
    await this.#sql.query(
      `INSERT INTO ai_execution_completions (
         execution_id, terminal_state, response_hash, verification_verdict, released,
         latency_ms, input_tokens, output_tokens, estimated_cost_pence, retries,
         provider_endpoint, finish_reason, provider_metadata, error_code, error_detail,
         resolved_provider, resolved_model, provider_response_id, provider_api_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [
        executionId,
        input.terminalState,
        input.responseHash,
        input.verificationVerdict,
        input.released,
        input.latencyMs,
        input.inputTokens,
        input.outputTokens,
        input.estimatedCostPence,
        input.retries,
        input.providerEndpoint,
        input.finishReason,
        JSON.stringify(input.providerMetadata),
        input.errorCode,
        input.errorDetail,
        input.resolvedProvider ?? null,
        input.resolvedModel ?? null,
        input.providerResponseId ?? null,
        input.providerApiVersion ?? null,
      ]
    );
  }

  /** Executions with no completion row. An empty result is the invariant. */
  async withoutCompletion(): Promise<string[]> {
    const result = await this.#sql.query<{ id: string }>(
      `SELECT e.id FROM ai_executions e
         LEFT JOIN ai_execution_completions c ON c.execution_id = e.id
        WHERE c.execution_id IS NULL`
    );
    return result.rows.map((r) => r.id);
  }

  async countExecutions(): Promise<number> {
    const result = await this.#sql.query<{ n: string }>(
      "SELECT count(*)::int AS n FROM ai_executions"
    );
    return Number(result.rows[0]?.n ?? 0);
  }
}
