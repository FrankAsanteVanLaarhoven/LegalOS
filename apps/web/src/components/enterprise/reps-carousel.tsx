"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { Pause, Play, X, MapPin, Scale, Languages, Building2 } from "lucide-react";
import type { LegalRepresentative } from "@/lib/legal/representatives";
import { LEGAL_REPRESENTATIVES } from "@/lib/legal/representatives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const CARD_W = 300;
const GAP = 20;

export function RepsCarousel({ reps = LEGAL_REPRESENTATIVES }: { reps?: LegalRepresentative[] }) {
  const [paused, setPaused] = useState(false);
  const [selected, setSelected] = useState<LegalRepresentative | null>(null);
  const [manual, setManual] = useState(false);

  // Triple the track for seamless infinite scroll
  const track = useMemo(() => [...reps, ...reps, ...reps], [reps]);

  const open = useCallback((rep: LegalRepresentative) => {
    setSelected(rep);
    setPaused(true);
    setManual(true);
  }, []);

  const close = useCallback(() => {
    setSelected(null);
    setManual(false);
    setPaused(false);
  }, []);

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, close]);

  // Prevent body scroll when modal open
  useEffect(() => {
    if (selected) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [selected]);

  const duration = Math.max(28, reps.length * 6);

  return (
    <div className="relative">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-[var(--muted)]">
          Infinite partner reel — hover to pause · click a card for full profile
        </p>
        <button
          type="button"
          onClick={() => {
            setManual((m) => !m);
            setPaused((p) => !p);
          }}
          className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] px-3 py-1.5 text-[12px] font-medium text-[var(--ink-soft)] transition hover:border-[var(--line-strong)] hover:text-[var(--ink)]"
        >
          {paused || manual ? (
            <>
              <Play className="h-3.5 w-3.5" /> Resume motion
            </>
          ) : (
            <>
              <Pause className="h-3.5 w-3.5" /> Pause reel
            </>
          )}
        </button>
      </div>

      {/* Edge fades */}
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-12 bg-gradient-to-r from-[var(--bg-elevated)] to-transparent sm:w-20" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-12 bg-gradient-to-l from-[var(--bg-elevated)] to-transparent sm:w-20" />

      <div
        className="relative overflow-hidden py-2"
        onMouseEnter={() => !manual && setPaused(true)}
        onMouseLeave={() => !manual && !selected && setPaused(false)}
      >
        <div
          className={cn("reps-marquee flex w-max gap-5", paused && "reps-marquee-paused")}
          style={
            {
              "--reps-duration": `${duration}s`,
              "--reps-shift": `-${reps.length * (CARD_W + GAP)}px`,
            } as React.CSSProperties
          }
        >
          {track.map((rep, i) => (
            <RepCard key={`${rep.id}-${i}`} rep={rep} onOpen={() => open(rep)} compact />
          ))}
        </div>
      </div>

      {/* Dot strip for quick jump */}
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {reps.map((rep) => (
          <button
            key={rep.id}
            type="button"
            title={rep.name}
            onClick={() => open(rep)}
            className={cn(
              "h-2 w-2 rounded-full transition-all",
              selected?.id === rep.id
                ? "w-6 bg-[var(--accent)]"
                : "bg-[var(--line-strong)] hover:bg-[var(--muted)]"
            )}
            aria-label={`Open ${rep.name}`}
          />
        ))}
      </div>

      <AnimatePresence>
        {selected && (
          <motion.div
            className="fixed inset-0 z-[70] flex items-center justify-center p-4 sm:p-8"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <button
              type="button"
              className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
              aria-label="Close profile"
              onClick={close}
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="rep-modal-title"
              initial={{ opacity: 0, y: 24, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.98 }}
              transition={{ type: "spring", stiffness: 320, damping: 28 }}
              className="relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[var(--line)] bg-[var(--bg-elevated)] shadow-2xl"
            >
              <button
                type="button"
                onClick={close}
                className="absolute right-3 top-3 z-10 rounded-full bg-black/45 p-2 text-white backdrop-blur-sm hover:bg-black/60"
              >
                <X className="h-4 w-4" />
              </button>

              <div className="relative aspect-[5/4] w-full overflow-hidden bg-[var(--line)] sm:aspect-[16/11]">
                <Image
                  src={selected.image}
                  alt={selected.imageAlt}
                  fill
                  className="object-cover object-top"
                  sizes="(max-width: 512px) 100vw, 512px"
                  priority
                />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/25 to-transparent p-5 pt-16">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      tone={selected.accepting ? "success" : "neutral"}
                      className="border-white/20 bg-white/15 text-white"
                    >
                      Illustrative profile
                    </Badge>
                    <span className="text-[11px] text-white/75">Partner profile</span>
                  </div>
                  <h3
                    id="rep-modal-title"
                    className="display mt-2 text-[1.75rem] tracking-tight text-white"
                  >
                    {selected.name}
                  </h3>
                  <p className="mt-0.5 text-[15px] text-white/85">{selected.role}</p>
                </div>
              </div>

              <div className="p-6 sm:p-8">
                <div className="space-y-4 text-[14px]">
                  <DetailRow icon={Building2} label="Organisation">
                    {selected.organisation}
                  </DetailRow>
                  <DetailRow icon={Scale} label="Regulation">
                    {selected.regulated}
                  </DetailRow>
                  <DetailRow icon={MapPin} label="Location">
                    {selected.location}
                  </DetailRow>
                  <DetailRow icon={Languages} label="Languages">
                    {selected.languages.join(" · ")}
                  </DetailRow>
                </div>

                <p className="mt-6 text-[15px] leading-relaxed text-[var(--ink-soft)]">
                  {selected.bio}
                </p>

                <div className="mt-5">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
                    Expertise
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {selected.domains.map((d) => (
                      <span
                        key={d}
                        className="rounded-full border border-[var(--line)] bg-[var(--bg)] px-3 py-1 text-[12px] text-[var(--ink-soft)]"
                      >
                        {d}
                      </span>
                    ))}
                  </div>
                </div>

                <p className="mt-6 text-[12px] leading-relaxed text-[var(--muted)]">
                  This is a fictional profile used to demonstrate the partner directory. No such
                  person or firm exists, and the regulatory details shown are illustrative. Always
                  verify live regulation on SRA, IAA, or Bar Standards Board registers before
                  instructing.
                </p>

                <div className="mt-6 flex flex-wrap gap-2">
                  <Button variant="dark" size="sm" type="button" onClick={close}>
                    Close
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    type="button"
                    onClick={() => {
                      const idx = reps.findIndex((r) => r.id === selected.id);
                      const next = reps[(idx + 1) % reps.length];
                      setSelected(next);
                    }}
                  >
                    Next profile
                  </Button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function RepCard({
  rep,
  onOpen,
  compact,
}: {
  rep: LegalRepresentative;
  onOpen: () => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group shrink-0 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--bg)] text-left shadow-[var(--shadow-soft)] transition duration-300",
        "hover:-translate-y-1 hover:border-[var(--accent)]/35 hover:shadow-[var(--shadow-float)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/30",
        compact && "w-[min(100vw-3rem,300px)]"
      )}
      style={compact ? { width: CARD_W } : undefined}
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-[var(--line)]">
        <Image
          src={rep.image}
          alt={rep.imageAlt}
          fill
          className="object-cover object-top transition duration-500 group-hover:scale-[1.04]"
          sizes="300px"
        />
        {/*
          This badge read "Accepting" / "Waitlist" on six invented people, which
          reads as live availability and invites an attempt to instruct them.
          The demo caveat existed only inside the modal, below the regulation
          claim, so the browsing state showed six named regulated solicitors.
        */}
        <div className="absolute left-3 top-3">
          <Badge tone="warning" className="border-white/25 bg-black/55 text-white backdrop-blur-sm">
            Illustrative — not a real adviser
          </Badge>
        </div>
      </div>
      <div className="p-4">
        <div className="truncate text-[15px] font-semibold tracking-tight text-[var(--ink)]">
          {rep.name}
        </div>
        <div className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-[var(--muted)]">
          {rep.role}
        </div>
        <p className="mt-2 truncate text-[12px] text-[var(--ink-soft)]">{rep.organisation}</p>
        <p className="mt-2 line-clamp-2 text-[12px] leading-relaxed text-[var(--muted)]">
          {rep.bio}
        </p>
        <div className="mt-3 flex flex-wrap gap-1">
          {rep.domains.slice(0, 3).map((d) => (
            <span
              key={d}
              className="rounded-md border border-[var(--line)] px-2 py-0.5 text-[10px] text-[var(--ink-soft)]"
            >
              {d}
            </span>
          ))}
          {rep.domains.length > 3 && (
            <span className="px-1 text-[10px] text-[var(--muted)]">+{rep.domains.length - 3}</span>
          )}
        </div>
        <p className="mt-3 text-[11px] font-medium text-[var(--accent)] opacity-80 transition group-hover:opacity-100">
          View full profile →
        </p>
      </div>
    </button>
  );
}

function DetailRow({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof MapPin;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
        <Icon className="h-4 w-4" strokeWidth={1.75} />
      </div>
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
          {label}
        </div>
        <div className="mt-0.5 text-[var(--ink-soft)]">{children}</div>
      </div>
    </div>
  );
}
