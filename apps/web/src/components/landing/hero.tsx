"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { useApp } from "@/lib/app-context";
import { PLACEMENT } from "@/lib/media/videos";

export function Hero() {
  const { t, speak } = useApp();
  const videoRef = useRef<HTMLVideoElement>(null);
  /** Always the original Sudan displacement film — nowhere else on the site */
  const film = PLACEMENT.hero;

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = 0.88;
    const tryPlay = () => {
      v.play().catch(() => undefined);
    };
    tryPlay();
    v.addEventListener("loadeddata", tryPlay);
    return () => v.removeEventListener("loadeddata", tryPlay);
  }, []);

  return (
    <section
      className="relative overflow-hidden border-b border-[var(--line)]"
      data-section="hero"
      data-film={film.id}
    >
      <div className="absolute inset-0">
        <video
          key={film.src}
          ref={videoRef}
          className="absolute inset-0 h-full w-full scale-105 object-cover brightness-[1.08] contrast-[1.06]"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          poster={film.poster}
          aria-label={film.label}
        >
          <source src={`${film.src}?v=sudan-hero`} type="video/mp4" />
        </video>
        <div className="absolute inset-0 bg-[var(--bg)]/42 sm:bg-[var(--bg)]/35" />
        <div className="absolute inset-0 bg-gradient-to-r from-[var(--bg)]/90 via-[var(--bg)]/50 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg)]/75 via-transparent to-[var(--bg)]/20" />
      </div>

      <div className="relative mx-auto max-w-[1400px] section-pad">
        <div className="grid min-h-[90vh] items-end gap-12 pb-16 pt-20 lg:grid-cols-12 lg:pb-24 lg:pt-28">
          <div className="lg:col-span-8">
            <motion.p
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="eyebrow"
            >
              {t("hero.eyebrow")}
            </motion.p>

            <motion.h1
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
              className="display mt-7 max-w-[16ch] text-[clamp(2.75rem,7vw,5.5rem)] text-[var(--ink)] drop-shadow-sm"
            >
              {t("hero.title.a")}{" "}
              <em className="italic text-[var(--accent)]">{t("hero.title.b")}</em>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.12 }}
              className="mt-8 max-w-xl text-[17px] leading-[1.65] text-[var(--ink-soft)] sm:text-[18px]"
            >
              {t("hero.body")}
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="mt-10 flex flex-wrap items-center gap-3"
            >
              <Link href="/workspace/cases/case-sabinah-001">
                <Button size="lg" variant="dark">
                  {t("hero.cta.demo")}
                </Button>
              </Link>
              <Link href="/#stories">
                <Button size="lg" variant="secondary">
                  {t("hero.cta.stories")}
                </Button>
              </Link>
              <Button
                size="lg"
                variant="ghost"
                type="button"
                onClick={() => speak(t("section.explain.hero"))}
              >
                {t("nav.listen")}
              </Button>
            </motion.div>
          </div>

          <motion.aside
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="lg:col-span-4 lg:self-end"
          >
            <div className="rounded-sm border border-[var(--line)] bg-[var(--bg)]/88 p-5 shadow-sm backdrop-blur-md lg:border-0 lg:bg-[var(--bg)]/80 lg:p-0 lg:pl-8 lg:shadow-none lg:backdrop-blur-sm">
              <p className="eyebrow">{t("hero.aside.eyebrow")}</p>
              <p className="mt-3 display text-[1.45rem] leading-tight tracking-tight">
                {t("hero.aside.title")}
              </p>
              <p className="mt-3 text-[14px] leading-relaxed text-[var(--ink-soft)]">
                {t("hero.aside.body")}
              </p>
              <p className="mt-3 text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">
                Film: {film.label}
              </p>
              <Link
                href="/workspace/cases/case-sabinah-001"
                className="link-underline mt-6 inline-block text-[13px] font-medium text-[var(--ink)]"
              >
                {t("hero.aside.link")}
              </Link>
            </div>
          </motion.aside>
        </div>
      </div>
    </section>
  );
}
