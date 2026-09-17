"use client";

import { Badge } from "@/components/ui/badge";
import type { EvidenceCategory, LegalCase } from "@/lib/types";
import { formatDate } from "@/lib/utils";

const categoryTone: Record<
  EvidenceCategory,
  "neutral" | "accent" | "success" | "warning" | "danger" | "info"
> = {
  medical: "success",
  immigration: "accent",
  police: "warning",
  tribunal: "info",
  identity: "neutral",
  employment: "neutral",
  personal: "neutral",
  other: "neutral",
};

const statusTone = {
  received: "success" as const,
  requested: "warning" as const,
  missing: "danger" as const,
  expired: "danger" as const,
};

export function EvidencePanel({ legalCase }: { legalCase: LegalCase }) {
  const groups = legalCase.evidence.reduce(
    (acc, item) => {
      acc[item.category] = acc[item.category] || [];
      acc[item.category].push(item);
      return acc;
    },
    {} as Record<string, typeof legalCase.evidence>
  );

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-[var(--shadow-soft)]">
        <h2 className="text-lg font-semibold tracking-tight">Evidence register</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Every document is linked to legal issues, timeline events, and completeness scoring.
        </p>
      </div>

      {Object.entries(groups).map(([category, items]) => (
        <div key={category} className="space-y-3">
          <div className="flex items-center gap-2">
            <Badge tone={categoryTone[category as EvidenceCategory] ?? "neutral"}>{category}</Badge>
            <span className="text-xs text-[var(--muted)]">{items.length} items</span>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {items.map((item) => (
              <div
                key={item.id}
                className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-[var(--shadow-soft)]"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold">{item.title}</div>
                    {item.date && (
                      <div className="mt-0.5 text-xs text-[var(--muted)]">
                        {formatDate(item.date)}
                      </div>
                    )}
                  </div>
                  <Badge tone={statusTone[item.status]}>{item.status}</Badge>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-[var(--graphite)]">
                  {item.summary}
                </p>
                {item.linkedIssues.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {item.linkedIssues.map((issue) => (
                      <span
                        key={issue}
                        className="rounded-md bg-[var(--accent-soft)] px-2 py-0.5 text-[11px] text-[var(--accent)]"
                      >
                        {issue}
                      </span>
                    ))}
                  </div>
                )}
                <div className="mt-3 flex flex-wrap gap-1">
                  {item.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] text-zinc-600"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
