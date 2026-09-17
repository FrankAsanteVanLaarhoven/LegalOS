/**
 * Multi-agent architecture definitions for LegalOS.
 * Each agent has bounded responsibilities, tools, and structured outputs.
 */

export type AgentId =
  | "supervisor"
  | "intake"
  | "immigration"
  | "employment"
  | "family"
  | "housing"
  | "research"
  | "evidence"
  | "timeline"
  | "translation"
  | "document"
  | "human_review";

export interface AgentSpec {
  id: AgentId;
  name: string;
  responsibilities: string[];
  tools: string[];
  outputs: string[];
  requiresHumanGate: boolean;
}

export const AGENT_SPECS: AgentSpec[] = [
  {
    id: "supervisor",
    name: "Supervisor Agent",
    responsibilities: [
      "Route work to specialist agents",
      "Enforce policy gates",
      "Escalate risk",
      "Compose final audit trail",
    ],
    tools: ["agent_graph", "risk_score", "policy_check"],
    outputs: ["orchestration_plan", "escalations"],
    requiresHumanGate: false,
  },
  {
    id: "intake",
    name: "Intake Agent",
    responsibilities: ["Collect facts", "Consent", "Language detection"],
    tools: ["form_schema", "speech_to_text", "consent_capture"],
    outputs: ["case_profile", "consent_record"],
    requiresHumanGate: false,
  },
  {
    id: "immigration",
    name: "Immigration Agent",
    responsibilities: ["Routes", "Status", "Rules mapping"],
    tools: ["rules_rag", "status_map"],
    outputs: ["route_analysis", "citations"],
    requiresHumanGate: true,
  },
  {
    id: "employment",
    name: "Employment Agent",
    responsibilities: ["Right to Work", "Sponsor compliance"],
    tools: ["rtw_rules", "salary_thresholds"],
    outputs: ["employment_status_brief"],
    requiresHumanGate: true,
  },
  {
    id: "family",
    name: "Family Agent",
    responsibilities: ["Family routes", "Dependants"],
    tools: ["family_rules_rag"],
    outputs: ["family_eligibility_brief"],
    requiresHumanGate: true,
  },
  {
    id: "housing",
    name: "Housing Agent",
    responsibilities: ["Right to Rent", "Accommodation evidence"],
    tools: ["rtr_guidance"],
    outputs: ["housing_checklist"],
    requiresHumanGate: false,
  },
  {
    id: "research",
    name: "Research Agent",
    responsibilities: ["Legislation", "Guidance", "Case law retrieval"],
    tools: ["legal_rag", "citation_verify"],
    outputs: ["research_memo", "sources"],
    requiresHumanGate: true,
  },
  {
    id: "evidence",
    name: "Evidence Agent",
    responsibilities: ["Issue matching", "Completeness scoring"],
    tools: ["evidence_graph", "completeness_score"],
    outputs: ["evidence_register", "gaps"],
    requiresHumanGate: false,
  },
  {
    id: "timeline",
    name: "Timeline Agent",
    responsibilities: ["Chronology reconstruction", "Provenance"],
    tools: ["date_extract", "event_link"],
    outputs: ["chronology", "confidence"],
    requiresHumanGate: false,
  },
  {
    id: "translation",
    name: "Translation Agent",
    responsibilities: ["Multilingual intake", "Solicitor-ready English"],
    tools: ["mt", "glossary"],
    outputs: ["translation", "qa_notes"],
    requiresHumanGate: false,
  },
  {
    id: "document",
    name: "Document Agent",
    responsibilities: ["Drafts under version control"],
    tools: ["templates", "bundle_builder"],
    outputs: ["draft_document", "version"],
    requiresHumanGate: true,
  },
  {
    id: "human_review",
    name: "Human Review Agent",
    responsibilities: ["Route reserved work to solicitors", "Approvals"],
    tools: ["review_queue", "audit_log"],
    outputs: ["approval", "change_request"],
    requiresHumanGate: true,
  },
];
