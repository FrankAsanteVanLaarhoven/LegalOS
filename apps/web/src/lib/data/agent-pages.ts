import type { AgentId } from "@/lib/types";
import { AGENTS } from "@/lib/data/agents";

export interface AgentPageContent {
  id: AgentId | string;
  slug: string;
  name: string;
  shortName: string;
  role: string;
  summary: string;
  whatItDoes: string[];
  inputs: string[];
  outputs: string[];
  humanGate: string;
  workspaceTab?: string;
  demoHref: string;
}

const base = (id: string) => AGENTS.find((a) => a.id === id);

export const PREVIEW_AGENTS: AgentPageContent[] = [
  {
    id: "intake",
    slug: "intake",
    name: base("intake")?.name ?? "Intake Agent",
    shortName: "Intake",
    role: "Structured facts, consent, language detection",
    summary:
      "Starts every matter: who you are, what happened, which languages you speak, and what you consent to share. Built for low literacy and multilingual first contact.",
    whatItDoes: [
      "Guided questions that adapt to the matter type (asylum, student, work, family)",
      "Language detection and handoff to Translation / Voice agents",
      "Consent and privacy capture before documents are stored",
      "Conflict and urgency flags (detention, deadline, trafficking indicators)",
    ],
    inputs: ["Voice or typed answers", "Identity documents", "Preferred language"],
    outputs: ["Structured case profile", "Consent record", "Initial risk flags"],
    humanGate:
      "Sensitive vulnerability flags can be escalated to a human adviser before full intake continues.",
    workspaceTab: "overview",
    demoHref: "/workspace/cases/case-sabinah-001",
  },
  {
    id: "timeline",
    slug: "timeline",
    name: base("timeline")?.name ?? "Timeline Agent",
    shortName: "Timeline",
    role: "Chronology reconstruction with provenance",
    summary:
      "Turns scattered dates into a legal chronology — with sources attached — so solicitors and clients share one story of the journey.",
    whatItDoes: [
      "Extracts dates from statements, decisions, and uploads",
      "Links events to evidence IDs and legal issues",
      "Detects gaps and inconsistent dates",
      "Shows confidence and whether a fact is user-stated or document-backed",
    ],
    inputs: ["Witness statements", "Home Office letters", "Passport / visa history"],
    outputs: ["Chronology", "Gap list", "Event–evidence map"],
    humanGate: "Inferred events stay marked until a solicitor or client confirms them.",
    workspaceTab: "timeline",
    demoHref: "/workspace/cases/case-sabinah-001",
  },
  {
    id: "evidence",
    slug: "evidence",
    name: base("evidence")?.name ?? "Evidence Agent",
    shortName: "Evidence",
    role: "Issue matching and completeness scoring",
    summary:
      "Maps every document to the legal issues that need it — GP letter to PTSD to Article 3 to NRM/VTS — and scores what is still missing.",
    whatItDoes: [
      "Categorises medical, immigration, police, tribunal, and identity files",
      "Builds the evidence graph of relationships",
      "Opens request workflows (GP, therapist, employer letters)",
      "Completeness scoring for tribunal readiness",
    ],
    inputs: ["Uploaded PDFs / photos", "Requested evidence status"],
    outputs: ["Evidence register", "Completeness score", "Request letters (draft)"],
    humanGate:
      "Evidence requests to third parties are sent only after solicitor or client approval.",
    workspaceTab: "evidence",
    demoHref: "/workspace/cases/case-sabinah-001",
  },
  {
    id: "research",
    slug: "research",
    name: base("research")?.name ?? "Research Agent",
    shortName: "Research",
    role: "Rules, guidance, and cited authorities",
    summary:
      "Retrieves Immigration Rules, Home Office guidance, legislation, and tribunal-relevant materials with citations — never bare assertions.",
    whatItDoes: [
      "RAG over legislation and guidance with source links",
      "Citation verification and confidence notes",
      "Policy update awareness (when corpus is refreshed)",
      "Alternative interpretations called out in plain language",
    ],
    inputs: ["Case issues", "Country / route context", "Public legal corpus"],
    outputs: ["Cited briefings", "Source list", "Open questions for counsel"],
    humanGate:
      "Research outputs are explanatory, not legal advice. Strategy is settled by a regulated professional.",
    workspaceTab: "analysis",
    demoHref: "/resources",
  },
  {
    id: "medical",
    slug: "medical",
    name: base("medical")?.name ?? "Medical Evidence Agent",
    shortName: "Medical",
    role: "GP, therapy, and medico-legal workflows",
    summary:
      "Identifies clinical evidence needs for protection and vulnerability, and drafts request packs solicitors can settle.",
    whatItDoes: [
      "Flags trauma / PTSD indicators from existing records",
      "Drafts GP and therapist request letters",
      "Tracks medico-legal expert instruction status",
      "Links medical nodes into the evidence graph",
    ],
    inputs: ["GP letters", "Therapy notes", "Client-reported symptoms"],
    outputs: ["Medical evidence plan", "Draft request letters", "Expert instruction checklist"],
    humanGate: "Expert instruction and clinical disclosure require solicitor / client authority.",
    workspaceTab: "tasks",
    demoHref: "/workspace/cases/case-sabinah-001",
  },
  {
    id: "compliance",
    slug: "compliance",
    name: base("compliance")?.name ?? "Compliance Agent",
    shortName: "Compliance",
    role: "Deadlines, gaps, and consistency checks",
    summary:
      "Deadline radar and quality checks: missing signatures, expired status documents, date clashes, and form completeness.",
    whatItDoes: [
      "Tracks hard, soft, and eligibility deadlines",
      "Date consistency across the chronology",
      "Status document / eVisa monitoring prompts",
      "Audit trail of automated checks",
    ],
    inputs: ["Case calendar", "Evidence register", "Leave conditions"],
    outputs: ["Deadline list", "QA flags", "Compliance checklist"],
    humanGate: "Filing decisions remain human. The agent only warns and prepares.",
    workspaceTab: "deadlines",
    demoHref: "/workspace/cases/case-sabinah-001",
  },
  {
    id: "document",
    slug: "document",
    name: base("document")?.name ?? "Document Agent",
    shortName: "Document",
    role: "Drafts under version control",
    summary:
      "Drafts witness statements, appeals, skeletons, complaint letters, and bundle indexes — versioned and never auto-filed.",
    whatItDoes: [
      "Template packs for common immigration workflows",
      "Version control and tracked changes",
      "Bundle / chronology assembly",
      "Routes drafts into the solicitor review queue",
    ],
    inputs: ["Timeline", "Evidence", "Research notes", "Client instructions"],
    outputs: ["Versioned drafts", "Bundle index", "Review tickets"],
    humanGate:
      "Reserved legal drafting is settled and signed off by a qualified professional before use.",
    workspaceTab: "documents",
    demoHref: "/workspace/cases/case-sabinah-001",
  },
  {
    id: "solicitor_review",
    slug: "solicitor-review",
    name: base("solicitor_review")?.name ?? "Solicitor Review Agent",
    shortName: "Solicitor Review",
    role: "Human approval for reserved work",
    summary:
      "The approval gate: routes high-stakes drafts and analyses to regulated solicitors so nothing reserved leaves without a human.",
    whatItDoes: [
      "Review queues with priority and reserved-activity flags",
      "Approve / request changes / reject workflows",
      "Privilege-aware sharing controls",
      "Audit log of who approved what and when",
    ],
    inputs: ["AI drafts", "Analyses", "Evidence packs"],
    outputs: ["Approved artefacts", "Change requests", "Submission-ready packs"],
    humanGate: "This agent never substitutes judgment. It only orchestrates human review.",
    workspaceTab: "review",
    demoHref: "/enterprise#representatives",
  },
];

export function getAgentPage(slug: string): AgentPageContent | undefined {
  return PREVIEW_AGENTS.find((a) => a.slug === slug || a.id === slug);
}

export function getAllAgentSlugs(): string[] {
  return PREVIEW_AGENTS.map((a) => a.slug);
}
