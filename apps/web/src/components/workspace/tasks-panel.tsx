"use client";

import { useState } from "react";
import { Plus, X, Check, Shield, CheckSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { CaseTask, Deadline, LegalCase } from "@/lib/types";
import { formatDate } from "@/lib/utils";
import { useCaseStore } from "./case-store-context";

const priorityTone = {
  critical: "danger" as const,
  high: "warning" as const,
  medium: "accent" as const,
  low: "neutral" as const,
};

const statusTone = {
  pending: "neutral" as const,
  in_progress: "info" as const,
  blocked: "danger" as const,
  completed: "success" as const,
  needs_review: "warning" as const,
};

export function TasksPanel({ legalCase }: { legalCase: LegalCase }) {
  const { createTask, toggleTask } = useCaseStore();
  const [showAddModal, setShowAddModal] = useState(false);

  // New task form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<"critical" | "high" | "medium" | "low">("medium");
  const [assignee, setAssignee] = useState("");
  const [dueDate, setDueDate] = useState("");

  const handleAddTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    createTask({
      title: title.trim(),
      description: description.trim(),
      priority,
      status: "pending",
      agentId: "immigration",
      assignee: assignee.trim() || legalCase.assignedSolicitor || "Reviewer",
      dueDate: dueDate || undefined,
    });

    setTitle("");
    setDescription("");
    setShowAddModal(false);
  };

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-[var(--shadow-soft)] sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-100 pb-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Tasks & Workflows</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Autonomous evidence collection, drafting workstreams, and solicitor instructions.
          </p>
        </div>
        <Button variant="dark" onClick={() => setShowAddModal(true)}>
          <Plus className="mr-1.5 h-4 w-4" />
          Add Task
        </Button>
      </div>

      <div className="mt-6 space-y-3">
        {legalCase.tasks.length === 0 ? (
          <p className="text-sm text-zinc-500">No tasks created yet. Click &quot;Add Task&quot; to schedule work.</p>
        ) : (
          legalCase.tasks.map((task) => (
            <div
              key={task.id}
              className={`flex items-start justify-between gap-3 rounded-2xl border p-4 transition ${
                task.status === "completed"
                  ? "border-emerald-200 bg-emerald-50/40"
                  : "border-zinc-100 bg-zinc-50/50"
              }`}
            >
              <div className="flex items-start gap-3">
                <button
                  type="button"
                  onClick={() => toggleTask(task.id)}
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition ${
                    task.status === "completed"
                      ? "border-emerald-600 bg-emerald-600 text-white"
                      : "border-zinc-300 bg-white hover:border-zinc-400"
                  }`}
                >
                  {task.status === "completed" && <Check className="h-3.5 w-3.5 stroke-[3]" />}
                </button>
                <div>
                  <div
                    className={`text-sm font-semibold ${
                      task.status === "completed" ? "text-zinc-500 line-through" : "text-zinc-900"
                    }`}
                  >
                    {task.title}
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-[var(--graphite)]">
                    {task.description}
                  </p>
                  <div className="mt-2.5 flex flex-wrap gap-3 text-xs text-[var(--muted)]">
                    {task.agentId && <span>Agent: {task.agentId}</span>}
                    {task.assignee && <span>Assignee: {task.assignee}</span>}
                    {task.dueDate && <span>Due: {formatDate(task.dueDate)}</span>}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                <Badge tone={priorityTone[task.priority]}>{task.priority}</Badge>
                <Badge tone={statusTone[task.status]}>{task.status.replaceAll("_", " ")}</Badge>
              </div>
            </div>
          ))
        )}
      </div>

      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="relative w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
              <h3 className="text-base font-semibold text-zinc-900">Add New Task</h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleAddTask} className="mt-4 space-y-3.5">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-600">
                  Task Title *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Request bank statements for maintenance check"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-600">
                  Task Description
                </label>
                <textarea
                  rows={2}
                  placeholder="Actionable steps or instructions..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-600">
                    Priority
                  </label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as any)}
                    className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none"
                  >
                    <option value="critical">Critical</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-600">
                    Due Date
                  </label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-600">
                  Assignee
                </label>
                <input
                  type="text"
                  placeholder="e.g. Solicitor / Client Care"
                  value={assignee}
                  onChange={(e) => setAssignee(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 border-t border-zinc-100 pt-3">
                <Button type="button" variant="secondary" onClick={() => setShowAddModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="dark">
                  Save Task
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export function DeadlinesPanel({ legalCase }: { legalCase: LegalCase }) {
  const { createDeadline } = useCaseStore();
  const [showAddModal, setShowAddModal] = useState(false);

  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [type, setType] = useState<"hard" | "soft" | "eligibility">("hard");
  const [notes, setNotes] = useState("");

  const handleAddDeadline = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !date) return;

    createDeadline({
      title: title.trim(),
      date,
      type,
      status: "upcoming",
      notes: notes.trim(),
    });

    setTitle("");
    setNotes("");
    setShowAddModal(false);
  };

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-[var(--shadow-soft)] sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-100 pb-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Deadlines Radar</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Hard statutory, tribunal filing, and eligibility dates tracked by the Compliance Agent.
          </p>
        </div>
        <Button variant="dark" onClick={() => setShowAddModal(true)}>
          <Plus className="mr-1.5 h-4 w-4" />
          Add Deadline
        </Button>
      </div>

      <div className="mt-6 space-y-3">
        {legalCase.deadlines.length === 0 ? (
          <p className="text-sm text-zinc-500">No deadlines registered.</p>
        ) : (
          legalCase.deadlines.map((d) => (
            <div
              key={d.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-100 bg-zinc-50/50 px-4 py-3"
            >
              <div>
                <div className="text-sm font-semibold text-zinc-900">{d.title}</div>
                {d.notes && <div className="mt-0.5 text-xs text-[var(--muted)]">{d.notes}</div>}
              </div>
              <div className="flex items-center gap-2">
                <Badge tone="neutral">{d.type}</Badge>
                <Badge tone={d.status === "overdue" ? "danger" : "accent"}>{d.status}</Badge>
                <span className="text-sm font-semibold tabular-nums text-zinc-900">
                  {formatDate(d.date)}
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="relative w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
              <h3 className="text-base font-semibold text-zinc-900">Add Critical Deadline</h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleAddDeadline} className="mt-4 space-y-3.5">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-600">
                  Deadline Title *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. First-tier Tribunal Appeal Notice Deadline"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-600">
                    Deadline Date *
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
                    Deadline Type
                  </label>
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value as any)}
                    className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none"
                  >
                    <option value="hard">Hard (Tribunal / Expiry)</option>
                    <option value="soft">Soft (Internal Target)</option>
                    <option value="eligibility">Eligibility Window</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-600">
                  Notes
                </label>
                <textarea
                  rows={2}
                  placeholder="Statutory citation, consequence of missing, or directions..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 border-t border-zinc-100 pt-3">
                <Button type="button" variant="secondary" onClick={() => setShowAddModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="dark">
                  Save Deadline
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export function ReviewPanel({ legalCase }: { legalCase: LegalCase }) {
  const { updateCaseDetails } = useCaseStore();

  const handleApprove = (id: string) => {
    updateCaseDetails((c) => ({
      ...c,
      reviews: c.reviews.map((r) =>
        r.id === id ? { ...r, status: "approved" as const } : r
      ),
    }));
  };

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-[var(--shadow-soft)] sm:p-6">
      <h2 className="text-lg font-semibold tracking-tight">Lawyer Review Queue</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">
        AI never files reserved legal work without human approval. Regulated practitioners settle drafts and legal maps.
      </p>

      <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-xs leading-relaxed text-[var(--muted)]">
        <span className="font-semibold text-[var(--foreground)]">Approval path:</span> AI Draft → Legal Reviewer → Solicitor → Client Settle → Submission
      </div>

      <div className="mt-6 space-y-3">
        {legalCase.reviews.length === 0 ? (
          <p className="text-sm text-zinc-500">No review items currently pending.</p>
        ) : (
          legalCase.reviews.map((item) => (
            <div
              key={item.id}
              className="flex flex-col justify-between gap-3 rounded-2xl border border-zinc-100 bg-zinc-50/50 p-4 sm:flex-row sm:items-center"
            >
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-sm font-semibold text-zinc-900">{item.title}</div>
                  <Badge tone={item.status === "approved" ? "success" : "warning"}>
                    {item.status.replaceAll("_", " ")}
                  </Badge>
                  {item.reservedActivity && <Badge tone="neutral">Reserved activity</Badge>}
                </div>
                <div className="mt-1 text-xs text-[var(--muted)]">
                  Submitted by {item.submittedBy} · {formatDate(item.submittedAt)}
                </div>
                {item.notes && (
                  <p className="mt-2 text-xs leading-relaxed text-[var(--graphite)]">
                    Notes: {item.notes}
                  </p>
                )}
              </div>

              {item.status !== "approved" && (
                <Button
                  size="sm"
                  variant="dark"
                  onClick={() => handleApprove(item.id)}
                  className="shrink-0"
                >
                  <Check className="mr-1 h-3.5 w-3.5" />
                  Approve & Settle
                </Button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function DocumentsPanel({ legalCase }: { legalCase: LegalCase }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-[var(--shadow-soft)] sm:p-6">
      <h2 className="text-lg font-semibold tracking-tight">Case Documents & Bundles</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Indexed bundles, draft witness statements, and Home Office application packs prepared for {legalCase.clientName}.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-zinc-100 bg-zinc-50/50 p-4">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-[var(--accent)]" />
            <div className="text-sm font-semibold">Evidence Bundle Draft</div>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">
            Auto-indexed PDF bundle paginated with chronology and evidence register exhibits.
          </p>
          <div className="mt-4 flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => alert("Generating indexed bundle for " + legalCase.clientName)}>
              Export Bundle (PDF)
            </Button>
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-100 bg-zinc-50/50 p-4">
          <div className="flex items-center gap-2">
            <CheckSquare className="h-4 w-4 text-emerald-600" />
            <div className="text-sm font-semibold">Witness Statement Draft</div>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">
            Chronological statement assembled from client recollections and supporting exhibits.
          </p>
          <div className="mt-4 flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => alert("Drafting witness statement for " + legalCase.clientName)}>
              View Draft Statement
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
