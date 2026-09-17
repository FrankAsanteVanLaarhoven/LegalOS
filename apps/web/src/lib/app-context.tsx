"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getLocale, LOCALES, type LocaleCode } from "@/lib/i18n/locales";
import { t as translate, type MessageKey } from "@/lib/i18n/messages";

export type ThemeMode = "light" | "dark" | "system";

interface AppContextValue {
  theme: ThemeMode;
  setTheme: (t: ThemeMode) => void;
  resolvedTheme: "light" | "dark";
  locale: LocaleCode;
  setLocale: (l: LocaleCode) => void;
  t: (key: MessageKey) => string;
  plainEnglish: boolean;
  speaking: boolean;
  speak: (text: string) => void;
  stopSpeaking: () => void;
  speakPage: () => void;
  voiceOpen: boolean;
  setVoiceOpen: (v: boolean) => void;
  utilsOpen: boolean;
  setUtilsOpen: (v: boolean) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

function resolveTheme(mode: ThemeMode): "light" | "dark" {
  if (mode === "system") {
    if (typeof window === "undefined") return "light";
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return mode;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>("system");
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">("light");
  const [locale, setLocaleState] = useState<LocaleCode>("en");
  const [speaking, setSpeaking] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [utilsOpen, setUtilsOpen] = useState(false);

  // Deliberate one-time sync from browser storage after hydration.
  //
  // react-hooks/set-state-in-effect exists to stop cascading renders, but the
  // alternatives are both worse here: reading localStorage in a lazy state
  // initialiser makes the client's first render disagree with the server's and
  // produces a hydration mismatch, and this state is read-write (the app also
  // writes it in setTheme/setLocale), so useSyncExternalStore does not fit
  // either. The effect runs once and is the documented way to adopt persisted
  // browser state without a mismatch.
  //
  // The stored values are validated rather than cast: an unrecognised locale
  // used to be accepted straight from storage via `as LocaleCode`.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const storedTheme = localStorage.getItem("legalos-theme");
      const storedLocale = localStorage.getItem("legalos-locale");
      if (storedTheme === "light" || storedTheme === "dark" || storedTheme === "system") {
        setThemeState(storedTheme);
      }
      if (storedLocale && LOCALES.some((entry) => entry.code === storedLocale)) {
        setLocaleState(storedLocale as LocaleCode);
      }
    } catch {
      /* storage unavailable (private mode, blocked cookies) — keep defaults */
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    const apply = () => {
      const r = resolveTheme(theme);
      setResolvedTheme(r);
      document.documentElement.dataset.theme = r;
      document.documentElement.classList.toggle("dark", r === "dark");
    };
    apply();
    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const fn = () => apply();
      mq.addEventListener("change", fn);
      return () => mq.removeEventListener("change", fn);
    }
  }, [theme]);

  useEffect(() => {
    const meta = getLocale(locale);
    document.documentElement.lang = locale === "en-plain" ? "en" : locale;
    document.documentElement.dir = meta.dir;
  }, [locale]);

  const setTheme = useCallback((mode: ThemeMode) => {
    setThemeState(mode);
    try {
      localStorage.setItem("legalos-theme", mode);
    } catch {
      /* ignore */
    }
  }, []);

  const setLocale = useCallback((l: LocaleCode) => {
    setLocaleState(l);
    try {
      localStorage.setItem("legalos-locale", l);
    } catch {
      /* ignore */
    }
  }, []);

  const t = useCallback((key: MessageKey) => translate(locale, key), [locale]);

  const stopSpeaking = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setSpeaking(false);
  }, []);

  const speak = useCallback(
    (text: string) => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const meta = getLocale(locale);
      u.lang = meta.speech;
      u.rate = locale === "en-plain" ? 0.92 : 0.95;
      u.onend = () => setSpeaking(false);
      u.onerror = () => setSpeaking(false);
      setSpeaking(true);
      window.speechSynthesis.speak(u);
    },
    [locale]
  );

  const speakPage = useCallback(() => {
    const main = document.querySelector("main");
    const text =
      main?.innerText?.replace(/\s+/g, " ").trim().slice(0, 4000) || t("section.explain.hero");
    speak(text);
  }, [speak, t]);

  const value = useMemo(
    () => ({
      theme,
      setTheme,
      resolvedTheme,
      locale,
      setLocale,
      t,
      plainEnglish: locale === "en-plain",
      speaking,
      speak,
      stopSpeaking,
      speakPage,
      voiceOpen,
      setVoiceOpen,
      utilsOpen,
      setUtilsOpen,
    }),
    [
      theme,
      setTheme,
      resolvedTheme,
      locale,
      setLocale,
      t,
      speaking,
      speak,
      stopSpeaking,
      speakPage,
      voiceOpen,
      utilsOpen,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
