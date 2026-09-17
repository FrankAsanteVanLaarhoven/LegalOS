"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ControlBar } from "@/components/shell/theme-language-bar";
import { NavMenu } from "@/components/layout/nav-menu";
import { MENU } from "@/lib/data/navigation";
import type { AgentBadge } from "@/lib/capability-display";
import { useApp } from "@/lib/app-context";

/**
 * `capabilityStatuses` is measured on the server and passed in. The menu marks
 * anything below `operational` as planned, so navigation cannot present unbuilt
 * work as an available service.
 */
export function Navbar({
  capabilityStatuses = {},
}: {
  capabilityStatuses?: Record<string, AgentBadge>;
}) {
  const pathname = usePathname();
  const { t, plainEnglish } = useApp();
  const isApp = pathname?.startsWith("/workspace") || pathname?.startsWith("/enterprise");

  // Narrow screens get a flat list; the dropdown panels need pointer room.
  const compactLinks = [
    { href: "/workspace", label: t("nav.workspace") },
    { href: "/resources", label: t("nav.resources") },
    { href: "/trust", label: t("nav.transparency") },
    { href: "/enterprise", label: t("nav.enterprise") },
  ];

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--line)]/80 bg-[var(--bg)]/90 backdrop-blur-md">
      <div className="mx-auto flex min-h-[4.25rem] max-w-[1400px] flex-wrap items-center justify-between gap-3 py-2 section-pad">
        <div className="flex items-center gap-6">
          <Link href="/" className="group flex items-baseline gap-2">
            <span className="display text-[1.35rem] tracking-tight text-[var(--ink)]">LegalOS</span>
            <span className="hidden text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--muted)] sm:inline">
              AI
            </span>
          </Link>
          {plainEnglish && (
            <span className="hidden rounded-full border border-[var(--accent)]/30 bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] font-medium text-[var(--accent)] md:inline">
              {t("plain.badge")}
            </span>
          )}
        </div>

        <NavMenu statuses={capabilityStatuses} className="order-3 lg:order-none" />

        <nav className="order-3 flex w-full items-center gap-5 overflow-x-auto lg:hidden">
          {compactLinks.map((link) => {
            const active = link.href.startsWith("/workspace")
              ? pathname?.startsWith("/workspace")
              : link.href.startsWith("/enterprise")
                ? pathname?.startsWith("/enterprise")
                : link.href.startsWith("/resources")
                  ? pathname?.startsWith("/resources")
                  : false;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "text-[13px] transition-colors whitespace-nowrap",
                  active ? "text-[var(--ink)]" : "text-[var(--muted)] hover:text-[var(--ink)]"
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <ControlBar />
          <Link href="/workspace/cases/case-sabinah-001">
            <Button size="sm" variant="dark">
              {isApp ? t("nav.demo") : t("nav.demo")}
            </Button>
          </Link>
        </div>
      </div>
    </header>
  );
}
