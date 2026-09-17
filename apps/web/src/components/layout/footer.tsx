"use client";

import Link from "next/link";
import { useApp } from "@/lib/app-context";

export function Footer() {
  const { t } = useApp();
  return (
    <footer className="border-t border-[var(--line)] bg-[var(--bg)]">
      <div className="mx-auto max-w-[1400px] section-pad py-16">
        <div className="grid gap-12 md:grid-cols-12">
          <div className="md:col-span-5">
            <div className="display text-2xl tracking-tight">LegalOS</div>
            <p className="mt-5 max-w-sm text-[15px] leading-relaxed text-[var(--muted)]">
              Legal intelligence for UK immigration, protection, and access to justice — designed so
              people stay responsible for reserved legal work.
            </p>
          </div>
          <div className="md:col-span-2">
            <div className="eyebrow">Product</div>
            <ul className="mt-4 space-y-3 text-[14px] text-[var(--ink-soft)]">
              <li>
                <Link href="/workspace" className="hover:text-[var(--ink)]">
                  {t("nav.workspace")}
                </Link>
              </li>
              <li>
                <Link href="/resources" className="hover:text-[var(--ink)]">
                  {t("nav.resources")}
                </Link>
              </li>
              <li>
                <Link href="/enterprise" className="hover:text-[var(--ink)]">
                  {t("nav.enterprise")}
                </Link>
              </li>
            </ul>
          </div>
          <div className="md:col-span-2">
            <div className="eyebrow">Principles</div>
            <ul className="mt-4 space-y-3 text-[14px] text-[var(--muted)]">
              <li>Not a solicitor</li>
              <li>
                <Link href="/trust" className="hover:text-[var(--ink)]">
                  Transparent by design
                </Link>
              </li>
              <li>Trust earned by work & numbers</li>
              <li>No outcome guarantees</li>
            </ul>
          </div>
          <div className="md:col-span-3">
            <div className="eyebrow">Note</div>
            <p className="mt-4 text-[13px] leading-relaxed text-[var(--muted)]">
              {t("footer.note")}
            </p>
          </div>
        </div>
        <div className="mt-14 flex flex-col gap-2 border-t border-[var(--line)] pt-6 text-[12px] text-[var(--muted)] sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} LegalOS AI</p>
          <p>Demonstration product · Built for the United Kingdom</p>
        </div>
      </div>
    </footer>
  );
}
