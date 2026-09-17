"use client";

import Image from "next/image";
import { PageBackdrop } from "@/components/layout/page-backdrop";
import { useApp } from "@/lib/app-context";

const items = [
  {
    title: "Transparent by design",
    body: "We show our working: evidence used, law and policy cited, alternatives and gaps named, and what could not be verified stated plainly. No confidence percentages — there is no calibrated basis for one. No black-box claims.",
  },
  {
    title: "Earned through the work",
    body: "Nothing in life is guaranteed — not outcomes, visas, or appeals. Trustworthiness comes from careful process, human review, and the quality of what we deliver.",
  },
  {
    title: "Shown in the numbers",
    body: "Platform metrics matter: evidence completeness, review acceptance, deadlines met, time saved, and solicitor feedback — measured openly, not promised lightly.",
  },
  {
    title: "Human gates, clear limits",
    body: "AI → legal reviewer → solicitor → client → submission. Reserved legal work stays with qualified professionals. We never claim to be a solicitor.",
  },
];

export function Security() {
  const { t, speak } = useApp();
  return (
    <section
      id="security"
      className="relative overflow-hidden border-b border-[var(--line)] bg-[var(--warm)]"
    >
      {/* Soft Union Jack wave — UK public trust / transparency */}
      <PageBackdrop id="union-jack-wave" position="center" size="cover" />
      <div className="relative z-[1] mx-auto max-w-[1400px] section-pad py-24 lg:py-28">
        <div className="grid gap-12 lg:grid-cols-12 lg:items-end">
          <div className="max-w-2xl lg:col-span-7">
            <p className="eyebrow">{t("transparency.eyebrow")}</p>
            <h2 className="display mt-5 text-[clamp(2.1rem,4vw,3.25rem)] tracking-tight">
              {t("transparency.title")}
            </h2>
            <p className="mt-6 text-[16px] leading-relaxed text-[var(--muted)]">
              {t("transparency.body")}
            </p>
            <button
              type="button"
              onClick={() => speak(t("section.explain.transparency"))}
              className="mt-4 text-sm font-medium text-[var(--accent)] hover:underline"
            >
              {t("nav.listen")}
            </button>
          </div>
          <div className="lg:col-span-5">
            <div className="photo-frame relative aspect-video overflow-hidden rounded-sm">
              <Image
                src="/images/feature-documents.jpg"
                alt="Quiet document review — careful, transparent process"
                fill
                className="object-cover"
                sizes="(max-width: 1024px) 100vw, 40vw"
              />
            </div>
          </div>
        </div>
        <div className="mt-16 grid gap-0 sm:grid-cols-2">
          {items.map((item, i) => (
            <div
              key={item.title}
              className={`border-t border-[var(--ink)]/10 py-8 sm:pr-10 ${
                i % 2 === 1 ? "sm:pl-10 sm:border-l" : ""
              }`}
            >
              <h3 className="text-[16px] font-medium tracking-tight">{item.title}</h3>
              <p className="mt-3 max-w-sm text-[15px] leading-relaxed text-[var(--muted)]">
                {item.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
