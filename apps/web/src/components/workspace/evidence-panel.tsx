"use client";

import { useState } from "react";
import { Plus, X, Trash2, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { EvidenceCategory, LegalCase } from "@/lib/types";
import { formatDate } from "@/lib/utils";
import { useCaseStore } from "./case-store-context";

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

export function EvidencePanel({ legalCase }: { legalCase: LegalCase }) {
  const { addEvidence, changeEvidenceStatus, removeEvidence } = useCaseStore();
  const [showAddModal, setShowAddModal] = useState(false);

  // New Document State
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<EvidenceCategory>("immigration");
  const [status, setStatus] = useState<"received" | "requested" | "missing">("received");
  const [summary, setSummary] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [linkedIssuesStr, setLinkedIssuesStr] = useState("");
  const [tagsStr, setTagsStr] = useState("");

  const groups = legalCase.evidence.reduce(
    (acc, item) => {
      acc[item.category] = acc[item.category] || [];
      acc[item.category].push(item);
      return acc;
    },
    {} as Record<string, typeof legalCase.evidence>
  );

  const handleAddDocument = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    addEvidence({
      title: title.trim(),
      category,
      status,
      summary: summary.trim(),
      date,
      confidence: 1.0,
      linkedIssues: linkedIssuesStr
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      linkedEvents: [],
      tags: tagsStr
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    });

    setTitle("");
    setSummary("");
    setLinkedIssuesStr("");
    setTagsStr("");
    setShowAddModal(false);
  };

  const receivedCount = legalCase.evidence.filter(
    (e) => e.status !== "missing" && e.status !== "requested"
  ).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-[var(--shadow-soft)]">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight">Evidence Register</h2>
            <Badge tone="accent">
              {receivedCount}/{legalCase.evidence.length} items received
            </Badge>
          </div>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Every document is linked to legal issues, timeline events, and completeness scoring.
          </p>
        </div>

        <Button variant="dark" onClick={() => setShowAddModal(true)}>
          <Plus className="mr-1.5 h-4 w-4" />
          Register Document
        </Button>
      </div>

      {legalCase.evidence.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-12 text-center">
          <FileText className="mx-auto h-8 w-8 text-zinc-400" />
          <h3 className="mt-2 text-sm font-semibold text-zinc-900">No evidence documents registered</h3>
          <p className="mt-1 text-xs text-zinc-500">
            Click &quot;Register Document&quot; above to log passports, tenancy records, employment letters, or Home Office notices.
          </p>
        </div>
      ) : (
        Object.entries(groups).map(([cat, items]) => (
          <div key={cat} className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge tone={categoryTone[cat as EvidenceCategory] ?? "neutral"}>{cat}</Badge>
              <span className="text-xs text-[var(--muted)]">{items.length} items</span>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col justify-between rounded-2xl border border-zinc-200 bg-white p-4 shadow-[var(--shadow-soft)]"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-sm font-semibold text-zinc-900">{item.title}</div>
                        {item.date && (
                          <div className="mt-0.5 text-xs text-[var(--muted)]">
                            {formatDate(item.date)}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5">
                        <select
                          value={item.status}
                          onChange={(e) =>
                            changeEvidenceStatus(
                              item.id,
                              e.target.value as "received" | "missing" | "requested" | "expired"
                            )
                          }
                          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold border ${
                            item.status === "received"
                              ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                              : item.status === "requested"
                                ? "bg-amber-50 text-amber-800 border-amber-200"
                                : "bg-red-50 text-red-800 border-red-200"
                          }`}
                        >
                          <option value="received">Received</option>
                          <option value="requested">Requested</option>
                          <option value="missing">Missing</option>
                          <option value="expired">Expired</option>
                        </select>

                        <button
                          type="button"
                          onClick={() => removeEvidence(item.id)}
                          className="p-1 text-zinc-400 hover:text-red-600"
                          title="Delete evidence item"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
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
                  </div>

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
        ))
      )}

      {/* Add Document Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
              <div>
                <h3 className="text-base font-semibold text-zinc-900">Register Evidence Document</h3>
                <p className="text-xs text-zinc-500">Record a new document into the case register.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleAddDocument} className="mt-4 space-y-3.5">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-600">
                  Document Title *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Certificate of Sponsorship / Marriage Certificate / Bank Statements"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-600">
                    Category
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as EvidenceCategory)}
                    className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none"
                  >
                    <option value="immigration">Immigration</option>
                    <option value="employment">Employment</option>
                    <option value="identity">Identity</option>
                    <option value="medical">Medical</option>
                    <option value="police">Police</option>
                    <option value="tribunal">Tribunal</option>
                    <option value="personal">Personal</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-600">
                    Document Status
                  </label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as any)}
                    className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none"
                  >
                    <option value="received">Received / Uploaded</option>
                    <option value="requested">Requested from client/third-party</option>
                    <option value="missing">Missing / Required</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-600">
                  Document Date
                </label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-600">
                  Summary / Notes
                </label>
                <textarea
                  rows={2}
                  placeholder="Summary of what the document shows and verifies..."
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-600">
                    Linked Issues (comma separated)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Salary requirement, Continuous residence"
                    value={linkedIssuesStr}
                    onChange={(e) => setLinkedIssuesStr(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-600">
                    Tags (comma separated)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. primary, sponsor, verified"
                    value={tagsStr}
                    onChange={(e) => setTagsStr(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 border-t border-zinc-100 pt-3">
                <Button type="button" variant="secondary" onClick={() => setShowAddModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="dark">
                  Register Document
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
