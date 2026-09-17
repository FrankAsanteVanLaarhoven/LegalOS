"use client";

import { AGENTS } from "@/lib/data/agents";
import { Badge } from "@/components/ui/badge";
import type { LegalCase } from "@/lib/types";
import { formatDate } from "@/lib/utils";

export function AnalysisPanel({ legalCase }: { legalCase: LegalCase }) {
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-[var(--shadow-soft)]">
        <h2 className="text-lg font-semibold tracking-tight">AI analysis</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Explainable outputs with evidence, law, alternatives, and missing documents. No confidence
          score is shown: nothing here produces a calibrated one.
        </p>
      </div>

      {legalCase.analyses.map((analysis) => {
        const agent = AGENTS.find((a) => a.id === analysis.agentId);
        return (
          <article
            key={analysis.id}
            className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-[var(--shadow-soft)] sm:p-6"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xs text-[var(--muted)]">
                  {agent?.name ?? analysis.agentId} · {formatDate(analysis.createdAt)}
                </div>
                <h3 className="mt-1 text-base font-semibold tracking-tight">{analysis.title}</h3>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {/*
                  A "High 87%" badge used to render here, coloured green/amber/red
                  by threshold. The number came from a literal in the case fixture —
                  nothing computed it and no model produced it, so it asserted a
                  precision that did not exist on the most decision-influencing
                  element of the page. Review state is a fact about the case and
                  is kept; the percentage is not.
                */}
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
                      <span className="text-sm font-medium">{law.title}</span>
                      <Badge tone="neutral">{law.type}</Badge>
                      {/* "relevance 94%" on a statute card was a hand-typed
                          literal presented as a legal-analysis measurement. */}
                    </div>
                    <div className="mt-0.5 text-xs text-[var(--muted)]">{law.source}</div>
                    <p className="mt-2 text-sm leading-relaxed text-[var(--graphite)]">
                      {law.excerpt}
                    </p>
                    <p className="mt-1.5 text-[11px] italic text-[var(--muted)]">
                      Paraphrase, not quoted statutory text. Check the source before relying on it.
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-4 text-xs text-[var(--muted)]">
              Evidence used:{" "}
              <span className="font-mono text-[var(--graphite)]">
                {analysis.evidenceUsed.join(", ")}
              </span>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function Section({ title, items, danger }: { title: string; items: string[]; danger?: boolean }) {
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
        {title}
      </h4>
      <ul className="mt-2 space-y-1.5">
        {items.map((item) => (
          <li
            key={item}
            className={`rounded-lg px-3 py-2 text-sm leading-relaxed ${
              danger ? "bg-red-50 text-red-900/90" : "bg-zinc-50 text-[var(--graphite)]"
            }`}
          >
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
