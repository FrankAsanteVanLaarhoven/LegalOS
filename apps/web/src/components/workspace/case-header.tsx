"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ChevronDown,
  Edit3,
  Languages,
  Lock,
  Plus,
  ShieldAlert,
} from "lucide-react";
import { evidenceCompleteness } from "@legalos/reliability";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { LegalCase } from "@/lib/types";
import { useCaseStore } from "./case-store-context";
import { NewCaseModal } from "./new-case-modal";
import { EditCaseModal } from "./edit-case-modal";

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
  const { allCases, switchCase } = useCaseStore();
  const [showNewModal, setShowNewModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showSwitcher, setShowSwitcher] = useState(false);

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
    <>
      <div className="border-b border-zinc-200 bg-white/95 backdrop-blur-md">
        {legalCase.isDemo ? (
          <div className="flex flex-wrap items-center justify-between gap-2 bg-amber-100 px-5 py-2 text-[11px] font-semibold tracking-wider text-amber-950 sm:px-6">
            <span className="uppercase">
              Fictional demonstration data — not a real person or a real case
            </span>
            <button
              onClick={() => setShowNewModal(true)}
              className="inline-flex items-center gap-1 rounded bg-amber-900 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-amber-950"
            >
              <Plus className="h-3.5 w-3.5" />
              Start Your Real Case
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2 bg-emerald-50 px-5 py-2 text-[11px] font-semibold text-emerald-950 sm:px-6">
            <div className="flex items-center gap-1.5 uppercase tracking-wider">
              <Lock className="h-3.5 w-3.5 text-emerald-700" />
              Active Case File · End-to-End Confidential · Stored in Your Secure Session
            </div>
            <button
              onClick={() => setShowNewModal(true)}
              className="inline-flex items-center gap-1 rounded bg-emerald-800 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-emerald-900"
            >
              <Plus className="h-3.5 w-3.5" />
              New Case
            </button>
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
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowSwitcher(!showSwitcher)}
                    className="flex items-center gap-1.5 text-xl font-semibold tracking-tight text-zinc-900 hover:text-zinc-700"
                  >
                    <span>{legalCase.clientName}</span>
                    <ChevronDown className="h-4 w-4 text-zinc-400" />
                  </button>

                  {showSwitcher && (
                    <div className="absolute left-0 top-full z-40 mt-1.5 w-64 rounded-xl border border-zinc-200 bg-white p-2 shadow-xl">
                      <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                        Switch Active Case
                      </div>
                      <div className="max-h-60 overflow-y-auto">
                        {allCases.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => {
                              switchCase(c.id);
                              setShowSwitcher(false);
                            }}
                            className={`w-full rounded-lg px-2.5 py-1.5 text-left text-xs transition ${
                              c.id === legalCase.id
                                ? "bg-zinc-100 font-semibold text-zinc-900"
                                : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
                            }`}
                          >
                            <div className="truncate">{c.clientName}</div>
                            <div className="font-mono text-[10px] text-zinc-400">
                              {c.reference} {c.isDemo ? "(Demo)" : ""}
                            </div>
                          </button>
                        ))}
                      </div>
                      <div className="mt-1 border-t border-zinc-100 pt-1">
                        <button
                          type="button"
                          onClick={() => {
                            setShowSwitcher(false);
                            setShowNewModal(true);
                          }}
                          className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left text-xs font-medium text-[var(--accent)] hover:bg-[var(--accent-soft)]"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Create New Case
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <Badge tone="warning">{statusLabel[legalCase.status] ?? legalCase.status}</Badge>

                {legalCase.riskLevel === "high" ? (
                  <span title="Handling category recorded at intake. Not an assessment of the case or its prospects.">
                    <Badge tone="warning">priority handling</Badge>
                  </span>
                ) : null}

                <button
                  type="button"
                  onClick={() => setShowEditModal(true)}
                  className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-2 py-0.5 text-xs text-zinc-600 hover:bg-zinc-50"
                  title="Edit case details"
                >
                  <Edit3 className="h-3 w-3" />
                  Edit
                </button>
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

      <NewCaseModal isOpen={showNewModal} onClose={() => setShowNewModal(false)} />
      <EditCaseModal
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        legalCase={legalCase}
      />
    </>
  );
}
