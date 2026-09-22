import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/layout/site-header";
import { Footer } from "@/components/layout/footer";
import { Shield, Lock, Eye, Trash2, Database, Scale, CheckCircle, FileText } from "lucide-react";

export const metadata: Metadata = {
  title: "Privacy Notice & UK GDPR Policy",
  description:
    "Comprehensive UK GDPR & Data Protection Act 2018 Privacy Notice explaining how LegalOS AI protects and processes personal and special-category data.",
};

export default function PrivacyPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[1100px] section-pad py-12 lg:py-16">
        <div className="space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--bg-elevated)] px-3 py-1 text-xs font-medium text-[var(--muted)]">
            <Shield className="h-3.5 w-3.5 text-[var(--success)]" />
            <span>UK GDPR & Data Protection Act 2018</span>
          </div>
          <h1 className="display text-[clamp(2.2rem,4vw,3.2rem)] tracking-tight text-[var(--ink)]">
            Privacy Notice & Data Governance
          </h1>
          <p className="text-[14px] text-[var(--muted)]">
            Last updated: September 2026 · Transparency by design for all clients, practitioners, and platform visitors
          </p>
        </div>

        {/* Privacy Commitment Hero Card */}
        <div className="mt-8 rounded-2xl border border-[var(--line-strong)] bg-[var(--bg-elevated)] p-6 sm:p-8 shadow-sm">
          <h2 className="text-xl font-semibold tracking-tight text-[var(--ink)]">
            Our Core Privacy Principle
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed text-[var(--muted)]">
            For individuals seeking asylum, protection, or justice, confidentiality is not an
            administrative compliance task — it is a matter of fundamental personal safety. LegalOS is
            engineered with strict zero-trust boundaries, zero third-party model training, and
            cryptographic accountability to ensure your legal material remains protected and in your
            control at all times.
          </p>
        </div>

        <div className="mt-12 space-y-12">
          {/* Section 1: Controller Info */}
          <section id="data-controller" className="space-y-4">
            <div className="flex items-center gap-2.5 text-lg font-semibold text-[var(--ink)]">
              <Database className="h-5 w-5 text-[var(--accent)]" />
              <h2>1. Data Controller & Data Protection Officer</h2>
            </div>
            <div className="space-y-3 text-[14px] leading-relaxed text-[var(--muted)]">
              <p>
                The Data Controller responsible for personal data processed through the LegalOS AI
                platform is <strong>LegalOS AI Ltd</strong>, registered in England and Wales.
              </p>
              <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-4 text-[13px] text-[var(--ink-soft)] space-y-1">
                <p><strong>Data Protection Officer (DPO):</strong> Compliance & Governance Directorate</p>
                <p><strong>Direct Privacy Contact:</strong> <a href="mailto:privacy@legalos.ai" className="text-[var(--accent)] underline">privacy@legalos.ai</a></p>
                <p><strong>Supervisory Authority:</strong> UK Information Commissioner&apos;s Office (ICO)</p>
              </div>
            </div>
          </section>

          {/* Section 2: Data Categories & Special Category Data */}
          <section id="data-categories" className="space-y-4">
            <div className="flex items-center gap-2.5 text-lg font-semibold text-[var(--ink)]">
              <FileText className="h-5 w-5 text-[var(--accent)]" />
              <h2>2. Personal & Special Category Data We Process</h2>
            </div>
            <div className="space-y-3 text-[14px] leading-relaxed text-[var(--muted)]">
              <p>
                Depending on your role (individual client, legal representative, or organization), we
                process the following categories of data:
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-[var(--line)] bg-[var(--bg-elevated)] p-4">
                  <h3 className="font-medium text-[var(--ink)] text-[14px]">Standard Personal Data</h3>
                  <ul className="mt-2 list-inside list-disc space-y-1 text-[13px] text-[var(--muted)]">
                    <li>Contact details (name, email, phone number)</li>
                    <li>Authentication & session tokens (<code className="font-mono">legalos_session</code>)</li>
                    <li>Home Office reference numbers and case identifiers</li>
                    <li>Chronological timeline records and evidence metadata</li>
                    <li>Communication records and platform inquiry notes</li>
                  </ul>
                </div>

                <div className="rounded-xl border border-[var(--line)] bg-[var(--bg-elevated)] p-4">
                  <h3 className="font-medium text-[var(--ink)] text-[14px]">Special Category Data (Art. 9)</h3>
                  <ul className="mt-2 list-inside list-disc space-y-1 text-[13px] text-[var(--muted)]">
                    <li>Racial and ethnic origin information</li>
                    <li>Religious or philosophical beliefs relevant to protection claims</li>
                    <li>Political opinions and human rights persecution grounds</li>
                    <li>Health, trauma, and psychological assessment evidence</li>
                    <li>Trafficking indicators and Modern Slavery referrals (NRM)</li>
                  </ul>
                </div>
              </div>
            </div>
          </section>

          {/* Section 3: Lawful Bases */}
          <section id="lawful-bases" className="space-y-4">
            <div className="flex items-center gap-2.5 text-lg font-semibold text-[var(--ink)]">
              <Scale className="h-5 w-5 text-[var(--accent)]" />
              <h2>3. Lawful Bases for Processing</h2>
            </div>
            <div className="space-y-3 text-[14px] leading-relaxed text-[var(--muted)]">
              <p>We process your data strictly under recognized legal bases under UK GDPR:</p>
              <ul className="list-inside list-disc space-y-1.5 pl-2 text-[var(--ink-soft)]">
                <li><strong>Article 6(1)(b) Contract:</strong> To deliver case management, document assembly, and evidence verification requested by you.</li>
                <li><strong>Article 6(1)(a) Consent:</strong> Explicit, event-logged consent for optional preferences, assistive voice interaction, and data sharing with external legal representatives.</li>
                <li><strong>Article 6(1)(c) Legal Obligation:</strong> To satisfy mandatory statutory requirements, including file retention obligations under the OISC Code of Standards.</li>
                <li><strong>Article 9(2)(f) Legal Claims:</strong> Processing special category data necessary for the establishment, exercise, or defence of legal claims and statutory tribunal appeals.</li>
              </ul>
            </div>
          </section>

          {/* Section 4: Data Subject Rights & Cryptographic Tombstoning */}
          <section id="your-rights" className="space-y-4">
            <div className="flex items-center gap-2.5 text-lg font-semibold text-[var(--ink)]">
              <Eye className="h-5 w-5 text-[var(--accent)]" />
              <h2>4. Your Rights under UK GDPR (Articles 15–22)</h2>
            </div>
            <div className="space-y-3 text-[14px] leading-relaxed text-[var(--muted)]">
              <p>You have statutory rights regarding your personal information:</p>
              <ul className="list-inside list-disc space-y-1 pl-2 text-[var(--ink-soft)]">
                <li><strong>Right of Access (SAR):</strong> Request a copy of all personal data held about you, provided within one month free of charge.</li>
                <li><strong>Right to Rectification:</strong> Request correction of inaccurate or incomplete case records.</li>
                <li><strong>Right to Data Portability:</strong> Export your evidence register and timeline in structured machine-readable formats (JSON/PDF).</li>
                <li><strong>Right to Restriction &amp; Objection:</strong> Object to specific processing or restrict access during disputes.</li>
              </ul>

              <div className="mt-4 rounded-xl border border-[var(--accent)]/20 bg-[var(--warm)]/40 p-5 space-y-2">
                <div className="flex items-center gap-2 font-medium text-[var(--ink)]">
                  <Trash2 className="h-4 w-4 text-[var(--danger)]" />
                  <span className="text-[14px]">Right to Erasure & Cryptographic Tombstoning</span>
                </div>
                <p className="text-[13px] leading-relaxed text-[var(--muted)]">
                  When you request erasure of your data, all case files, uploaded evidence documents,
                  OCR text extracts, AI conversations, and audio recordings are permanently and
                  irreversibly purged from our database. In order to preserve the cryptographic validity
                  of our append-only audit trail (required for regulatory auditing and proving that no
                  tampering occurred), the audit row is replaced with a structural <em>tombstone</em>:
                  all contents and PII are destroyed, leaving only the irreversible cryptographic hash to
                  confirm historical chain integrity without retaining any personal data.
                </p>
              </div>
            </div>
          </section>

          {/* Section 5: Retention */}
          <section id="retention" className="space-y-4">
            <div className="flex items-center gap-2.5 text-lg font-semibold text-[var(--ink)]">
              <Lock className="h-5 w-5 text-[var(--accent)]" />
              <h2>5. Data Retention Periods</h2>
            </div>
            <div className="space-y-3 text-[14px] leading-relaxed text-[var(--muted)]">
              <ul className="list-inside list-disc space-y-2 pl-2 text-[var(--ink-soft)]">
                <li>
                  <strong>Regulated Legal Casework:</strong> In strict compliance with the Commissioner&apos;s
                  Rules and OISC Code of Standards (Standard 14 & Rule 4), completed casework and evidence
                  records handled with qualified advisers are securely retained for a minimum of{" "}
                  <strong>6 years</strong> following file closure, after which they are systematically
                  scheduled for secure erasure.
                </li>
                <li>
                  <strong>Unrepresented Draft Workspaces:</strong> Unlinked drafts or preliminary client
                  notes are retained for 30 days of inactivity or deleted immediately upon client request.
                </li>
                <li>
                  <strong>System Telemetry & Audit Logs:</strong> Cryptographic audit logs are maintained
                  to verify security integrity and tamper-evidence.
                </li>
              </ul>
            </div>
          </section>

          {/* Section 6: Supervisory Authority */}
          <section id="supervisory-authority" className="space-y-4">
            <div className="flex items-center gap-2.5 text-lg font-semibold text-[var(--ink)]">
              <CheckCircle className="h-5 w-5 text-[var(--success)]" />
              <h2>6. Right to Lodge a Complaint with the ICO</h2>
            </div>
            <div className="space-y-3 text-[14px] leading-relaxed text-[var(--muted)]">
              <p>
                If you believe your data has been processed in breach of UK data protection laws, you
                have the statutory right to lodge a complaint directly with the UK supervisory authority:
              </p>
              <div className="rounded-xl border border-[var(--line)] bg-[var(--bg-elevated)] p-4 text-[13px] text-[var(--muted)] space-y-1">
                <p className="font-semibold text-[var(--ink)]">Information Commissioner&apos;s Office (ICO)</p>
                <p>Wycliffe House, Water Lane, Wilmslow, Cheshire SK9 5AF</p>
                <p>Helpline: 0303 123 1113 · Website: <a href="https://ico.org.uk" target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] underline">ico.org.uk</a></p>
              </div>
            </div>
          </section>
        </div>
      </main>
      <Footer />
    </>
  );
}
