import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/layout/site-header";
import { Footer } from "@/components/layout/footer";
import { Shield, AlertTriangle, FileText, Scale, Lock, RefreshCw, CheckCircle2 } from "lucide-react";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "Terms of Service governing the use of the LegalOS AI platform, including statutory disclaimers under Section 84 of the Immigration and Asylum Act 1999.",
};

export default function TermsPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[1100px] section-pad py-12 lg:py-16">
        <div className="space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--bg-elevated)] px-3 py-1 text-xs font-medium text-[var(--muted)]">
            <Scale className="h-3.5 w-3.5 text-[var(--accent)]" />
            <span>Statutory & Platform Terms</span>
          </div>
          <h1 className="display text-[clamp(2.2rem,4vw,3.2rem)] tracking-tight text-[var(--ink)]">
            Terms of Service
          </h1>
          <p className="text-[14px] text-[var(--muted)]">
            Last updated: September 2026 · Effective across all workspaces and platform interfaces
          </p>
        </div>

        {/* Regulatory Callout Box */}
        <div className="mt-8 rounded-2xl border-2 border-[var(--accent)]/30 bg-[var(--warm)]/50 p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)] text-white">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <div className="space-y-2">
              <h2 className="text-lg font-semibold tracking-tight text-[var(--ink)]">
                Important Regulatory Notice: S.84 Immigration and Asylum Act 1999
              </h2>
              <p className="text-[14px] leading-relaxed text-[var(--ink-soft)]">
                <strong>LegalOS is not a law firm and does not provide regulated legal advice.</strong>{" "}
                Under Section 84 of the Immigration and Asylum Act 1999, the provision of immigration
                advice and services in the United Kingdom is strictly restricted to qualified
                persons registered with the Immigration Services Commissioner (OISC / IAA) or
                authorized by a designated qualifying regulator (e.g. Solicitors Regulation
                Authority, Bar Standards Board). LegalOS provides structural intelligence, rule
                verification, evidence organisation, and document preparation tools. All reserved
                legal submissions require review and sign-off by a qualified human practitioner.
              </p>
            </div>
          </div>
        </div>

        {/* Structured Sections */}
        <div className="mt-12 space-y-12">
          {/* Section 1 */}
          <section id="platform-scope" className="space-y-4">
            <div className="flex items-center gap-2.5 text-lg font-semibold text-[var(--ink)]">
              <FileText className="h-5 w-5 text-[var(--accent)]" />
              <h2>1. Nature and Scope of Platform Services</h2>
            </div>
            <div className="space-y-3 text-[14px] leading-relaxed text-[var(--muted)]">
              <p>
                LegalOS operates as an assistive workflow, evidence analysis, and case intelligence
                operating system. The platform assists individuals, solicitors, non-profit organisations,
                and legal professionals by:
              </p>
              <ul className="list-inside list-disc space-y-1.5 pl-2 text-[var(--ink-soft)]">
                <li>Extracting facts and assembling chronological timelines from evidentiary material;</li>
                <li>Validating immigration rules against official statutory registers deterministically;</li>
                <li>Cross-referencing legal authorities and Home Office guidance in context;</li>
                <li>Highlighting missing evidence required for tribunal hearings and administrative reviews;</li>
                <li>Facilitating secure, audited collaboration between clients and qualified practitioners.</li>
              </ul>
              <p>
                Model outputs and AI assistant responses are informational navigational aids. They do
                not constitute an official solicitor-client retainer unless you have separately engaged
                an authorised legal professional through our enterprise advisory networks.
              </p>
            </div>
          </section>

          {/* Section 2 */}
          <section id="reserved-activities" className="space-y-4">
            <div className="flex items-center gap-2.5 text-lg font-semibold text-[var(--ink)]">
              <Shield className="h-5 w-5 text-[var(--accent)]" />
              <h2>2. Reserved Legal Activities & Qualified Human Sign-Off</h2>
            </div>
            <div className="space-y-3 text-[14px] leading-relaxed text-[var(--muted)]">
              <p>
                In accordance with the Legal Services Act 2007 and the OISC Code of Standards,
                reserved legal activities — including exercising rights of audience before the
                First-tier and Upper Tribunal (Immigration and Asylum Chamber), the conduct of
                litigation, and lodging formal statutory appeals — can only be executed by regulated
                individuals.
              </p>
              <p>
                LegalOS enforces technical gatekeepers: draft appeal skeleton arguments, judicial review
                protocols, and tribunal bundles generated in the workspace remain in a provisional
                draft state until approved by a verified qualified human professional holding Level 2/3
                OISC accreditation or SRA solicitor status.
              </p>
            </div>
          </section>

          {/* Section 3 */}
          <section id="data-protection-ai" className="space-y-4">
            <div className="flex items-center gap-2.5 text-lg font-semibold text-[var(--ink)]">
              <Lock className="h-5 w-5 text-[var(--accent)]" />
              <h2>3. Data Confidentiality & Zero Model Training Guarantee</h2>
            </div>
            <div className="space-y-3 text-[14px] leading-relaxed text-[var(--muted)]">
              <p>
                We recognise that users of LegalOS frequently entrust the platform with highly sensitive,
                confidential asylum claims, medical records, and human trafficking disclosure documents.
              </p>
              <div className="rounded-xl border border-[var(--line)] bg-[var(--bg-elevated)] p-5 space-y-2">
                <div className="flex items-center gap-2 font-medium text-[var(--ink)]">
                  <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />
                  <span>Our Binding Zero-Training Commitment:</span>
                </div>
                <p className="text-[13px] text-[var(--muted)]">
                  LegalOS operates under strict contractual API agreements where zero client case
                  material, evidence uploads, OCR text, or conversation prompts are retained or used
                  to train, fine-tune, or improve third-party or proprietary artificial intelligence
                  foundation models. All inference queries are processed ephemerally within secure
                  enclaves and immediately released.
                </p>
              </div>
            </div>
          </section>

          {/* Section 4 */}
          <section id="acceptable-use" className="space-y-4">
            <div className="flex items-center gap-2.5 text-lg font-semibold text-[var(--ink)]">
              <RefreshCw className="h-5 w-5 text-[var(--accent)]" />
              <h2>4. Acceptable Use, Security & Fair Quotas</h2>
            </div>
            <div className="space-y-3 text-[14px] leading-relaxed text-[var(--muted)]">
              <p>When using LegalOS, you agree not to:</p>
              <ul className="list-inside list-disc space-y-1.5 pl-2 text-[var(--ink-soft)]">
                <li>Submit intentionally fraudulent, deceptive, or forged evidentiary documentation;</li>
                <li>Attempt adversarial prompt injection or bypass verification guardrails;</li>
                <li>Circumvent identity-scoped rate limiting or session authentication controls;</li>
                <li>Share account credentials or attempt to access cases belonging to another workspace tenant;</li>
                <li>Use automated scripts or scraping tools to exhaust platform resources.</li>
              </ul>
              <p>
                Violation of acceptable use policies may result in immediate suspension of access and,
                where fraudulent conduct or document falsification is identified, statutory reporting
                under regulatory obligations.
              </p>
            </div>
          </section>

          {/* Section 5 */}
          <section id="complaints-disputes" className="space-y-4">
            <div className="flex items-center gap-2.5 text-lg font-semibold text-[var(--ink)]">
              <Scale className="h-5 w-5 text-[var(--accent)]" />
              <h2>5. Complaints Handling & Governing Law</h2>
            </div>
            <div className="space-y-3 text-[14px] leading-relaxed text-[var(--muted)]">
              <p>
                We are dedicated to the highest standards of transparency and service quality. If you
                are dissatisfied with any aspect of the platform, you have the right to file a formal
                complaint in accordance with our documented procedure.
              </p>
              <p>
                Please review our comprehensive{" "}
                <Link href="/complaints" className="font-medium text-[var(--ink)] underline underline-offset-2">
                  Complaints Procedure
                </Link>
                , which details our 20-working-day investigation timeframe and external statutory
                escalation routes to the Immigration Services Commissioner (OISC / IAA) and the Legal
                Ombudsman.
              </p>
              <p>
                These terms are governed by and construed in accordance with the laws of England and
                Wales. The courts of England and Wales shall have exclusive jurisdiction over any dispute
                arising out of or in connection with the platform.
              </p>
            </div>
          </section>
        </div>
      </main>
      <Footer />
    </>
  );
}
