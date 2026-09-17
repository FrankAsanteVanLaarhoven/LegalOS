"use client";

import {
  Cpu as AnalysisIcon,
  Calendar,
  CheckSquare,
  FileText,
  GitBranch,
  LayoutDashboard,
  Network,
  Scale,
  Shield,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { LegalCase } from "@/lib/types";

export type WorkspaceTab =
  | "overview"
  | "timeline"
  | "evidence"
  | "graph"
  | "analysis"
  | "tasks"
  | "deadlines"
  | "review"
  | "assistant"
  | "documents"
  | "audit";

const tabs: { id: WorkspaceTab; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "timeline", label: "Timeline", icon: GitBranch },
  { id: "evidence", label: "Evidence", icon: FileText },
  { id: "graph", label: "Evidence Graph", icon: Network },
  { id: "analysis", label: "AI Analysis", icon: AnalysisIcon },
  { id: "assistant", label: "AI Assistant", icon: Scale },
  { id: "tasks", label: "Tasks", icon: CheckSquare },
  { id: "deadlines", label: "Deadlines", icon: Calendar },
  { id: "review", label: "Lawyer Review", icon: Users },
  { id: "documents", label: "Documents", icon: Shield },
  { id: "audit", label: "Audit", icon: Shield },
];

export function CaseSidebar({
  legalCase,
  active,
  onChange,
}: {
  legalCase: LegalCase;
  active: WorkspaceTab;
  onChange: (tab: WorkspaceTab) => void;
}) {
  return (
    <aside className="flex w-full flex-col border-r border-zinc-200 bg-white lg:w-60 lg:shrink-0">
      <div className="border-b border-zinc-100 px-4 py-4">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">
          Case workspace
        </div>
        <div className="mt-1 truncate text-sm font-semibold">{legalCase.clientName}</div>
        <div className="mt-0.5 font-mono text-[11px] text-[var(--muted)]">
          {legalCase.reference}
        </div>
      </div>
      <nav className="flex gap-1 overflow-x-auto p-2 lg:flex-col lg:overflow-visible scrollbar-thin">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = active === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              className={cn(
                "flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm transition-colors",
                isActive
                  ? "bg-[var(--accent-soft)] font-medium text-[var(--accent)]"
                  : "text-[var(--muted)] hover:bg-zinc-50 hover:text-[var(--foreground)]"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
              {tab.label}
            </button>
          );
        })}
      </nav>
      <div className="mt-auto hidden border-t border-zinc-100 p-4 lg:block">
        <div className="rounded-xl bg-amber-50 px-3 py-2.5 text-[11px] leading-relaxed text-amber-900/90">
          AI drafts and analyses require solicitor approval before any reserved legal activity.
        </div>
      </div>
    </aside>
  );
}
