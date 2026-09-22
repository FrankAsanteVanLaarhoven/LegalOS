"use client";

import Link from "next/link";
import { useApp } from "@/lib/app-context";
import { openCookiePreferences } from "@/components/compliance/cookie-consent";

export function Footer() {
  const { t } = useApp();
  return (
    <footer className="border-t border-[var(--line)] bg-[var(--bg)]">
      <div className="mx-auto max-w-[1400px] section-pad py-16">
        <div className="grid gap-10 md:grid-cols-12">
          <div className="md:col-span-4">
            <div className="display text-2xl tracking-tight">LegalOS</div>
            <p className="mt-4 max-w-sm text-[14px] leading-relaxed text-[var(--muted)]">
              Legal intelligence for UK immigration, protection, and access to justice — engineered so
              people stay responsible for reserved legal work.
            </p>
            <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--bg-elevated)] px-3 py-1 text-[11px] font-medium text-[var(--muted)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--success)]" />
              <span>S.84 IAA 1999 &amp; OISC Guardrails Active</span>
            </div>
          </div>

          <div className="md:col-span-2">
            <div className="eyebrow">Product</div>
            <ul className="mt-4 space-y-2.5 text-[14px] text-[var(--ink-soft)]">
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
              <li>
                <Link href="/trust" className="hover:text-[var(--ink)]">
                  Trust &amp; Verification
                </Link>
              </li>
            </ul>
          </div>

          <div className="md:col-span-3">
            <div className="eyebrow">Compliance &amp; Legal</div>
            <ul className="mt-4 space-y-2.5 text-[14px] text-[var(--ink-soft)]">
              <li>
                <Link href="/terms" className="hover:text-[var(--ink)]">
                  Terms of Service
                </Link>
              </li>
              <li>
                <Link href="/privacy" className="hover:text-[var(--ink)]">
                  Privacy Notice (UK GDPR)
                </Link>
              </li>
              <li>
                <Link href="/cookies" className="hover:text-[var(--ink)]">
                  Cookie Policy
                </Link>
              </li>
              <li>
                <Link href="/complaints" className="hover:text-[var(--ink)]">
                  Complaints Procedure
                </Link>
              </li>
              <li>
                <Link href="/governance" className="hover:text-[var(--ink)]">
                  Security &amp; Governance
                </Link>
              </li>
              <li className="pt-1">
                <button
                  type="button"
                  onClick={() => openCookiePreferences()}
                  className="text-[13px] text-[var(--muted)] underline underline-offset-2 hover:text-[var(--ink)]"
                >
                  Cookie Settings
                </button>
              </li>
            </ul>
          </div>

          <div className="md:col-span-3">
            <div className="eyebrow">Regulatory Safeguard</div>
            <p className="mt-4 text-[13px] leading-relaxed text-[var(--muted)]">
              LegalOS provides assistive intelligence tools and does not provide regulated legal advice.
              Reserved legal activities require qualified human solicitor or OISC adviser sign-off.
            </p>
          </div>
        </div>

        <div className="mt-14 flex flex-col gap-2 border-t border-[var(--line)] pt-6 text-[12px] text-[var(--muted)] sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} LegalOS AI Ltd · Registered in England &amp; Wales</p>
          <p>Zero-Training AI Policy · Data Minimisation · UK GDPR Compliant</p>
        </div>
      </div>
    </footer>
  );
}
