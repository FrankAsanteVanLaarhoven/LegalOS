import type { Metadata } from "next";
import { SiteHeader } from "@/components/layout/site-header";
import { Footer } from "@/components/layout/footer";
import { CookiePreferencesButton } from "@/components/compliance/cookie-preferences-button";
import { Cookie, ShieldCheck, Info, CheckCircle2, XCircle } from "lucide-react";

export const metadata: Metadata = {
  title: "Cookie Policy",
  description:
    "Comprehensive disclosure of cookies, local storage tokens, and tracking governance on the LegalOS AI platform under UK GDPR and PECR.",
};

export default function CookiesPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[1100px] section-pad py-12 lg:py-16">
        <div className="space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--bg-elevated)] px-3 py-1 text-xs font-medium text-[var(--muted)]">
            <Cookie className="h-3.5 w-3.5 text-[var(--accent)]" />
            <span>ePrivacy & PECR Compliance</span>
          </div>
          <h1 className="display text-[clamp(2.2rem,4vw,3.2rem)] tracking-tight text-[var(--ink)]">
            Cookie Policy
          </h1>
          <p className="text-[14px] text-[var(--muted)]">
            Last updated: September 2026 · Transparent cookie taxonomy and user controls
          </p>
        </div>

        {/* Action Header Card */}
        <div className="mt-8 flex flex-col gap-5 rounded-2xl border border-[var(--line-strong)] bg-[var(--bg-elevated)] p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
          <div className="space-y-1.5">
            <h2 className="text-lg font-semibold tracking-tight text-[var(--ink)]">
              Your Current Consent Settings
            </h2>
            <p className="max-w-xl text-[14px] leading-relaxed text-[var(--muted)]">
              You can adjust your cookie settings or withdraw your consent for non-essential cookies at
              any time.
            </p>
          </div>
          <CookiePreferencesButton variant="primary" className="shrink-0" />
        </div>

        <div className="mt-12 space-y-12">
          {/* Section 1: Overview */}
          <section id="what-are-cookies" className="space-y-4">
            <div className="flex items-center gap-2.5 text-lg font-semibold text-[var(--ink)]">
              <Info className="h-5 w-5 text-[var(--accent)]" />
              <h2>1. How We Use Cookies</h2>
            </div>
            <div className="space-y-3 text-[14px] leading-relaxed text-[var(--muted)]">
              <p>
                Under the Privacy and Electronic Communications Regulations (PECR) and UK GDPR, we
                are required to obtain informed, unambiguous consent before setting any non-essential
                cookies or local storage objects on your device.
              </p>
              <p>
                LegalOS is designed with data minimisation at its core. We do not use third-party
                advertising networks, tracking pixels, or cross-site user fingerprinting. Our cookies
                serve solely to keep your session secure, protect your case file from unauthorised
                access, and save your accessibility preferences.
              </p>
            </div>
          </section>

          {/* Section 2: Complete Cookie Inventory */}
          <section id="cookie-inventory" className="space-y-4">
            <div className="flex items-center gap-2.5 text-lg font-semibold text-[var(--ink)]">
              <ShieldCheck className="h-5 w-5 text-[var(--accent)]" />
              <h2>2. Complete Cookie & Storage Inventory</h2>
            </div>
            <div className="overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--bg-elevated)]">
              <table className="w-full text-left text-[13px]">
                <thead className="border-b border-[var(--line)] bg-[var(--warm)]/60 text-[var(--ink)]">
                  <tr>
                    <th className="p-3.5 font-semibold">Cookie Name</th>
                    <th className="p-3.5 font-semibold">Category</th>
                    <th className="p-3.5 font-semibold">Duration</th>
                    <th className="p-3.5 font-semibold">Purpose & Security Flags</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line)] text-[var(--muted)]">
                  <tr>
                    <td className="p-3.5 font-mono font-medium text-[var(--ink)]">legalos_session</td>
                    <td className="p-3.5">
                      <span className="rounded-full bg-[var(--line)] px-2 py-0.5 text-[11px] font-medium text-[var(--ink)]">
                        Strictly Necessary
                      </span>
                    </td>
                    <td className="p-3.5">24 hours</td>
                    <td className="p-3.5">
                      Cryptographic authentication session token. Enforces tenant boundaries.
                      Flagged: <code className="text-[11px]">HttpOnly, Secure, SameSite=Lax</code>.
                    </td>
                  </tr>
                  <tr>
                    <td className="p-3.5 font-mono font-medium text-[var(--ink)]">legalos_consent</td>
                    <td className="p-3.5">
                      <span className="rounded-full bg-[var(--line)] px-2 py-0.5 text-[11px] font-medium text-[var(--ink)]">
                        Strictly Necessary
                      </span>
                    </td>
                    <td className="p-3.5">1 year</td>
                    <td className="p-3.5">
                      Records your chosen cookie consent preferences and compliance audit version.
                      Flagged: <code className="text-[11px]">Secure, SameSite=Lax</code>.
                    </td>
                  </tr>
                  <tr>
                    <td className="p-3.5 font-mono font-medium text-[var(--ink)]">legalos_theme</td>
                    <td className="p-3.5">
                      <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--accent)]">
                        Functional
                      </span>
                    </td>
                    <td className="p-3.5">6 months</td>
                    <td className="p-3.5">
                      Remembers your preference for light, dark, or high-contrast visual display mode.
                    </td>
                  </tr>
                  <tr>
                    <td className="p-3.5 font-mono font-medium text-[var(--ink)]">legalos_lang</td>
                    <td className="p-3.5">
                      <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--accent)]">
                        Functional
                      </span>
                    </td>
                    <td className="p-3.5">6 months</td>
                    <td className="p-3.5">
                      Saves your plain English toggle and preferred translation terminology.
                    </td>
                  </tr>
                  <tr>
                    <td className="p-3.5 font-mono font-medium text-[var(--ink)]">legalos_analytics</td>
                    <td className="p-3.5">
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
                        Optional Telemetry
                      </span>
                    </td>
                    <td className="p-3.5">30 days</td>
                    <td className="p-3.5">
                      Aggregated platform health and runtime invariant verification. Zero tracking across websites.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* Section 3: Third-Party Disclosures */}
          <section id="third-parties" className="space-y-4">
            <div className="flex items-center gap-2.5 text-lg font-semibold text-[var(--ink)]">
              <CheckCircle2 className="h-5 w-5 text-[var(--success)]" />
              <h2>3. Third-Party Tracker Disclosure</h2>
            </div>
            <div className="rounded-xl border border-[var(--line)] bg-[var(--bg-elevated)] p-5 space-y-3 text-[14px] leading-relaxed text-[var(--muted)]">
              <div className="flex items-center gap-2 text-[var(--ink)] font-medium">
                <XCircle className="h-4 w-4 text-[var(--danger)]" />
                <span>What We Do NOT Use:</span>
              </div>
              <ul className="list-inside list-disc space-y-1 pl-2 text-[var(--ink-soft)] text-[13px]">
                <li>Zero advertising or retargeting networks (no Google Ads, Meta Pixel, TikTok, or LinkedIn tags);</li>
                <li>Zero cross-domain fingerprinting or behavioural profiling trackers;</li>
                <li>Zero data monetization or sharing with data brokers.</li>
              </ul>
            </div>
          </section>

          {/* Section 4: Browser Controls */}
          <section id="browser-management" className="space-y-4">
            <div className="flex items-center gap-2.5 text-lg font-semibold text-[var(--ink)]">
              <Cookie className="h-5 w-5 text-[var(--accent)]" />
              <h2>4. How to Manage Cookies in Your Browser</h2>
            </div>
            <div className="space-y-3 text-[14px] leading-relaxed text-[var(--muted)]">
              <p>
                In addition to our on-platform consent modal, you can control or delete cookies directly
                within your browser settings:
              </p>
              <ul className="list-inside list-disc space-y-1.5 pl-2 text-[var(--ink-soft)]">
                <li><strong>Google Chrome:</strong> Settings → Privacy and Security → Third-party cookies.</li>
                <li><strong>Apple Safari:</strong> Preferences → Privacy → Manage Website Data.</li>
                <li><strong>Mozilla Firefox:</strong> Settings → Privacy & Security → Enhanced Tracking Protection.</li>
                <li><strong>Microsoft Edge:</strong> Settings → Cookies and Site Permissions.</li>
              </ul>
              <p>
                Please note that blocking strictly necessary cookies will prevent you from signing in
                or accessing your confidential case workspace.
              </p>
            </div>
          </section>
        </div>
      </main>
      <Footer />
    </>
  );
}
