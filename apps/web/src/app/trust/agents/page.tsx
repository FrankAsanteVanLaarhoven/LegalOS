import type { Metadata } from "next";

import { SiteHeader } from "@/components/layout/site-header";
import { Footer } from "@/components/layout/footer";
import { Badge } from "@/components/ui/badge";
import {
  agentGovernance,
  byDebt,
  byDepartment,
  type AgentGovernance,
} from "@/lib/agent-governance";

export const metadata: Metadata = {
  title: "Agent governance",
  description:
    "Every agent the platform has, what it is permitted to do, which of its invariants hold, and what it has actually done.",
};

/**
 * Agent governance.
 *
 * Three things this page keeps apart, because conflating them is how a system
 * comes to look more capable than it is:
 *
 *   Definition   what the registry declares. Fixed, and real today.
 *   Capability   which of its invariants hold. Derived, and measured today.
 *   Operation    what it has actually done. Derived, and currently zero.
 *
 * The last one being zero is not an absence of data. It is the correct
 * measurement of an agent that has never processed a live request, and it is
 * written in those words — "no production executions recorded" rather than "no
 * data available", because the first is a measurement and the second is a
 * shrug.
 */
export const dynamic = "force-dynamic";

const DEPARTMENT_NAMES: Record<string, string> = {
  migration: "Migration",
  visa: "Visa",
  settlement: "Settlement",
  refugee: "Refugee & integration",
  public_services: "Public services",
  legal: "Legal",
  enterprise: "Enterprise",
  platform: "Platform",
};

function standingTone(standing: string): "neutral" | "accent" | "success" | "warning" {
  if (standing === "certified" || standing === "operational") return "success";
  if (standing === "verified") return "accent";
  if (standing === "testing") return "warning";
  return "neutral";
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-[0.08em] text-[var(--muted)]">{label}</dt>
      <dd className="mt-1 text-[15px] tabular-nums">{value}</dd>
    </div>
  );
}

function AgentCard({ agent }: { agent: AgentGovernance }) {
  const { definition, standing, checks, metrics } = agent;
  const executions = metrics?.executions ?? 0;

  return (
    <article className="rounded-lg border border-[var(--line)] p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[17px] font-medium">{definition.name}</h3>
          <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-[var(--muted)]">
            {definition.description}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge tone={standingTone(standing.observed)}>{standing.observed}</Badge>
          <Badge tone={agent.debt === 0 ? "success" : "warning"}>debt {agent.debt}</Badge>
        </div>
      </header>

      {/* Operation. Zero is a measurement, and is written as one. */}
      <section className="mt-5">
        <h4 className="text-[11px] uppercase tracking-[0.08em] text-[var(--muted)]">Operation</h4>
        {executions === 0 ? (
          <p className="mt-2 text-[13px] leading-relaxed text-[var(--muted)]">
            No production executions recorded. This agent has never processed a live request.
            Metrics appear here automatically after the first recorded execution — nothing on this
            page is entered by hand.
          </p>
        ) : (
          <dl className="mt-2 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Metric label="Executions" value={String(executions)} />
            <Metric
              label="Verification"
              value={
                metrics?.verificationRate === null || metrics === null
                  ? "—"
                  : `${(metrics.verificationRate * 100).toFixed(1)}%`
              }
            />
            <Metric
              label="Median latency"
              value={metrics?.medianLatencyMs === null ? "—" : `${metrics?.medianLatencyMs} ms`}
            />
            <Metric label="Policy blocks" value={String(metrics?.policyBlocks ?? 0)} />
          </dl>
        )}
      </section>

      {/* Definition — fixed, and real today. */}
      <section className="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <h4 className="text-[11px] uppercase tracking-[0.08em] text-[var(--muted)]">
            Definition
          </h4>
          <dl className="mt-2 space-y-1 text-[13px]">
            <div className="flex gap-2">
              <dt className="text-[var(--muted)]">Capabilities</dt>
              <dd>{definition.capabilities.join(", ")}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-[var(--muted)]">Permissions</dt>
              <dd>
                {definition.permissions.length === 0
                  ? "none declared — reads nothing"
                  : definition.permissions.join(", ")}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-[var(--muted)]">Verification gate</dt>
              <dd>{definition.requiresVerification ? "required" : "not required"}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-[var(--muted)]">Human review</dt>
              <dd>
                {definition.requiresHumanReview
                  ? "required before release"
                  : "not required for release"}
              </dd>
            </div>
          </dl>
        </div>

        {/* Capability — which of its invariants hold, measured today. */}
        <div>
          <h4 className="text-[11px] uppercase tracking-[0.08em] text-[var(--muted)]">
            Governance
          </h4>
          <p className="mt-2 text-[13px] text-[var(--muted)]">
            {agent.invariants.length} declared · {agent.satisfied} satisfied · {agent.failed} failed
            · {agent.unmeasured} unmeasured
          </p>
          <ul className="mt-2 space-y-1 text-[13px]">
            {agent.invariants.map((invariant) => (
              <li key={invariant.id} className="flex gap-2">
                <span
                  aria-hidden
                  className={
                    invariant.status === "satisfied"
                      ? "text-[var(--success)]"
                      : invariant.status === "failed"
                        ? "text-[var(--danger)]"
                        : "text-[var(--muted)]"
                  }
                >
                  {invariant.status === "satisfied"
                    ? "✓"
                    : invariant.status === "failed"
                      ? "✗"
                      : "·"}
                </span>
                <span className="text-[var(--muted)]">{invariant.id}</span>
                <span>{invariant.title}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Why it stands where it does. A level alone is not actionable. */}
      <section className="mt-5">
        <h4 className="text-[11px] uppercase tracking-[0.08em] text-[var(--muted)]">
          Why {standing.observed}
        </h4>
        <ul className="mt-2 grid gap-1 text-[13px] sm:grid-cols-2">
          {checks.map((check) => (
            <li key={check.label} className="flex gap-2">
              <span
                aria-hidden
                className={check.met ? "text-[var(--success)]" : "text-[var(--muted)]"}
              >
                {check.met ? "✓" : "✗"}
              </span>
              <span>
                {check.label}
                <span className="text-[var(--muted)]"> — {check.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* Routing is configuration; performance is measured separately. */}
      <section className="mt-5">
        <h4 className="text-[11px] uppercase tracking-[0.08em] text-[var(--muted)]">
          Provider routing
        </h4>
        <ul className="mt-2 space-y-1 text-[13px]">
          {agent.routing.map((route) => (
            <li key={route.capability} className="flex flex-wrap gap-2">
              <span className="text-[var(--muted)]">{route.capability}</span>
              <span>{route.provider ?? "unavailable"}</span>
              <span className="text-[var(--muted)]">{route.basis}</span>
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}

export default async function TrustAgentsPage() {
  const { agents, availability } = await agentGovernance();
  const grouped = byDepartment(agents);
  const worstDebt = byDebt(agents).slice(0, 8);
  const totalExecutions = agents.reduce((sum, a) => sum + (a.metrics?.executions ?? 0), 0);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[1400px] section-pad py-12 lg:py-16">
        <p className="eyebrow">Transparency</p>
        <h1 className="display mt-4 max-w-3xl text-[clamp(2.2rem,4vw,3.4rem)] tracking-tight">
          Agent governance
        </h1>
        <p className="mt-5 max-w-3xl text-[16px] leading-relaxed text-[var(--muted)]">
          Every agent the platform has, what it is permitted to do, which of its invariants hold,
          and what it has actually done. Three different questions, kept apart: what is{" "}
          <em>declared</em> is fixed and real today, what is <em>measured</em> is derived from
          checks against this instance, and what is <em>operated</em> is derived from recorded
          executions.
        </p>

        {totalExecutions === 0 ? (
          <div className="mt-8 rounded-lg border border-[var(--warning)]/30 p-5">
            <p className="text-[14px] font-medium">
              No production executions have been recorded for any agent.
            </p>
            <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-[var(--muted)]">
              This page shows governance, policy and measured implementation state, all of which are
              real. Operational metrics are zero because nothing has run — that is the correct
              measurement, not missing data. They appear automatically after the first recorded
              execution, with no change to this page.
              {availability.available ? "" : ` ${availability.reason}`}
            </p>
          </div>
        ) : null}

        <section className="mt-12">
          <h2 className="text-[20px] font-medium">Verification debt</h2>
          <p className="mt-2 max-w-2xl text-[14px] text-[var(--muted)]">
            Declared invariants that are not satisfied, per agent. An integer rather than a ratio,
            so it cannot be improved by declaring more. Worst first, which is the order the work
            should be done in.
          </p>
          <ul className="mt-4 max-w-xl divide-y divide-[var(--line)]">
            {worstDebt.map((agent) => (
              <li key={agent.definition.id} className="flex items-center justify-between py-2">
                <span className="text-[14px]">{agent.definition.name}</span>
                <span className="tabular-nums text-[14px] text-[var(--muted)]">
                  {agent.satisfied}/{agent.invariants.length} satisfied · debt {agent.debt}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {grouped.map(({ department, agents: members }) => (
          <section key={department} className="mt-12">
            <h2 className="text-[20px] font-medium">
              {DEPARTMENT_NAMES[department] ?? department}
              <span className="ml-2 text-[14px] font-normal text-[var(--muted)]">
                {members.length} agent{members.length === 1 ? "" : "s"}
              </span>
            </h2>
            <div className="mt-4 grid gap-4">
              {members.map((agent) => (
                <AgentCard key={agent.definition.id} agent={agent} />
              ))}
            </div>
          </section>
        ))}
      </main>
      <Footer />
    </>
  );
}
