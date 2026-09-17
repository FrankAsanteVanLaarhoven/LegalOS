"use client";

import { AGENTS } from "@/lib/data/agents";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { LegalCase } from "@/lib/types";
import { maturityTone, type AgentBadge } from "@/lib/capability-display";
import { formatDate } from "@/lib/utils";

export function OverviewPanel({
  legalCase,
  agentBadges = {},
}: {
  legalCase: LegalCase;
  agentBadges?: Record<string, AgentBadge>;
}) {
  const activeAgents = AGENTS.filter((a) => legalCase.activeAgents.includes(a.id));
  const openReviews = legalCase.reviews.filter((r) => r.status === "pending").length;
  const criticalTasks = legalCase.tasks.filter(
    (t) => t.priority === "critical" || t.priority === "high"
  ).length;
  const missingEvidence = legalCase.evidence.filter(
    (e) => e.status === "missing" || e.status === "requested"
  );

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Case summary</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-relaxed text-[var(--graphite)]">{legalCase.summary}</p>
          <p className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-xs leading-relaxed text-[var(--muted)]">
            {legalCase.disclaimer}
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Timeline events", value: legalCase.timeline.length },
          { label: "Evidence items", value: legalCase.evidence.length },
          { label: "Open reviews", value: openReviews },
          { label: "Priority tasks", value: criticalTasks },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardContent className="pt-5">
              <div className="text-2xl font-semibold tracking-tight text-[var(--accent)]">
                {stat.value}
              </div>
              <div className="mt-1 text-xs uppercase tracking-wider text-[var(--muted)]">
                {stat.label}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Agents on this case</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {/*
              These previously all rendered a green "active" badge, including
              the Research Agent — whose retrieval corpus does not exist. That
              is the same defect as a hardcoded confidence score: a status
              asserted rather than established. Each agent now shows the
              maturity of the capability behind it, derived from checks.
            */}
            {activeAgents.map((agent) => {
              const status = agentBadges[agent.id];
              return (
                <div
                  key={agent.id}
                  className="flex items-start justify-between gap-3 rounded-xl border border-zinc-100 bg-zinc-50/80 px-3 py-2.5"
                >
                  <div>
                    <div className="text-sm font-medium">{agent.name}</div>
                    <div className="text-xs text-[var(--muted)]">{agent.role}</div>
                    {status?.detail && (
                      <div className="mt-1 text-[11px] leading-relaxed text-amber-800">
                        {status.detail}
                      </div>
                    )}
                  </div>
                  <Badge tone={maturityTone(status?.implementation)}>
                    {status?.implementation ?? "unknown"}
                  </Badge>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Evidence gaps</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {missingEvidence.map((item) => (
              <div
                key={item.id}
                className="flex items-start justify-between gap-3 rounded-xl border border-zinc-100 px-3 py-2.5"
              >
                <div>
                  <div className="text-sm font-medium">{item.title}</div>
                  <div className="mt-0.5 text-xs text-[var(--muted)]">{item.summary}</div>
                </div>
                <Badge tone={item.status === "missing" ? "danger" : "warning"}>{item.status}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Next deadlines</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {legalCase.deadlines.map((d) => (
            <div
              key={d.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-100 px-3 py-2.5"
            >
              <div>
                <div className="text-sm font-medium">{d.title}</div>
                {d.notes && <div className="text-xs text-[var(--muted)]">{d.notes}</div>}
              </div>
              <div className="flex items-center gap-2">
                <Badge tone="neutral">{d.type}</Badge>
                <span className="text-sm font-medium tabular-nums">{formatDate(d.date)}</span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
