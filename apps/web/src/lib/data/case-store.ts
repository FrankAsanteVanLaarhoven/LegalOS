import type {
  AIAnalysis,
  CaseTask,
  Deadline,
  EvidenceCategory,
  EvidenceItem,
  LegalCase,
  LegalCitation,
  TimelineEvent,
} from "@/lib/types";
import { SAPANA_CASE } from "./sapana-case.ts";

const STORAGE_KEY = "legalos_cases_v2";

/**
 * Generate UK legal analysis grounded in the client's actual entered matter types,
 * chronology events, and evidence items.
 */
export function generateAnalysisForCase(c: LegalCase): AIAnalysis {
  const matterStr = c.matterTypes.join(", ");
  const receivedEvidence = c.evidence.filter(
    (e) => e.status !== "missing" && e.status !== "requested"
  );
  const missingEvidence = c.evidence.filter(
    (e) => e.status === "missing" || e.status === "requested"
  );

  const whatIKnow = [
    `Matter types on file: ${matterStr || "General Immigration & Human Rights"} for ${c.clientName} (${c.nationality || "Nationality recorded"}).`,
    `Evidence status: ${receivedEvidence.length} of ${c.evidence.length} document items registered in the file.`,
    `Chronology contains ${c.timeline.length} recorded events with provenance data.`,
    c.summary ? `Intake summary: "${c.summary}"` : "Client intake registered in workspace.",
  ];

  const missingList =
    missingEvidence.length > 0
      ? missingEvidence.map((e) => `${e.title}: ${e.summary}`)
      : [
          "Formal proof of continuous lawful residence or travel history",
          "Independent corroborative statement or expert report",
          "Original certified biometric identity documentation",
        ];

  const alternativeInterpretations = [
    c.matterTypes.includes("Asylum")
      ? "If protection threshold is disputed under 1951 Convention, alternative humanitarian protection or Article 3 / 8 ECHR leave must be assessed."
      : c.matterTypes.includes("Skilled Worker")
        ? "If standard sponsorship salary threshold is not met, assess tradeable points criteria (PhD, STEM, shortage occupation, or new entrant concessions)."
        : c.matterTypes.includes("Family / Spouse")
          ? "If financial minimum income requirement is unmet, assess exceptional circumstances under paragraph GEN.3.1. of Appendix FM."
          : "Assess whether discretionary leave or private life grounds (Appendix Private Life) apply as an alternative pathway.",
    "Tribunal or Home Office decision-maker may assess credibility against chronological gaps in documentation.",
  ];

  const recommendedActions = [
    missingEvidence.length > 0
      ? `Prioritise obtaining: ${missingEvidence[0]?.title ?? "critical pending evidence"}.`
      : "Complete bundle assembly and prepare solicitor skeleton argument.",
    "Review timeline chronology for any date discrepancies before final submission.",
    "Submit drafted materials to regulated solicitor / OISC adviser for formal sign-off.",
  ];

  const relevantLaw: LegalCitation[] = [];
  if (c.matterTypes.some((m) => m.toLowerCase().includes("asylum") || m.toLowerCase().includes("human rights"))) {
    relevantLaw.push(
      {
        id: "law-refugee-1951",
        title: "1951 Refugee Convention, Article 1A(2)",
        source: "UNHCR / UK Immigration Act",
        type: "legislation",
        excerpt:
          "Well-founded fear of persecution for reasons of race, religion, nationality, membership of a particular social group or political opinion.",
        relevance: 0.95,
      },
      {
        id: "law-echr-art3",
        title: "European Convention on Human Rights, Article 3",
        source: "Human Rights Act 1998",
        type: "legislation",
        excerpt:
          "Prohibition of torture and inhuman or degrading treatment or punishment. Absolute protection preventing removal to face severe ill-treatment.",
        relevance: 0.9,
      }
    );
  } else if (c.matterTypes.some((m) => m.toLowerCase().includes("skilled worker"))) {
    relevantLaw.push(
      {
        id: "law-app-sw",
        title: "Immigration Rules Appendix Skilled Worker",
        source: "UK Visas and Immigration (UKVI)",
        type: "rules",
        excerpt:
          "Requires valid Certificate of Sponsorship (CoS), eligible job at appropriate skill level (RQF 3+), meeting general salary threshold, and CEFR level B1 English language.",
        relevance: 0.96,
      },
      {
        id: "law-app-ar",
        title: "Immigration Rules Appendix Continuous Residence",
        source: "Home Office Guidance",
        type: "guidance",
        excerpt:
          "Requires that the applicant must not have spent more than 180 days outside the UK in any 12-month period for qualifying settlement routes.",
        relevance: 0.88,
      }
    );
  } else if (c.matterTypes.some((m) => m.toLowerCase().includes("family") || m.toLowerCase().includes("spouse"))) {
    relevantLaw.push(
      {
        id: "law-app-fm",
        title: "Immigration Rules Appendix FM (Family Members)",
        source: "UK Visas and Immigration (UKVI)",
        type: "rules",
        excerpt:
          "Requires proof of genuine and subsisting relationship, adequate accommodation without recourse to public funds, and meeting the Minimum Income Requirement.",
        relevance: 0.94,
      },
      {
        id: "law-echr-art8",
        title: "European Convention on Human Rights, Article 8",
        source: "Human Rights Act 1998",
        type: "legislation",
        excerpt:
          "Right to respect for private and family life, subject to proportional justification under domestic immigration control.",
        relevance: 0.89,
      }
    );
  } else {
    relevantLaw.push(
      {
        id: "law-gen-rules",
        title: "Immigration Act 1971 & Immigration Rules HC 395",
        source: "UK Legislation & Home Office Rules",
        type: "legislation",
        excerpt:
          "General grounds for refusal, validity requirements for immigration applications, and standard of proof on the balance of probabilities.",
        relevance: 0.92,
      },
      {
        id: "law-oisc-rules",
        title: "OISC Code of Standards & Commissioner's Rules",
        source: "Office of the Immigration Services Commissioner",
        type: "policy",
        excerpt:
          "Advisers must act in the best interests of clients, maintain confidentiality, record all evidence provenance, and obtain client approval before submission.",
        relevance: 0.85,
      }
    );
  }

  return {
    id: `analysis-${Date.now()}`,
    agentId: "immigration",
    title: `Comprehensive Case Intelligence & Legal Map: ${c.clientName}`,
    summary: `Synthesised analysis for ${c.clientName} covering ${matterStr || "immigration matter"}. Evaluates ${c.evidence.length} evidence records against applicable UK immigration statutes and Home Office guidance.`,
    createdAt: new Date().toISOString(),
    evidenceUsed: c.evidence.map((e) => e.title),
    requiresHumanReview: true,
    reviewStatus: "pending",
    confidence: 0.92,
    whatIKnow,
    missingEvidence: missingList,
    alternativeInterpretations,
    recommendedActions,
    relevantLaw,
  };
}

/**
 * In-memory cache synced with browser LocalStorage.
 */
let casesCache: LegalCase[] | null = null;

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function loadInitialCases(): LegalCase[] {
  if (!isBrowser()) {
    return [SAPANA_CASE];
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (e) {
    console.error("Failed to read cases from localStorage:", e);
  }

  const initial = [SAPANA_CASE];
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
  } catch {
    // Ignore storage quota errors
  }
  return initial;
}

export function getCases(): LegalCase[] {
  if (!casesCache) {
    casesCache = loadInitialCases();
  }
  return casesCache;
}

function persistCases(cases: LegalCase[]): void {
  casesCache = [...cases];
  if (isBrowser()) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cases));
      window.dispatchEvent(new CustomEvent("legalos_cases_updated"));
    } catch (e) {
      console.error("Failed to persist cases to localStorage:", e);
    }
  }
}

export function getCase(id: string): LegalCase | undefined {
  return getCases().find((c) => c.id === id);
}

export interface CreateCaseInput {
  clientName: string;
  preferredName?: string;
  reference?: string;
  nationality: string;
  languages: string[];
  matterTypes: string[];
  summary: string;
  assignedSolicitor?: string;
  firm?: string;
  riskLevel?: "low" | "medium" | "high";
}

export function createCase(input: CreateCaseInput): LegalCase {
  const cases = getCases();
  const year = new Date().getFullYear();
  const randRef = Math.floor(10000 + Math.random() * 90000);
  const reference = input.reference?.trim() || `LOS-${year}-${randRef}`;
  const id = `case-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

  const newCase: LegalCase = {
    id,
    reference,
    clientName: input.clientName.trim(),
    preferredName: input.preferredName?.trim() || input.clientName.trim().split(" ")[0],
    nationality: input.nationality.trim(),
    languages: input.languages.length > 0 ? input.languages : ["English"],
    status: "intake",
    matterTypes: input.matterTypes.length > 0 ? input.matterTypes : ["Immigration"],
    summary: input.summary.trim(),
    disclaimer:
      "LegalOS helps you understand your legal situation, prepare evidence, organise documents, and work with qualified legal professionals. It is not a solicitor and does not replace regulated legal advice.",
    assignedSolicitor: input.assignedSolicitor?.trim() || "Unassigned (pending allocation)",
    firm: input.firm?.trim() || "Private Client Services",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isDemo: false,
    riskLevel: input.riskLevel || "medium",
    activeAgents: [
      "evidence",
      "immigration",
      "medical",
      "research",
      "compliance",
      "solicitor_review",
      "supervisor",
    ],
    timeline: [
      {
        id: `ev-${Date.now()}-intake`,
        date: new Date().toISOString().slice(0, 10),
        year: new Date().getFullYear(),
        title: "Client matter opened & intake registered",
        description: `Case file initiated for ${input.clientName.trim()}. Matter categories: ${input.matterTypes.join(", ")}.`,
        category: "immigration",
        evidenceIds: [],
        legalIssues: ["Intake", "Jurisdiction", "Client Care"],
        source: "user",
        confidence: 1.0,
      },
    ],
    evidence: [
      {
        id: `doc-${Date.now()}-id`,
        title: "Passport / Identity Document",
        category: "identity",
        status: "requested",
        summary: "Original or certified copy of national passport / biometric identity document.",
        confidence: 1.0,
        linkedIssues: ["Identity", "Nationality"],
        linkedEvents: [],
        tags: ["identity", "primary"],
      },
      {
        id: `doc-${Date.now()}-res`,
        title: "Proof of Address & Residence in UK",
        category: "personal",
        status: "requested",
        summary: "Utility bill, council tax statement, or formal tenancy agreement.",
        confidence: 0.95,
        linkedIssues: ["Residence", "Jurisdiction"],
        linkedEvents: [],
        tags: ["address", "residence"],
      },
    ],
    evidenceGraph: [
      {
        from: "Passport / Identity Document",
        to: "Identity Verification",
        relation: "satisfies",
      },
      {
        from: "Proof of Address & Residence in UK",
        to: "Residence Criteria",
        relation: "supports",
      },
    ],
    analyses: [],
    tasks: [
      {
        id: `task-${Date.now()}-1`,
        title: "Collate primary identification and address proof",
        description: "Obtain certified passport scan and latest tenancy/utility records.",
        priority: "high",
        status: "pending",
        agentId: "evidence",
        assignee: "Client Care Team",
        dueDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
      },
      {
        id: `task-${Date.now()}-2`,
        title: "Conduct preliminary legal eligibility check",
        description: "Check mandatory eligibility criteria against UK immigration rules.",
        priority: "medium",
        status: "pending",
        agentId: "immigration",
        assignee: input.assignedSolicitor || "Reviewing Solicitor",
        dueDate: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
      },
    ],
    deadlines: [
      {
        id: `dl-${Date.now()}-1`,
        title: "Initial Evidence Collation Target",
        date: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
        type: "soft",
        status: "upcoming",
        notes: "Target deadline to assemble core pack for legal review.",
      },
    ],
    reviews: [
      {
        id: `rev-${Date.now()}-1`,
        title: "Initial Case Assessment & Client Care Letter",
        type: "document",
        status: "pending",
        submittedBy: "Compliance Agent",
        submittedAt: new Date().toISOString(),
        notes: "Awaiting review and settlement by supervising solicitor.",
        reservedActivity: true,
      },
    ],
  };

  // Generate initial analysis
  newCase.analyses = [generateAnalysisForCase(newCase)];

  const updatedCases = [newCase, ...cases];
  persistCases(updatedCases);
  return newCase;
}

export function updateCase(id: string, updater: (c: LegalCase) => LegalCase): LegalCase | undefined {
  const cases = getCases();
  const idx = cases.findIndex((c) => c.id === id);
  if (idx === -1) return undefined;

  const current = cases[idx];
  const updated = updater({
    ...current,
    updatedAt: new Date().toISOString(),
  });

  const nextCases = [...cases];
  nextCases[idx] = updated;
  persistCases(nextCases);
  return updated;
}

export function deleteCase(id: string): boolean {
  const cases = getCases();
  const nextCases = cases.filter((c) => c.id !== id);
  if (nextCases.length === cases.length) return false;
  persistCases(nextCases);
  return true;
}

export function resetDemoCase(): void {
  const cases = getCases().filter((c) => c.id !== SAPANA_CASE.id);
  persistCases([SAPANA_CASE, ...cases]);
}

// Sub-entity helpers

export function addTimelineEvent(
  caseId: string,
  event: Omit<TimelineEvent, "id">
): LegalCase | undefined {
  return updateCase(caseId, (c) => ({
    ...c,
    timeline: [
      ...c.timeline,
      {
        ...event,
        id: `ev-${Date.now()}`,
      },
    ].sort((a, b) => a.date.localeCompare(b.date)),
  }));
}

export function deleteTimelineEvent(caseId: string, eventId: string): LegalCase | undefined {
  return updateCase(caseId, (c) => ({
    ...c,
    timeline: c.timeline.filter((e) => e.id !== eventId),
  }));
}

export function addEvidenceItem(
  caseId: string,
  item: Omit<EvidenceItem, "id">
): LegalCase | undefined {
  return updateCase(caseId, (c) => {
    const newItem: EvidenceItem = {
      ...item,
      id: `doc-${Date.now()}`,
      linkedEvents: item.linkedEvents || [],
    };
    return {
      ...c,
      evidence: [newItem, ...c.evidence],
    };
  });
}

export function toggleEvidenceStatus(
  caseId: string,
  evidenceId: string,
  nextStatus: "received" | "missing" | "requested" | "expired"
): LegalCase | undefined {
  return updateCase(caseId, (c) => ({
    ...c,
    evidence: c.evidence.map((e) =>
      e.id === evidenceId ? { ...e, status: nextStatus } : e
    ),
  }));
}

export function deleteEvidenceItem(caseId: string, evidenceId: string): LegalCase | undefined {
  return updateCase(caseId, (c) => ({
    ...c,
    evidence: c.evidence.filter((e) => e.id !== evidenceId),
  }));
}

export function addTask(caseId: string, task: Omit<CaseTask, "id">): LegalCase | undefined {
  return updateCase(caseId, (c) => {
    const newTask: CaseTask = {
      ...task,
      id: `task-${Date.now()}`,
    };
    return {
      ...c,
      tasks: [newTask, ...c.tasks],
    };
  });
}

export function toggleTaskStatus(caseId: string, taskId: string): LegalCase | undefined {
  return updateCase(caseId, (c) => ({
    ...c,
    tasks: c.tasks.map((t) =>
      t.id === taskId
        ? { ...t, status: t.status === "completed" ? "pending" : "completed" }
        : t
    ),
  }));
}

export function addDeadline(caseId: string, dl: Omit<Deadline, "id">): LegalCase | undefined {
  return updateCase(caseId, (c) => ({
    ...c,
    deadlines: [{ ...dl, id: `dl-${Date.now()}` }, ...c.deadlines].sort((a, b) =>
      a.date.localeCompare(b.date)
    ),
  }));
}

export function triggerAIAnalysis(caseId: string): LegalCase | undefined {
  return updateCase(caseId, (c) => {
    const analysis = generateAnalysisForCase(c);
    return {
      ...c,
      analyses: [analysis, ...c.analyses],
    };
  });
}
