"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronDown } from "lucide-react";

import { isAvailable, MENU, type MenuSection } from "@/lib/data/navigation";
import type { AgentBadge } from "@/lib/capability-display";
import { cn } from "@/lib/utils";

/**
 * Primary navigation with dropdown panels.
 *
 * Opens on hover and on click, and closes on Escape or an outside click. Hover
 * alone would leave it unusable by keyboard and unreliable on touch, so pointer
 * intent and explicit activation are handled separately: hover opens after a
 * short delay and closes after a longer one, while click toggles and pins.
 *
 * Capability status comes in as a prop rather than being read here, because the
 * measurement is server-side. Items whose capability is below `operational` are
 * marked as planned — a menu that lists unbuilt work beside working pages tells
 * a visitor both exist.
 */

const OPEN_DELAY_MS = 90;
const CLOSE_DELAY_MS = 220;

export function NavMenu({
  statuses = {},
  className,
}: {
  statuses?: Record<string, AgentBadge>;
  className?: string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [pinned, setPinned] = useState(false);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);
  const reduceMotion = useReducedMotion();

  const clearTimers = useCallback(() => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  const scheduleOpen = useCallback(
    (id: string) => {
      clearTimers();
      openTimer.current = setTimeout(() => setOpenId(id), OPEN_DELAY_MS);
    },
    [clearTimers]
  );

  const scheduleClose = useCallback(() => {
    if (pinned) return;
    clearTimers();
    closeTimer.current = setTimeout(() => setOpenId(null), CLOSE_DELAY_MS);
  }, [clearTimers, pinned]);

  const close = useCallback(() => {
    clearTimers();
    setOpenId(null);
    setPinned(false);
  }, [clearTimers]);

  useEffect(() => clearTimers, [clearTimers]);

  // Escape closes, and a click anywhere outside dismisses a pinned panel.
  useEffect(() => {
    if (openId === null) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [openId, close]);

  return (
    <nav
      ref={rootRef}
      className={cn("relative hidden items-center gap-1 lg:flex", className)}
      onMouseLeave={scheduleClose}
    >
      {MENU.map((section) => (
        <Section
          key={section.id}
          section={section}
          statuses={statuses}
          open={openId === section.id}
          reduceMotion={Boolean(reduceMotion)}
          onHoverStart={() => scheduleOpen(section.id)}
          onHoverEnd={scheduleClose}
          onToggle={() => {
            clearTimers();
            if (openId === section.id && pinned) {
              close();
            } else {
              setOpenId(section.id);
              setPinned(true);
            }
          }}
          onNavigate={close}
        />
      ))}
    </nav>
  );
}

function Section({
  section,
  statuses,
  open,
  reduceMotion,
  onHoverStart,
  onHoverEnd,
  onToggle,
  onNavigate,
}: {
  section: MenuSection;
  statuses: Record<string, AgentBadge>;
  open: boolean;
  reduceMotion: boolean;
  onHoverStart: () => void;
  onHoverEnd: () => void;
  onToggle: () => void;
  onNavigate: () => void;
}) {
  const panelId = useId();

  return (
    <div className="relative" onMouseEnter={onHoverStart} onMouseLeave={onHoverEnd}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="true"
        onClick={onToggle}
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[13px] transition-colors",
          open
            ? "bg-[var(--accent-soft)] text-[var(--accent)]"
            : "text-[var(--muted)] hover:text-[var(--ink)]"
        )}
      >
        {section.label}
        <ChevronDown
          aria-hidden
          className={cn("h-3.5 w-3.5 transition-transform duration-200", open && "rotate-180")}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            id={panelId}
            role="group"
            aria-label={section.label}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.985 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.99 }}
            transition={{ duration: reduceMotion ? 0.12 : 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="absolute left-1/2 top-[calc(100%+0.5rem)] z-50 w-[min(92vw,30rem)] -translate-x-1/2 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--bg-elevated)] shadow-[var(--shadow-float)]"
          >
            <div className="border-b border-[var(--line)] px-4 py-3">
              <p className="text-[13px] font-semibold text-[var(--ink)]">{section.label}</p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--muted)]">
                {section.summary}
              </p>
            </div>

            <ul className="p-1.5">
              {section.items.map((item, index) => {
                const status = item.capability ? statuses[item.capability] : undefined;
                const available = item.capability === null || isAvailable(status?.implementation);

                return (
                  <motion.li
                    key={item.label}
                    initial={reduceMotion ? false : { opacity: 0, y: -3 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: reduceMotion ? 0 : 0.02 * index, duration: 0.16 }}
                  >
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      className="block rounded-xl px-3 py-2.5 transition-colors hover:bg-[var(--accent-soft)]/60"
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-[13px] font-medium text-[var(--ink)]">
                          {item.label}
                        </span>
                        {!available && (
                          <span className="rounded-full border border-amber-300 bg-amber-50 px-1.5 py-px text-[10px] font-medium uppercase tracking-wider text-amber-900">
                            {status?.implementation ?? "planned"}
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block text-[12px] leading-relaxed text-[var(--muted)]">
                        {item.description}
                      </span>
                      {!available && item.plannedNote && (
                        <span className="mt-1 block text-[11px] leading-relaxed text-amber-800">
                          {item.plannedNote}
                        </span>
                      )}
                    </Link>
                  </motion.li>
                );
              })}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
