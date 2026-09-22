"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ShieldCheck, Cookie, Settings2, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface CookiePreferences {
  version: number;
  necessary: boolean; // Always true
  functional: boolean;
  analytics: boolean;
  updatedAt: string;
}

const COOKIE_NAME = "legalos_consent";
const CURRENT_VERSION = 1;

const DEFAULT_PREFERENCES: CookiePreferences = {
  version: CURRENT_VERSION,
  necessary: true,
  functional: true,
  analytics: false,
  updatedAt: new Date().toISOString(),
};

function readConsentCookie(): CookiePreferences | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(^|;\\s*)${COOKIE_NAME}=([^;]*)`));
  if (!match || !match[2]) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(match[2]));
    if (parsed && typeof parsed.necessary === "boolean") {
      return parsed as CookiePreferences;
    }
  } catch {
    // Malformed cookie; ignore
  }
  return null;
}

function writeConsentCookie(prefs: CookiePreferences) {
  if (typeof document === "undefined") return;
  const serialized = encodeURIComponent(JSON.stringify(prefs));
  const maxAge = 365 * 24 * 60 * 60; // 1 year
  document.cookie = `${COOKIE_NAME}=${serialized}; path=/; max-age=${maxAge}; SameSite=Lax; ${
    window.location.protocol === "https:" ? "Secure;" : ""
  }`;
  try {
    localStorage.setItem(COOKIE_NAME, JSON.stringify(prefs));
  } catch {
    // LocalStorage unavailable
  }
}

/**
 * Event-driven trigger to allow opening cookie preferences from anywhere in the app
 * (e.g. footer links, settings menus, or cookie policy page).
 */
export function openCookiePreferences() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("legalos:open-cookie-preferences"));
  }
}

export function CookieConsent() {
  const [hasChecked, setHasChecked] = useState(false);
  const [bannerVisible, setBannerVisible] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [preferences, setPreferences] = useState<CookiePreferences>(DEFAULT_PREFERENCES);
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    const existing = readConsentCookie();
    if (existing) {
      setPreferences(existing);
      setBannerVisible(false);
    } else {
      setBannerVisible(true);
    }
    setHasChecked(true);

    const handleOpenModal = () => {
      setModalOpen(true);
    };

    window.addEventListener("legalos:open-cookie-preferences", handleOpenModal);
    return () => {
      window.removeEventListener("legalos:open-cookie-preferences", handleOpenModal);
    };
  }, []);

  const handleAcceptAll = () => {
    const accepted: CookiePreferences = {
      version: CURRENT_VERSION,
      necessary: true,
      functional: true,
      analytics: true,
      updatedAt: new Date().toISOString(),
    };
    writeConsentCookie(accepted);
    setPreferences(accepted);
    setBannerVisible(false);
    setModalOpen(false);
    triggerSaved();
  };

  const handleRejectNonEssential = () => {
    const rejected: CookiePreferences = {
      version: CURRENT_VERSION,
      necessary: true,
      functional: false,
      analytics: false,
      updatedAt: new Date().toISOString(),
    };
    writeConsentCookie(rejected);
    setPreferences(rejected);
    setBannerVisible(false);
    setModalOpen(false);
    triggerSaved();
  };

  const handleSavePreferences = () => {
    const updated: CookiePreferences = {
      ...preferences,
      version: CURRENT_VERSION,
      necessary: true, // Always required
      updatedAt: new Date().toISOString(),
    };
    writeConsentCookie(updated);
    setBannerVisible(false);
    setModalOpen(false);
    triggerSaved();
  };

  const triggerSaved = () => {
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 3000);
  };

  if (!hasChecked) return null;

  return (
    <>
      {/* 1. Global Bottom Cookie Banner */}
      {bannerVisible && !modalOpen && (
        <aside
          aria-label="Cookie and Privacy Consent"
          className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-4xl rounded-2xl border border-[var(--line-strong)] bg-[var(--bg-elevated)] p-5 shadow-2xl transition-all duration-300 sm:p-6"
        >
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-3.5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--warm)] text-[var(--accent)]">
                <Cookie className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-[15px] font-semibold tracking-tight text-[var(--ink)]">
                  Privacy & Cookie Governance
                </h3>
                <p className="max-w-2xl text-[13px] leading-relaxed text-[var(--muted)]">
                  LegalOS uses strictly necessary cookies to ensure secure session authentication,
                  prevent cross-site request forgery, and enforce tenant isolation. We do not use
                  advertising or third-party marketing trackers. Learn more in our{" "}
                  <Link href="/cookies" className="underline underline-offset-2 hover:text-[var(--ink)]">
                    Cookie Policy
                  </Link>{" "}
                  and{" "}
                  <Link href="/privacy" className="underline underline-offset-2 hover:text-[var(--ink)]">
                    GDPR Privacy Notice
                  </Link>
                  .
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-2 md:pt-0">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setModalOpen(true)}
                className="text-[13px]"
              >
                <Settings2 className="mr-1.5 h-3.5 w-3.5" />
                Preferences
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleRejectNonEssential}
                className="text-[13px]"
              >
                Essential Only
              </Button>
              <Button
                size="sm"
                onClick={handleAcceptAll}
                className="bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] text-[13px]"
              >
                Accept All
              </Button>
            </div>
          </div>
        </aside>
      )}

      {/* 2. Granular Cookie Preferences Modal */}
      {modalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="cookie-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200"
        >
          <div className="relative w-full max-w-2xl rounded-2xl border border-[var(--line-strong)] bg-[var(--bg-elevated)] p-6 shadow-2xl sm:p-8">
            <div className="flex items-center justify-between border-b border-[var(--line)] pb-4">
              <div className="flex items-center gap-2.5">
                <ShieldCheck className="h-6 w-6 text-[var(--success)]" />
                <h2 id="cookie-modal-title" className="text-xl font-semibold tracking-tight text-[var(--ink)]">
                  Cookie & Privacy Preferences
                </h2>
              </div>
              <button
                onClick={() => setModalOpen(false)}
                className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-[var(--line)] hover:text-[var(--ink)] transition-colors"
                aria-label="Close preferences"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="mt-4 text-[13px] leading-relaxed text-[var(--muted)]">
              You can configure the non-essential cookies and local storage tokens stored by LegalOS.
              Under UK GDPR and PECR, your consent can be withdrawn or modified at any time.
            </p>

            <div className="mt-6 space-y-4">
              {/* Strictly Necessary */}
              <div className="rounded-xl border border-[var(--line)] bg-[var(--warm)]/40 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-semibold text-[var(--ink)]">
                        Strictly Necessary Cookies
                      </span>
                      <span className="rounded-full bg-[var(--line-strong)] px-2 py-0.5 text-[10px] font-medium text-[var(--ink)]">
                        Always Active
                      </span>
                    </div>
                    <p className="mt-1 text-[12px] leading-relaxed text-[var(--muted)]">
                      Required for session authentication (<code className="font-mono">legalos_session</code>),
                      tenant security isolation, and recording consent compliance choices. These cannot be disabled.
                    </p>
                  </div>
                </div>
              </div>

              {/* Functional */}
              <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <span className="text-[14px] font-semibold text-[var(--ink)]">
                      Functional & Preference Storage
                    </span>
                    <p className="mt-1 text-[12px] leading-relaxed text-[var(--muted)]">
                      Remembers your user interface preferences, such as selected language mode,
                      plain English explanations, theme preferences, and offline case drafting.
                    </p>
                  </div>
                  <label className="relative inline-flex cursor-pointer items-center shrink-0">
                    <input
                      type="checkbox"
                      checked={preferences.functional}
                      onChange={(e) =>
                        setPreferences({ ...preferences, functional: e.target.checked })
                      }
                      className="peer sr-only"
                    />
                    <div className="peer h-6 w-11 rounded-full bg-[var(--line-strong)] after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-[var(--accent)] peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none" />
                  </label>
                </div>
              </div>

              {/* Analytics */}
              <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <span className="text-[14px] font-semibold text-[var(--ink)]">
                      Privacy-Preserving Telemetry & Invariants
                    </span>
                    <p className="mt-1 text-[12px] leading-relaxed text-[var(--muted)]">
                      Measures platform reliability, error rates, and system invariant health.
                      Strictly aggregated and anonymised without cross-site tracking or profiling.
                    </p>
                  </div>
                  <label className="relative inline-flex cursor-pointer items-center shrink-0">
                    <input
                      type="checkbox"
                      checked={preferences.analytics}
                      onChange={(e) =>
                        setPreferences({ ...preferences, analytics: e.target.checked })
                      }
                      className="peer sr-only"
                    />
                    <div className="peer h-6 w-11 rounded-full bg-[var(--line-strong)] after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-[var(--accent)] peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none" />
                  </label>
                </div>
              </div>
            </div>

            <div className="mt-8 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
              <Button
                variant="secondary"
                size="sm"
                onClick={handleRejectNonEssential}
                className="text-[13px]"
              >
                Reject Non-Essential
              </Button>
              <Button
                size="sm"
                onClick={handleSavePreferences}
                className="bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] text-[13px]"
              >
                Save Preferences
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Saved Toast Notice */}
      {savedNotice && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-xl border border-[var(--success)]/40 bg-[var(--bg-elevated)] px-4 py-2.5 text-[13px] font-medium text-[var(--success)] shadow-lg animate-in fade-in duration-200"
        >
          <Check className="h-4 w-4" />
          <span>Cookie preferences saved.</span>
        </div>
      )}
    </>
  );
}
