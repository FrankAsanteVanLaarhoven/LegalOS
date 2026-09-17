"use client";

import { motion } from "framer-motion";
import { VideoMedia } from "@/components/ui/video-media";
import { useApp } from "@/lib/app-context";
import { PLACEMENT } from "@/lib/media/videos";

const pillars = [
  {
    title: "Case intelligence, not chatbots",
    description:
      "Every matter becomes a living workspace — chronology, evidence, deadlines, drafts, and solicitor review — grounded in the full journey.",
  },
  {
    title: "Evidence that connects",
    description:
      "Documents map to issues: medical letters, refusals, NRM decisions, employment records. Relationships stay searchable and explainable.",
  },
  {
    title: "Multilingual by design",
    description:
      "Speech and translation into solicitor-ready English — built for real access to justice, not only fluent users.",
  },
  {
    title: "Humans remain responsible",
    description:
      "Reserved legal activities stay with qualified professionals. AI prepares; solicitors approve; nothing important files itself.",
  },
];

export function Features() {
  const { t, speak } = useApp();
  return (
    <section id="platform" className="border-b border-[var(--line)] bg-[var(--bg)]">
      <div className="mx-auto max-w-[1400px] section-pad py-24 lg:py-32">
        <div className="grid gap-16 lg:grid-cols-12 lg:gap-10">
          <div className="lg:col-span-5">
            <p className="eyebrow">{t("platform.eyebrow")}</p>
            <h2 className="display mt-5 text-[clamp(2.1rem,4vw,3.4rem)] tracking-tight">
              {t("platform.title")}
            </h2>
            <p className="mt-6 max-w-md text-[16px] leading-relaxed text-[var(--muted)]">
              {t("platform.body")}
            </p>
            <button
              type="button"
              onClick={() => speak(t("section.explain.platform"))}
              className="mt-4 text-sm font-medium text-[var(--accent)] hover:underline"
            >
              {t("nav.listen")}
            </button>
          </div>

          <div className="lg:col-span-7">
            <VideoMedia
              src={PLACEMENT.features.src}
              poster={PLACEMENT.features.poster}
              className="aspect-[16/10] rounded-sm"
              label={PLACEMENT.features.label}
              veil="soft"
            />
          </div>
        </div>

        <div className="mt-20 grid gap-x-10 gap-y-14 sm:grid-cols-2">
          {pillars.map((item, i) => (
            <motion.div
              key={item.title}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ delay: i * 0.06, duration: 0.45 }}
              className="border-t border-[var(--line)] pt-6"
            >
              <h3 className="text-[17px] font-medium tracking-tight text-[var(--ink)]">
                {item.title}
              </h3>
              <p className="mt-3 max-w-md text-[15px] leading-relaxed text-[var(--muted)]">
                {item.description}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
