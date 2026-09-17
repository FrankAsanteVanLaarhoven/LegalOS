"use client";

import { useState } from "react";
import type { LegalCase } from "@/lib/types";
import { CaseHeader } from "./case-header";
import { CaseSidebar, type WorkspaceTab } from "./case-sidebar";
import { OverviewPanel } from "./overview-panel";
import type { AgentBadge } from "@/lib/capability-display";
import { EvidencePanel } from "./evidence-panel";
import { EvidenceGraphPanel } from "./evidence-graph-panel";
import { AnalysisPanel } from "./analysis-panel";
import { DeadlinesPanel, DocumentsPanel, ReviewPanel, TasksPanel } from "./tasks-panel";
import { AIAssistant } from "./ai-assistant";

/**
 * The audit panel is a server component reading the append-only log, and this
 * shell is a client component holding tab state. A server component cannot be
 * nested inside one, so it arrives as a slot rendered by the page — which keeps
 * the database read on the server where it belongs.
 */
export function CaseWorkspace({
  legalCase,
  agentBadges = {},
  auditSlot,
  timelineSlot,
}: {
  legalCase: LegalCase;
  agentBadges?: Record<string, AgentBadge>;
  auditSlot?: React.ReactNode;
  timelineSlot?: React.ReactNode;
}) {
  const [tab, setTab] = useState<WorkspaceTab>("overview");

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col bg-[var(--background)]">
      <CaseHeader legalCase={legalCase} />
      <div className="flex flex-1 flex-col lg:flex-row">
        <CaseSidebar legalCase={legalCase} active={tab} onChange={setTab} />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 scrollbar-thin">
          {tab === "overview" && <OverviewPanel legalCase={legalCase} agentBadges={agentBadges} />}
          {tab === "timeline" && timelineSlot}
          {tab === "evidence" && <EvidencePanel legalCase={legalCase} />}
          {tab === "graph" && <EvidenceGraphPanel legalCase={legalCase} />}
          {tab === "analysis" && <AnalysisPanel legalCase={legalCase} />}
          {tab === "assistant" && <AIAssistant legalCase={legalCase} />}
          {tab === "tasks" && <TasksPanel legalCase={legalCase} />}
          {tab === "deadlines" && <DeadlinesPanel legalCase={legalCase} />}
          {tab === "review" && <ReviewPanel legalCase={legalCase} />}
          {tab === "documents" && <DocumentsPanel legalCase={legalCase} />}
          {tab === "audit" && auditSlot}
        </main>
      </div>
    </div>
  );
}
