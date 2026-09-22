"use client";

import { useState } from "react";
import {
  AlertCircle,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  FileCheck2,
  FileText,
  Layers,
  ListTodo,
  Loader2,
  Plus,
  Send,
  ShieldAlert,
  Sparkles,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LegalCase } from "@/lib/types";
import { useCaseStore } from "./case-store-context";
import type { ProposedAction, SpecialistAgentId } from "@/lib/agents/types";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  activeAgents?: SpecialistAgentId[];
  proposedActions?: ProposedAction[];
  appliedActions?: number[];
  offline?: boolean;
}

const AGENT_LABELS: Record<SpecialistAgentId, { name: string; color: string }> = {
  supervisor: { name: "Supervisor Orchestrator", color: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  intake: { name: "Intake Agent", color: "bg-blue-50 text-blue-700 border-blue-200" },
  evidence: { name: "Evidence Agent", color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  timeline: { name: "Timeline Agent", color: "bg-amber-50 text-amber-700 border-amber-200" },
  immigration: { name: "Immigration Specialist", color: "bg-purple-50 text-purple-700 border-purple-200" },
  workflow: { name: "Workflow Agent", color: "bg-cyan-50 text-cyan-700 border-cyan-200" },
  compliance: { name: "Compliance Agent", color: "bg-rose-50 text-rose-700 border-rose-200" },
  human_review: { name: "Human Review Gate", color: "bg-zinc-100 text-zinc-800 border-zinc-300" },
};

export function AIAssistant({ legalCase }: { legalCase: LegalCase }) {
  const { createTask, addEvidence, addTimeline, createDeadline } = useCaseStore();

  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content: `I am the **LegalOS Autonomous Multi-Agent Supervisor** for **${legalCase.clientName}** (${legalCase.reference}).\n\nI can coordinate specialized agents to audit evidence gaps, inspect your timeline chronology for tribunal credibility, verify immigration rule eligibility, and dispatch actionable tasks directly into your workspace.\n\n*LegalOS is not a solicitor and all reserved legal activities require qualified human sign-off.*`,
      activeAgents: ["supervisor", "intake", "evidence", "timeline", "workflow", "human_review"],
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const quickPrompts = [
    { label: "⚡ Audit Evidence & Create Tasks", prompt: "Audit all evidence gaps for this client and create high priority tasks for missing documents." },
    { label: "⏱️ Check Chronology for Tribunal Gaps", prompt: "Audit the timeline chronology for credibility gaps, date discrepancies, and tribunal compliance." },
    { label: "⚖️ Evaluate Immigration Rules & Routes", prompt: "Assess this case against applicable UK Immigration Rules, Home Office guidance, and human rights grounds." },
    { label: "🛡️ Solicitor Pre-Submission Checklist", prompt: "Prepare a complete pre-submission checklist for solicitor review and compliance sign-off." },
  ];

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const userMsg: Message = {
      id: `u-${crypto.randomUUID()}`,
      role: "user",
      content: trimmed,
    };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          caseId: legalCase.id,
          caseData: legalCase,
        }),
      });

      const data = await res.json().catch(() => ({}));

      const replyContent =
        typeof data.reply === "string" && data.reply.length > 0
          ? data.reply
          : `## Supervisor Analysis for ${legalCase.clientName}\n\nCoordinated evaluation processed for ${legalCase.matterTypes.join(", ")}.`;

      setMessages((m) => [
        ...m,
        {
          id: `a-${crypto.randomUUID()}`,
          role: "assistant",
          content: replyContent,
          activeAgents: Array.isArray(data.activeAgents) ? data.activeAgents : ["supervisor", "human_review"],
          proposedActions: Array.isArray(data.proposedActions) ? data.proposedActions : [],
          appliedActions: [],
          offline: data.offline ?? true,
        },
      ]);
    } catch (err) {
      console.error("Supervisor chat error:", err);
      setMessages((m) => [
        ...m,
        {
          id: `a-${crypto.randomUUID()}`,
          role: "assistant",
          content: `## Case Intelligence: ${legalCase.clientName}\n\nProcessed case query for ${legalCase.matterTypes.join(", ")}. Review active evidence and chronology in the workspace tabs.`,
          activeAgents: ["supervisor", "human_review"],
          proposedActions: [],
          appliedActions: [],
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function applyAction(msgId: string, actionIndex: number, action: ProposedAction) {
    if (action.type === "add_task") {
      createTask(action.task);
    } else if (action.type === "add_evidence") {
      addEvidence(action.evidence);
    } else if (action.type === "add_timeline") {
      addTimeline(action.event);
    } else if (action.type === "add_deadline") {
      createDeadline(action.deadline);
    }

    setMessages((prev) =>
      prev.map((msg) => {
        if (msg.id !== msgId) return msg;
        const existing = msg.appliedActions ?? [];
        return {
          ...msg,
          appliedActions: existing.includes(actionIndex) ? existing : [...existing, actionIndex],
        };
      })
    );
  }

  function applyAllActions(msgId: string, actions: ProposedAction[]) {
    actions.forEach((action, idx) => {
      applyAction(msgId, idx, action);
    });
  }

  return (
    <div className="flex h-[calc(100vh-14rem)] min-h-[550px] flex-col rounded-2xl border border-zinc-200 bg-white shadow-[var(--shadow-soft)]">
      {/* Header */}
      <div className="border-b border-zinc-100 p-4 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
              <Layers className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold tracking-tight text-zinc-900">
                Multi-Agent Supervisor: {legalCase.clientName}
              </h2>
              <p className="text-xs text-zinc-500">
                Autonomous orchestrator coordinating specialized agents across your case register.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
            <Sparkles className="h-3 w-3" />
            <span>Standalone Entity Active</span>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 space-y-5 overflow-y-auto p-4 sm:p-6 scrollbar-thin">
        {messages.map((m) => {
          const isUser = m.role === "user";
          return (
            <div
              key={m.id}
              className={`flex ${isUser ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-3xl rounded-2xl p-4 sm:p-5 text-sm leading-relaxed ${
                  isUser
                    ? "bg-zinc-900 text-white shadow-sm"
                    : "border border-zinc-200/90 bg-zinc-50/60 text-zinc-800 shadow-sm"
                }`}
              >
                {/* Agent collaboration badges */}
                {!isUser && m.activeAgents && m.activeAgents.length > 0 && (
                  <div className="mb-3.5 pb-3 border-b border-zinc-200/70">
                    <div className="flex items-center gap-1.5 text-xs text-zinc-500 mb-1.5">
                      <Users className="h-3.5 w-3.5 text-indigo-500" />
                      <span className="font-semibold text-zinc-700">Agent Collaboration Trail:</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {m.activeAgents.map((ag) => {
                        const meta = AGENT_LABELS[ag] || { name: ag, color: "bg-zinc-100 text-zinc-700 border-zinc-200" };
                        return (
                          <span
                            key={ag}
                            className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${meta.color}`}
                          >
                            {meta.name}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Markdown content */}
                <div className="prose prose-sm max-w-none dark:prose-invert whitespace-pre-wrap">
                  {m.content}
                </div>

                {/* Proposed Actions Card */}
                {!isUser && m.proposedActions && m.proposedActions.length > 0 && (
                  <div className="mt-4 rounded-xl border border-indigo-200/80 bg-white p-3.5 shadow-sm">
                    <div className="flex items-center justify-between gap-2 mb-2.5">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-indigo-950">
                        <ListTodo className="h-4 w-4 text-indigo-600" />
                        <span>Proposed Case Actions ({m.proposedActions.length})</span>
                      </div>
                      <Button
                        size="sm"
                        variant="secondary"
                        className="h-7 text-xs border-indigo-300 text-indigo-700 hover:bg-indigo-50"
                        onClick={() => applyAllActions(m.id, m.proposedActions!)}
                      >
                        <CheckCircle2 className="mr-1 h-3 w-3" />
                        Apply All to Workspace
                      </Button>
                    </div>

                    <div className="space-y-2">
                      {m.proposedActions.map((action, idx) => {
                        const isApplied = m.appliedActions?.includes(idx);
                        return (
                          <div
                            key={idx}
                            className="flex items-center justify-between gap-3 rounded-lg border border-zinc-100 bg-zinc-50/70 p-2.5 text-xs"
                          >
                            <div className="flex items-start gap-2 min-w-0">
                              {action.type === "add_task" && (
                                <ListTodo className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                              )}
                              {action.type === "add_evidence" && (
                                <FileCheck2 className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
                              )}
                              {action.type === "add_timeline" && (
                                <Calendar className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                              )}
                              {action.type === "add_deadline" && (
                                <Clock className="h-4 w-4 text-purple-600 shrink-0 mt-0.5" />
                              )}

                              <div className="min-w-0">
                                <span className="font-medium text-zinc-900">
                                  {action.type === "add_task" && `Task: ${action.task.title}`}
                                  {action.type === "add_evidence" && `Evidence Request: ${action.evidence.title}`}
                                  {action.type === "add_timeline" && `Chronology: ${action.event.date} — ${action.event.title}`}
                                  {action.type === "add_deadline" && `Deadline: ${action.deadline.title} (${action.deadline.date})`}
                                </span>
                                <p className="text-[11px] text-zinc-500 truncate">
                                  {action.type === "add_task" && action.task.description}
                                  {action.type === "add_evidence" && action.evidence.summary}
                                  {action.type === "add_timeline" && action.event.description}
                                  {action.type === "add_deadline" && action.deadline.notes}
                                </p>
                              </div>
                            </div>

                            <button
                              type="button"
                              disabled={isApplied}
                              onClick={() => applyAction(m.id, idx, action)}
                              className={`shrink-0 flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition ${
                                isApplied
                                  ? "bg-emerald-100 text-emerald-800 cursor-default"
                                  : "border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100"
                              }`}
                            >
                              {isApplied ? (
                                <>
                                  <Check className="h-3 w-3" />
                                  <span>Applied</span>
                                </>
                              ) : (
                                <>
                                  <Plus className="h-3 w-3" />
                                  <span>Apply</span>
                                </>
                              )}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {loading && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
              <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />
              <span>Supervisor coordinating Intake, Evidence, Timeline, and Immigration agents...</span>
            </div>
          </div>
        )}
      </div>

      {/* Quick Prompts & Input Bar */}
      <div className="border-t border-zinc-100 p-4 bg-zinc-50/40 rounded-b-2xl">
        <div className="mb-3 flex flex-wrap gap-1.5">
          {quickPrompts.map((q) => (
            <button
              key={q.label}
              type="button"
              onClick={() => send(q.prompt)}
              className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 hover:text-zinc-900 shadow-xs"
            >
              {q.label}
            </button>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            placeholder={`Ask the Supervisor to audit evidence, chronology, or distribute tasks...`}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={loading}
            className="flex-1 rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900"
          />
          <Button type="submit" variant="dark" disabled={loading || !input.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </div>
  );
}
