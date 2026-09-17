"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, FolderPlus, ArrowRight, Lock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getCases } from "@/lib/data/case-store";
import type { LegalCase } from "@/lib/types";
import { NewCaseModal } from "./new-case-modal";

import { CaseStoreProvider } from "./case-store-context";

function WorkspaceCaseListInner({ defaultCases }: { defaultCases: LegalCase[] }) {
  const [cases, setCases] = useState<LegalCase[]>(defaultCases);
  const [showNewModal, setShowNewModal] = useState(false);

  useEffect(() => {
    const list = getCases();
    if (list.length > 0) {
      setCases(list);
    }

    const onUpdate = () => {
      setCases(getCases());
    };

    window.addEventListener("legalos_cases_updated", onUpdate);
    return () => window.removeEventListener("legalos_cases_updated", onUpdate);
  }, []);

  const realCases = cases.filter((c) => !c.isDemo);
  const demoCases = cases.filter((c) => c.isDemo);

  return (
    <div className="mt-12 space-y-8">
      {/* Top Banner & Action */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div>
          <span className="eyebrow text-emerald-800">Operational Workspace</span>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900">
            Client Cases & Matter Management
          </h2>
          <p className="mt-1 text-sm text-zinc-600">
            Create active client files, register evidential exhibits, log chronology events, and run UK legal analysis.
          </p>
        </div>

        <Button size="lg" variant="dark" onClick={() => setShowNewModal(true)} className="flex items-center gap-2">
          <Plus className="h-4 w-4" />
          Start New Real Case
        </Button>
      </div>

      {/* Real Cases Section */}
      {realCases.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-zinc-900">Your Active Cases</h3>
            <Badge tone="success">{realCases.length} active</Badge>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {realCases.map((c) => {
              const receivedCount = c.evidence.filter(
                (e) => e.status !== "missing" && e.status !== "requested"
              ).length;

              return (
                <div
                  key={c.id}
                  className="flex flex-col justify-between rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm transition hover:border-zinc-400 hover:shadow-md"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1 text-[11px] font-medium text-emerald-700">
                          <Lock className="h-3 w-3" />
                          Confidential Case File
                        </div>
                        <h4 className="mt-1 text-lg font-semibold text-zinc-900">{c.clientName}</h4>
                        <div className="font-mono text-xs text-zinc-500">{c.reference}</div>
                      </div>
                      <Badge tone="accent">{c.status}</Badge>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-1">
                      {c.matterTypes.map((m) => (
                        <span
                          key={m}
                          className="rounded bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-700"
                        >
                          {m}
                        </span>
                      ))}
                    </div>

                    <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-zinc-600">
                      {c.summary}
                    </p>
                  </div>

                  <div className="mt-5 border-t border-zinc-100 pt-4">
                    <div className="flex items-center justify-between text-xs text-zinc-500 mb-3">
                      <span>{c.timeline.length} timeline events</span>
                      <span>
                        {receivedCount}/{c.evidence.length} evidence received
                      </span>
                    </div>

                    <Link href={`/workspace/cases/${c.id}`} className="block">
                      <Button variant="secondary" className="w-full justify-between">
                        Open Workspace
                        <ArrowRight className="h-4 w-4" />
                      </Button>
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Demo Section */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-semibold text-zinc-900">Demonstration Matter</h3>
          <Badge tone="warning">Fictional Sample</Badge>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {demoCases.map((c) => (
            <div
              key={c.id}
              className="flex flex-col justify-between rounded-2xl border border-amber-200 bg-amber-50/40 p-5 shadow-sm"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-amber-900">
                      Sample Case Study
                    </span>
                    <h4 className="mt-1 text-lg font-semibold text-zinc-900">{c.clientName}</h4>
                    <div className="font-mono text-xs text-zinc-500">{c.reference}</div>
                  </div>
                  <Badge tone="warning">Demo</Badge>
                </div>

                <div className="mt-3 flex flex-wrap gap-1">
                  {c.matterTypes.map((m) => (
                    <span
                      key={m}
                      className="rounded border border-amber-300 bg-white px-2 py-0.5 text-[11px] font-medium text-amber-950"
                    >
                      {m}
                    </span>
                  ))}
                </div>

                <p className="mt-3 line-clamp-3 text-xs leading-relaxed text-zinc-600">
                  {c.summary}
                </p>
              </div>

              <div className="mt-5 border-t border-amber-200/60 pt-4">
                <Link href={`/workspace/cases/${c.id}`} className="block">
                  <Button variant="secondary" className="w-full justify-between bg-white">
                    Explore Demo Case
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
              </div>
            </div>
          ))}

          {/* Quick Create Card */}
          <button
            type="button"
            onClick={() => setShowNewModal(true)}
            className="flex min-h-[220px] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-zinc-200 p-6 text-center transition hover:border-zinc-400 hover:bg-zinc-50"
          >
            <FolderPlus className="h-10 w-10 text-zinc-400" />
            <div className="mt-3 text-sm font-semibold text-zinc-900">Open Another Case</div>
            <p className="mt-1 text-xs text-zinc-500">
              Add a new immigration, settlement, or visa matter.
            </p>
          </button>
        </div>
      </div>

      <NewCaseModal isOpen={showNewModal} onClose={() => setShowNewModal(false)} />
    </div>
  );
}

export function WorkspaceCaseList({ defaultCases }: { defaultCases: LegalCase[] }) {
  return (
    <CaseStoreProvider initialCase={defaultCases[0]}>
      <WorkspaceCaseListInner defaultCases={defaultCases} />
    </CaseStoreProvider>
  );
}

