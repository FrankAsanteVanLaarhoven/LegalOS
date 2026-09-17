import type { ImplementationLevel } from "@legalos/capabilities";

/**
 * Navigation menu structure.
 *
 * Every item that names a platform capability carries the id of that capability,
 * so the menu shows its measured status rather than presenting everything as an
 * available service. A mega-menu listing "Tribunal bundle generator" beside
 * "Legal resources" with no distinction would tell a visitor that both exist —
 * which is the defect this architecture keeps removing, moved to the nav bar.
 *
 * Items with `capability: null` are pages that genuinely exist and need no
 * qualification.
 */

export interface MenuItem {
  readonly label: string;
  readonly description: string;
  readonly href: string;
  /** Capability whose measured level qualifies this item, if it names one. */
  readonly capability: string | null;
  /** Shown when the capability is below `operational`. */
  readonly plannedNote?: string;
}

export interface MenuSection {
  readonly id: string;
  readonly label: string;
  readonly summary: string;
  readonly items: readonly MenuItem[];
}

export const MENU: readonly MenuSection[] = [
  {
    id: "case",
    label: "Case workspace",
    summary: "One living case file rather than a series of conversations.",
    items: [
      {
        label: "Overview & timeline",
        description: "Chronology with every event linked to the evidence behind it.",
        href: "/workspace",
        capability: null,
      },
      {
        label: "Evidence register",
        description: "What is on file, what is outstanding, and who it is waiting on.",
        href: "/workspace",
        capability: null,
      },
      {
        label: "Evidence & knowledge graph",
        description:
          "Why a document is in the file, traced back through the requirement that asked for it.",
        href: "/trust",
        capability: "evidence_graph",
      },
      {
        label: "Timeline reconstruction",
        description: "Chronology derived automatically from uploaded documents.",
        href: "/trust",
        capability: "timeline_reconstruction",
        plannedNote: "Timelines are authored by hand today.",
      },
      {
        label: "Deadlines & tasks",
        description: "Dates read from correspondence, proposed for you to confirm.",
        href: "/trust",
        capability: "workflow_engine",
        plannedNote: "Deadline extraction is not built yet.",
      },
    ],
  },
  {
    id: "evidence",
    label: "Evidence",
    summary: "Capture, integrity and translation, with the original never replaced.",
    items: [
      {
        label: "Document capture",
        description: "Photograph or upload; quality is checked before anything is accepted.",
        href: "/trust",
        capability: "evidence_ingestion",
        plannedNote: "The contract exists; no OCR engine is connected.",
      },
      {
        label: "Translation",
        description:
          "Aligned segment by segment against the original, with anything uncertain flagged.",
        href: "/trust",
        capability: "evidence_ingestion",
        plannedNote: "No translation engine is connected.",
      },
      {
        label: "Evidence review",
        description:
          "Where records differ, the ordinary reasons are offered before any question is asked.",
        href: "/trust",
        capability: null,
      },
      {
        label: "Legal sources",
        description: "Legislation and guidance with retrieval date, version and checksum.",
        href: "/resources",
        capability: "knowledge_sources",
        plannedNote: "No source has been retrieved and checksummed yet.",
      },
    ],
  },
  {
    id: "trust",
    label: "Trust & governance",
    summary: "What the platform can honestly claim, measured rather than declared.",
    items: [
      {
        label: "Platform trust",
        description: "Every capability at the level its observations support.",
        href: "/trust",
        capability: null,
      },
      {
        label: "Output verification",
        description:
          "Citations must resolve. Guarantees and confidence figures are withheld, not caveated.",
        href: "/trust",
        capability: "verification",
      },
      {
        label: "Audit trail",
        description: "Hash-chained and append-only, so tampering is detectable.",
        href: "/trust",
        capability: "audit",
      },
      {
        label: "Human review",
        description: "Reserved activities need a named, regulated person. AI proposes only.",
        href: "/trust",
        capability: "human_review",
      },
      {
        label: "Engineering principles",
        description: "Fifteen constraints, thirteen of them checked in CI.",
        href: "/trust",
        capability: null,
      },
    ],
  },
  {
    id: "professionals",
    label: "For professionals",
    summary: "Arrive at a case that is already organised.",
    items: [
      {
        label: "Enterprise",
        description: "Workspaces, review queues and audit separation for teams.",
        href: "/enterprise",
        capability: null,
      },
      {
        label: "Review & approvals",
        description: "Proposals reach you with the evidence they rest on attached.",
        href: "/enterprise",
        capability: "human_review",
      },
      {
        label: "Rule engine",
        description:
          "Requirements evaluated deterministically, with missing evidence named rather than guessed.",
        href: "/trust",
        capability: "rule_engine",
      },
      {
        label: "LegalOS Bench",
        description: "Continuous scoring of the safety envelope.",
        href: "/trust",
        capability: "benchmark",
      },
    ],
  },
  {
    id: "learn",
    label: "Resources",
    summary: "Official sources, and how this platform works.",
    items: [
      {
        label: "Legal resources",
        description: "Curated GOV.UK and legislation links, opened in context.",
        href: "/resources",
        capability: null,
      },
      {
        label: "Journeys",
        description: "How the platform is used across different situations.",
        href: "/#stories",
        capability: null,
      },
      {
        label: "Approach",
        description: "Why answers are withheld rather than embellished.",
        href: "/#approach",
        capability: null,
      },
    ],
  },
];

/** Levels at which an item is presented as available rather than planned. */
export function isAvailable(level: ImplementationLevel | undefined): boolean {
  return level === "operational" || level === "verified" || level === "certified";
}
