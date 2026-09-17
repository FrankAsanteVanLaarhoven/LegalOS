"use client";

import { useEffect, useRef, useState } from "react";
import {
  CloudSun,
  Coins,
  Globe2,
  Headphones,
  MessageCircle,
  Monitor,
  Moon,
  Sun,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useApp } from "@/lib/app-context";
import { PRIORITY_LOCALES, LOCALES } from "@/lib/i18n/locales";
import type { LocaleCode } from "@/lib/i18n/locales";
import { cn } from "@/lib/utils";

export function ControlBar() {
  const {
    theme,
    setTheme,
    locale,
    setLocale,
    t,
    speaking,
    speakPage,
    stopSpeaking,
    setVoiceOpen,
    utilsOpen,
    setUtilsOpen,
  } = useApp();
  const [langOpen, setLangOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setLangOpen(false);
        setThemeOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const priority = PRIORITY_LOCALES;
  const rest = LOCALES.filter((l) => !l.priority);

  return (
    <div ref={rootRef} className="flex flex-wrap items-center justify-end gap-1 sm:gap-1.5">
      <IconBtn
        label={t("nav.utilities")}
        active={utilsOpen}
        onClick={() => setUtilsOpen(!utilsOpen)}
      >
        <CloudSun className="h-3.5 w-3.5" />
        <Coins className="hidden h-3.5 w-3.5 sm:block" />
      </IconBtn>

      <div className="relative">
        <IconBtn label={t("nav.theme")} onClick={() => setThemeOpen((v) => !v)}>
          {theme === "dark" ? (
            <Moon className="h-3.5 w-3.5" />
          ) : theme === "light" ? (
            <Sun className="h-3.5 w-3.5" />
          ) : (
            <Monitor className="h-3.5 w-3.5" />
          )}
        </IconBtn>
        {themeOpen && (
          <Menu>
            {(
              [
                ["light", t("theme.light"), Sun],
                ["dark", t("theme.dark"), Moon],
                ["system", t("theme.system"), Monitor],
              ] as const
            ).map(([mode, label, Icon]) => (
              <button
                key={mode}
                type="button"
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-black/5 dark:hover:bg-white/10",
                  theme === mode && "font-semibold"
                )}
                onClick={() => {
                  setTheme(mode);
                  setThemeOpen(false);
                }}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </Menu>
        )}
      </div>

      <div className="relative">
        <IconBtn label={t("nav.language")} onClick={() => setLangOpen((v) => !v)}>
          <Globe2 className="h-3.5 w-3.5" />
          <span className="hidden max-w-[4.5rem] truncate text-[10px] sm:inline">
            {LOCALES.find((l) => l.code === locale)?.nativeName ?? "EN"}
          </span>
        </IconBtn>
        {langOpen && (
          <Menu className="max-h-80 w-64 overflow-y-auto">
            <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
              UK focus
            </div>
            {priority.map((l) => (
              <button
                key={l.code}
                type="button"
                className={cn(
                  "flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-black/5 dark:hover:bg-white/10",
                  locale === l.code && "bg-black/5 font-semibold dark:bg-white/10"
                )}
                onClick={() => {
                  setLocale(l.code as LocaleCode);
                  setLangOpen(false);
                }}
              >
                <span>{l.nativeName}</span>
                <span className="text-[10px] text-[var(--muted)]">{l.name}</span>
              </button>
            ))}
            <div className="mt-1 border-t border-[var(--line)] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
              More languages
            </div>
            {rest.map((l) => (
              <button
                key={l.code}
                type="button"
                className={cn(
                  "flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-black/5 dark:hover:bg-white/10",
                  locale === l.code && "font-semibold"
                )}
                onClick={() => {
                  setLocale(l.code as LocaleCode);
                  setLangOpen(false);
                }}
              >
                <span>{l.nativeName}</span>
                <span className="text-[10px] text-[var(--muted)]">{l.name}</span>
              </button>
            ))}
          </Menu>
        )}
      </div>

      <IconBtn
        label={speaking ? t("nav.stopListen") : t("nav.listen")}
        onClick={() => (speaking ? stopSpeaking() : speakPage())}
      >
        {speaking ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
      </IconBtn>

      <IconBtn label={t("nav.voiceAgent")} onClick={() => setVoiceOpen(true)}>
        <MessageCircle className="h-3.5 w-3.5" />
        <Headphones className="hidden h-3.5 w-3.5 sm:block" />
      </IconBtn>
    </div>
  );
}

function IconBtn({
  children,
  label,
  onClick,
  active,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--bg-elevated)] px-2.5 text-[var(--ink-soft)] transition hover:border-[var(--line-strong)] hover:text-[var(--ink)]",
        active && "border-[var(--accent)]/40 bg-[var(--accent-soft)] text-[var(--accent)]"
      )}
    >
      {children}
    </button>
  );
}

function Menu({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "absolute right-0 top-full z-50 mt-2 min-w-[10rem] rounded-xl border border-[var(--line)] bg-[var(--bg-elevated)] py-1 shadow-lg",
        className
      )}
    >
      {children}
    </div>
  );
}
