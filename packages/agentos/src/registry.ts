import type { AgentDefinition } from "./types.ts";

/**
 * The registry. One list, reconciling the four that disagreed.
 *
 * Every agent referenced anywhere in the platform appears here, including the
 * ones that exist only as a page or a name in a marketing list. That is
 * deliberate: an agent that is shown to a person is an agent the platform is
 * claiming to have, and the honest place for it is a registry entry with a
 * `draft` ceiling rather than absence from the one list that governs.
 *
 * Ceilings are set low and stay low until evidence moves them. Two agents are
 * `testing` because the routes that name them run through the runner; the rest
 * are `draft` because nothing calls them at all. None is higher, because no
 * agent has produced a single recorded execution yet.
 */

function agent(definition: AgentDefinition): AgentDefinition {
  return definition;
}

export const AGENTS: readonly AgentDefinition[] = [
  // ---- Platform ----
  agent({
    id: "public-companion",
    name: "Companion",
    department: "platform",
    version: "0.1.0",
    declaredCeiling: "testing",
    description:
      "Explains processes and routes questions to a specialist. Holds no legal expertise of its own and answers no legal question directly.",
    capabilities: ["conversation"],
    // Reads nothing. A public conversation has no case attached, and the
    // widget that used to default to a demo case put one client's asylum,
    // trafficking and medical history into every public answer.
    permissions: [],
    retrievalDomains: [],
    requiresVerification: true,
    requiresHumanReview: false,
    observableInvariants: ["AI-002", "AI-003", "AU-005"],
  }),
  agent({
    id: "case-companion",
    name: "Case Companion",
    department: "platform",
    version: "0.1.0",
    declaredCeiling: "testing",
    description: "The same receptionist, with a case in scope.",
    capabilities: ["conversation"],
    permissions: ["read_case", "read_evidence", "read_timeline"],
    retrievalDomains: ["case"],
    requiresVerification: true,
    requiresHumanReview: false,
    observableInvariants: ["AI-002", "AI-003", "AU-005", "INV-001"],
  }),
  agent({
    id: "supervisor",
    name: "Supervisor",
    department: "platform",
    version: "0.1.0",
    declaredCeiling: "draft",
    description: "Routes work to specialists and escalates what needs a person.",
    capabilities: ["conversation", "deep_reasoning"],
    permissions: ["read_case", "propose_action"],
    retrievalDomains: ["case"],
    requiresVerification: true,
    requiresHumanReview: false,
    observableInvariants: ["AI-003", "AU-005"],
  }),
  agent({
    id: "voice",
    name: "Voice",
    department: "platform",
    version: "0.1.0",
    declaredCeiling: "draft",
    description: "Speech in and out, for people who find typing hard or slow.",
    capabilities: ["speech", "conversation"],
    permissions: [],
    retrievalDomains: [],
    requiresVerification: true,
    requiresHumanReview: false,
    observableInvariants: ["AI-002", "AU-005"],
  }),

  // ---- Migration ----
  agent({
    id: "intake",
    name: "Intake",
    department: "migration",
    version: "0.1.0",
    declaredCeiling: "draft",
    description: "Collects what a case needs, in the order a person can actually supply it.",
    capabilities: ["conversation", "structured_extraction"],
    permissions: ["read_case", "write_tasks"],
    retrievalDomains: ["case"],
    requiresVerification: true,
    requiresHumanReview: false,
    observableInvariants: ["AU-005", "INV-001"],
  }),
  agent({
    id: "legal-analysis",
    name: "Legal Analysis",
    department: "legal",
    version: "0.1.0",
    declaredCeiling: "testing",
    description:
      "Structured readiness analysis over a case. Proposes; never concludes, and never files.",
    capabilities: ["deep_reasoning", "retrieval"],
    permissions: ["read_case", "read_evidence", "read_timeline", "propose_action"],
    retrievalDomains: ["case", "uk_law"],
    requiresVerification: true,
    requiresHumanReview: true,
    observableInvariants: ["AI-001", "AI-002", "AU-004", "AU-005"],
  }),
  agent({
    id: "evidence",
    name: "Evidence",
    department: "migration",
    version: "0.1.0",
    declaredCeiling: "draft",
    description: "Assesses what evidence exists, what is missing and what is unreadable.",
    capabilities: ["structured_extraction", "deep_reasoning"],
    permissions: ["read_case", "read_evidence", "propose_action"],
    retrievalDomains: ["case"],
    requiresVerification: true,
    requiresHumanReview: false,
    observableInvariants: ["EV-001", "EV-002", "EV-005", "AU-005"],
  }),
  agent({
    id: "timeline",
    name: "Timeline",
    department: "migration",
    version: "0.1.0",
    declaredCeiling: "draft",
    description: "Builds a chronology from evidence, and marks what is unevidenced as such.",
    capabilities: ["structured_extraction", "deep_reasoning"],
    permissions: ["read_case", "read_evidence", "read_communications", "write_timeline"],
    retrievalDomains: ["case"],
    requiresVerification: true,
    requiresHumanReview: false,
    observableInvariants: ["EV-005", "AU-005"],
  }),
  agent({
    id: "tribunal",
    name: "Tribunal Bundle",
    department: "migration",
    version: "0.1.0",
    declaredCeiling: "draft",
    description: "Assembles, paginates and indexes a bundle. Edits nothing it assembles.",
    capabilities: ["structured_extraction"],
    permissions: ["read_case", "read_evidence", "read_timeline", "assemble_bundle"],
    retrievalDomains: ["case"],
    requiresVerification: true,
    requiresHumanReview: true,
    observableInvariants: ["EV-001", "AU-005"],
  }),
  agent({
    id: "appeal",
    name: "Appeal",
    department: "migration",
    version: "0.1.0",
    declaredCeiling: "draft",
    description: "Prepares appeal material for a regulated adviser to settle.",
    capabilities: ["deep_reasoning", "retrieval"],
    permissions: ["read_case", "read_evidence", "write_draft", "propose_action"],
    retrievalDomains: ["case", "uk_law", "case_law"],
    requiresVerification: true,
    requiresHumanReview: true,
    observableInvariants: ["AI-001", "AI-002", "AU-005"],
  }),
  agent({
    id: "hearing",
    name: "Hearing Preparation",
    department: "migration",
    version: "0.1.0",
    declaredCeiling: "draft",
    description: "Practice and preparation for a hearing. Rehearsal, not coaching on answers.",
    capabilities: ["conversation", "deep_reasoning"],
    permissions: ["read_case", "read_evidence"],
    retrievalDomains: ["case"],
    requiresVerification: true,
    requiresHumanReview: false,
    observableInvariants: ["AI-002", "AU-005"],
  }),
  agent({
    id: "compliance",
    name: "Deadlines & Compliance",
    department: "migration",
    version: "0.1.0",
    declaredCeiling: "draft",
    description: "Tracks deadlines, each traceable to the document that set it.",
    capabilities: ["structured_extraction"],
    permissions: ["read_case", "read_evidence", "read_communications", "write_tasks"],
    retrievalDomains: ["case"],
    requiresVerification: true,
    requiresHumanReview: false,
    observableInvariants: ["EV-005", "AU-005"],
  }),

  // ---- Legal ----
  agent({
    id: "research",
    name: "Legal Research",
    department: "legal",
    version: "0.1.0",
    declaredCeiling: "draft",
    description: "Finds and cites primary sources. States nothing that is not in what it found.",
    capabilities: ["retrieval", "deep_reasoning"],
    permissions: ["read_case"],
    retrievalDomains: ["uk_law", "case_law", "guidance"],
    requiresVerification: true,
    requiresHumanReview: false,
    observableInvariants: ["AI-001", "AI-002", "AU-005"],
  }),
  agent({
    id: "immigration",
    name: "Immigration Rules",
    department: "visa",
    version: "0.1.0",
    declaredCeiling: "draft",
    description: "Applies the Immigration Rules to recorded facts, showing which rule and why.",
    capabilities: ["deep_reasoning", "retrieval"],
    permissions: ["read_case", "read_evidence"],
    retrievalDomains: ["uk_law", "guidance"],
    requiresVerification: true,
    requiresHumanReview: true,
    observableInvariants: ["AI-001", "AI-002", "AU-005"],
  }),
  agent({
    id: "employment",
    name: "Employment Status",
    department: "visa",
    version: "0.1.0",
    declaredCeiling: "draft",
    description: "Employment and right-to-work questions arising from a migration case.",
    capabilities: ["deep_reasoning", "retrieval"],
    permissions: ["read_case", "read_evidence"],
    retrievalDomains: ["uk_law", "guidance"],
    requiresVerification: true,
    requiresHumanReview: true,
    observableInvariants: ["AI-001", "AU-005"],
  }),
  agent({
    id: "family",
    name: "Family Migration",
    department: "visa",
    version: "0.1.0",
    declaredCeiling: "draft",
    description: "Family route questions, including where a child's interests are engaged.",
    capabilities: ["deep_reasoning", "retrieval"],
    permissions: ["read_case", "read_evidence"],
    retrievalDomains: ["uk_law", "guidance"],
    requiresVerification: true,
    requiresHumanReview: true,
    observableInvariants: ["AI-001", "AU-005"],
  }),

  // ---- Refugee & public services ----
  agent({
    id: "housing",
    name: "Housing",
    department: "refugee",
    version: "0.1.0",
    declaredCeiling: "draft",
    description: "Accommodation and homelessness duties during and after a claim.",
    capabilities: ["retrieval", "conversation"],
    permissions: ["read_case"],
    retrievalDomains: ["guidance", "local_authority"],
    requiresVerification: true,
    requiresHumanReview: false,
    observableInvariants: ["AI-001", "AU-005"],
  }),
  agent({
    id: "medical",
    name: "Medical Evidence",
    department: "refugee",
    version: "0.1.0",
    declaredCeiling: "draft",
    description:
      "Handles medical evidence, including material about torture and trafficking. Never summarises trauma back to the person who reported it.",
    capabilities: ["structured_extraction"],
    permissions: ["read_case", "read_evidence"],
    retrievalDomains: ["case"],
    requiresVerification: true,
    requiresHumanReview: true,
    observableInvariants: ["EV-003", "PR-003", "AU-005"],
  }),

  // ---- Cross-cutting ----
  agent({
    id: "translation",
    name: "Translation",
    department: "platform",
    version: "0.1.0",
    declaredCeiling: "draft",
    description: "Translates, and always keeps the original resolvable from the translation.",
    capabilities: ["translation"],
    permissions: ["read_evidence"],
    retrievalDomains: ["case"],
    requiresVerification: true,
    requiresHumanReview: false,
    observableInvariants: ["EV-004", "AU-005"],
  }),
  agent({
    id: "document",
    name: "Document",
    department: "platform",
    version: "0.1.0",
    declaredCeiling: "draft",
    description: "Reads documents into structured form, recording the engine and its confidence.",
    capabilities: ["ocr", "vision", "structured_extraction"],
    permissions: ["read_evidence"],
    retrievalDomains: ["case"],
    requiresVerification: true,
    requiresHumanReview: false,
    observableInvariants: ["EV-002", "EV-003", "AU-005"],
  }),
  agent({
    id: "solicitor-review",
    name: "Professional Review",
    department: "legal",
    version: "0.1.0",
    declaredCeiling: "draft",
    description:
      "Prepares material for a named qualified human to authorise. Proposes only, and the authorisation is theirs.",
    capabilities: ["deep_reasoning"],
    permissions: ["read_case", "read_evidence", "propose_action"],
    retrievalDomains: ["case", "uk_law"],
    requiresVerification: true,
    requiresHumanReview: true,
    observableInvariants: ["AI-003", "AU-005"],
  }),
];

const BY_ID = new Map(AGENTS.map((a) => [a.id, a] as const));

/** Resolves an agent, or null. Callers must refuse on null rather than default. */
export function findAgent(id: string): AgentDefinition | null {
  return BY_ID.get(id) ?? null;
}

export function agentIds(): readonly string[] {
  return [...BY_ID.keys()].sort();
}

export function byDepartment(department: string): readonly AgentDefinition[] {
  return AGENTS.filter((a) => a.department === department);
}

/** Whether an agent holds a permission. There are no implicit grants. */
export function may(agent: AgentDefinition, permission: string): boolean {
  return (agent.permissions as readonly string[]).includes(permission);
}
