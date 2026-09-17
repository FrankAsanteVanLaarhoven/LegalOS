import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, Shield } from "lucide-react";
import { SiteHeader } from "@/components/layout/site-header";
import { Footer } from "@/components/layout/footer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getAgentPage, getAllAgentSlugs, PREVIEW_AGENTS } from "@/lib/data/agent-pages";

export function generateStaticParams() {
  return getAllAgentSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const agent = getAgentPage(slug);
  return {
    title: agent ? agent.shortName : "Agent",
    description: agent?.summary,
  };
}

export default async function AgentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const agent = getAgentPage(slug);
  if (!agent) notFound();

  const idx = PREVIEW_AGENTS.findIndex((a) => a.slug === agent.slug);
  const prev = PREVIEW_AGENTS[(idx - 1 + PREVIEW_AGENTS.length) % PREVIEW_AGENTS.length];
  const next = PREVIEW_AGENTS[(idx + 1) % PREVIEW_AGENTS.length];

  return (
    <>
      <SiteHeader />
      <main className="flex-1 bg-[var(--bg)]">
        <div className="border-b border-[var(--line)] bg-[#111111] text-[#f5f3ee]">
          <div className="mx-auto max-w-[1400px] section-pad py-12 lg:py-16">
            <Link
              href="/#approach"
              className="inline-flex items-center gap-2 text-[13px] text-white/55 transition hover:text-white"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              All agents
            </Link>
            <p className="mt-8 text-[11px] font-medium uppercase tracking-[0.18em] text-white/45">
              Multi-agent system
            </p>
            <h1 className="display mt-3 text-[clamp(2.4rem,5vw,3.75rem)] tracking-tight text-white">
              {agent.shortName}
            </h1>
            <p className="mt-3 max-w-xl text-[17px] text-white/65">{agent.role}</p>
            <div className="mt-6 flex flex-wrap gap-2">
              <Badge tone="accent" className="border-white/20 text-white/90">
                {agent.name}
              </Badge>
              <Badge tone="neutral" className="border-white/15 text-white/70">
                Human-in-the-loop
              </Badge>
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-[1400px] section-pad py-14 lg:py-20">
          <div className="grid gap-12 lg:grid-cols-12">
            <div className="lg:col-span-7">
              <h2 className="text-[13px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
                What this agent does
              </h2>
              <p className="mt-4 text-[17px] leading-relaxed text-[var(--ink-soft)]">
                {agent.summary}
              </p>
              <ul className="mt-8 space-y-3">
                {agent.whatItDoes.map((item) => (
                  <li
                    key={item}
                    className="border-t border-[var(--line)] pt-3 text-[15px] leading-relaxed text-[var(--ink-soft)]"
                  >
                    {item}
                  </li>
                ))}
              </ul>

              <div className="mt-10 grid gap-8 sm:grid-cols-2">
                <div>
                  <h3 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
                    Inputs
                  </h3>
                  <ul className="mt-3 space-y-2 text-[14px] text-[var(--ink-soft)]">
                    {agent.inputs.map((i) => (
                      <li key={i}>· {i}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
                    Outputs
                  </h3>
                  <ul className="mt-3 space-y-2 text-[14px] text-[var(--ink-soft)]">
                    {agent.outputs.map((o) => (
                      <li key={o}>· {o}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            <aside className="lg:col-span-5">
              <div className="rounded-2xl border border-[var(--line)] bg-[var(--bg-elevated)] p-6">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
                    <Shield className="h-5 w-5" strokeWidth={1.75} />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold">Human gate</h3>
                    <p className="mt-2 text-[14px] leading-relaxed text-[var(--muted)]">
                      {agent.humanGate}
                    </p>
                  </div>
                </div>
                <div className="mt-6 flex flex-col gap-2">
                  <Link href={agent.demoHref}>
                    <Button variant="dark" className="w-full" size="lg">
                      Open in Mission Control
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </Link>
                  <Link href="/resources">
                    <Button variant="secondary" className="w-full" size="lg">
                      Public legal resources
                    </Button>
                  </Link>
                </div>
                <p className="mt-4 text-[12px] leading-relaxed text-[var(--muted)]">
                  Agents prepare and organise. They do not replace solicitors or guarantee outcomes.
                </p>
              </div>

              <div className="mt-6 flex items-center justify-between gap-3 text-[13px]">
                <Link
                  href={`/agents/${prev.slug}`}
                  className="text-[var(--muted)] transition hover:text-[var(--ink)]"
                >
                  ← {prev.shortName}
                </Link>
                <Link
                  href={`/agents/${next.slug}`}
                  className="text-[var(--muted)] transition hover:text-[var(--ink)]"
                >
                  {next.shortName} →
                </Link>
              </div>
            </aside>
          </div>

          <div className="mt-16 border-t border-[var(--line)] pt-10">
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
              All agents
            </h2>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {PREVIEW_AGENTS.map((a) => (
                <Link
                  key={a.slug}
                  href={`/agents/${a.slug}`}
                  className={`rounded-xl border px-4 py-3 text-sm transition ${
                    a.slug === agent.slug
                      ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                      : "border-[var(--line)] text-[var(--ink-soft)] hover:border-[var(--line-strong)] hover:text-[var(--ink)]"
                  }`}
                >
                  <div className="font-medium">{a.shortName}</div>
                  <div className="mt-0.5 text-[12px] opacity-70 line-clamp-1">{a.role}</div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
