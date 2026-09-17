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

const SUGGESTIONS = [
  "Explain the current status map and what VTS means here",
  "What evidence is still missing for the tribunal appeal?",
  "Map the GP letter to Article 3 / NRM / VTS",
  "Draft a checklist for solicitor review before skeleton arguments",
];

function offlineReply(question: string, legalCase: LegalCase): string {
  const lower = question.toLowerCase();
  if (lower.includes("missing") || lower.includes("evidence")) {
    const missing = legalCase.evidence
      .filter((e) => e.status === "missing" || e.status === "requested")
      .map((e) => `• ${e.title} — ${e.summary}`)
      .join("\n");
    const received = legalCase.evidence.filter(
      (e) => e.status !== "missing" && e.status !== "requested"
    ).length;
    return `## What I know
${received} of ${legalCase.evidence.length} evidence items are on file for ${legalCase.clientName}.

## Missing / requested evidence
${missing}

## Recommended next actions
1. Prioritise independent medico-legal report (critical for tribunal weight).
2. Obtain therapist letter.
3. Finalise witness statement with solicitor.

---
*LegalOS is not a solicitor. High-stakes steps need qualified legal review.*

_Note: Live AI is unavailable. Showing structured case intelligence from the workspace._`;
  }

  if (lower.includes("vts") || lower.includes("status")) {
    return `## What I know
• Positive Conclusive Grounds (2025)
• VTS granted (Jan 2026)
• Asylum appeal still pending at the First-tier Tribunal

## Evidence used
Positive CG decision, VTS grant letter, appeal notice, refusal letter.

## Relevant law / policy
Temporary Permission to Stay guidance for victims of trafficking; NRM framework; appeal rights after asylum refusal.

## Alternative interpretations
Leave under VTS does not automatically resolve all protection issues raised in the asylum appeal.

## Recommended next actions
Confirm leave conditions, track expiry/extension, and ensure appeal evidence addresses refusal findings with updated medical pack.

---
*LegalOS is not a solicitor. This is case organisation support, not reserved legal advice.*

_Note: Live AI is unavailable. Showing structured case intelligence from the workspace._`;
  }

  if (lower.includes("gp") || lower.includes("article") || lower.includes("ptsd")) {
    return `## Evidence chain
GP Letter → PTSD indicators → Article 3 relevance → supports NRM/VTS narrative → material for Appeal / Tribunal.

## What I know
GP letter notes trauma-related symptoms. Specialist medico-legal evidence is still missing and often carries more tribunal weight.

## Missing evidence
Independent psychiatric / medico-legal report; therapist treatment letter.

## Recommended next actions
Use Medical Evidence Agent request workflows; solicitor to instruct expert.

---
*LegalOS is not a solicitor.*

_Note: Live AI is unavailable._`;
  }

  return `## What I know
You are working on case ${legalCase.reference} for ${legalCase.clientName}: ${legalCase.matterTypes.join(", ")}.

## Case snapshot
${legalCase.summary}

## What I could not verify
This response uses the local case register only. It does not check current law or guidance.

## Recommended next actions
Ask about status, missing evidence, GP/Article 3 mapping, or solicitor review checklist. Live reasoning requires a configured provider.

---
*LegalOS helps organise evidence and collaborate with professionals. It is not your lawyer.*

_Note: Live AI is unavailable._`;
}

export function AIAssistant({ legalCase }: { legalCase: LegalCase }) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content: `I'm the LegalOS assistant for **${legalCase.clientName}**.\n\nI can help you understand this case, map evidence to legal issues, and prepare materials for solicitor review.\n\nI am **not** a solicitor and will not file reserved legal work.\n\nTry a suggestion below, or ask about timeline, VTS, NRM, or missing evidence.`,
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    // `Date.now()` during render is impure and was a lint error; ids come from
    // the crypto RNG instead.
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
      const data = await res.json();

      // The canned reply is only correct when the server says live AI is not
      // configured. Previously any empty reply — a refusal, a truncation, a
      // provider error, an output shape the extractor missed — was silently
      // swapped for a keyword-matched script, so the user believed they had
      // received live reasoning about their case.
      let content: string;
      if (typeof data.reply === "string" && data.reply.length > 0) {
        content =
          data.verified === false
            ? `${data.reply}\n\n---\n*Not verified: the citations in this answer could not be checked against a verified source. Do not rely on it without confirming with a regulated adviser.*`
            : data.reply;
      } else if (data.offline === true) {
        content = offlineReply(trimmed, legalCase);
      } else {
        content =
          "I could not produce an answer for that. Nothing has been substituted in its place. Please try again, or speak to a regulated adviser.";
      }

      setMessages((m) => [...m, { id: `a-${crypto.randomUUID()}`, role: "assistant", content }]);
    } catch {
      setMessages((m) => [
        ...m,
        {
          id: `a-${crypto.randomUUID()}`,
          role: "assistant",
          content:
            "I could not reach the assistant. Nothing has been substituted in its place — please try again.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-[min(720px,calc(100vh-12rem))] flex-col rounded-2xl border border-zinc-200 bg-white shadow-[var(--shadow-soft)]">
      <div className="flex items-center gap-2 border-b border-zinc-100 px-5 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
          <Sparkles className="h-4 w-4" />
        </div>
        <div>
          <div className="text-sm font-semibold">Case AI Assistant</div>
          <div className="text-[11px] text-[var(--muted)]">
            Explainable · Human-in-the-loop · Not a solicitor
          </div>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-5 scrollbar-thin">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                msg.role === "user"
                  ? "bg-[var(--accent)] text-white"
                  : "border border-zinc-100 bg-zinc-50 text-[var(--graphite)]"
              }`}
            >
              <div className="prose-legal whitespace-pre-wrap">{msg.content}</div>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Reasoning with case context…
          </div>
        )}
      </div>

      <div className="border-t border-zinc-100 p-4">
        <div className="mb-3 flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => send(s)}
              className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-[11px] text-[var(--muted)] transition hover:border-[var(--accent)]/30 hover:text-[var(--accent)]"
            >
              {s}
            </button>
          ))}
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about this case…"
            className="h-11 flex-1 rounded-xl border border-zinc-200 bg-white px-4 text-sm outline-none ring-[var(--accent)]/20 placeholder:text-zinc-400 focus:ring-2"
          />
          <Button type="submit" disabled={loading || !input.trim()} className="h-11 px-4">
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </div>
  );
}
