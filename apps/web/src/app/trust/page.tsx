import type { Metadata } from "next";
import Link from "next/link";

import { SiteHeader } from "@/components/layout/site-header";
import { Footer } from "@/components/layout/footer";
import { Badge } from "@/components/ui/badge";
import { belowTargetCapabilities, platformStatus } from "@/lib/capabilities";
import { evidenceTone, maturityTone } from "@/lib/capability-display";

export const metadata: Metadata = {
  title: "Platform trust",
  description:
    "What LegalOS has actually implemented, what is configured, and what is not — derived from checks rather than declared.",
};

/**
 * Platform trust dashboard.
 *
 * Every row is computed by @legalos/capabilities from checks against the
 * running system. A capability cannot appear here at a higher maturity than its
 * checks support, which is what stops this page becoming the same kind of
 * marketing surface it exists to replace.
 */
export default async function TrustPage() {
  const statuses = await platformStatus();
  const belowTarget = await belowTargetCapabilities();

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[1400px] section-pad py-12 lg:py-16">
        <p className="eyebrow">Transparency</p>
        <h1 className="display mt-4 max-w-3xl text-[clamp(2.2rem,4vw,3.4rem)] tracking-tight">
          Platform trust
        </h1>
        <p className="mt-5 max-w-2xl text-[16px] leading-relaxed text-[var(--muted)]">
          What is implemented, what is configured, and what is not. Every status below is derived
          from checks against this running instance — none of it is typed in by hand. Where a
          capability claims more than its checks support, it is listed as overstated rather than
          shown at the claimed level.
        </p>

        <p className="mt-5 text-[14px]">
          <Link className="underline underline-offset-4" href="/trust/agents">
            Agent governance
          </Link>
          <span className="text-[var(--muted)]"> · </span>
          <Link className="underline underline-offset-4" href="/trust/research">
            Research record
          </Link>
          <span className="text-[var(--muted)]">
            {" "}
            — every agent, what it may do, which of its invariants hold, and what it has actually
            done.
          </span>
        </p>

        <div className="mt-4 rounded-2xl border border-[var(--line)] bg-[var(--bg-elevated)] px-4 py-3 text-[13px] leading-relaxed text-[var(--muted)]">
          <strong className="font-medium text-[var(--ink)]">Reading the levels.</strong> Two axes,
          because they answer different questions.{" "}
          <strong className="font-medium text-[var(--ink)]">Implementation</strong> runs prototype →
          implemented → operational → verified → certified: is it built and can it run.{" "}
          <strong className="font-medium text-[var(--ink)]">Evidence</strong> runs none → internal
          tests → benchmark validated → external audit → production telemetry: what grounds there
          are for believing it works. A subsystem can be fully operational on nothing but its own
          unit tests, and that is a much weaker claim than it looks — so evidence never renders in
          green, and only <em>verified</em> implementation and above does.
        </div>

        <div className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--bg-elevated)] px-4 py-3 text-[13px] leading-relaxed">
          <strong className="font-semibold text-[var(--ink)]">
            Nothing on this page is claimed — every level is measured.
          </strong>{" "}
          <span className="text-[var(--muted)]">
            Observations are taken from the running system: files on disk, database queries where a
            connection exists, benchmark reports where one has been produced. A check that cannot be
            measured fails closed and says so, rather than passing. Overclaiming is therefore not
            prevented by review but by construction —{" "}
            {belowTarget.length > 0
              ? `${belowTarget.length} of ${statuses.length} capabilities are below the level they are built towards, and each says what would close the gap.`
              : "every capability is at its target level."}
          </span>
        </div>

        <div className="mt-8 space-y-3">
          {statuses.map((status) => (
            <article
              key={status.id}
              className="rounded-2xl border border-[var(--line)] bg-[var(--bg)] px-5 py-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="max-w-2xl">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-[15px] font-semibold tracking-tight">{status.name}</h2>
                    {status.unmeasured.length > 0 && (
                      <Badge tone="neutral">{status.unmeasured.length} unmeasured</Badge>
                    )}
                  </div>
                  <p className="mt-1 text-[13px] leading-relaxed text-[var(--muted)]">
                    {status.description}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  <Badge tone={maturityTone(status.implementation)}>{status.implementation}</Badge>
                  <Badge tone={evidenceTone(status.evidence)}>
                    evidence: {status.evidence.replace(/_/g, " ")}
                  </Badge>
                </div>
              </div>

              {status.nextAction && (
                <p className="mt-3 rounded-xl border border-[var(--line)] bg-[var(--bg-elevated)] px-3 py-2 text-[12px] leading-relaxed">
                  <span className="font-semibold text-[var(--ink)]">Next action</span>{" "}
                  <span className="text-[var(--muted)]">— {status.nextAction}</span>
                </p>
              )}

              <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
                {status.checks.map((check) => (
                  <li key={check.id} className="flex items-start gap-2 text-[12px] leading-relaxed">
                    <span
                      aria-hidden
                      className={
                        check.satisfied
                          ? "mt-[3px] h-2 w-2 shrink-0 rounded-full bg-emerald-500"
                          : "mt-[3px] h-2 w-2 shrink-0 rounded-full bg-amber-500"
                      }
                    />
                    <span className={check.satisfied ? "" : "text-amber-900"}>
                      <span className="font-medium">{check.label}</span>
                      <span className="sr-only">
                        {check.satisfied ? " — passing" : " — not satisfied"}
                      </span>
                      {!check.satisfied && check.detail && <> — {check.detail}</>}
                    </span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>

        <p className="mt-8 max-w-2xl text-[13px] leading-relaxed text-[var(--muted)]">
          This page reflects the instance you are looking at. A capability that depends on
          configuration — a database, a model key, an ingested corpus — will read differently in an
          environment where that configuration is present.
        </p>
      </main>
      <Footer />
    </>
  );
}
