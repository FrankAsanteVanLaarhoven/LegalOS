"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { VideoMedia } from "@/components/ui/video-media";
import { useApp } from "@/lib/app-context";
import { PLACEMENT } from "@/lib/media/videos";

export function CTA() {
  const { t } = useApp();
  return (
    <section className="border-b border-[var(--line)] bg-[var(--bg)]">
      <div className="mx-auto max-w-[1400px] section-pad py-16 lg:py-24">
        <div className="grid overflow-hidden rounded-sm bg-[#0c0c0c] lg:grid-cols-12">
          <div className="relative min-h-[240px] lg:col-span-5 lg:min-h-full">
            <VideoMedia
              src={PLACEMENT.cta.src}
              poster={PLACEMENT.cta.poster}
              className="absolute inset-0 h-full w-full rounded-none"
              label={PLACEMENT.cta.label}
              veil="strong"
            />
          </div>
          <div className="px-8 py-14 sm:px-12 lg:col-span-7 lg:px-14 lg:py-20">
            <p className="text-[12px] font-semibold uppercase tracking-[0.2em] text-[#f5f3ee]">
              {t("cta.demo")}
            </p>
            <h2 className="display mt-5 max-w-xl text-[clamp(2.15rem,4.2vw,3.25rem)] text-white">
              {t("cta.title")}
            </h2>
            <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-[#ebe7df] sm:text-[18px]">
              {t("cta.body")}
            </p>
            <div className="mt-11 flex flex-wrap gap-3">
              <Link href="/workspace/cases/case-sabinah-001">
                <Button
                  size="lg"
                  className="bg-white text-[#0c0c0c] hover:bg-[#f5f2eb] hover:text-[#0c0c0c]"
                >
                  {t("cta.launch")}
                </Button>
              </Link>
              <Link href="/enterprise">
                <Button
                  size="lg"
                  className="border-2 border-white bg-transparent text-white hover:bg-white hover:text-[#0c0c0c]"
                >
                  {t("cta.enterprise")}
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
