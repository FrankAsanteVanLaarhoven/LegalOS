"use client";

import { useEffect, useRef, useState } from "react";
import {
  Bot,
  Loader2,
  Mic,
  MicOff,
  Radio,
  RotateCcw,
  Sparkles,
  Square,
  Volume2,
  VolumeX,
  X,
  Send,
} from "lucide-react";
import { useApp } from "@/lib/app-context";
import { Button } from "@/components/ui/button";
import {
  createSpeechRecognizer,
  isSpeechRecognitionSupported,
  isSpeechSynthesisSupported,
  speakConversationalText,
  type BrowserSpeechRecognition,
} from "@/lib/voice/speech";

interface Msg {
  id: string;
  role: "user" | "assistant";
  content: string;
  spokenSummary?: string;
  timestamp: string;
}

interface ProperQuestion {
  category: string;
  question: string;
}

const PROPER_LEGAL_QUESTIONS: ProperQuestion[] = [
  {
    category: "Tribunal Appeal",
    question: "How do I appeal a Home Office refusal to the First-tier Tribunal within the 14-day limit?",
  },
  {
    category: "Work Visa",
    question: "Can I switch from a Graduate visa to a Skilled Worker visa without leaving the UK?",
  },
  {
    category: "Settlement (ILR)",
    question: "What evidence proves 5 years continuous residence under the 180-day rule for ILR?",
  },
  {
    category: "Asylum Interview",
    question: "What happens at the Home Office substantive asylum interview and what can I bring?",
  },
  {
    category: "Spouse & Partner",
    question: "What financial and relationship evidence is required for a UK partner or spouse visa?",
  },
  {
    category: "Solicitor Sign-off",
    question: "Which legal drafting and submission tasks require an SRA solicitor sign-off?",
  },
];

export function VoiceAgentPanel() {
  const { voiceOpen, setVoiceOpen, t, locale, plainEnglish } = useApp();
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [activeSpeechId, setActiveSpeechId] = useState<string | null>(null);
  const [voiceMode, setVoiceMode] = useState(false); // Hands-free continuous speech-to-speech mode
  const [voiceStatus, setVoiceStatus] = useState<"idle" | "listening" | "thinking" | "speaking">("idle");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [speechSpeed, setSpeechSpeed] = useState<number>(1.0);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [isMuted, setIsMuted] = useState(false);

  const [messages, setMessages] = useState<Msg[]>([
    {
      id: "welcome-1",
      role: "assistant",
      content: plainEnglish
        ? "Hi! I explain UK legal and immigration processes in simple English. I am not a solicitor. Ask me anything in writing or speak into your microphone."
        : "Ask in plain language. I explain process and documents — I am not a solicitor. You can type or use voice conversation.",
      spokenSummary: plainEnglish
        ? "Hi! I explain UK legal and immigration processes in simple English. I am not a solicitor. Ask me anything in writing or speak into your microphone."
        : "Ask in plain language. I explain process and documents. I am not a solicitor. You can type or use voice conversation.",
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    },
  ]);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const stopCurrentSpeechRef = useRef<(() => void) | null>(null);
  const activeRecognizerRef = useRef<{ stop: () => void; abort: () => void } | null>(null);

  // Auto-scroll to bottom of conversation
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, interimTranscript]);

  // Clean up speech and recognition when panel closes
  useEffect(() => {
    if (!voiceOpen) {
      stopCurrentSpeechRef.current?.();
      activeRecognizerRef.current?.stop();
      setIsListening(false);
      setActiveSpeechId(null);
      setVoiceStatus("idle");
    }
  }, [voiceOpen]);

  if (!voiceOpen) return null;

  function stopAllAudio() {
    if (stopCurrentSpeechRef.current) {
      stopCurrentSpeechRef.current();
      stopCurrentSpeechRef.current = null;
    }
    setActiveSpeechId(null);
    if (voiceStatus === "speaking") {
      setVoiceStatus("idle");
    }
  }

  function playTextToSpeech(text: string, msgId?: string, onComplete?: () => void) {
    if (isMuted || !isSpeechSynthesisSupported()) {
      onComplete?.();
      return;
    }

    stopAllAudio();
    if (msgId) setActiveSpeechId(msgId);
    setVoiceStatus("speaking");

    stopCurrentSpeechRef.current = speakConversationalText(text, {
      lang: locale === "en-plain" ? "en-GB" : locale,
      rate: speechSpeed,
      onStart: () => {
        setVoiceStatus("speaking");
      },
      onEnd: () => {
        setActiveSpeechId(null);
        setVoiceStatus("idle");
        stopCurrentSpeechRef.current = null;
        onComplete?.();
      },
      onError: () => {
        setActiveSpeechId(null);
        setVoiceStatus("idle");
        stopCurrentSpeechRef.current = null;
        onComplete?.();
      },
    });
  }

  async function handleSendQuery(userText: string) {
    const q = userText.trim();
    if (!q || loading) return;

    stopAllAudio();
    setInput("");
    setInterimTranscript("");

    const userMsgId = `user-${Date.now()}`;
    const userMsg: Msg = {
      id: userMsgId,
      role: "user",
      content: q,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);
    setVoiceStatus("thinking");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `${plainEnglish || locale === "en-plain" ? "Explain in clear, simple English. " : ""}${q}`,
        }),
      });

      const data = await res.json();
      const replyText =
        data.reply ||
        data.error ||
        "I could not retrieve an answer right now. LegalOS assists with evidence and documents; please consult a qualified solicitor for regulated advice.";

      const assistantMsgId = `bot-${Date.now()}`;
      const assistantMsg: Msg = {
        id: assistantMsgId,
        role: "assistant",
        content: replyText,
        spokenSummary: data.spokenSummary || replyText,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };

      setMessages((prev) => [...prev, assistantMsg]);

      // If auto-speak is enabled, speak the answer
      if (autoSpeak && !isMuted) {
        const textToSpeak = assistantMsg.spokenSummary || assistantMsg.content;
        playTextToSpeech(textToSpeak, assistantMsgId, () => {
          // In voice conversation mode, automatically turn mic back on after bot finishes speaking!
          if (voiceMode) {
            startVoiceListening();
          }
        });
      } else if (voiceMode) {
        startVoiceListening();
      }
    } catch {
      const errorMsg: Msg = {
        id: `err-${Date.now()}`,
        role: "assistant",
        content:
          "I am having trouble connecting right now. Remember: LegalOS is an assistive platform. For urgent tribunal deadlines or immigration bail, contact Migrant Help or a duty solicitor.",
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setLoading(false);
      if (!autoSpeak) {
        setVoiceStatus("idle");
      }
    }
  }

  function startVoiceListening() {
    if (!isSpeechRecognitionSupported()) {
      alert("Speech recognition is not supported by your browser. Please type your message.");
      return;
    }

    stopAllAudio();
    setIsListening(true);
    setVoiceStatus("listening");
    setInterimTranscript("");

    const recognizer = createSpeechRecognizer(
      {
        onStart: () => {
          setIsListening(true);
          setVoiceStatus("listening");
        },
        onTranscript: (transcript, isFinal) => {
          if (isFinal) {
            setInterimTranscript(transcript);
            setInput(transcript);
            recognizer.stop();
            setIsListening(false);
            // Submit immediately when final speech sentence is spoken!
            handleSendQuery(transcript);
          } else {
            setInterimTranscript(transcript);
            setInput(transcript);
          }
        },
        onEnd: () => {
          setIsListening(false);
          if (voiceStatus === "listening") {
            setVoiceStatus("idle");
          }
        },
        onError: (err) => {
          console.warn("Speech recognition error:", err);
          setIsListening(false);
          setVoiceStatus("idle");
        },
      },
      { lang: locale === "en-plain" ? "en-GB" : locale }
    );

    activeRecognizerRef.current = recognizer;
  }

  function stopVoiceListening() {
    if (activeRecognizerRef.current) {
      activeRecognizerRef.current.stop();
      activeRecognizerRef.current = null;
    }
    setIsListening(false);
    setVoiceStatus("idle");
    if (interimTranscript.trim()) {
      handleSendQuery(interimTranscript);
    }
  }

  function toggleVoiceMode() {
    const nextMode = !voiceMode;
    setVoiceMode(nextMode);
    stopAllAudio();
    if (nextMode) {
      setAutoSpeak(true);
      startVoiceListening();
    } else {
      stopVoiceListening();
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-end bg-black/40 backdrop-blur-sm p-3 sm:items-center sm:p-6 transition-opacity animate-in fade-in duration-200">
      <div className="flex h-[min(640px,90vh)] w-full max-w-lg flex-col rounded-3xl border border-[var(--line)] bg-[var(--bg-elevated)] shadow-2xl overflow-hidden">
        {/* Top Header */}
        <div className="flex items-center justify-between border-b border-[var(--line)] bg-[var(--bg)]/80 backdrop-blur-md px-4 py-3.5">
          <div className="flex items-center gap-3">
            <div className="relative flex h-10 w-10 items-center justify-center rounded-2xl bg-[var(--accent)] text-white shadow-md">
              <Bot className="h-5 w-5" />
              {voiceStatus !== "idle" && (
                <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5">
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                    voiceStatus === "listening" ? "bg-emerald-400" : voiceStatus === "speaking" ? "bg-amber-400" : "bg-blue-400"
                  }`} />
                  <span className={`relative inline-flex rounded-full h-3.5 w-3.5 ${
                    voiceStatus === "listening" ? "bg-emerald-500" : voiceStatus === "speaking" ? "bg-amber-500" : "bg-blue-500"
                  }`} />
                </span>
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold tracking-tight">{t("voice.agentTitle")}</span>
                <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400 border border-blue-500/20">
                  AI Legal Assistant
                </span>
              </div>
              <div className="text-[11px] text-[var(--muted)]">
                {voiceStatus === "listening"
                  ? "🎙️ Listening to you..."
                  : voiceStatus === "speaking"
                  ? "🔊 Speaking answer..."
                  : voiceStatus === "thinking"
                  ? "⚡ Searching UK statutory law..."
                  : "Type or speak · Explain process & documents"}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {/* Hands-free Voice Mode Toggle */}
            <button
              type="button"
              onClick={toggleVoiceMode}
              title={voiceMode ? "Turn off continuous voice conversation" : "Turn on continuous hands-free voice mode"}
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-all ${
                voiceMode
                  ? "bg-emerald-600 text-white shadow-sm ring-2 ring-emerald-400/30"
                  : "bg-black/5 hover:bg-black/10 dark:bg-white/5 dark:hover:bg-white/10 text-[var(--ink-soft)]"
              }`}
            >
              <Radio className={`h-3 w-3 ${voiceMode ? "animate-pulse" : ""}`} />
              <span className="hidden xs:inline">{voiceMode ? "Voice Active" : "Voice Mode"}</span>
            </button>

            {/* Mute/Unmute Audio */}
            <button
              type="button"
              onClick={() => {
                if (!isMuted) stopAllAudio();
                setIsMuted(!isMuted);
              }}
              title={isMuted ? "Unmute speech" : "Mute speech"}
              className="rounded-full p-2 text-[var(--muted)] hover:bg-black/5 dark:hover:bg-white/10"
            >
              {isMuted ? <VolumeX className="h-4 w-4 text-red-500" /> : <Volume2 className="h-4 w-4" />}
            </button>

            {/* Close */}
            <button
              type="button"
              onClick={() => {
                stopAllAudio();
                setVoiceOpen(false);
              }}
              className="rounded-full p-2 text-[var(--muted)] hover:bg-black/5 dark:hover:bg-white/10"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Continuous Voice Conversation Banner (when Voice Mode active) */}
        {voiceMode && (
          <div className="bg-gradient-to-r from-emerald-500/15 via-teal-500/10 to-blue-500/15 border-b border-emerald-500/20 px-4 py-2.5 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 h-3">
                <span className={`w-1 rounded-full bg-emerald-500 ${voiceStatus === "listening" ? "animate-[bounce_0.6s_infinite_0.1s] h-3" : "h-1.5"}`} />
                <span className={`w-1 rounded-full bg-emerald-500 ${voiceStatus === "listening" ? "animate-[bounce_0.6s_infinite_0.2s] h-4" : "h-2"}`} />
                <span className={`w-1 rounded-full bg-emerald-500 ${voiceStatus === "listening" ? "animate-[bounce_0.6s_infinite_0.3s] h-3" : "h-1.5"}`} />
              </div>
              <span className="font-medium text-emerald-800 dark:text-emerald-300">
                {voiceStatus === "listening"
                  ? "Speak now — listening..."
                  : voiceStatus === "speaking"
                  ? "Bot is speaking — listen..."
                  : voiceStatus === "thinking"
                  ? "Processing your question..."
                  : "Continuous voice ready — speak anytime"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSpeechSpeed(speechSpeed === 1.0 ? 1.15 : speechSpeed === 1.15 ? 0.9 : 1.0)}
                className="text-[10px] font-semibold bg-emerald-500/20 px-2 py-0.5 rounded text-emerald-800 dark:text-emerald-300"
              >
                {speechSpeed}x
              </button>
              <button
                type="button"
                onClick={stopAllAudio}
                className="text-[10px] font-medium underline text-emerald-700 dark:text-emerald-400"
              >
                Stop Sound
              </button>
            </div>
          </div>
        )}

        {/* Message Thread */}
        <div className="flex-1 space-y-4 overflow-y-auto p-4 scrollbar-thin">
          {messages.map((m) => {
            const isBot = m.role === "assistant";
            const isCurrentSpeaking = activeSpeechId === m.id;

            return (
              <div
                key={m.id}
                className={`flex flex-col ${isBot ? "items-start" : "items-end"} gap-1`}
              >
                <div
                  className={`max-w-[88%] rounded-3xl px-4 py-3 text-sm leading-relaxed shadow-sm transition-all ${
                    isBot
                      ? "border border-[var(--line)] bg-[var(--bg)] text-[var(--ink-soft)]"
                      : "bg-[var(--accent)] text-white"
                  }`}
                >
                  <div className="whitespace-pre-wrap">{m.content}</div>

                  {/* Audio Read-Out Action for Assistant */}
                  {isBot && (
                    <div className="mt-2.5 pt-2 border-t border-[var(--line)]/60 flex items-center justify-between gap-3 text-xs text-[var(--muted)]">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            if (isCurrentSpeaking) {
                              stopAllAudio();
                            } else {
                              playTextToSpeech(m.spokenSummary || m.content, m.id);
                            }
                          }}
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium transition-colors ${
                            isCurrentSpeaking
                              ? "bg-amber-500/20 text-amber-600 dark:text-amber-400 ring-1 ring-amber-500/40"
                              : "hover:bg-black/5 dark:hover:bg-white/10 text-[var(--ink-soft)]"
                          }`}
                        >
                          {isCurrentSpeaking ? (
                            <>
                              <Square className="h-3 w-3 fill-current" />
                              <span>Stop Speech</span>
                            </>
                          ) : (
                            <>
                              <Volume2 className="h-3.5 w-3.5 text-[var(--accent)]" />
                              <span>Read Aloud</span>
                            </>
                          )}
                        </button>

                        {isCurrentSpeaking && (
                          <div className="flex items-center gap-0.5 h-3">
                            <span className="w-0.5 h-2 bg-amber-500 animate-[pulse_0.4s_infinite]" />
                            <span className="w-0.5 h-3.5 bg-amber-500 animate-[pulse_0.4s_infinite_0.1s]" />
                            <span className="w-0.5 h-2 bg-amber-500 animate-[pulse_0.4s_infinite_0.2s]" />
                          </div>
                        )}
                      </div>

                      <span className="text-[10px] text-[var(--muted)]">{m.timestamp}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Real-time Interim Voice Dictation Bubble */}
          {isListening && interimTranscript && (
            <div className="flex justify-end">
              <div className="max-w-[85%] rounded-3xl px-4 py-2.5 text-sm bg-[var(--accent)]/80 text-white italic shadow-sm flex items-center gap-2">
                <Mic className="h-3.5 w-3.5 animate-pulse text-emerald-300" />
                <span>{interimTranscript}</span>
              </div>
            </div>
          )}

          {/* Thinking / Loader */}
          {loading && (
            <div className="flex items-center gap-2.5 text-xs text-[var(--muted)] bg-[var(--bg)] border border-[var(--line)] rounded-2xl px-3.5 py-2 w-fit">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--accent)]" />
              <span>Analyzing UK immigration rules & statutes…</span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Quick Question Suggestions */}
        {/* Proper Legal Questions */}
        {messages.length <= 2 && (
          <div className="px-4 py-2.5 border-t border-[var(--line)]/50 bg-[var(--bg)]/40 max-h-36 overflow-y-auto scrollbar-thin">
            <div className="text-[11px] font-medium text-[var(--muted)] mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1">
                <Sparkles className="h-3 w-3 text-amber-500" /> Common Legal Questions:
              </span>
              <span className="text-[10px] text-[var(--muted)]">Tap to ask or speak</span>
            </div>
            <div className="flex flex-col gap-1.5">
              {PROPER_LEGAL_QUESTIONS.map((item) => (
                <button
                  key={item.question}
                  type="button"
                  onClick={() => handleSendQuery(item.question)}
                  className="group flex items-center justify-between gap-2 rounded-xl border border-[var(--line)] bg-[var(--bg-elevated)] px-3 py-1.5 text-xs text-[var(--ink-soft)] hover:border-[var(--accent)] hover:bg-[var(--accent)]/5 hover:text-[var(--ink)] transition-all text-left"
                >
                  <span className="truncate">{item.question}</span>
                  <span className="shrink-0 rounded-md bg-black/5 dark:bg-white/5 px-1.5 py-0.5 text-[9px] font-semibold text-[var(--muted)] group-hover:text-[var(--accent)]">
                    {item.category}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Input & Speech-to-Text Footer */}
        <div className="border-t border-[var(--line)] bg-[var(--bg)] p-3">
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              handleSendQuery(input);
            }}
          >
            {/* Microphone Button (Speech to Text) */}
            <button
              type="button"
              onClick={() => {
                if (isListening) {
                  stopVoiceListening();
                } else {
                  startVoiceListening();
                }
              }}
              title={isListening ? "Stop listening" : "Speak your question (Voice to Text)"}
              className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-all ${
                isListening
                  ? "bg-red-500 text-white ring-4 ring-red-400/30 animate-pulse"
                  : "border border-[var(--line)] bg-[var(--bg-elevated)] text-[var(--ink-soft)] hover:bg-black/5 dark:hover:bg-white/5"
              }`}
            >
              {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4 text-[var(--accent)]" />}
            </button>

            {/* Input Box */}
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={isListening ? "Listening... speak now" : t("voice.placeholder")}
              disabled={loading}
              className="h-10 flex-1 rounded-xl border border-[var(--line)] bg-[var(--bg-elevated)] px-3 text-sm outline-none focus:ring-2 focus:ring-[var(--accent)]/20 text-[var(--ink)]"
            />

            {/* Send Button */}
            <Button
              type="submit"
              size="sm"
              disabled={loading || !input.trim()}
              className="h-10 px-4 rounded-xl font-medium"
            >
              <Send className="h-4 w-4" />
              <span className="hidden sm:inline ml-1.5">{t("voice.send")}</span>
            </Button>
          </form>

          {/* Subtext info */}
          <div className="mt-2 flex items-center justify-between text-[10px] text-[var(--muted)] px-1">
            <span>Voice & Text AI · TTS & STT enabled</span>
            <span>UK Legal Framework & Statutes</span>
          </div>
        </div>
      </div>
    </div>
  );
}
