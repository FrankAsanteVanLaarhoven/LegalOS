"use client";

import { useState } from "react";
import { Plus, X, Trash2, Calendar } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { LegalCase, TimelineEvent } from "@/lib/types";
import { formatDate } from "@/lib/utils";
import { useCaseStore } from "./case-store-context";

const SOURCE_LABEL: Record<string, string> = {
  user: "stated by the client",
  document: "from a document",
  ai_inferred: "inferred by a model",
};

const SOURCE_TONE: Record<string, "neutral" | "success" | "warning"> = {
  user: "neutral",
  document: "success",
  ai_inferred: "warning",
};

export function CaseTimelinePanel({ legalCase }: { legalCase: LegalCase }) {
  const { addTimeline, removeTimeline } = useCaseStore();
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [showAddModal, setShowAddModal] = useState(false);

  // New Event Form State
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<string>("immigration");
  const [source, setSource] = useState<"user" | "document" | "ai_inferred">("user");
  const [description, setDescription] = useState("");
  const [issuesStr, setIssuesStr] = useState("Immigration history, Status");

  const events = legalCase.timeline.filter((e) => {
    if (filterCategory === "all") return true;
    return e.category === filterCategory;
  });

  const handleAddEvent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    addTimeline({
      date,
      year: parseInt(date.slice(0, 4), 10) || new Date().getFullYear(),
      title: title.trim(),
      description: description.trim(),
      category,
      evidenceIds: [],
      legalIssues: issuesStr
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      source,
      confidence: 1.0,
    });

    setTitle("");
    setDescription("");
    setShowAddModal(false);
  };

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-[var(--shadow-soft)] sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-100 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight">Case Chronology</h2>
            <Badge tone="neutral">{legalCase.timeline.length} events</Badge>
          </div>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-zinc-600">
            Every event carries how it came to be known. A chronology that shows a recollection and
            a document the same way invites a submission built on the weaker of the two.
          </p>
        </div>

        <Button variant="dark" onClick={() => setShowAddModal(true)}>
          <Plus className="mr-1.5 h-4 w-4" />
          Add Timeline Event
        </Button>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {["all", "immigration", "personal", "identity", "protection", "medical", "tribunal", "employment"].map(
            (cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setFilterCategory(cat)}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium capitalize transition ${
                  filterCategory === cat
                    ? "bg-zinc-900 text-white"
                    : "border border-zinc-200 bg-zinc-50 text-zinc-600 hover:bg-zinc-100"
                }`}
              >
                {cat}
              </button>
            )
          )}
        </div>
      </div>

      {events.length === 0 ? (
        <div className="my-10 text-center">
          <Calendar className="mx-auto h-8 w-8 text-zinc-300" />
          <p className="mt-2 text-sm font-medium text-zinc-700">No events recorded in this filter</p>
          <p className="mt-1 text-xs text-zinc-500">
            Click &quot;Add Timeline Event&quot; to log dates of arrival, visa decisions, appointments, or notifications.
          </p>
        </div>
      ) : (
        <ol className="mt-6 border-l border-zinc-200 pl-5">
          {events.map((event) => (
            <li key={event.id} className="relative pb-6 last:pb-0">
              <span
                aria-hidden
                className="absolute -left-[27px] top-1.5 h-2.5 w-2.5 rounded-full bg-[var(--accent)] ring-4 ring-white"
              />
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="flex flex-wrap items-baseline gap-2">
                  <time className="font-mono text-[12px] font-semibold text-zinc-700">
                    {formatDate(event.date)}
                  </time>
                  <span className="text-[14px] font-semibold text-zinc-900">{event.title}</span>
                  <Badge tone={SOURCE_TONE[event.source] ?? "neutral"}>
                    {SOURCE_LABEL[event.source] ?? event.source}
                  </Badge>
                  <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium capitalize text-zinc-600">
                    {event.category}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => removeTimeline(event.id)}
                  className="text-zinc-400 hover:text-red-600"
                  title="Remove event"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              {event.description && (
                <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-700">
                  {event.description}
                </p>
              )}

              {event.legalIssues.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {event.legalIssues.map((issue) => (
                    <span
                      key={issue}
                      className="rounded bg-zinc-50 px-2 py-0.5 text-[11px] font-medium text-zinc-600 border border-zinc-200"
                    >
                      {issue}
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      {/* Add Timeline Event Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
              <div>
                <h3 className="text-base font-semibold text-zinc-900">Add Chronology Event</h3>
                <p className="text-xs text-zinc-500">Record a date, decision, or event with evidence provenance.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleAddEvent} className="mt-4 space-y-3.5">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-600">
                    Date of Occurrence *
                  </label>
                  <input
                    type="date"
                    required
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-600">
                    Category
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none"
                  >
                    <option value="immigration">Immigration</option>
                    <option value="personal">Personal</option>
                    <option value="identity">Identity</option>
                    <option value="protection">Protection</option>
                    <option value="medical">Medical</option>
                    <option value="employment">Employment</option>
                    <option value="tribunal">Tribunal</option>
                    <option value="compliance">Compliance</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-600">
                  Event Title *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Granted Skilled Worker Visa / Refusal letter received"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-600">
                  Provenance (How this came to be known) *
                </label>
                <select
                  value={source}
                  onChange={(e) => setSource(e.target.value as "user" | "document" | "ai_inferred")}
                  className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none"
                >
                  <option value="user">Stated by the client (verbal recollection)</option>
                  <option value="document">From a formal document / certificate</option>
                  <option value="ai_inferred">Inferred by AI model from records</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-600">
                  Description / Facts
                </label>
                <textarea
                  rows={2}
                  placeholder="Detailed description of what occurred..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-600">
                  Legal Issues / Topics (comma separated)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Leave conditions, Continuous Residence, Right to Work"
                  value={issuesStr}
                  onChange={(e) => setIssuesStr(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 border-t border-zinc-100 pt-3">
                <Button type="button" variant="secondary" onClick={() => setShowAddModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="dark">
                  Save Event
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
