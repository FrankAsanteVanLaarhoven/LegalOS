"use client";

import { PageBackdrop } from "@/components/layout/page-backdrop";
import { VideoMedia } from "@/components/ui/video-media";
import { PLACEMENT } from "@/lib/media/videos";

const immigration = [
  "Student & Graduate",
  "Skilled Worker",
  "Sponsor Licence",
  "eVisa / BRP",
  "Right to Work",
  "ILR & Citizenship",
  "Asylum",
  "Humanitarian Protection",
  "NRM & VTS",
  "Family routes",
  "Appeals & Tribunals",
  "Judicial Review prep",
];

const employment = [
  "Share Codes",
  "Visa conditions",
  "Salary thresholds",
  "Certificate of Sponsorship",
  "Employer compliance",
  "Settlement pathways",
];

export function Coverage() {
  return (
    <section className="relative overflow-hidden border-b border-[var(--line)] bg-[var(--bg)]">
      {/* UK map — jurisdiction / UK immigration vertical */}
      <PageBackdrop id="uk-map-union" position="right" size="contain" />
      <div className="relative z-[1] mx-auto max-w-[1400px] section-pad py-24 lg:py-32">
        <div className="max-w-2xl">
          <p className="eyebrow">Initial vertical</p>
          <h2 className="display mt-5 text-[clamp(2.1rem,4vw,3.4rem)] tracking-tight">
            UK Immigration &amp; Protection
          </h2>
          <p className="mt-6 text-[16px] leading-relaxed text-[var(--muted)]">
            Depth over breadth. One serious vertical first — employment status and compliance sit
            beside protection pathways.
          </p>
        </div>

        <div className="mt-14 grid gap-6 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <VideoMedia
              src={PLACEMENT.coverageImmigration.src}
              poster={PLACEMENT.coverageImmigration.poster}
              className="aspect-[16/11] rounded-sm"
              label={PLACEMENT.coverageImmigration.label}
              veil="soft"
            />
          </div>
          <div className="flex flex-col justify-between gap-10 lg:col-span-5 lg:pl-4">
            <div>
              <h3 className="text-[13px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">
                Immigration engine
              </h3>
              <ul className="mt-5 space-y-0">
                {immigration.map((item) => (
                  <li
                    key={item}
                    className="border-b border-[var(--line)] py-3 text-[15px] text-[var(--ink-soft)]"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-16 grid gap-10 border-t border-[var(--line)] pt-14 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <VideoMedia
              src={PLACEMENT.coverageEmployment.src}
              poster={PLACEMENT.coverageEmployment.poster}
              className="aspect-video max-w-xl rounded-sm"
              label={PLACEMENT.coverageEmployment.label}
              veil="soft"
            />
          </div>
          <div className="lg:col-span-6 lg:col-start-7">
            <h3 className="text-[13px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">
              Employment engine
            </h3>
            <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-[var(--muted)]">
              For universities, sponsors, HR teams, and relocation providers managing mixed
              immigration–employment portfolios — and for individuals balancing work rights with the
              cost of living.
            </p>
            <div className="mt-8 flex flex-wrap gap-x-3 gap-y-2">
              {employment.map((item) => (
                <span
                  key={item}
                  className="border border-[var(--line-strong)] px-3 py-1.5 text-[13px] text-[var(--ink-soft)]"
                >
                  {item}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
