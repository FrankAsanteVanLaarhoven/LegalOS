"use client";

import { useMemo } from "react";
import type { LegalCase } from "@/lib/types";
import { cn } from "@/lib/utils";

export function EvidenceGraphPanel({ legalCase }: { legalCase: LegalCase }) {
  const nodes = useMemo(() => {
    const set = new Set<string>();
    legalCase.evidenceGraph.forEach((e) => {
      set.add(e.from);
      set.add(e.to);
    });
    return Array.from(set);
  }, [legalCase.evidenceGraph]);

  const docNodes = nodes.filter((n) => n.startsWith("doc-"));
  const conceptNodes = nodes.filter((n) => !n.startsWith("doc-"));

  const label = (id: string) => {
    const doc = legalCase.evidence.find((e) => e.id === id);
    return doc?.title ?? id;
  };

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-[var(--shadow-soft)] sm:p-7">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Evidence graph</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Relationships between documents, medical concepts, protection pathways and appeal issues —
          searchable and inspectable.
        </p>
      </div>

      {/* Classic chain highlight from product vision */}
      <div className="mt-8 overflow-x-auto scrollbar-thin">
        <div className="flex min-w-max items-center gap-2 py-2">
          {["GP Letter", "PTSD", "Article 3", "VTS", "NRM", "Appeal", "Tribunal"].map(
            (step, i, arr) => (
              <div key={step} className="flex items-center gap-2">
                <div className="rounded-xl border border-[var(--accent)]/20 bg-[var(--accent-soft)] px-3 py-2 text-xs font-semibold text-[var(--accent)]">
                  {step}
                </div>
                {i < arr.length - 1 && <div className="text-[var(--muted)]">→</div>}
              </div>
            )
          )}
        </div>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
            Document nodes
          </h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {docNodes.map((id) => (
              <span
                key={id}
                className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-medium"
                title={id}
              >
                {label(id)}
              </span>
            ))}
          </div>
        </div>
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
            Legal / clinical concepts
          </h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {conceptNodes.map((id) => (
              <span
                key={id}
                className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-900"
              >
                {id}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-8">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
          Edges
        </h3>
        <div className="mt-3 space-y-2">
          {legalCase.evidenceGraph.map((edge, i) => (
            <div
              key={`${edge.from}-${edge.to}-${i}`}
              className="grid grid-cols-1 items-center gap-2 rounded-xl border border-zinc-100 bg-zinc-50/60 px-3 py-2.5 text-sm sm:grid-cols-[1fr_auto_1fr]"
            >
              <span className="truncate font-medium" title={label(edge.from)}>
                {label(edge.from)}
              </span>
              <span
                className={cn(
                  "justify-self-start rounded-full bg-white px-2.5 py-0.5 text-[11px] font-medium text-[var(--accent)] ring-1 ring-zinc-200 sm:justify-self-center"
                )}
              >
                {edge.relation}
              </span>
              <span className="truncate text-[var(--graphite)] sm:text-right" title={edge.to}>
                {label(edge.to)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
