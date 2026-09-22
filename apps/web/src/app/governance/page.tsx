import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/layout/site-header";
import { Footer } from "@/components/layout/footer";
import { ShieldCheck, Lock, GitCommit, Scale, FileText, CheckCircle2 } from "lucide-react";

export const metadata: Metadata = {
  title: "Security & Governance Architecture",
  description:
    "How LegalOS AI enforces cryptographic auditability, tenant isolation, zero-training AI privacy, and OISC compliance.",
};

export default function GovernancePage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[1100px] section-pad py-12 lg:py-16">
        <div className="space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--bg-elevated)] px-3 py-1 text-xs font-medium text-[var(--muted)]">
            <ShieldCheck className="h-3.5 w-3.5 text-[var(--accent)]" />
            <span>Platform Governance & Technical Controls</span>
          </div>
          <h1 className="display text-[clamp(2.2rem,4vw,3.2rem)] tracking-tight text-[var(--ink)]">
            Security & Governance Architecture
          </h1>
          <p className="text-[14px] text-[var(--muted)]">
            How LegalOS translates professional legal standards and data protection into executable software constraints
          </p>
        </div>

        {/* Pillars Grid */}
        <div className="mt-10 grid gap-6 md:grid-cols-2">
          {/* Pillar 1 */}
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--bg-elevated)] p-6 space-y-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--warm)] text-[var(--accent)]">
              <GitCommit className="h-5 w-5" />
            </div>
            <h2 className="text-lg font-semibold text-[var(--ink)]">Immutable Hash-Chained Audit Logs</h2>
            <p className="text-[13px] leading-relaxed text-[var(--muted)]">
              Every case action, evidence upload, AI execution, and approval gate is recorded in an
              append-only hash chain. Each entry commits to the SHA-256 hash of the preceding entry.
              Any modification or retroactive deletion breaks the chain, ensuring verifiable proof of
              provenance for tribunal proceedings.
            </p>
          </div>

          {/* Pillar 2 */}
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--bg-elevated)] p-6 space-y-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--warm)] text-[var(--accent)]">
              <Scale className="h-5 w-5 text-[var(--accent)]" />
            </div>
            <h2 className="text-lg font-semibold text-[var(--ink)]">Fail-Closed Verification Gates</h2>
            <p className="text-[13px] leading-relaxed text-[var(--muted)]">
              Unlike generic chatbots that hallucinate legal advice, LegalOS runs an independent rule
              verification engine. If an AI statement cannot resolve citations against official UK
              statutes or Home Office guidance, it is withheld rather than embellished.
            </p>
          </div>

          {/* Pillar 3 */}
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--bg-elevated)] p-6 space-y-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--warm)] text-[var(--accent)]">
              <Lock className="h-5 w-5 text-[var(--accent)]" />
            </div>
            <h2 className="text-lg font-semibold text-[var(--ink)]">Tenant Isolation & Anti-Leakage (INV-001)</h2>
            <p className="text-[13px] leading-relaxed text-[var(--muted)]">
              Multi-tenant boundaries are strictly enforced at five distinct architectural layers:
              database row-level tenancy, retrieval corpus boundaries, prompt context assembly, model
              payload boundaries, and response release gates. Insecure Direct Object References (IDOR)
              are blocked deterministically.
            </p>
          </div>

          {/* Pillar 4 */}
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--bg-elevated)] p-6 space-y-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--warm)] text-[var(--accent)]">
              <FileText className="h-5 w-5 text-[var(--accent)]" />
            </div>
            <h2 className="text-lg font-semibold text-[var(--ink)]">Executable Fiduciary Duties</h2>
            <p className="text-[13px] leading-relaxed text-[var(--muted)]">
              Professional duties are implemented as active code filters: automated confidentiality
              detectors check for Home Office references and NI numbers; conflict-of-interest checks
              prevent shared advisers on adverse matters; and candour algorithms distinguish facts
              from unverified assumptions.
            </p>
          </div>
        </div>

        {/* Detailed Governance Sections */}
        <div className="mt-14 space-y-8 rounded-2xl border border-[var(--line)] bg-[var(--warm)]/40 p-6 sm:p-8">
          <h2 className="text-xl font-semibold text-[var(--ink)]">
            Regulatory & Platform Governance Map
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Link
              href="/terms"
              className="group rounded-xl border border-[var(--line)] bg-[var(--bg-elevated)] p-4 transition-colors hover:border-[var(--accent)]"
            >
              <h3 className="font-semibold text-[var(--ink)] group-hover:text-[var(--accent)]">
                Terms of Service →
              </h3>
              <p className="mt-1 text-[12px] text-[var(--muted)]">
                S.84 statutory disclaimer, human sign-off rules, and acceptable use.
              </p>
            </Link>

            <Link
              href="/privacy"
              className="group rounded-xl border border-[var(--line)] bg-[var(--bg-elevated)] p-4 transition-colors hover:border-[var(--accent)]"
            >
              <h3 className="font-semibold text-[var(--ink)] group-hover:text-[var(--accent)]">
                GDPR Privacy Notice →
              </h3>
              <p className="mt-1 text-[12px] text-[var(--muted)]">
                Data subject rights, lawful bases, and cryptographic erasure tombstones.
              </p>
            </Link>

            <Link
              href="/cookies"
              className="group rounded-xl border border-[var(--line)] bg-[var(--bg-elevated)] p-4 transition-colors hover:border-[var(--accent)]"
            >
              <h3 className="font-semibold text-[var(--ink)] group-hover:text-[var(--accent)]">
                Cookie Policy →
              </h3>
              <p className="mt-1 text-[12px] text-[var(--muted)]">
                Transparent cookie taxonomy, zero tracking disclosure, and preferences.
              </p>
            </Link>

            <Link
              href="/complaints"
              className="group rounded-xl border border-[var(--line)] bg-[var(--bg-elevated)] p-4 transition-colors hover:border-[var(--accent)]"
            >
              <h3 className="font-semibold text-[var(--ink)] group-hover:text-[var(--accent)]">
                Complaints Procedure →
              </h3>
              <p className="mt-1 text-[12px] text-[var(--muted)]">
                OISC 3-stage dispute resolution, 20-day investigation, and external contacts.
              </p>
            </Link>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
