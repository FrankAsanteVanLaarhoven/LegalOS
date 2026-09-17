import type { AgentDefinition } from "@/lib/types";

export const AGENTS: AgentDefinition[] = [
  {
    id: "intake",
    name: "Intake Agent",
    role: "Information collection",
    description:
      "Collects structured case facts through intelligent questioning, multilingual voice, and document upload.",
    status: "completed",
    capabilities: ["Structured intake", "Language detection", "Consent capture", "Conflict checks"],
  },
  {
    id: "timeline",
    name: "Timeline Agent",
    role: "Chronology reconstruction",
    description:
      "Builds a legal chronology from statements, documents, and Home Office correspondence.",
    status: "completed",
    capabilities: ["Date extraction", "Event linking", "Gap detection", "Source provenance"],
  },
  {
    id: "evidence",
    name: "Evidence Agent",
    role: "Evidence orchestration",
    description:
      "Maps documents to legal issues, scores completeness, and initiates evidence request workflows.",
    status: "active",
    capabilities: [
      "Issue matching",
      "Request generation",
      "Completeness scoring",
      "Chain of custody",
    ],
  },
  {
    id: "immigration",
    name: "Immigration Agent",
    role: "UK immigration pathways",
    description:
      "Analyses visa routes, asylum, NRM, VTS, ILR, citizenship, eVisa and Right to Work conditions.",
    status: "active",
    capabilities: ["Rules mapping", "Route eligibility", "Status tracking", "Switching analysis"],
  },
  {
    id: "employment",
    name: "Employment Agent",
    role: "Work & sponsor compliance",
    description:
      "Explains Right to Work, Share Codes, CoS, salary thresholds, and employer compliance obligations.",
    status: "idle",
    capabilities: ["RTW checks", "Sponsor licence", "Hours/salary rules", "Switching routes"],
  },
  {
    id: "medical",
    name: "Medical Evidence Agent",
    role: "Clinical evidence",
    description:
      "Identifies medical evidence needs (GP, therapist, medico-legal) and drafts request letters.",
    status: "active",
    capabilities: ["PTSD/trauma flags", "GP requests", "Medico-legal pack", "NHS pathway prompts"],
  },
  {
    id: "research",
    name: "Research Agent",
    role: "Legal research",
    description:
      "Retrieves Immigration Rules, Home Office guidance, tribunal decisions and legislation with citations.",
    status: "active",
    capabilities: [
      "RAG over corpus",
      "Citation verification",
      "Policy updates",
      "Country guidance",
    ],
  },
  {
    id: "document",
    name: "Document Agent",
    role: "Drafting",
    description:
      "Generates witness statements, appeals, skeletons, D11s, reconsideration requests and bundles.",
    status: "waiting",
    capabilities: ["Version control", "Template packs", "Bundle assembly", "Tracked changes"],
  },
  {
    id: "translation",
    name: "Translation Agent",
    role: "Multilingual access",
    description:
      "Translates 100+ languages into solicitor-ready English with legal terminology fidelity.",
    status: "idle",
    capabilities: ["Speech-to-text", "Legal glossary", "Back-translation QA", "Easy English mode"],
  },
  {
    id: "hearing",
    name: "Hearing Preparation Agent",
    role: "Tribunal readiness",
    description:
      "Simulates tribunal questions, credibility testing and cross-examination practice.",
    status: "idle",
    capabilities: ["Mock hearing", "Credibility drills", "Judge Q bank", "Stress-aware coaching"],
  },
  {
    id: "compliance",
    name: "Compliance Agent",
    role: "Deadlines & QA",
    description:
      "Checks missing evidence, incorrect dates, expired status documents and signature gaps.",
    status: "active",
    capabilities: ["Deadline radar", "Form QA", "Date consistency", "Audit trail"],
  },
  {
    id: "tribunal",
    name: "Tribunal Agent",
    role: "Appeals procedure",
    description:
      "Supports First-tier and Upper Tribunal procedure, directions compliance and bundle structure.",
    status: "waiting",
    capabilities: ["Procedure map", "Directions tracker", "Bundle index", "Listing prep"],
  },
  {
    id: "appeal",
    name: "Appeal Agent",
    role: "Grounds & grounds drafting",
    description:
      "Structures grounds of appeal, error of law analysis and human rights submissions.",
    status: "waiting",
    capabilities: ["Grounds structure", "Error of law", "Art 3/8 mapping", "Remittal strategy"],
  },
  {
    id: "voice",
    name: "Voice Agent",
    role: "Speech interface",
    description:
      "Enables low-literacy and multilingual clients to speak their story and receive spoken summaries.",
    status: "idle",
    capabilities: ["Real-time STT", "TTS responses", "Language switch", "Voice navigation"],
  },
  {
    id: "solicitor_review",
    name: "Solicitor Review Agent",
    role: "Human-in-the-loop routing",
    description:
      "Routes reserved legal activities and high-stakes drafts to qualified solicitors for approval.",
    status: "active",
    capabilities: ["Routing rules", "Review queues", "Approval gates", "Privilege controls"],
  },
  {
    id: "supervisor",
    name: "Supervisor Agent",
    role: "Orchestration",
    description:
      "Coordinates multi-agent workflows, enforces policy constraints and escalates risk.",
    status: "active",
    capabilities: ["Agent graph", "Risk scoring", "Policy gates", "Escalation paths"],
  },
];
