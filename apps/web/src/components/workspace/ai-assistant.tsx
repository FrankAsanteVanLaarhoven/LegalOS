"use client";

import { useState } from "react";
import { Loader2, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LegalCase } from "@/lib/types";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

function getDynamicSuggestions(legalCase: LegalCase): string[] {
  const list = [
    `What evidence is still missing for ${legalCase.clientName}?`,
    `Summarise the chronology and timeline of this case`,
    `What are the upcoming deadlines and priority tasks?`,
    `Draft a checklist for solicitor review on ${legalCase.matterTypes[0] ?? "this application"}`,
  ];
  return list;
}

function dynamicOfflineReply(question: string, legalCase: LegalCase): string {
  const lower = question.toLowerCase();

  if (lower.includes("missing") || lower.includes("evidence") || lower.includes("document")) {
    const missing = legalCase.evidence.filter(
      (e) => e.status === "missing" || e.status === "requested"
    );
    const received = legalCase.evidence.filter(
      (e) => e.status !== "missing" && e.status !== "requested"
    );

    const missingList =
      missing.length > 0
        ? missing.map((e) => `• **${e.title}** (${e.status}): ${e.summary}`).join("\n")
        : "• No critical documents are currently flagged as missing.";

    return `## Evidence Register for ${legalCase.clientName}
**${received.length} of ${legalCase.evidence.length}** evidence items are marked as received.

### Missing or Requested Items
${missingList}

### Recommended Next Actions
1. Request or upload outstanding documents to achieve evidence completeness.
2. Cross-verify dates on all certificates against the case chronology.
3. Have your regulated solicitor / legal adviser inspect translated documents for compliance.

---
*LegalOS is not a solicitor. High-stakes steps need qualified legal review.*`;
  }

  if (lower.includes("timeline") || lower.includes("chronology") || lower.includes("events") || lower.includes("history")) {
    const timelineList =
      legalCase.timeline.length > 0
        ? legalCase.timeline
            .map((ev) => `• **${ev.date}**: ${ev.title} (${ev.source.replaceAll("_", " ")}) — ${ev.description}`)
            .join("\n")
        : "• No chronology events entered yet. Use the Timeline tab to add key dates.";

    return `## Chronology Summary for ${legalCase.clientName}
Recorded events on file (${legalCase.timeline.length} total):

${timelineList}

### Legal Intelligence Finding
Home Office decision-makers and Tribunal judges assess credibility against chronological coherence. Ensure all dates match primary documentary evidence.

---
*LegalOS helps organise facts and evidence. It does not replace regulated legal advice.*`;
  }

  if (lower.includes("deadline") || lower.includes("task") || lower.includes("due")) {
    const dls =
      legalCase.deadlines.length > 0
        ? legalCase.deadlines
            .map((d) => `• **${d.title}**: Due ${d.date} (${d.type} deadline - ${d.status})`)
            .join("\n")
        : "• No statutory deadlines registered.";

    const tasks =
      legalCase.tasks.length > 0
        ? legalCase.tasks
            .map((t) => `• **${t.title}** [${t.priority}]: ${t.status} (Assignee: ${t.assignee || "Unassigned"})`)
            .join("\n")
        : "• No open tasks.";

    return `## Deadlines & Workflow Status for ${legalCase.clientName}

### Tracked Deadlines
${dls}

### Active Tasks
${tasks}

### Recommended Action
Prioritise high/critical tasks before approaching statutory deadlines to allow sufficient time for lawyer review.

---
*LegalOS is not a solicitor.*`;
  }

  if (lower.includes("checklist") || lower.includes("solicitor") || lower.includes("review") || lower.includes("prepare")) {
    return `## Solicitor Pre-Submission Checklist for ${legalCase.clientName}
**Matter(s):** ${legalCase.matterTypes.join(", ")} | **Reference:** ${legalCase.reference}

1. **Client Identity & Authority:**
   - Confirm current nationality (${legalCase.nationality}) and valid passport.
   - Client Care letter settled and OISC / SRA compliance logged.

2. **Evidential Pack:**
   - Review ${legalCase.evidence.length} evidence items on file.
   - Verify certified translations for any foreign-language documents.

3. **Chronology Check:**
   - Verify all ${legalCase.timeline.length} chronology events against official stamps, travel history, and Home Office letters.

4. **Legal Grounds:**
   - Address statutory criteria for ${legalCase.matterTypes[0] ?? "the immigration route"}.
   - Prepare formal index bundle for submission or appeal filing.

---
*LegalOS provides case preparation workflows. Reserved legal activities must be conducted by authorised practitioners.*`;
  }

  return `## Case Intelligence: ${legalCase.clientName}
**Reference:** ${legalCase.reference}  
**Nationality:** ${legalCase.nationality}  
**Matter Types:** ${legalCase.matterTypes.join(", ")}  
**Assigned Solicitor:** ${legalCase.assignedSolicitor || "Pending allocation"}

### Case Summary
${legalCase.summary}

### Workspace Snapshot
• **Evidence Completeness:** ${legalCase.evidence.filter((e) => e.status !== "missing" && e.status !== "requested").length} / ${legalCase.evidence.length} items  
• **Chronology Events:** ${legalCase.timeline.length} events recorded  
• **Open Tasks:** ${legalCase.tasks.filter((t) => t.status !== "completed").length} pending  
• **Tracked Deadlines:** ${legalCase.deadlines.length} scheduled  

You can ask me about:
- Missing evidence and document gaps
- Timeline events and chronology
- Solicitor pre-submission checklist
- Deadlines and priority tasks

---
*LegalOS helps you understand your legal situation and prepare evidence. It is not your lawyer.*`;
}

export function AIAssistant({ legalCase }: { legalCase: LegalCase }) {
  const suggestions = getDynamicSuggestions(legalCase);

  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content: `I'm the LegalOS case assistant for **${legalCase.clientName}** (${legalCase.reference}).\n\nI can help you audit evidence gaps, review the chronology, explain legal requirements for **${legalCase.matterTypes.join(", ")}**, and prepare materials for your legal adviser.\n\nI am **not** a solicitor and will not perform reserved legal activities.\n\nTry a prompt below or ask about missing documents, deadlines, or timeline facts.`,
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

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
        }),
      });
      const data = await res.json().catch(() => ({}));

      let content: string;
      if (typeof data.reply === "string" && data.reply.length > 0) {
        content =
          data.verified === false
            ? `${data.reply}\n\n---\n*Not verified: the citations in this answer could not be checked against a verified source. Do not rely on it without confirming with a regulated adviser.*`
            : data.reply;
      } else {
        // Dynamic offline case reasoning tailored to this case
        content = dynamicOfflineReply(trimmed, legalCase);
      }

      setMessages((m) => [
        ...m,
        {
          id: `a-${crypto.randomUUID()}`,
          role: "assistant",
          content,
        },
      ]);
    } catch {
      setMessages((m) => [
        ...m,
        {
          id: `a-${crypto.randomUUID()}`,
          role: "assistant",
          content: dynamicOfflineReply(trimmed, legalCase),
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-14rem)] min-h-[500px] flex-col rounded-2xl border border-zinc-200 bg-white shadow-[var(--shadow-soft)]">
      <div className="border-b border-zinc-100 p-4 sm:px-6">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-[var(--accent)]" />
          <h2 className="text-base font-semibold tracking-tight text-zinc-900">
            Case Intelligence Assistant: {legalCase.clientName}
          </h2>
        </div>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Autonomous intelligence grounded in {legalCase.clientName}&apos;s case register. Does not provide reserved legal advice.
        </p>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6 scrollbar-thin">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-2xl rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                m.role === "user"
                  ? "bg-zinc-900 text-white"
                  : "border border-zinc-100 bg-zinc-50/80 text-[var(--graphite)] shadow-sm"
              }`}
            >
              <div className="prose prose-sm max-w-none dark:prose-invert whitespace-pre-wrap">
                {m.content}
              </div>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-2xl border border-zinc-100 bg-zinc-50 px-4 py-3 text-sm text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin text-[var(--accent)]" />
              Evaluating case register and UK immigration rules...
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-zinc-100 p-4">
        <div className="mb-3 flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => send(s)}
              className="rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900"
            >
              {s}
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
            placeholder={`Ask about ${legalCase.clientName}'s evidence, timeline, or checklist...`}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={loading}
            className="flex-1 rounded-xl border border-zinc-200 px-4 py-2.5 text-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900"
          />
          <Button type="submit" variant="dark" disabled={loading || !input.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </div>
  );
}
