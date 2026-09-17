"use client";

import { Badge } from "@/components/ui/badge";
import type { LegalCase } from "@/lib/types";
import { formatDate } from "@/lib/utils";

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
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-[var(--shadow-soft)] sm:p-6">
      <h2 className="text-lg font-semibold tracking-tight">Tasks & workflows</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Autonomous evidence collection and drafting workstreams — gated by human review where
        required.
      </p>
      <div className="mt-6 space-y-3">
        {legalCase.tasks.map((task) => (
          <div key={task.id} className="rounded-2xl border border-zinc-100 bg-zinc-50/50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="text-sm font-semibold">{task.title}</div>
                <p className="mt-1 text-sm leading-relaxed text-[var(--graphite)]">
                  {task.description}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Badge tone={priorityTone[task.priority]}>{task.priority}</Badge>
                <Badge tone={statusTone[task.status]}>{task.status.replaceAll("_", " ")}</Badge>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-3 text-xs text-[var(--muted)]">
              {task.agentId && <span>Agent: {task.agentId}</span>}
              {task.assignee && <span>Assignee: {task.assignee}</span>}
              {task.dueDate && <span>Due: {formatDate(task.dueDate)}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DeadlinesPanel({ legalCase }: { legalCase: LegalCase }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-[var(--shadow-soft)] sm:p-6">
      <h2 className="text-lg font-semibold tracking-tight">Deadlines radar</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Hard, soft, and eligibility dates tracked by the Compliance Agent.
      </p>
      <div className="mt-6 space-y-3">
        {legalCase.deadlines.map((d) => (
          <div
            key={d.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-100 px-4 py-3"
          >
            <div>
              <div className="text-sm font-semibold">{d.title}</div>
              {d.notes && <div className="mt-0.5 text-xs text-[var(--muted)]">{d.notes}</div>}
            </div>
            <div className="flex items-center gap-2">
              <Badge tone="neutral">{d.type}</Badge>
              <Badge tone={d.status === "overdue" ? "danger" : "accent"}>{d.status}</Badge>
              <span className="text-sm font-semibold tabular-nums">{formatDate(d.date)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ReviewPanel({ legalCase }: { legalCase: LegalCase }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-[var(--shadow-soft)] sm:p-6">
      <h2 className="text-lg font-semibold tracking-tight">Lawyer review queue</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">
        AI never files reserved legal work without approval. Reviewers settle drafts and analyses.
      </p>

      <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-xs leading-relaxed text-[var(--muted)]">
        <span className="font-semibold text-[var(--foreground)]">Approval path:</span> AI → Legal
        Reviewer → Solicitor → Client → Submission
      </div>

      <div className="mt-6 space-y-3">
        {legalCase.reviews.map((item) => (
          <div key={item.id} className="rounded-2xl border border-zinc-100 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="text-sm font-semibold">{item.title}</div>
                <div className="mt-0.5 text-xs text-[var(--muted)]">
                  {item.submittedBy} · {formatDate(item.submittedAt)}
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Badge tone="neutral">{item.type}</Badge>
                <Badge
                  tone={
                    item.status === "approved"
                      ? "success"
                      : item.status === "changes_requested"
                        ? "warning"
                        : item.status === "rejected"
                          ? "danger"
                          : "accent"
                  }
                >
                  {item.status.replaceAll("_", " ")}
                </Badge>
                {item.reservedActivity && <Badge tone="danger">reserved activity</Badge>}
              </div>
            </div>
            {item.notes && <p className="mt-2 text-sm text-[var(--graphite)]">{item.notes}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white"
              >
                Approve (demo)
              </button>
              <button
                type="button"
                className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium"
              >
                Request changes
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DocumentsPanel({ legalCase }: { legalCase: LegalCase }) {
  const drafts = [
    "Witness statement v3 (needs review)",
    "Medico-legal instruction letter",
    "Appeal skeleton (blocked — awaiting medical pack)",
    "Evidence index / bundle draft",
    "GP / therapist request letters",
    "Chronology for tribunal",
  ];

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-[var(--shadow-soft)] sm:p-6">
      <h2 className="text-lg font-semibold tracking-tight">Document generation</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Version-controlled drafts for appeals, statements, skeletons, JR grounds, and requests.
      </p>
      <div className="mt-6 space-y-2">
        {drafts.map((d) => (
          <div
            key={d}
            className="flex items-center justify-between rounded-xl border border-zinc-100 px-4 py-3"
          >
            <span className="text-sm font-medium">{d}</span>
            <Badge tone="neutral">versioned</Badge>
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs text-[var(--muted)]">
        Case: {legalCase.reference}. All generated documents remain drafts until solicitor approval.
      </p>
    </div>
  );
}
