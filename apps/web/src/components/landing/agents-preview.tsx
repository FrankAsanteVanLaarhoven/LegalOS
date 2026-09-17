"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";
import { VideoMedia } from "@/components/ui/video-media";
import { PREVIEW_AGENTS } from "@/lib/data/agent-pages";
import { PLACEMENT } from "@/lib/media/videos";

export function AgentsPreview() {
  return (
    <section id="approach" className="border-b border-[var(--line)] bg-[#111111] text-[#f5f3ee]">
      <div className="mx-auto max-w-[1400px] section-pad py-24 lg:py-32">
        <div className="grid gap-14 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/45">
              Multi-agent system
            </p>
            <h2 className="display mt-5 text-[clamp(2.1rem,4vw,3.25rem)] text-white">
              Specialists that collaborate under supervision
            </h2>
            <p className="mt-6 max-w-md text-[16px] leading-relaxed text-white/60">
              Uncertainty is real — waiting, fear, and unanswered letters. Agents narrow the work.
              Humans keep the judgment. Transparency is the default. Click any agent to open its
              workspace page.
            </p>

            <div className="mt-10 max-w-sm">
              <VideoMedia
                src={PLACEMENT.agents.src}
                poster={PLACEMENT.agents.poster}
                className="aspect-[4/5] rounded-sm"
                label={PLACEMENT.agents.label}
                veil="bottom"
              />
              <p className="mt-3 text-[12px] text-white/45">
                Waiting is part of the system. Our job is clarity — not false comfort.
              </p>
            </div>
          </div>

          <div className="lg:col-span-7">
            <div className="grid gap-0 sm:grid-cols-2">
              {PREVIEW_AGENTS.map((agent, i) => (
                <motion.div
                  key={agent.slug}
                  initial={{ opacity: 0, y: 10 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: Math.min(i * 0.04, 0.28) }}
                >
                  <Link
                    href={`/agents/${agent.slug}`}
                    className="group flex h-full flex-col border-t border-white/10 py-7 transition sm:odd:pr-8 sm:even:border-l sm:even:pl-8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="text-[15px] font-medium tracking-tight text-white transition group-hover:text-white">
                        {agent.shortName}
                      </div>
                      <ArrowUpRight className="h-4 w-4 shrink-0 text-white/30 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-white/80" />
                    </div>
                    <p className="mt-2 text-[14px] leading-relaxed text-white/50 transition group-hover:text-white/70">
                      {agent.role}
                    </p>
                    <span className="mt-3 text-[11px] font-medium uppercase tracking-[0.12em] text-white/0 transition group-hover:text-white/45">
                      Open agent →
                    </span>
                  </Link>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
