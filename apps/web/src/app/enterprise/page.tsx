import Link from "next/link";
import { SiteHeader } from "@/components/layout/site-header";
import { Footer } from "@/components/layout/footer";
import { PageBackdrop } from "@/components/layout/page-backdrop";
import { Button } from "@/components/ui/button";
import { VideoMedia } from "@/components/ui/video-media";
import { RepsCarousel } from "@/components/enterprise/reps-carousel";
import { PLACEMENT } from "@/lib/media/videos";

/*
 * These are the operational measures the platform is built to report. The
 * values were invented — "Solicitor acceptance rate 86%" in particular is a
 * safety claim (that regulated professionals approve 86% of this system's
 * output) with nothing behind it, printed at 2.5rem directly under copy
 * promising "measured numbers, not slogans".
 *
 * They stay as labels with no value until telemetry exists to fill them.
 */
const metrics = [
  { label: "Active cases", value: null },
  { label: "Evidence completeness (avg)", value: null },
  { label: "AI drafts awaiting review", value: null },
  { label: "Deadlines this week", value: null },
  { label: "Solicitor acceptance rate", value: null },
  { label: "Languages in use", value: null },
];

const tiers = [
  { name: "Individual", desc: "Guided case organisation and multilingual access" },
  { name: "Legal Aid / NGO", desc: "Caseload tools for protection and trafficking support" },
  { name: "Law Firm", desc: "Review queues, audit logs, firm knowledge packs" },
  { name: "University / Employer", desc: "Status pathways, RTW and sponsor compliance" },
  { name: "Enterprise / Government", desc: "SSO, residency controls, custom policy corpus" },
];

export const metadata = {
  title: "Enterprise",
};

export default function EnterprisePage() {
  return (
    <>
      <SiteHeader />
      <main className="relative flex-1 overflow-hidden">
        {/* Crown + Union Jack — institutional / firm & government posture */}
        <PageBackdrop id="union-jack-crown" position="right" size="contain" />
        <section className="relative z-[1] border-b border-[var(--line)]">
          <div className="mx-auto max-w-[1400px] section-pad py-20 lg:py-28">
            <div className="grid gap-12 lg:grid-cols-12">
              <div className="lg:col-span-7">
                <p className="eyebrow">Enterprise</p>
                <h1 className="display mt-5 max-w-xl text-[clamp(2.4rem,5vw,4rem)] tracking-tight">
                  Operations for legal teams at scale
                </h1>
                <p className="mt-6 max-w-lg text-[17px] leading-relaxed text-[var(--muted)]">
                  Analytics for case status, evidence completeness, solicitor workload, and
                  compliance. Nothing is guaranteed. Regulated representatives join to deliver
                  faster, domain-expert services with human approval gates.
                </p>
                <div className="mt-9 flex flex-wrap gap-3">
                  <Link href="/workspace/cases/case-sabinah-001">
                    <Button size="lg" variant="dark">
                      View demo case
                    </Button>
                  </Link>
                  <Link href="/resources">
                    <Button size="lg" variant="secondary">
                      Public legal resources
                    </Button>
                  </Link>
                </div>
              </div>
              <div className="lg:col-span-5">
                <VideoMedia
                  src={PLACEMENT.enterpriseHero.src}
                  poster={PLACEMENT.enterpriseHero.poster}
                  className="aspect-[4/3] rounded-sm"
                  label={PLACEMENT.enterpriseHero.label}
                  veil="soft"
                />
              </div>
            </div>
          </div>
        </section>

        <section
          id="representatives"
          className="relative z-[1] border-b border-[var(--line)] bg-[var(--bg-elevated)]/95"
        >
          <div className="mx-auto max-w-[1400px] section-pad py-16 lg:py-20">
            <p className="eyebrow">Partners</p>
            <h2 className="display mt-4 max-w-2xl text-[clamp(1.8rem,3vw,2.6rem)] tracking-tight">
              Legal representatives on LegalOS
            </h2>
            <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-[var(--muted)]">
              Solicitors, barristers, and IAA-regulated advisers join as enterprise partners for
              productive services in their expertise domain. AI prepares; they approve. Scroll the
              infinite reel — pause or click any card for the full profile. Verify live regulation
              on the SRA, IAA, or BSB registers.
            </p>
            <div className="mt-10">
              <RepsCarousel />
            </div>
          </div>
        </section>

        <section className="relative z-[1] border-b border-[var(--line)] bg-[var(--bg)]/95">
          <div className="mx-auto max-w-[1400px] section-pad py-16">
            <p className="eyebrow">Operational measures — awaiting live telemetry</p>
            <div className="mt-8 grid gap-0 sm:grid-cols-2 lg:grid-cols-3">
              {metrics.map((m, i) => (
                <div
                  key={m.label}
                  className={`border-t border-[var(--line)] py-7 ${
                    i % 2 === 1 ? "sm:pl-8" : "sm:pr-8"
                  }`}
                >
                  <div className="display text-[2.5rem] tracking-tight text-[var(--muted)]">
                    {m.value ?? "—"}
                  </div>
                  <div className="mt-2 text-[14px] text-[var(--muted)]">{m.label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="relative z-[1] border-b border-[var(--line)] bg-[var(--warm)]">
          <div className="mx-auto max-w-[1400px] section-pad py-16 lg:py-20">
            <div className="grid gap-10 lg:grid-cols-12 lg:items-center">
              <div className="lg:col-span-5">
                <VideoMedia
                  src={PLACEMENT.enterpriseLower.src}
                  poster={PLACEMENT.enterpriseLower.poster}
                  className="aspect-video rounded-sm"
                  label={PLACEMENT.enterpriseLower.label}
                  veil="soft"
                />
              </div>
              <div className="lg:col-span-6 lg:col-start-7">
                <h2 className="display text-[clamp(1.8rem,3vw,2.5rem)] tracking-tight">
                  How organisations use LegalOS
                </h2>
                <div className="mt-8 grid gap-0 sm:grid-cols-2">
                  {tiers.map((tier) => (
                    <div key={tier.name} className="border-t border-[var(--line)] py-6 sm:pr-6">
                      <div className="text-[15px] font-medium">{tier.name}</div>
                      <p className="mt-2 text-[14px] leading-relaxed text-[var(--muted)]">
                        {tier.desc}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
