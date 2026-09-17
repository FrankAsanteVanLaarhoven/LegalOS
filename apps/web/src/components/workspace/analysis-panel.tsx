"use client";

import { useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { AGENTS } from "@/lib/data/agents";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { LegalCase } from "@/lib/types";
import { formatDate } from "@/lib/utils";
import { useCaseStore } from "./case-store-context";

export function AnalysisPanel({ legalCase }: { legalCase: LegalCase }) {
  const { runAnalysis } = useCaseStore();
  const [analyzing, setAnalyzing] = useState(false);

  const handleRunAnalysis = () => {
    setAnalyzing(true);
    setTimeout(() => {
      runAnalysis();
      setAnalyzing(false);
    }, 600);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-[var(--shadow-soft)]">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight">AI Analysis & Intelligence</h2>
            <Badge tone="accent">{legalCase.analyses.length} reports</Badge>
          </div>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Explainable legal intelligence evaluating {legalCase.clientName}&apos;s case against UK
            immigration rules, evidence gaps, and statutory thresholds.
          </p>
        </div>

        <Button
          variant="dark"
          onClick={handleRunAnalysis}
          disabled={analyzing}
          className="flex items-center gap-2"
        >
          {analyzing ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Evaluating Evidence & Rules...
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4 text-amber-300" />
              Run AI Analysis on this Case
            </>
          )}
        </Button>
      </div>

      {legalCase.analyses.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-12 text-center">
          <Sparkles className="mx-auto h-8 w-8 text-zinc-400" />
          <h3 className="mt-2 text-sm font-semibold text-zinc-900">No AI analysis reports yet</h3>
          <p className="mt-1 text-xs text-zinc-500">
            Click &quot;Run AI Analysis on this Case&quot; above to evaluate {legalCase.clientName}&apos;s documents and legal pathways.
          </p>
        </div>
      ) : (
        legalCase.analyses.map((analysis) => {
          const agent = AGENTS.find((a) => a.id === analysis.agentId);
          return (
            <article
              key={analysis.id}
              className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-[var(--shadow-soft)] sm:p-6"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xs text-[var(--muted)]">
                    {agent?.name ?? "Immigration Intelligence Agent"} · {formatDate(analysis.createdAt)}
                  </div>
                  <h3 className="mt-1 text-base font-semibold tracking-tight text-zinc-900">
                    {analysis.title}
                  </h3>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {analysis.requiresHumanReview && <Badge tone="warning">needs review</Badge>}
                  <Badge tone={analysis.reviewStatus === "approved" ? "success" : "neutral"}>
                    {analysis.reviewStatus}
                  </Badge>
                </div>
              </div>

              <p className="mt-3 text-sm leading-relaxed text-[var(--graphite)]">
                {analysis.summary}
              </p>

              <div className="mt-5 grid gap-4 lg:grid-cols-2">
                <Section title="What I know" items={analysis.whatIKnow} />
                <Section title="Missing evidence" items={analysis.missingEvidence} danger />
                <Section
                  title="Alternative interpretations"
                  items={analysis.alternativeInterpretations}
                />
                <Section title="Recommended next actions" items={analysis.recommendedActions} />
              </div>

              {analysis.relevantLaw && analysis.relevantLaw.length > 0 && (
                <div className="mt-5">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                    Relevant law / policy
                  </h4>
                  <div className="mt-2 space-y-2">
                    {analysis.relevantLaw.map((law) => (
                      <div
                        key={law.id}
                        className="rounded-xl border border-zinc-100 bg-zinc-50/80 px-3 py-3"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-zinc-900">{law.title}</span>
                          <Badge tone="neutral">{law.type}</Badge>
                        </div>
                        <div className="mt-0.5 text-xs text-[var(--muted)]">{law.source}</div>
                        <p className="mt-2 text-sm leading-relaxed text-[var(--graphite)]">
                          {law.excerpt}
                        </p>
                        <p className="mt-1.5 text-[11px] italic text-[var(--muted)]">
                          Statutory excerpt for reference. Confirm current rules with a regulated adviser.
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {analysis.evidenceUsed && analysis.evidenceUsed.length > 0 && (
                <div className="mt-4 text-xs text-[var(--muted)]">
                  Evidence evaluated:{" "}
                  <span className="font-mono text-[var(--graphite)]">
                    {analysis.evidenceUsed.join(", ")}
                  </span>
                </div>
              )}
            </article>
          );
        })
      )}
    </div>
  );
}

function Section({
  title,
  items,
  danger,
}: {
  title: string;
  items: string[];
  danger?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        danger ? "border-red-200 bg-red-50/50" : "border-zinc-100 bg-zinc-50/60"
      }`}
    >
      <h4
        className={`text-xs font-semibold uppercase tracking-wider ${
          danger ? "text-red-900" : "text-[var(--muted)]"
        }`}
      >
        {title}
      </h4>
      <ul className="mt-2 space-y-1.5 text-sm text-[var(--graphite)]">
        {items.map((it, idx) => (
          <li key={idx} className="flex items-start gap-2">
            <span className={danger ? "text-red-500 font-bold" : "text-[var(--accent)]"}>•</span>
            <span className="leading-relaxed">{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
