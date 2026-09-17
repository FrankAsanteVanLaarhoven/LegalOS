/**
 * The task domain model.
 *
 * Pure, so the rules that decide when a task may be completed can be read
 * without a database. Completion is the one transition worth being careful
 * about: everything else on a task is a note, and completion is a claim that
 * something was done.
 */

export const TASK_STATUSES = [
  "open",
  "in_progress",
  "blocked",
  "awaiting_review",
  "completed",
  "cancelled",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["urgent", "high", "normal", "low"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/**
 * Where a task came from.
 *
 * `agent_proposed` is the one that changes how a list should be read: a
 * caseworker working through a queue believing a solicitor set the priorities,
 * when a model did, has quietly delegated triage to something nobody agreed to
 * trust with it.
 */
export const TASK_SOURCES = ["human", "agent_proposed", "deadline_derived", "policy_rule"] as const;
export type TaskSource = (typeof TASK_SOURCES)[number];

export const TASK_EVENTS = [
  "created",
  "updated",
  "assigned",
  "unassigned",
  "started",
  "blocked",
  "unblocked",
  "sent_for_review",
  "completed",
  "cancelled",
  "reopened",
  "commented",
  "dependency_added",
  "dependency_removed",
  "evidence_linked",
  "evidence_unlinked",
] as const;
export type TaskEventName = (typeof TASK_EVENTS)[number];

export const EVIDENCE_RELATIONS = ["produces", "requires", "concerns"] as const;
export type EvidenceRelation = (typeof EVIDENCE_RELATIONS)[number];

/** Statuses a task is still being worked in. */
export const ACTIVE_TASK_STATUSES: readonly TaskStatus[] = [
  "open",
  "in_progress",
  "blocked",
  "awaiting_review",
];

/** Statuses from which a task may still be completed. */
export const COMPLETABLE: readonly TaskStatus[] = ["open", "in_progress", "blocked", "awaiting_review"];

/**
 * Review decisions that count as a professional having accepted the work.
 *
 * `referred_onward` is deliberately absent: it means somebody else must look,
 * which is the opposite of an acceptance. `refused` obviously so.
 */
export const ACCEPTING_DECISIONS = ["approved", "approved_with_amendments"] as const;

export const MAY_MANAGE_TASKS = ["caseworker", "adviser", "solicitor", "admin"] as const;

export interface TaskDependencySummary {
  readonly dependsOn: readonly string[];
  /** Predecessors not yet finished. Non-empty means completion is blocked. */
  readonly unresolved: readonly string[];
  readonly blocks: readonly string[];
}

export interface TaskEvidenceSummary {
  readonly evidenceId: string;
  readonly relation: EvidenceRelation;
  readonly createdBy: string | null;
  readonly createdAt: string;
  readonly note: string | null;
}

export interface TaskRecord {
  readonly id: string;
  readonly organisationId: string;
  readonly caseId: string;
  readonly taskType: string;
  readonly title: string;
  readonly description: string | null;
  readonly status: TaskStatus;
  readonly priority: TaskPriority;
  readonly source: TaskSource;
  /** The execution that proposed it, where a model did. */
  readonly proposedByExecution: string | null;
  readonly createdBy: string;
  readonly assignedTo: string | null;
  readonly requiresProfessional: boolean;
  readonly deadlineId: string | null;
  readonly reviewRequestId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
  readonly cancelledAt: string | null;
  /** Integer, matching the column. Never a timestamp. */
  readonly version: number;
  readonly dependencies: TaskDependencySummary;
  readonly evidence: readonly TaskEvidenceSummary[];
}

export interface TaskEventRecord {
  readonly id: number;
  readonly taskId: string;
  readonly event: TaskEventName;
  readonly actorId: string | null;
  readonly detail: string | null;
  readonly at: string;
}

export interface CompletionInput {
  readonly status: TaskStatus;
  readonly requiresProfessional: boolean;
  /** Predecessor task ids that are not yet completed or cancelled. */
  readonly unresolvedDependencies: readonly string[];
  /** The linked review's decision, or null when there is no accepted decision. */
  readonly reviewDecision: string | null;
  readonly reviewRequestId: string | null;
}

/**
 * Whether a task may be completed, and why not when it may not.
 *
 * Every clause is a refusal. Completion is a claim that something was done, and
 * the failures below are all ways that claim could be made without it being
 * true: a predecessor still open, a professional requirement satisfied by
 * nothing more than a review existing, or a task completed twice.
 */
export function mayComplete(input: CompletionInput): {
  permitted: boolean;
  because: string | null;
} {
  const refuse = (because: string) => ({ permitted: false, because });

  if (input.status === "completed") return refuse("this task is already completed");
  if (input.status === "cancelled") return refuse("this task was cancelled and cannot be completed");
  if (!COMPLETABLE.includes(input.status)) {
    return refuse(`a task in ${input.status} cannot be completed`);
  }
  if (input.unresolvedDependencies.length > 0) {
    return refuse(
      `${input.unresolvedDependencies.length} task(s) this one depends on are not finished`
    );
  }
  if (input.requiresProfessional) {
    if (!input.reviewRequestId) {
      // The failure this prevents: a task marked as needing a solicitor is
      // closed by whoever had capacity, and nothing anywhere records that the
      // requirement went unmet.
      return refuse("this task requires professional review and no review has been requested");
    }
    if (!input.reviewDecision) {
      return refuse("the professional review of this task has not been decided");
    }
    if (!ACCEPTING_DECISIONS.includes(input.reviewDecision as (typeof ACCEPTING_DECISIONS)[number])) {
      return refuse(`the professional review was ${input.reviewDecision}, which is not an acceptance`);
    }
  }
  return { permitted: true, because: null };
}

/** Fields a caller may change through `updateTask`. Everything else is refused. */
export const MUTABLE_FIELDS = [
  "title",
  "description",
  "priority",
  "taskType",
  "deadlineId",
  "reviewRequestId",
] as const;
export type MutableField = (typeof MUTABLE_FIELDS)[number];

/**
 * Deterministic order for every task read.
 *
 * `priority_rank` ascending is priority descending — urgent is rank 0. Ordering
 * on the text column instead would give high, low, normal, urgent, which looks
 * sorted and is alphabetical.
 */
export const TASK_ORDER = "ORDER BY t.priority_rank ASC, t.created_at ASC, t.id ASC";

/** Fields that can hold free text a person wrote. Referenced by ADR-002. */
export const PERSONAL_TEXT_FIELDS = {
  tasks: ["title", "description", "task_type"],
  task_events: ["detail"],
  task_dependencies: ["reason"],
  task_evidence_links: ["note"],
} as const;
