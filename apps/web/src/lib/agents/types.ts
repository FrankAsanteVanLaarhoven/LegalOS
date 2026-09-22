import type { AgentId, CaseTask, Deadline, EvidenceItem, LegalCitation, TimelineEvent } from "@/lib/types";

export type SpecialistAgentId =
  | "supervisor"
  | "intake"
  | "evidence"
  | "timeline"
  | "immigration"
  | "workflow"
  | "compliance"
  | "human_review";

export interface ProposedTaskAction {
  type: "add_task";
  task: Omit<CaseTask, "id">;
}

export interface ProposedEvidenceAction {
  type: "add_evidence";
  evidence: Omit<EvidenceItem, "id">;
}

export interface ProposedTimelineAction {
  type: "add_timeline";
  event: Omit<TimelineEvent, "id">;
}

export interface ProposedDeadlineAction {
  type: "add_deadline";
  deadline: Omit<Deadline, "id">;
}

export type ProposedAction =
  | ProposedTaskAction
  | ProposedEvidenceAction
  | ProposedTimelineAction
  | ProposedDeadlineAction;

export interface SpecialistFinding {
  agentId: SpecialistAgentId;
  agentName: string;
  badge: string;
  summary: string;
  details: string[];
  citations?: LegalCitation[];
  reservedActivity?: boolean;
}

export interface OrchestrationResult {
  supervisorMessage: string;
  activeAgents: SpecialistAgentId[];
  findings: SpecialistFinding[];
  proposedActions: ProposedAction[];
  requiresHumanReview: boolean;
  guardrailNotice: string;
}
