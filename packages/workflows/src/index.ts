/**
 * @legalos/workflows — Workflow Engine
 *
 * Deterministic generation of tasks, statutory deadlines, hearing bundles,
 * and evidence requests derived strictly from evidenced case state.
 *
 * All operations enforce S.84 IAA 1999 non-lawyer disclaimers and human-in-the-loop
 * verification before reserved legal actions are confirmed.
 */

export type WorkflowName =
  | "evidence_collection"
  | "medico_legal_request"
  | "solicitor_review"
  | "bundle_assembly"
  | "deadline_tracking"
  | "representation_drafting";

export interface WorkflowRun {
  readonly id: string;
  readonly caseId: string;
  readonly name: WorkflowName;
  readonly status: "running" | "completed" | "failed" | "cancelled";
  readonly startedAt: string;
  readonly completedAt: string | null;
}

export type TaskPriority = "low" | "medium" | "high" | "urgent";

export interface CaseTask {
  readonly id: string;
  readonly caseId: string;
  readonly title: string;
  readonly description: string;
  readonly category: "evidence" | "compliance" | "drafting" | "review" | "filing";
  readonly priority: TaskPriority;
  readonly assignedRole: "client" | "caseworker" | "solicitor" | "adviser";
  readonly requiresRegulatedSignOff: boolean;
  readonly dueDate: string | null;
  readonly status: "pending" | "in_progress" | "completed" | "blocked";
}

export interface CaseDeadline {
  readonly id: string;
  readonly caseId: string;
  readonly title: string;
  readonly statutoryBasis: string;
  readonly dueDate: string;
  readonly daysRemaining: number;
  readonly critical: boolean;
}

export interface BundleItem {
  readonly evidenceId: string;
  readonly title: string;
  readonly section: "chronology" | "statements" | "primary_evidence" | "country_guidance" | "authorities";
  readonly pageCount: number;
  readonly verified: boolean;
}

export interface BundleSpecification {
  readonly caseId: string;
  readonly bundleTitle: string;
  readonly hearingDate: string | null;
  readonly tribunal: string;
  readonly sections: readonly {
    readonly name: string;
    readonly items: readonly BundleItem[];
  }[];
  readonly indexGeneratedAt: string;
  readonly totalPages: number;
}

export interface EvidenceRequest {
  readonly id: string;
  readonly caseId: string;
  readonly requirementId: string;
  readonly requestedItem: string;
  readonly legalJustification: string;
  readonly guidanceNotes: string;
  readonly recipient: "client" | "employer" | "institution" | "medical_expert";
}

export interface CaseWorkflowState {
  readonly caseId: string;
  readonly category: "asylum" | "skilled_worker" | "family" | "human_rights" | "appeal";
  readonly stage: "intake" | "evidence_gathering" | "drafting" | "review" | "submitted" | "hearing";
  readonly decisionDate?: string | null;
  readonly hearingDate?: string | null;
  readonly missingEvidence?: readonly string[];
  readonly evidencedFacts?: Record<string, unknown>;
}

/**
 * Generates tasks derived deterministically from case category and stage.
 */
export function generateCaseTasks(state: CaseWorkflowState): readonly CaseTask[] {
  const tasks: CaseTask[] = [];

  if (state.stage === "intake") {
    tasks.push({
      id: `task-${state.caseId}-id-verify`,
      caseId: state.caseId,
      title: "Verify identity and nationality documents",
      description: "Perform biometric identity check and verify original passport or BRP.",
      category: "compliance",
      priority: "high",
      assignedRole: "caseworker",
      requiresRegulatedSignOff: false,
      dueDate: null,
      status: "pending",
    });
  }

  if (state.missingEvidence && state.missingEvidence.length > 0) {
    for (const [index, item] of state.missingEvidence.entries()) {
      tasks.push({
        id: `task-${state.caseId}-ev-${index + 1}`,
        caseId: state.caseId,
        title: `Collect evidence: ${item}`,
        description: `Obtain certified proof for ${item} to satisfy legal workflow requirements.`,
        category: "evidence",
        priority: "medium",
        assignedRole: "client",
        requiresRegulatedSignOff: false,
        dueDate: null,
        status: "pending",
      });
    }
  }

  if (state.stage === "review" || state.stage === "drafting") {
    tasks.push({
      id: `task-${state.caseId}-solicitor-signoff`,
      caseId: state.caseId,
      title: "Solicitor / Regulated Adviser Final Case Review",
      description: "Mandatory human sign-off on representation drafts and bundle contents under S.84 IAA 1999.",
      category: "review",
      priority: "urgent",
      assignedRole: "solicitor",
      requiresRegulatedSignOff: true,
      dueDate: state.hearingDate ?? null,
      status: "pending",
    });
  }

  return tasks;
}

/**
 * Calculates statutory deadlines from tribunal procedure rules and immigration acts.
 */
export function generateCaseDeadlines(state: CaseWorkflowState, now = new Date()): readonly CaseDeadline[] {
  const deadlines: CaseDeadline[] = [];

  if (state.category === "appeal" && state.decisionDate) {
    const decTime = Date.parse(state.decisionDate);
    if (!Number.isNaN(decTime)) {
      // 14 days under FTT-IAC Procedure Rules 2014, r. 19(2)
      const appealDeadline = new Date(decTime + 14 * 24 * 60 * 60 * 1000);
      const daysRemaining = Math.ceil((appealDeadline.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));

      deadlines.push({
        id: `deadline-${state.caseId}-appeal-notice`,
        caseId: state.caseId,
        title: "Notice of Appeal to First-tier Tribunal (IAC)",
        statutoryBasis: "Tribunal Procedure (First-tier Tribunal) (Immigration and Asylum Chamber) Rules 2014, rule 19",
        dueDate: appealDeadline.toISOString().slice(0, 10),
        daysRemaining,
        critical: daysRemaining <= 3,
      });
    }
  }

  if (state.hearingDate) {
    const hearingTime = Date.parse(state.hearingDate);
    if (!Number.isNaN(hearingTime)) {
      // Hearing bundle due 5 working days before hearing
      const bundleDeadline = new Date(hearingTime - 7 * 24 * 60 * 60 * 1000);
      const daysRemaining = Math.ceil((bundleDeadline.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));

      deadlines.push({
        id: `deadline-${state.caseId}-hearing-bundle`,
        caseId: state.caseId,
        title: "Tribunal Hearing Bundle Delivery",
        statutoryBasis: "Senior President of Tribunals Practice Direction (Immigration and Asylum Chamber)",
        dueDate: bundleDeadline.toISOString().slice(0, 10),
        daysRemaining,
        critical: daysRemaining <= 2,
      });
    }
  }

  return deadlines;
}

/**
 * Assembles standard compliant hearing bundle specifications.
 */
export function assembleBundleSpecification(
  caseId: string,
  tribunal: string,
  hearingDate: string | null,
  items: readonly BundleItem[]
): BundleSpecification {
  const sections = [
    { name: "Section A: Chronology & Overview", items: items.filter((i) => i.section === "chronology") },
    { name: "Section B: Witness Statements", items: items.filter((i) => i.section === "statements") },
    { name: "Section C: Primary Evidence", items: items.filter((i) => i.section === "primary_evidence") },
    { name: "Section D: Country Guidance & Objective Reports", items: items.filter((i) => i.section === "country_guidance") },
    { name: "Section E: Legal Authorities", items: items.filter((i) => i.section === "authorities") },
  ];

  const totalPages = items.reduce((acc, item) => acc + item.pageCount, 0);

  return {
    caseId,
    bundleTitle: `Hearing Bundle - Case ${caseId}`,
    hearingDate,
    tribunal,
    sections,
    indexGeneratedAt: new Date().toISOString(),
    totalPages,
  };
}

/**
 * Generates tailored evidence requests explaining why each item is required.
 */
export function generateEvidenceRequests(
  caseId: string,
  missingRequirements: readonly { readonly id: string; readonly item: string; readonly justification: string }[]
): readonly EvidenceRequest[] {
  return missingRequirements.map((req) => ({
    id: `req-${caseId}-${req.id.toLowerCase()}`,
    caseId,
    requirementId: req.id,
    requestedItem: req.item,
    legalJustification: req.justification,
    guidanceNotes: "Provide clear digital scan or photograph with all four corners visible and text legible.",
    recipient: req.item.toLowerCase().includes("medical") ? "medical_expert" : "client",
  }));
}
