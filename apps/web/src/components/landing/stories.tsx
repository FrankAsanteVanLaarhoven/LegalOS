"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { VideoMedia } from "@/components/ui/video-media";
import { useApp } from "@/lib/app-context";
import { PLACEMENT } from "@/lib/media/videos";

const stories = [
  {
    id: "asylum",
    eyebrow: "Protection",
    title: "When home is no longer safe",
    body: "Asylum is not a theory. It is sleepless nights, heavy silence, and a system that asks for proof of pain. LegalOS helps people gather chronology, evidence, and drafts — while solicitors stay responsible for advice and filings.",
    video: PLACEMENT.storyAsylum,
    tag: "Asylum · Human rights",
  },
  {
    id: "work",
    eyebrow: "Work & status",
    title: "Papers on the table. Future on the line.",
    body: "Right to work, visa conditions, sponsor rules, and letters that decide whether you can keep your job. We map documents to issues so nothing critical is missed — and nothing is overclaimed.",
    video: PLACEMENT.storyWork,
    tag: "Employment · Right to Work",
  },
  {
    id: "finance",
    eyebrow: "Money & pressure",
    title: "The quiet arithmetic of staying afloat",
    body: "Rent, fees, remittances, legal costs. Financial strain sits inside almost every immigration story. The platform treats it as part of the case — not a side note.",
    video: PLACEMENT.storyFinance,
    tag: "Financial burden · Access to justice",
  },
  {
    id: "study",
    eyebrow: "Students",
    title: "Study hard. Work the hours. Watch the clock.",
    body: "Student and Graduate routes, switching, CAS, and the fear of falling out of status. LegalOS is built for universities, sponsors, and young people carrying both ambition and risk.",
    video: PLACEMENT.storyStudent,
    tag: "Student · Graduate · PSW",
  },
  {
    id: "family",
    eyebrow: "Family",
    title: "When the whole household is waiting",
    body: "Parents, partners, and children share one case file in practice — even when the forms treat them as separate. LegalOS keeps the family timeline, evidence, and applications connected.",
    video: PLACEMENT.storyFamily,
    tag: "Family visas · Uncertainty",
  },
  {
    id: "crossing",
    eyebrow: "Crossing",
    title: "The journey itself is part of the case",
    body: "How someone arrives shapes credibility, evidence, and risk. Chronology and country context matter. LegalOS holds that whole arc without reducing a person to a single form.",
    video: PLACEMENT.storyCrossing,
    tag: "Journey · Displacement · Chronology",
  },
];

export function Stories() {
  const { t, speak } = useApp();
  return (
    <section id="stories" className="border-b border-[var(--line)] bg-[var(--bg)]">
      <div className="mx-auto max-w-[1400px] section-pad py-24 lg:py-32">
        <div className="max-w-2xl">
          <p className="eyebrow">{t("stories.eyebrow")}</p>
          <h2 className="display mt-5 text-[clamp(2.1rem,4vw,3.4rem)] tracking-tight">
            {t("stories.title")}
          </h2>
          <p className="mt-6 text-[16px] leading-relaxed text-[var(--muted)]">
            {t("stories.body")}
          </p>
          <button
            type="button"
            onClick={() => speak(t("section.explain.stories"))}
            className="mt-4 text-sm font-medium text-[var(--accent)] hover:underline"
          >
            {t("nav.listen")}
          </button>
        </div>

        <div className="mt-16 space-y-20 lg:space-y-28">
          {stories.map((story, i) => {
            const reverse = i % 2 === 1;
            return (
              <motion.article
                key={story.id}
                data-film={story.video.id}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={{ duration: 0.5 }}
                className="grid items-center gap-8 lg:grid-cols-12 lg:gap-12"
              >
                <div className={`lg:col-span-7 ${reverse ? "lg:order-2" : ""}`}>
                  <VideoMedia
                    src={story.video.src}
                    poster={story.video.poster}
                    className="aspect-[16/10] rounded-sm"
                    label={story.video.label}
                    veil="soft"
                  />
                </div>
                <div className={`lg:col-span-5 ${reverse ? "lg:order-1" : ""}`}>
                  <p className="eyebrow">{story.eyebrow}</p>
                  <h3 className="display mt-4 text-[clamp(1.6rem,2.5vw,2.15rem)] tracking-tight">
                    {story.title}
                  </h3>
                  <p className="mt-4 text-[15px] leading-relaxed text-[var(--muted)]">
                    {story.body}
                  </p>
                  <p className="mt-5 text-[12px] font-medium uppercase tracking-[0.14em] text-[var(--accent)]">
                    {story.tag}
                  </p>
                </div>
              </motion.article>
            );
          })}
        </div>

        <div className="mt-20 border-t border-[var(--line)] pt-10">
          <p className="text-[14px] text-[var(--muted)]">
            Demo matter:{" "}
            <Link
              href="/workspace/cases/case-sabinah-001"
              className="link-underline font-medium text-[var(--ink)]"
            >
              Sabinah Mamood · LOS-2026-00481
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}
