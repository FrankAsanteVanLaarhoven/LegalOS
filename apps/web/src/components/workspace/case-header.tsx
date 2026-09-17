"use client";

import Link from "next/link";
import { ArrowLeft, Languages, ShieldAlert } from "lucide-react";
import { evidenceCompleteness } from "@legalos/reliability";
import { Badge } from "@/components/ui/badge";
import type { LegalCase } from "@/lib/types";

const statusLabel: Record<string, string> = {
  appeal_pending: "Appeal pending",
  evidence_collection: "Evidence collection",
  lawyer_review: "Lawyer review",
  analysis: "Analysis",
  intake: "Intake",
  submitted: "Submitted",
  closed: "Closed",
};

export function CaseHeader({ legalCase }: { legalCase: LegalCase }) {
  // Counted from the evidence register rather than read from a stored score.
  const completeness = evidenceCompleteness(
    legalCase.evidence.map((e) => e.title),
    legalCase.evidence.map((e) => ({
      id: e.id,
      satisfies: e.title,
      received: e.status !== "missing" && e.status !== "requested",
    }))
  );

  return (
    <div className="border-b border-zinc-200 bg-white/90 backdrop-blur-md">
      {legalCase.isDemo && (
        <div className="bg-amber-100 px-5 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-amber-950 sm:px-6">
          Fictional demonstration data — not a real person or a real case
        </div>
      )}
      <div className="flex flex-col gap-4 px-5 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3">
          <Link
            href="/workspace"
            className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl border border-zinc-200 text-[var(--muted)] transition hover:bg-zinc-50 hover:text-[var(--foreground)]"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">{legalCase.clientName}</h1>
              <Badge tone="warning">{statusLabel[legalCase.status] ?? legalCase.status}</Badge>
              {/* The risk field was rendered as a bare "high risk" badge. On a
                  case screen that reads as an assessment of the person's
                  prospects, and nothing derived it — it is a fixture value with
                  no observation behind it. Shown only where it can be attributed,
                  and named as a handling category rather than a judgement. */}
              {legalCase.riskLevel === "high" ? (
                <span title="Handling category recorded at intake. Not an assessment of the case or its prospects.">
                  <Badge tone="warning">priority handling</Badge>
                </span>
              ) : null}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--muted)]">
              <span className="font-mono">{legalCase.reference}</span>
              <span>{legalCase.nationality}</span>
              <span className="inline-flex items-center gap-1">
                <Languages className="h-3 w-3" />
                {legalCase.languages.join(" · ")}
              </span>
              {legalCase.assignedSolicitor && <span>Solicitor: {legalCase.assignedSolicitor}</span>}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {legalCase.matterTypes.map((m) => (
                <Badge key={m} tone="accent">
                  {m}
                </Badge>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/*
            This tile read "72% — Evidence complete", which a reader takes as
            tribunal readiness. The figure was the constant `completenessScore`
            in the case fixture; nothing derived it from the evidence register.
            It now shows the count it is actually able to support.
          */}
          <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-center">
            <div className="text-lg font-semibold text-[var(--accent)]">
              {completeness.satisfied.length}/{completeness.required.length}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-[var(--muted)]">
              Evidence items received
            </div>
          </div>
          <div className="max-w-xs rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-950/90">
            <div className="mb-0.5 flex items-center gap-1 font-semibold">
              <ShieldAlert className="h-3.5 w-3.5" />
              Core principle
            </div>
            Helps prepare evidence and work with professionals — not your lawyer.
          </div>
        </div>
      </div>
    </div>
  );
}
