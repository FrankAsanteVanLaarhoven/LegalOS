// Web Speech API interfaces for browser-native Speech-to-Text and Text-to-Speech

export interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

export interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

export interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

export interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

export interface BrowserSpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onaudiostart: ((this: BrowserSpeechRecognition, ev: Event) => void) | null;
  onsoundstart: ((this: BrowserSpeechRecognition, ev: Event) => void) | null;
  onspeechstart: ((this: BrowserSpeechRecognition, ev: Event) => void) | null;
  onspeechend: ((this: BrowserSpeechRecognition, ev: Event) => void) | null;
  onsoundend: ((this: BrowserSpeechRecognition, ev: Event) => void) | null;
  onaudioend: ((this: BrowserSpeechRecognition, ev: Event) => void) | null;
  onresult: ((this: BrowserSpeechRecognition, ev: SpeechRecognitionEvent) => void) | null;
  onnomatch: ((this: BrowserSpeechRecognition, ev: Event) => void) | null;
  onerror: ((this: BrowserSpeechRecognition, ev: { error: string }) => void) | null;
  onstart: ((this: BrowserSpeechRecognition, ev: Event) => void) | null;
  onend: ((this: BrowserSpeechRecognition, ev: Event) => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => BrowserSpeechRecognition;
    webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
  }
}

/**
 * Strips markdown and reformats statutory terms for fluent, natural spoken audio.
 */
export function cleanTextForSpeech(text: string): string {
  if (!text) return "";

  const cleaned = text
    // Replace markdown links with link text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // Remove markdown bold / italic
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, "$1")
    // Remove headers
    .replace(/^#{1,6}\s+(.+)$/gm, "$1.")
    // Remove blockquotes
    .replace(/^>\s+(.+)$/gm, "$1.")
    // Remove code blocks and inline code
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    // Replace markdown bullet points with natural spoken pauses
    .replace(/^[-*•]\s+(.+)$/gm, "$1.")
    // Normalize statutory abbreviations for better TTS pronunciation
    .replace(/\bS\.(\d+)\b/g, "Section $1")
    .replace(/\bSch\.(\d+)\b/g, "Schedule $1")
    .replace(/\bpara(?:graph)?\.?\s*(\d+)/gi, "paragraph $1")
    .replace(/\bOISC\b/g, "O-I-S-C")
    .replace(/\bSRA\b/g, "S-R-A")
    .replace(/\bIAA\b/g, "Immigration and Asylum Act")
    .replace(/\bECHR\b/g, "European Convention on Human Rights")
    .replace(/\bFTT-IAC\b/g, "First-tier Tribunal")
    // Clean up excessive whitespace and punctuation
    .replace(/---/g, " ")
    .replace(/\n+/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/\.{2,}/g, ".")
    .trim();

  return cleaned;
}

/**
 * Checks whether Speech-to-Text (STT) is supported in this browser.
 */
export function isSpeechRecognitionSupported(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

/**
 * Checks whether Text-to-Speech (TTS) is supported in this browser.
 */
export function isSpeechSynthesisSupported(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean("speechSynthesis" in window);
}

export interface SpeechRecognizerHandlers {
  onTranscript: (transcript: string, isFinal: boolean) => void;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (error: string) => void;
}

/**
 * Creates and starts a SpeechRecognition instance with safe lifecycle management.
 */
export function createSpeechRecognizer(
  handlers: SpeechRecognizerHandlers,
  options: { lang?: string; continuous?: boolean } = {}
): { recognition: BrowserSpeechRecognition | null; stop: () => void; abort: () => void } {
  if (!isSpeechRecognitionSupported()) {
    handlers.onError?.("Speech recognition is not supported in this browser.");
    return { recognition: null, stop: () => {}, abort: () => {} };
  }

  const SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognitionClass) {
    return { recognition: null, stop: () => {}, abort: () => {} };
  }

  const recognition = new SpeechRecognitionClass();
  recognition.lang = options.lang || "en-GB";
  recognition.continuous = options.continuous ?? false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  let stopped = false;

  recognition.onstart = () => {
    handlers.onStart?.();
  };

  recognition.onresult = (event: SpeechRecognitionEvent) => {
    let interim = "";
    let final = "";

    for (let i = event.resultIndex; i < event.results.length; ++i) {
      const item = event.results[i];
      if (item && item[0]) {
        if (item.isFinal) {
          final += item[0].transcript;
        } else {
          interim += item[0].transcript;
        }
      }
    }

    if (final) {
      handlers.onTranscript(final.trim(), true);
    } else if (interim) {
      handlers.onTranscript(interim.trim(), false);
    }
  };

  recognition.onerror = (event: { error: string }) => {
    if (event.error !== "no-speech" && event.error !== "aborted") {
      handlers.onError?.(event.error);
    }
  };

  recognition.onend = () => {
    if (!stopped) {
      handlers.onEnd?.();
    }
  };

  try {
    recognition.start();
  } catch (err) {
    handlers.onError?.(err instanceof Error ? err.message : "Failed to start microphone.");
  }

  return {
    recognition,
    stop: () => {
      stopped = true;
      try {
        recognition.stop();
      } catch {}
    },
    abort: () => {
      stopped = true;
      try {
        recognition.abort();
      } catch {}
    },
  };
}

/**
 * Discovers the best available voice in the browser, favoring UK English natural voices.
 */
export function getBestUkVoice(): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;

  const voices = window.speechSynthesis.getVoices();
  if (!voices || voices.length === 0) return null;

  // Priority search for high quality en-GB natural voices
  const ukPreferred = [
    "Google UK English Female",
    "Google UK English Male",
    "Daniel",
    "Oliver",
    "Serena",
    "Kate",
    "en-GB-Standard",
    "en-GB-Wavenet",
    "en-GB-Neural",
  ];

  for (const preferred of ukPreferred) {
    const match = voices.find((v) => v.name.includes(preferred) || (v.lang === "en-GB" && v.name.includes(preferred)));
    if (match) return match;
  }

  // Fallback to any en-GB voice
  const anyUk = voices.find((v) => v.lang === "en-GB" || v.lang.startsWith("en-GB"));
  if (anyUk) return anyUk;

  // Fallback to any English voice
  const anyEnglish = voices.find((v) => v.lang.startsWith("en"));
  return anyEnglish || voices[0] || null;
}

export interface SpeakOptions {
  lang?: string;
  rate?: number;
  pitch?: number;
  voice?: SpeechSynthesisVoice | null;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (err: unknown) => void;
}

/**
 * Speaks the given text using browser SpeechSynthesis with sentence chunking
 * to avoid browser speech timeout/truncation bugs.
 */
export function speakConversationalText(
  rawText: string,
  options: SpeakOptions = {}
): () => void {
  if (!isSpeechSynthesisSupported()) {
    options.onError?.("Speech synthesis not supported");
    return () => {};
  }

  window.speechSynthesis.cancel();

  const cleaned = cleanTextForSpeech(rawText);
  if (!cleaned) {
    options.onEnd?.();
    return () => {};
  }

  // Split into manageable sentence chunks (max ~200 chars) for smooth, uninterrupted playback
  const sentences = cleaned.match(/[^.!?]+[.!?]+|\s*[^.!?]+$/g) || [cleaned];
  const queue = sentences.map((s) => s.trim()).filter(Boolean);

  if (queue.length === 0) {
    options.onEnd?.();
    return () => {};
  }

  let index = 0;
  let cancelled = false;
  const voice = options.voice || getBestUkVoice();

  function speakNext() {
    if (cancelled || index >= queue.length) {
      if (!cancelled) options.onEnd?.();
      return;
    }

    const chunk = queue[index];
    index++;

    const utterance = new SpeechSynthesisUtterance(chunk);
    utterance.lang = options.lang || "en-GB";
    utterance.rate = options.rate ?? 1.0;
    utterance.pitch = options.pitch ?? 1.0;
    if (voice) {
      utterance.voice = voice;
    }

    if (index === 1) {
      utterance.onstart = () => {
        if (!cancelled) options.onStart?.();
      };
    }

    utterance.onend = () => {
      if (!cancelled) speakNext();
    };

    utterance.onerror = (e) => {
      if (!cancelled) {
        options.onError?.(e);
        speakNext();
      }
    };

    window.speechSynthesis.speak(utterance);
  }

  speakNext();

  return () => {
    cancelled = true;
    window.speechSynthesis.cancel();
  };
}
