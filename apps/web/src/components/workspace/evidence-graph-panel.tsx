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

  const docNodes = nodes.filter((n) => n.startsWith("doc-") || legalCase.evidence.some(e => e.title === n));
  const conceptNodes = nodes.filter((n) => !docNodes.includes(n));

  const label = (id: string) => {
    const doc = legalCase.evidence.find((e) => e.id === id);
    return doc?.title ?? id;
  };

  // Dynamic chain constructed from this case's matter types and evidence
  const dynamicChain = useMemo(() => {
    if (legalCase.isDemo) {
      return ["GP Letter", "PTSD", "Article 3", "VTS", "NRM", "Appeal", "Tribunal"];
    }

    const firstDoc = legalCase.evidence[0]?.title ?? "Identity & Residence";
    const matters = legalCase.matterTypes;
    return [
      firstDoc,
      "Document Verification",
      matters[0] ?? "Immigration Pathway",
      "Statutory Eligibility",
      "Solicitor Review",
      "Decision-Maker Submission",
    ];
  }, [legalCase]);

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-[var(--shadow-soft)] sm:p-7">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Evidence Graph</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Causal and evidential relationships connecting documents to legal criteria, statutes, and submission gates for {legalCase.clientName}.
        </p>
      </div>

      {/* Dynamic chain highlight */}
      <div className="mt-6 overflow-x-auto scrollbar-thin">
        <div className="flex min-w-max items-center gap-2 py-2">
          {dynamicChain.map((step, i, arr) => (
            <div key={step} className="flex items-center gap-2">
              <div className="rounded-xl border border-[var(--accent)]/20 bg-[var(--accent-soft)] px-3 py-2 text-xs font-semibold text-[var(--accent)]">
                {step}
              </div>
              {i < arr.length - 1 && <div className="text-[var(--muted)]">→</div>}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
            Document nodes ({docNodes.length})
          </h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {docNodes.length === 0 ? (
              <span className="text-xs text-zinc-400">No document nodes mapped yet.</span>
            ) : (
              docNodes.map((id) => (
                <span
                  key={id}
                  className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-medium"
                  title={id}
                >
                  {label(id)}
                </span>
              ))
            )}
          </div>
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
            Legal / factual criteria ({conceptNodes.length})
          </h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {conceptNodes.length === 0 ? (
              <span className="text-xs text-zinc-400">No concept nodes mapped yet.</span>
            ) : (
              conceptNodes.map((id) => (
                <span
                  key={id}
                  className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-900"
                >
                  {id}
                </span>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="mt-8">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
          Evidential links & dependencies ({legalCase.evidenceGraph.length})
        </h3>
        <div className="mt-3 space-y-2">
          {legalCase.evidenceGraph.length === 0 ? (
            <p className="text-xs text-zinc-400">No evidential edges recorded yet.</p>
          ) : (
            legalCase.evidenceGraph.map((edge, i) => (
              <div
                key={`${edge.from}-${edge.to}-${i}`}
                className="grid grid-cols-1 items-center gap-2 rounded-xl border border-zinc-100 bg-zinc-50/60 px-3 py-2.5 text-sm sm:grid-cols-[1fr_auto_1fr]"
              >
                <span className="truncate font-medium text-zinc-900" title={label(edge.from)}>
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
            ))
          )}
        </div>
      </div>
    </div>
  );
}
