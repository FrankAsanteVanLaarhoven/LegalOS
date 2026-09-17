"use client";

import { useState } from "react";
import { Loader2, X } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { Button } from "@/components/ui/button";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

export function VoiceAgentPanel() {
  const { voiceOpen, setVoiceOpen, t, speak, locale, plainEnglish } = useApp();
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "assistant",
      content: plainEnglish
        ? "Hi. I explain pages and legal words in simple English. I am not a lawyer. Ask me anything on this page."
        : t("voice.agentHint"),
    },
  ]);

  if (!voiceOpen) return null;

  async function send() {
    const q = input.trim();
    if (!q || loading) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: q }]);
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // No caseId. This widget is mounted on every page and answers questions
        // from the general public; attaching a case file here meant a stranger's
        // question was answered through an unrelated client's asylum, trafficking
        // and medical history.
        body: JSON.stringify({
          message: `${plainEnglish || locale === "en-plain" ? "Explain in very simple English a 10-year-old can understand. " : ""}Locale=${locale}. User question about LegalOS / UK immigration process: ${q}`,
        }),
      });
      const data = await res.json();
      // The server already knows why it could not answer, and says so. This
      // used to substitute a hardcoded message naming one vendor's key, so a
      // database outage, a refused request and a missing credential all read as
      // the same thing — and kept reading that way after the credential existed.
      const reply =
        data.reply ||
        data.error ||
        (plainEnglish
          ? "I could not reach the live AI. Here is a simple answer: LegalOS helps organise papers and work with real solicitors. It does not decide your case. Always ask a real solicitor for legal advice."
          : "Live AI is unavailable. LegalOS organises evidence and workflows; reserved advice requires a qualified professional.");
      setMessages((m) => [...m, { role: "assistant", content: reply }]);
      speak(reply.slice(0, 800));
    } catch {
      const fallback =
        "I am offline. Remember: LegalOS is not a solicitor. Use Mission Control to organise your case and speak to a regulated professional.";
      setMessages((m) => [...m, { role: "assistant", content: fallback }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-end bg-black/30 p-4 sm:items-center sm:p-8">
      <div className="flex h-[min(560px,85vh)] w-full max-w-md flex-col rounded-2xl border border-[var(--line)] bg-[var(--bg-elevated)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
          <div>
            <div className="text-sm font-semibold">{t("voice.agentTitle")}</div>
            <div className="text-[11px] text-[var(--muted)]">{t("voice.agentHint")}</div>
          </div>
          <button
            type="button"
            onClick={() => setVoiceOpen(false)}
            className="rounded-full p-1.5 hover:bg-black/5 dark:hover:bg-white/10"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-4 scrollbar-thin">
          {messages.map((m, i) => (
            <div
              key={i}
              className={`max-w-[90%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                m.role === "user"
                  ? "ml-auto bg-[var(--accent)] text-white"
                  : "border border-[var(--line)] bg-[var(--bg)] text-[var(--ink-soft)]"
              }`}
            >
              {m.content}
            </div>
          ))}
          {loading && (
            <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
            </div>
          )}
        </div>
        <form
          className="flex gap-2 border-t border-[var(--line)] p-3"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t("voice.placeholder")}
            className="h-10 flex-1 rounded-xl border border-[var(--line)] bg-transparent px-3 text-sm outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
          />
          <Button type="submit" size="sm" disabled={loading}>
            {t("voice.send")}
          </Button>
        </form>
      </div>
    </div>
  );
}
