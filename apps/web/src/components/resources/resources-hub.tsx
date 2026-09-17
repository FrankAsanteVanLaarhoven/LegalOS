"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Bell,
  BookOpen,
  ExternalLink,
  Link2,
  Newspaper,
  QrCode,
  Radio,
  Share2,
  ShoppingBag,
  X,
} from "lucide-react";
import QRCode from "qrcode";
import { UK_LEGAL_RESOURCES, type LegalResource } from "@/lib/legal/uk-resources";
import { useApp } from "@/lib/app-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const CATEGORIES = [
  "immigration",
  "asylum",
  "employment",
  "tribunal",
  "modern_slavery",
  "guidance",
  "rights",
  "cases",
  "news",
] as const;

type Tab = "library" | "feeds" | "alerts" | "share" | "ads";

type FeedItem = {
  id: string;
  source: string;
  title: string;
  summary: string;
  url: string;
  publishedAt?: string;
  tags: string[];
};

export function ResourcesHub() {
  const { t, speak } = useApp();
  const [tab, setTab] = useState<Tab>("library");
  const [active, setActive] = useState<LegalResource | null>(null);
  const [preview, setPreview] = useState<string>("");
  const [previewNote, setPreviewNote] = useState("");
  const [feeds, setFeeds] = useState<FeedItem[]>([]);
  const [feedsDisclaimer, setFeedsDisclaimer] = useState("");
  const [feedsLoading, setFeedsLoading] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [alertEmail, setAlertEmail] = useState("");
  const [alertPhone, setAlertPhone] = useState("");
  const [alertMsg, setAlertMsg] = useState("");
  const [alertBusy, setAlertBusy] = useState(false);
  const previewRequestId = useRef(0);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    // The `typeof window` branch was dead code — effects never run on the
    // server — and hid the fact that shareUrl is empty on first paint.
    const url = `${window.location.origin}/resources`;
    setShareUrl(url);
    QRCode.toDataURL(url, {
      width: 280,
      margin: 2,
      color: { dark: "#111111", light: "#f7f6f3" },
    })
      .then(setQrDataUrl)
      // Without this, a blocked canvas (privacy extension, strict CSP) left the
      // skeleton pulsing forever and raised an unhandled rejection.
      .catch(() => setQrDataUrl(""));
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const openResource = useCallback(async (r: LegalResource) => {
    // Guards against a slow response overwriting a newer one. Clicking
    // "Immigration Rules" then "Claim asylum in the UK" used to render the
    // asylum body under the Immigration Rules heading once the slower request
    // landed — in a legal product, text attributed to the wrong source.
    const requestId = ++previewRequestId.current;
    setActive(r);
    setPreview(r.description);
    if (r.id.startsWith("feed-")) {
      setPreviewNote(
        "Live feed item opened inside LegalOS. Cross-check primary GOV.UK / legislation sources before acting."
      );
      return;
    }
    setPreviewNote("Loading in-platform preview…");
    try {
      const res = await fetch(`/api/resources/preview?id=${encodeURIComponent(r.id)}`);
      const data = await res.json();
      if (requestId !== previewRequestId.current) return;
      if (data.preview?.excerpt) setPreview(data.preview.excerpt);
      setPreviewNote(data.preview?.note ?? "");
    } catch {
      if (requestId !== previewRequestId.current) return;
      setPreviewNote("Showing catalogue description. Verify the official page for filings.");
    }
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (tab !== "feeds") return;
    const controller = new AbortController();
    setFeedsLoading(true);
    fetch("/api/feeds", { signal: controller.signal })
      .then((r) => r.json())
      .then((d) => {
        setFeeds(d.items ?? []);
        setFeedsDisclaimer(d.disclaimer ?? "");
      })
      .catch(() => setFeeds([]))
      .finally(() => setFeedsLoading(false));
    return () => controller.abort();
  }, [tab]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const byCategory = useMemo(() => {
    return CATEGORIES.map((cat) => ({
      cat,
      items: UK_LEGAL_RESOURCES.filter((r) => r.category === cat),
    })).filter((g) => g.items.length > 0);
  }, []);

  async function subscribeAlerts(e: React.FormEvent) {
    e.preventDefault();
    setAlertBusy(true);
    setAlertMsg("");
    try {
      const res = await fetch("/api/alerts/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: alertEmail,
          phone: alertPhone,
          topics: ["immigration_rules", "home_office_news", "case_law", "tribunal_practice"],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setAlertMsg(data.subscription?.message ?? "Request received.");
      // The email and phone were previously written to localStorage in
      // cleartext with no expiry. On a library, charity or shared terminal —
      // common for this cohort — the next person at that machine could read a
      // contact detail that, tied to this app, discloses that someone is
      // pursuing an immigration or asylum matter.
    } catch (err) {
      setAlertMsg(err instanceof Error ? err.message : "Could not subscribe");
    } finally {
      setAlertBusy(false);
    }
  }

  async function copyShare() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  const tabs: { id: Tab; label: string; icon: typeof BookOpen }[] = [
    { id: "library", label: "Library", icon: BookOpen },
    { id: "feeds", label: "Live feeds", icon: Radio },
    { id: "alerts", label: "Alerts", icon: Bell },
    { id: "share", label: "Share & QR", icon: Share2 },
    { id: "ads", label: "Discover", icon: ShoppingBag },
  ];

  return (
    <div className="mx-auto max-w-[1400px] section-pad py-12 lg:py-16">
      <p className="eyebrow">{t("nav.resources")}</p>
      <h1 className="display mt-4 max-w-2xl text-[clamp(2.2rem,4vw,3.4rem)] tracking-tight">
        {t("resources.title")}
      </h1>
      <p className="mt-5 max-w-2xl text-[16px] leading-relaxed text-[var(--muted)]">
        Open every official link{" "}
        <strong className="font-medium text-[var(--ink)]">inside LegalOS</strong> for context,
        alerts, and sharing — then verify the live government page before any filing.
      </p>
      <button
        type="button"
        onClick={() => speak(t("resources.body"))}
        className="mt-4 text-sm font-medium text-[var(--accent)] underline-offset-4 hover:underline"
      >
        {t("nav.listen")}
      </button>

      <div className="mt-8 flex flex-wrap gap-2 border-b border-[var(--line)] pb-3">
        {tabs.map((tb) => (
          <button
            key={tb.id}
            type="button"
            onClick={() => setTab(tb.id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] transition",
              tab === tb.id
                ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                : "border-[var(--line)] text-[var(--muted)] hover:text-[var(--ink)]"
            )}
          >
            <tb.icon className="h-3.5 w-3.5" />
            {tb.label}
          </button>
        ))}
      </div>

      {tab === "library" && (
        <div className="mt-10 space-y-12">
          {byCategory.map(({ cat, items }) => (
            <section key={cat} id={`cat-${cat}`}>
              <h2 className="text-[13px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
                {cat.replaceAll("_", " ")}
              </h2>
              <ul className="mt-4 divide-y divide-[var(--line)] border-t border-[var(--line)]">
                {items.map((r) => (
                  <li key={r.id} className="py-4">
                    <button
                      type="button"
                      onClick={() => openResource(r)}
                      className="group flex w-full flex-col gap-1 text-left sm:flex-row sm:items-start sm:justify-between"
                    >
                      <div>
                        <div className="flex items-center gap-2 text-[15px] font-medium text-[var(--ink)] group-hover:text-[var(--accent)]">
                          {r.title}
                          <BookOpen className="h-3.5 w-3.5 opacity-40" />
                        </div>
                        <p className="mt-1 max-w-2xl text-[14px] leading-relaxed text-[var(--muted)]">
                          {r.description}
                        </p>
                      </div>
                      <span className="mt-1 shrink-0 text-[12px] text-[var(--muted)]">
                        {r.publisher}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {tab === "feeds" && (
        <div className="mt-10">
          <div className="flex flex-wrap items-center gap-2">
            <Newspaper className="h-4 w-4 text-[var(--accent)]" />
            <h2 className="text-lg font-semibold tracking-tight">Live needs & public signals</h2>
          </div>
          <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-[var(--muted)]">
            Aggregated public updates from GOV.UK, discussion forums, and official social channels.
            Not legal advice. Politics and social posts can be incomplete — always cross-check
            primary law.
          </p>
          {feedsDisclaimer && (
            <p className="mt-3 rounded-xl border border-amber-200/80 bg-amber-50 px-4 py-3 text-[12px] text-amber-950/90 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100/90">
              {feedsDisclaimer}
            </p>
          )}
          {feedsLoading ? (
            <p className="mt-8 text-sm text-[var(--muted)]">Loading feeds…</p>
          ) : (
            <div className="mt-8 space-y-3">
              {feeds.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() =>
                    openResource({
                      id: `feed-${item.id}`,
                      title: item.title,
                      description: item.summary,
                      url: item.url,
                      publisher: item.source.toUpperCase(),
                      category: "news",
                    })
                  }
                  className="w-full rounded-2xl border border-[var(--line)] bg-[var(--bg-elevated)] p-4 text-left transition hover:border-[var(--accent)]/30"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="accent">{item.source}</Badge>
                    {item.tags.slice(0, 3).map((tag) => (
                      <span key={tag} className="text-[11px] text-[var(--muted)]">
                        #{tag}
                      </span>
                    ))}
                  </div>
                  <div className="mt-2 text-[15px] font-medium text-[var(--ink)]">{item.title}</div>
                  <p className="mt-1 text-[13px] leading-relaxed text-[var(--muted)]">
                    {item.summary}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "alerts" && (
        <div id="alerts" className="mt-10 max-w-xl">
          <h2 className="text-lg font-semibold tracking-tight">Gov change alerts</h2>
          <p className="mt-2 text-[14px] leading-relaxed text-[var(--muted)]">
            Get email and/or phone alerts when Immigration Rules, Home Office communications,
            tribunal practice notes, or tracked public case law change. Demo mode records your
            preference; production connects SMS/email providers.
          </p>
          <form onSubmit={subscribeAlerts} className="mt-6 space-y-4">
            <label className="block text-[13px] text-[var(--muted)]">
              Email
              <input
                type="email"
                value={alertEmail}
                onChange={(e) => setAlertEmail(e.target.value)}
                placeholder="you@example.com"
                className="mt-1 h-11 w-full rounded-xl border border-[var(--line)] bg-transparent px-3 text-sm text-[var(--ink)] outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
              />
            </label>
            <label className="block text-[13px] text-[var(--muted)]">
              Phone (SMS)
              <input
                type="tel"
                value={alertPhone}
                onChange={(e) => setAlertPhone(e.target.value)}
                placeholder="+44 …"
                className="mt-1 h-11 w-full rounded-xl border border-[var(--line)] bg-transparent px-3 text-sm text-[var(--ink)] outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
              />
            </label>
            <div className="flex flex-wrap gap-2 text-[12px] text-[var(--muted)]">
              {["Immigration Rules", "Home Office news", "Case law", "Tribunal practice"].map(
                (topic) => (
                  <span
                    key={topic}
                    className="rounded-full border border-[var(--line)] px-2.5 py-1"
                  >
                    {topic}
                  </span>
                )
              )}
            </div>
            <Button type="submit" variant="dark" disabled={alertBusy}>
              {alertBusy ? "Saving…" : "Enable alerts"}
            </Button>
            {alertMsg && (
              <p className="text-[13px] leading-relaxed text-[var(--ink-soft)]">{alertMsg}</p>
            )}
          </form>
        </div>
      )}

      {tab === "share" && (
        <div id="share" className="mt-10 grid max-w-3xl gap-8 sm:grid-cols-2">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Share LegalOS</h2>
            <p className="mt-2 text-[14px] leading-relaxed text-[var(--muted)]">
              Share the platform link with clients, universities, NGOs, or colleagues. QR works for
              posters, reception desks, and outreach packs.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <code className="rounded-lg border border-[var(--line)] bg-[var(--bg-elevated)] px-3 py-2 text-[12px] text-[var(--ink-soft)]">
                {shareUrl || "…"}
              </code>
              <Button type="button" size="sm" variant="secondary" onClick={copyShare}>
                <Link2 className="h-3.5 w-3.5" />
                {copied ? "Copied" : "Copy link"}
              </Button>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <a
                href={`https://twitter.com/intent/tweet?text=${encodeURIComponent("LegalOS — Legal Intelligence for UK immigration & access to justice")}&url=${encodeURIComponent(shareUrl)}`}
                className="rounded-full border border-[var(--line)] px-3 py-1.5 text-[12px] text-[var(--muted)] hover:text-[var(--ink)]"
              >
                Share on X
              </a>
              <a
                href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`}
                className="rounded-full border border-[var(--line)] px-3 py-1.5 text-[12px] text-[var(--muted)] hover:text-[var(--ink)]"
              >
                Share on LinkedIn
              </a>
              <a
                href={`mailto:?subject=${encodeURIComponent("LegalOS resources")}&body=${encodeURIComponent(shareUrl)}`}
                className="rounded-full border border-[var(--line)] px-3 py-1.5 text-[12px] text-[var(--muted)] hover:text-[var(--ink)]"
              >
                Email link
              </a>
            </div>
          </div>
          <div className="flex flex-col items-start">
            <div className="inline-flex items-center gap-2 text-[13px] font-medium text-[var(--ink)]">
              <QrCode className="h-4 w-4" /> Platform QR
            </div>
            {qrDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={qrDataUrl}
                alt="QR code linking to LegalOS resources"
                className="mt-3 rounded-2xl border border-[var(--line)] bg-white p-3"
                width={220}
                height={220}
              />
            ) : (
              <div className="mt-3 h-[220px] w-[220px] animate-pulse rounded-2xl bg-[var(--line)]" />
            )}
          </div>
        </div>
      )}

      {tab === "ads" && (
        <div className="mt-10">
          <h2 className="text-lg font-semibold tracking-tight">Discover · outreach placements</h2>
          <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-[var(--muted)]">
            Optional discovery slots for partner outreach (including TikTok Shop / social ads).
            Clearly labelled. Never mixed with legal advice.
          </p>
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            <div className="relative overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--bg-elevated)] p-5">
              <Badge tone="warning">Sponsored · demo</Badge>
              <h3 className="mt-3 text-[15px] font-semibold">TikTok Shop · LegalOS awareness</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-[var(--muted)]">
                Short-form explainers: student visas, RTW, asylum basics — driving traffic to
                LegalOS resources and Mission Control demo. Creative review required before launch.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="dark">
                  Request ad pack
                </Button>
                <Link href="/#stories">
                  <Button type="button" size="sm" variant="secondary">
                    View journey films
                  </Button>
                </Link>
              </div>
            </div>
            <div className="relative overflow-hidden rounded-2xl border border-[var(--line)]">
              <div className="relative aspect-[16/10]">
                <Image
                  src="/images/video-posters/still-study-work.png"
                  alt="Study and work awareness creative"
                  fill
                  className="object-cover"
                  sizes="(max-width: 768px) 100vw, 50vw"
                />
              </div>
              <div className="p-4">
                <p className="text-[13px] text-[var(--muted)]">
                  Sample creative: Study &amp; Work — use only with proper disclaimers.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* In-platform resource viewer */}
      {active && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/45 p-0 sm:items-center sm:p-6">
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            aria-label="Close viewer"
            onClick={() => setActive(null)}
          />
          <div
            role="dialog"
            aria-modal="true"
            className="relative z-10 flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-[var(--line)] bg-[var(--bg-elevated)] shadow-2xl sm:rounded-2xl"
          >
            <div className="flex items-start justify-between gap-3 border-b border-[var(--line)] px-5 py-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="accent">{active.category.replaceAll("_", " ")}</Badge>
                  <span className="text-[11px] text-[var(--muted)]">{active.publisher}</span>
                </div>
                <h2 className="mt-2 text-lg font-semibold tracking-tight text-[var(--ink)]">
                  {active.title}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setActive(null)}
                className="rounded-full p-2 text-[var(--muted)] hover:bg-black/5 dark:hover:bg-white/10"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 scrollbar-thin">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
                Viewing inside LegalOS
              </p>
              <p className="mt-3 text-[15px] leading-relaxed text-[var(--ink-soft)]">{preview}</p>
              {previewNote && (
                <p className="mt-3 text-[12px] leading-relaxed text-[var(--muted)]">
                  {previewNote}
                </p>
              )}
              <div className="mt-6 rounded-xl border border-[var(--line)] bg-[var(--bg)] p-4">
                <p className="text-[12px] text-[var(--muted)]">Official source</p>
                <p className="mt-1 break-all font-mono text-[12px] text-[var(--ink-soft)]">
                  {active.url}
                </p>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setTab("alerts")}
                  className="rounded-xl border border-[var(--line)] px-3 py-2 text-left text-[13px] hover:border-[var(--accent)]/30"
                >
                  <Bell className="mb-1 h-3.5 w-3.5" /> Alert me on gov changes
                </button>
                <Link
                  href="/workspace"
                  className="rounded-xl border border-[var(--line)] px-3 py-2 text-[13px] hover:border-[var(--accent)]/30"
                >
                  Open Mission Control
                </Link>
              </div>
              <p className="mt-6 text-[12px] leading-relaxed text-[var(--muted)]">
                Many government sites block iframe embedding. LegalOS keeps you in-platform for
                catalogue context, alerts, and sharing — then hands off to the official site for the
                authoritative page.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 border-t border-[var(--line)] px-5 py-4">
              <a href={active.url} target="_blank" rel="noopener noreferrer">
                <Button variant="dark" size="sm">
                  Open official page
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              </a>
              <Button variant="secondary" size="sm" type="button" onClick={() => setActive(null)}>
                Stay in LegalOS
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
