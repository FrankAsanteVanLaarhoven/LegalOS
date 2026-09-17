export type CaseStatus =
  | "intake"
  | "evidence_collection"
  | "analysis"
  | "lawyer_review"
  | "appeal_pending"
  | "submitted"
  | "closed";

export type EvidenceCategory =
  | "medical"
  | "immigration"
  | "police"
  | "tribunal"
  | "identity"
  | "employment"
  | "personal"
  | "other";

export type AgentId =
  | "intake"
  | "timeline"
  | "evidence"
  | "immigration"
  | "employment"
  | "research"
  | "document"
  | "translation"
  | "hearing"
  | "compliance"
  | "medical"
  | "tribunal"
  | "appeal"
  | "voice"
  | "solicitor_review"
  | "supervisor";

export type TaskStatus = "pending" | "in_progress" | "blocked" | "completed" | "needs_review";
export type ReviewStatus = "pending" | "approved" | "rejected" | "changes_requested";

export interface TimelineEvent {
  id: string;
  date: string;
  year: number;
  title: string;
  description: string;
  category: string;
  evidenceIds: string[];
  legalIssues: string[];
  source: "user" | "document" | "ai_inferred";
  confidence: number;
}

export interface EvidenceItem {
  id: string;
  title: string;
  category: EvidenceCategory;
  date?: string;
  summary: string;
  linkedIssues: string[];
  linkedEvents: string[];
  status: "received" | "requested" | "missing" | "expired";
  confidence: number;
  tags: string[];
}

export interface EvidenceEdge {
  from: string;
  to: string;
  relation: string;
}

export interface LegalCitation {
  id: string;
  title: string;
  source: string;
  type: "legislation" | "rules" | "guidance" | "case_law" | "policy";
  url?: string;
  excerpt: string;
  relevance: number;
}

export interface AIAnalysis {
  id: string;
  agentId: AgentId;
  title: string;
  summary: string;
  whatIKnow: string[];
  evidenceUsed: string[];
  relevantLaw: LegalCitation[];
  confidence: number;
  alternativeInterpretations: string[];
  missingEvidence: string[];
  recommendedActions: string[];
  createdAt: string;
  requiresHumanReview: boolean;
  reviewStatus: ReviewStatus;
}

export interface CaseTask {
  id: string;
  title: string;
  description: string;
  agentId?: AgentId;
  status: TaskStatus;
  priority: "low" | "medium" | "high" | "critical";
  dueDate?: string;
  assignee?: string;
}

export interface Deadline {
  id: string;
  title: string;
  date: string;
  type: "hard" | "soft" | "eligibility";
  status: "upcoming" | "overdue" | "completed";
  notes?: string;
}

export interface LawyerReviewItem {
  id: string;
  title: string;
  type: "document" | "analysis" | "submission" | "advice";
  status: ReviewStatus;
  submittedBy: string;
  submittedAt: string;
  notes?: string;
  reservedActivity: boolean;
}

export interface AgentDefinition {
  id: AgentId;
  name: string;
  role: string;
  description: string;
  status: "idle" | "active" | "waiting" | "completed";
  capabilities: string[];
}

export interface LegalCase {
  id: string;
  reference: string;
  clientName: string;
  preferredName?: string;
  nationality: string;
  languages: string[];
  status: CaseStatus;
  matterTypes: string[];
  summary: string;
  disclaimer: string;
  assignedSolicitor?: string;
  firm?: string;
  createdAt: string;
  updatedAt: string;
  timeline: TimelineEvent[];
  evidence: EvidenceItem[];
  evidenceGraph: EvidenceEdge[];
  analyses: AIAnalysis[];
  tasks: CaseTask[];
  deadlines: Deadline[];
  reviews: LawyerReviewItem[];
  activeAgents: AgentId[];
  /**
   * Marks fixture data so the workspace can say so on screen. The demo case
   * carries realistic special-category detail (nationality, trafficking, NRM,
   * PTSD) and previously rendered exactly like a live matter.
   */
  isDemo: boolean;
  riskLevel: "low" | "medium" | "high";
}
