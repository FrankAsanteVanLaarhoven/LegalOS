/**
 * @legalos/database — PostgreSQL schema, migrations and repositories.
 *
 * The domain types below describe the case model; the schema that enforces it
 * lives in `migrations/`. Several product invariants are expressed there rather
 * than in application code, because that is the only place they cannot be
 * bypassed: the audit log is append-only by trigger, a source may not claim to
 * be `verified` without a retrieval date and checksum, AI output cannot be
 * stored without its verification verdict, an authorised proposal must name the
 * human who authorised it, and there is no stored completeness score to drift
 * away from the evidence rows it is supposed to summarise.
 */

export { PostgresAuditStore } from "./audit-store.ts";
export {
  PostgresAgentMetrics,
  digestOf,
  type AgentMetricsRow,
  type AgentMetricsProjection,
} from "./agent-metrics.ts";
export { PostgresSessionStore } from "./session-store.ts";
export { PostgresAccountStore, type ContactChannel } from "./account-store.ts";
export {
  PostgresExecutionStore,
  PostgresExecutionLifecycle,
  EXECUTION_STATES,
  TERMINAL_STATES,
  isTerminal,
  canonicalJson,
  snapshotContentHash,
  type ExecutionInput,
  type RetrievalSnapshotInput,
  type ReplayResult,
  type ReplayFailure,
  type ExecutionState,
  type TerminalState,
  type CompletionInput,
} from "./execution-store.ts";
export {
  createPool,
  requireDatabaseUrl,
  withTransaction,
  type PoolClientLike,
  type PoolLike,
  type QueryResult,
  type SqlExecutor,
} from "./client.ts";
export { migrate, readMigrations, type AppliedMigration } from "./migrate.ts";
export {
  assertTestDatabase,
  refuseTestDatabaseInProduction,
  isTestDatabase,
  databaseNameOf,
} from "./test-guard.ts";
export { bootstrapTenancy, type BootstrapInput, type BootstrapResult } from "./bootstrap.ts";

export interface Organization {
  id: string;
  name: string;
  type: "law_firm" | "ngo" | "university" | "employer" | "legal_aid" | "other";
}

export interface Workspace {
  id: string;
  organizationId: string;
  name: string;
}

export interface Client {
  id: string;
  workspaceId: string;
  preferredName?: string;
  languages: string[];
}

export interface Case {
  id: string;
  clientId: string;
  reference: string;
  status: string;
  matterTypes: string[];
}

export interface TimelineEvent {
  id: string;
  caseId: string;
  occurredOn: string;
  title: string;
  /** Provenance, not a score. Mirrors timeline_events.source. */
  source: "client_stated" | "document" | "ai_inferred";
}

export interface EvidenceItem {
  id: string;
  caseId: string;
  title: string;
  category: string;
  status: "received" | "requested" | "missing" | "expired";
}

export interface DocumentDraft {
  id: string;
  caseId: string;
  kind: string;
  version: number;
  reviewStatus: "pending" | "approved" | "changes_requested" | "rejected";
}

export interface Task {
  id: string;
  caseId: string;
  title: string;
  status: string;
  priority: string;
}

export interface AIAnalysis {
  id: string;
  caseId: string;
  agentId: string;
  summary: string;
  /** Mirrors ai_outputs.verdict — output is never stored without one. */
  verdict: "pass" | "flag" | "block";
  reasonCodes: string[];
  requiresHumanReview: boolean;
}

export interface HumanReview {
  id: string;
  caseId: string;
  subjectId: string;
  status: "pending" | "approved" | "rejected" | "changes_requested";
  reservedActivity: boolean;
}

/** AI-first evidence graph node kinds */
export type GraphNodeKind =
  | "person"
  | "identity_doc"
  | "visa"
  | "medical"
  | "legal_issue"
  | "timeline_event"
  | "evidence"
  | "risk";
