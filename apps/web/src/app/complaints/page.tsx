import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/layout/site-header";
import { Footer } from "@/components/layout/footer";
import { Scale, Mail, Clock, AlertCircle, Building2, CheckCircle2, FileCheck } from "lucide-react";

export const metadata: Metadata = {
  title: "Complaints Procedure",
  description:
    "Official client complaints handling procedure under the OISC / IAA Code of Standards 2024 and SRA Transparency Rules.",
};

export default function ComplaintsPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[1100px] section-pad py-12 lg:py-16">
        <div className="space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--bg-elevated)] px-3 py-1 text-xs font-medium text-[var(--muted)]">
            <Scale className="h-3.5 w-3.5 text-[var(--accent)]" />
            <span>OISC / IAA Regulatory Compliance</span>
          </div>
          <h1 className="display text-[clamp(2.2rem,4vw,3.2rem)] tracking-tight text-[var(--ink)]">
            Complaints Handling Procedure
          </h1>
          <p className="text-[14px] text-[var(--muted)]">
            In compliance with the Office of the Immigration Services Commissioner (OISC / IAA) Code of Standards
          </p>
        </div>

        {/* Regulatory Banner */}
        <div className="mt-8 rounded-2xl border border-[var(--line-strong)] bg-[var(--bg-elevated)] p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
              <FileCheck className="h-6 w-6" />
            </div>
            <div className="space-y-2">
              <h2 className="text-lg font-semibold tracking-tight text-[var(--ink)]">
                Our Commitment to Fair Treatment & Client Care
              </h2>
              <p className="text-[14px] leading-relaxed text-[var(--muted)]">
                Under Standards 10–13 of the OISC Code of Standards and the Commissioner&apos;s Rules,
                all individuals and organizations using LegalOS are entitled to fair, transparent, and
                dignified treatment. We recognize the profound impact immigration decisions have on
                people&apos;s lives. If something has gone wrong, we provide a prompt, impartial, and
                thorough procedure to investigate and put matters right.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-12 space-y-12">
          {/* 3-Stage Process */}
          <section id="three-stage-procedure" className="space-y-6">
            <h2 className="text-xl font-semibold tracking-tight text-[var(--ink)]">
              The Three-Stage Resolution Procedure
            </h2>

            <div className="grid gap-6 md:grid-cols-3">
              {/* Stage 1 */}
              <div className="rounded-2xl border border-[var(--line)] bg-[var(--bg-elevated)] p-6 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="rounded-full bg-[var(--line)] px-2.5 py-1 text-[11px] font-semibold text-[var(--ink)]">
                    Stage 1
                  </span>
                  <span className="flex items-center text-[12px] font-medium text-[var(--muted)]">
                    <Clock className="mr-1 h-3.5 w-3.5 text-[var(--accent)]" /> 7 Days
                  </span>
                </div>
                <h3 className="text-base font-semibold text-[var(--ink)]">Informal Resolution</h3>
                <p className="text-[13px] leading-relaxed text-[var(--muted)]">
                  Contact our support team directly. We acknowledge within 2 business days and aim to
                  resolve operational or technical misunderstandings informally within 7 working days.
                </p>
              </div>

              {/* Stage 2 */}
              <div className="rounded-2xl border-2 border-[var(--accent)]/30 bg-[var(--warm)]/30 p-6 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="rounded-full bg-[var(--accent)] px-2.5 py-1 text-[11px] font-semibold text-white">
                    Stage 2
                  </span>
                  <span className="flex items-center text-[12px] font-medium text-[var(--ink)]">
                    <Clock className="mr-1 h-3.5 w-3.5 text-[var(--accent)]" /> 20 Days Max
                  </span>
                </div>
                <h3 className="text-base font-semibold text-[var(--ink)]">Formal Investigation</h3>
                <p className="text-[13px] leading-relaxed text-[var(--ink-soft)]">
                  Escalated to our Designated Compliance Director. A comprehensive investigation of
                  audit logs and evidence chains is conducted. A full written determination is issued
                  within 20 working days.
                </p>
              </div>

              {/* Stage 3 */}
              <div className="rounded-2xl border border-[var(--line)] bg-[var(--bg-elevated)] p-6 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-800">
                    Stage 3
                  </span>
                  <span className="text-[12px] font-medium text-[var(--muted)]">
                    External Escalate
                  </span>
                </div>
                <h3 className="text-base font-semibold text-[var(--ink)]">Regulator Escalation</h3>
                <p className="text-[13px] leading-relaxed text-[var(--muted)]">
                  If dissatisfied with our determination, you have the right to escalate directly to
                  the Immigration Services Commissioner (OISC / IAA) or the Legal Ombudsman.
                </p>
              </div>
            </div>
          </section>

          {/* How to Lodge a Complaint */}
          <section id="how-to-complain" className="space-y-4">
            <div className="flex items-center gap-2.5 text-lg font-semibold text-[var(--ink)]">
              <Mail className="h-5 w-5 text-[var(--accent)]" />
              <h2>How to Lodge a Formal Complaint</h2>
            </div>
            <div className="space-y-3 text-[14px] leading-relaxed text-[var(--muted)]">
              <p>
                To initiate a Stage 2 formal complaint, please submit a written notice to our
                compliance directorate:
              </p>
              <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-5 space-y-2 text-[13px] text-[var(--ink-soft)]">
                <p><strong>Email:</strong> <a href="mailto:complaints@legalos.ai" className="text-[var(--accent)] underline">complaints@legalos.ai</a></p>
                <p><strong>Subject Line:</strong> Formal Complaint — [Case Reference Number or Account Email]</p>
                <p><strong>Information to include:</strong></p>
                <ul className="list-inside list-disc pl-2 space-y-1 text-[var(--muted)]">
                  <li>Your full name and contact details;</li>
                  <li>The relevant case file identifier (e.g. <code className="font-mono">LOS-ACTIVE</code>);</li>
                  <li>A clear description of what occurred and how it affected your matter;</li>
                  <li>Any supporting documentation or correspondence;</li>
                  <li>The remedy or resolution you are seeking.</li>
                </ul>
              </div>
            </div>
          </section>

          {/* External Regulators */}
          <section id="statutory-escalation" className="space-y-4">
            <div className="flex items-center gap-2.5 text-lg font-semibold text-[var(--ink)]">
              <Building2 className="h-5 w-5 text-[var(--accent)]" />
              <h2>Statutory Regulatory Contacts</h2>
            </div>
            <p className="text-[14px] leading-relaxed text-[var(--muted)]">
              You do not need our permission to approach regulatory authorities. If your complaint
              relates to immigration advice or services provided by an adviser or partner organization,
              you may contact:
            </p>

            <div className="grid gap-4 sm:grid-cols-2">
              {/* OISC / IAA */}
              <div className="rounded-xl border border-[var(--line)] bg-[var(--bg-elevated)] p-5 space-y-2">
                <h3 className="font-semibold text-[var(--ink)] text-[15px]">
                  Immigration Advice Authority (OISC)
                </h3>
                <p className="text-[12px] text-[var(--muted)]">
                  The statutory regulator for immigration advisers in the United Kingdom.
                </p>
                <div className="pt-2 text-[13px] text-[var(--ink-soft)] space-y-1">
                  <p>5th Floor, 21 Bloomsbury Street, London WC1B 3HF</p>
                  <p>Telephone: 0345 000 0046</p>
                  <p>Email: <a href="mailto:complaints@oisc.gov.uk" className="text-[var(--accent)] underline">complaints@oisc.gov.uk</a></p>
                  <p>Website: <a href="https://www.gov.uk/oisc" target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] underline">gov.uk/oisc</a></p>
                </div>
              </div>

              {/* Legal Ombudsman / SRA */}
              <div className="rounded-xl border border-[var(--line)] bg-[var(--bg-elevated)] p-5 space-y-2">
                <h3 className="font-semibold text-[var(--ink)] text-[15px]">
                  Legal Ombudsman &amp; SRA
                </h3>
                <p className="text-[12px] text-[var(--muted)]">
                  For matters handled by or supervised by an SRA-regulated solicitor.
                </p>
                <div className="pt-2 text-[13px] text-[var(--ink-soft)] space-y-1">
                  <p>PO Box 6806, Wolverhampton WV1 9WJ</p>
                  <p>Telephone: 0300 555 0333</p>
                  <p>Email: <a href="mailto:enquiries@legalombudsman.org.uk" className="text-[var(--accent)] underline">enquiries@legalombudsman.org.uk</a></p>
                  <p>Website: <a href="https://www.legalombudsman.org.uk" target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] underline">legalombudsman.org.uk</a></p>
                </div>
              </div>
            </div>
          </section>

          {/* Remedies & Invariant Guarantees */}
          <section id="remedies" className="space-y-4">
            <div className="flex items-center gap-2.5 text-lg font-semibold text-[var(--ink)]">
              <CheckCircle2 className="h-5 w-5 text-[var(--success)]" />
              <h2>Remedies and Corrective Action</h2>
            </div>
            <div className="space-y-3 text-[14px] leading-relaxed text-[var(--muted)]">
              <p>Where an investigation concludes that service fell below our standards, we can:</p>
              <ul className="list-inside list-disc space-y-1 pl-2 text-[var(--ink-soft)] text-[13px]">
                <li>Issue a formal written apology and comprehensive explanation;</li>
                <li>Provide verified cryptographic audit chain extracts to support tribunal relief applications;</li>
                <li>Arrange expedited re-analysis and evidence re-structuring by a senior legal specialist;</li>
                <li>Waive platform subscription fees or issue financial reimbursements where appropriate;</li>
                <li>Implement immediate software and rule-engine patches to prevent recurrence.</li>
              </ul>
            </div>
          </section>
        </div>
      </main>
      <Footer />
    </>
  );
}
