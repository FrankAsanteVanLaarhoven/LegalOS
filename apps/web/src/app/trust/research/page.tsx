import type { Metadata } from "next";

import { SiteHeader } from "@/components/layout/site-header";
import { Footer } from "@/components/layout/footer";
import { Badge } from "@/components/ui/badge";
import { capabilityLevels, researchArtefacts } from "@/lib/research-artefacts";

export const metadata: Metadata = {
  title: "Research record",
  description:
    "The invariants, claims, falsification records and decisions behind this platform, read from the repository.",
};

/**
 * The research record.
 *
 * A system asking to be trusted should let a reader inspect what it got wrong,
 * not only what it does. The falsification section below is a catalogue of
 * checks that were deliberately broken to prove they could fail — including
 * several that turned out to be checking nothing at the time.
 *
 * Everything here is read from the repository when the page is requested. None
 * of it is stored, because a cached copy would show the state of a moment that
 * has passed.
 */
export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, "success" | "danger" | "warning" | "neutral"> = {
  satisfied: "success",
  failed: "danger",
  unfalsified: "warning",
  unmeasured: "warning",
  blocked: "warning",
  no_observer: "neutral",
};

export default async function ResearchPage() {
  const { invariants, claims, falsifications, decisions, debt } = await researchArtefacts();
  const levels = await capabilityLevels();

  const byType = (type: string) => claims.filter((c) => c.type === type);
  const counts = Object.fromEntries(
    ["satisfied", "failed", "unfalsified", "unmeasured", "blocked", "no_observer"].map((s) => [
      s,
      invariants.filter((i) => i.status === s).length,
    ])
  );

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[1400px] section-pad py-12 lg:py-16">
        <p className="eyebrow">Transparency</p>
        <h1 className="display mt-4 max-w-3xl text-[clamp(2.2rem,4vw,3.4rem)] tracking-tight">
          Research record
        </h1>
        <p className="mt-5 max-w-3xl text-[16px] leading-relaxed text-[var(--muted)]">
          The properties this platform states, the claims it makes, the checks that were
          deliberately broken to prove they could fail, and the decisions taken along the way. Read
          from the repository when you load this page — none of it is entered by hand, and several
          entries record the platform being wrong about itself.
        </p>

        {/* Claims, split by the kind of evidence behind them. */}
        <section className="mt-12">
          <h2 className="text-[20px] font-medium">Claims</h2>
          <p className="mt-2 max-w-2xl text-[14px] text-[var(--muted)]">
            Engineering, scientific and operational evidence are different kinds. Mixing them is how
            an architecture gets mistaken for a result, so each claim is typed and a claim above its
            evidence fails the build.
          </p>
          <div className="mt-4 grid gap-6 lg:grid-cols-3">
            {(["engineering", "scientific", "operational"] as const).map((type) => {
              const group = byType(type);
              const supported = group.filter((c) => c.supported).length;
              return (
                <div key={type} className="rounded-lg border border-[var(--line)] p-4">
                  <h3 className="text-[15px] font-medium capitalize">{type}</h3>
                  <p className="mt-1 text-[13px] text-[var(--muted)]">
                    {supported} supported of {group.length}
                  </p>
                  <ul className="mt-3 space-y-2 text-[13px]">
                    {group.map((claim) => (
                      <li key={claim.claim} className="flex gap-2">
                        <span
                          aria-hidden
                          className={
                            claim.supported ? "text-[var(--success)]" : "text-[var(--muted)]"
                          }
                        >
                          {claim.supported ? "✓" : "·"}
                        </span>
                        <span>
                          {claim.claim}
                          <span className="block text-[var(--muted)]">{claim.evidence}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </section>

        {/* Falsification: the record of this platform being wrong about itself. */}
        <section className="mt-12">
          <h2 className="text-[20px] font-medium">Falsification records</h2>
          <p className="mt-2 max-w-3xl text-[14px] text-[var(--muted)]">
            A check only ever observed passing is indistinguishable from one that cannot fail. Each
            record below names a deliberate mutation and what the check then reported. Several were
            written after discovering the check was measuring nothing at the time.
          </p>
          <ul className="mt-4 space-y-3">
            {falsifications.map((record) => (
              <li key={record.observationId} className="rounded-lg border border-[var(--line)] p-4">
                <p className="text-[14px] font-medium">{record.observationId}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-[var(--muted)]">
                  {record.mutation}
                </p>
                <p className="mt-2 text-[12px] text-[var(--muted)]">
                  {record.commit ? `${record.commit.slice(0, 8)} · ` : ""}
                  {record.performedBy}
                </p>
              </li>
            ))}
          </ul>
        </section>

        {/* Invariants, with the uncomfortable distribution shown rather than summarised away. */}
        <section className="mt-12">
          <h2 className="text-[20px] font-medium">Invariants</h2>
          <p className="mt-2 text-[14px] text-[var(--muted)]">
            {invariants.length} stated ·{" "}
            {Object.entries(counts)
              .filter(([, n]) => n > 0)
              .map(([status, n]) => `${n} ${status.replace(/_/g, " ")}`)
              .join(" · ")}
          </p>
          <ul className="mt-4 grid gap-2 lg:grid-cols-2">
            {invariants.map((invariant) => (
              <li key={invariant.id} className="flex items-start gap-3 text-[13px]">
                <Badge tone={STATUS_TONE[invariant.status] ?? "neutral"}>{invariant.status}</Badge>
                <span>
                  <span className="text-[var(--muted)]">{invariant.id}</span> {invariant.title}
                  {invariant.status !== "satisfied" ? (
                    <span className="block text-[var(--muted)]">{invariant.nextAction}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-12 grid gap-8 lg:grid-cols-2">
          <div>
            <h2 className="text-[20px] font-medium">Verification debt</h2>
            <p className="mt-2 text-[14px] text-[var(--muted)]">
              Stated properties minus demonstrated ones. An integer, so it cannot be improved by
              declaring more.
            </p>
            <ul className="mt-4 divide-y divide-[var(--line)]">
              {[...debt]
                .sort((a, b) => b.stated - b.satisfied - (a.stated - a.satisfied))
                .map((row) => (
                  <li key={row.capability} className="flex justify-between py-2 text-[14px]">
                    <span>{row.capability.replace(/_/g, " ")}</span>
                    <span className="tabular-nums text-[var(--muted)]">
                      {row.satisfied}/{row.stated} · debt {row.stated - row.satisfied}
                    </span>
                  </li>
                ))}
            </ul>
          </div>

          <div>
            <h2 className="text-[20px] font-medium">Capability levels</h2>
            <p className="mt-2 text-[14px] text-[var(--muted)]">
              Derived from observations taken now. Nothing raises a level by being edited.
            </p>
            <ul className="mt-4 divide-y divide-[var(--line)]">
              {levels.map((level) => (
                <li key={level.id} className="flex justify-between py-2 text-[14px]">
                  <span>{level.id.replace(/_/g, " ")}</span>
                  <span className="text-[var(--muted)]">
                    {level.implementation} · {level.evidence.replace(/_/g, " ")}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mt-12">
          <h2 className="text-[20px] font-medium">Decisions</h2>
          <ul className="mt-4 divide-y divide-[var(--line)]">
            {decisions.map((decision) => (
              <li key={decision.id} className="flex flex-wrap gap-3 py-2 text-[14px]">
                <span className="text-[var(--muted)]">{decision.id}</span>
                <span>{decision.title}</span>
                <span className="text-[var(--muted)]">{decision.status}</span>
              </li>
            ))}
          </ul>
          {decisions.length === 0 ? (
            <p className="mt-2 text-[14px] text-[var(--muted)]">No decision records.</p>
          ) : null}
        </section>
      </main>
      <Footer />
    </>
  );
}
