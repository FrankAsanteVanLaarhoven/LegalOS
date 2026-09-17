import { Badge } from "@/components/ui/badge";
import { agentBadges } from "@/lib/capabilities";
import { maturityTone } from "@/lib/capability-display";
import { revalidatePath } from "next/cache";
import { readAuditTrail } from "@/lib/repositories/audit";
import type { LegalCase } from "@/lib/types";

/**
 * Audit trail.
 *
 * A server component reading the append-only log through a repository, and
 * verifying the chain at the moment somebody looks. A page showing an audit
 * trail without saying whether it still verifies is showing a list, and a list
 * is what an audit log is not.
 *
 * Three states are kept distinct, because collapsing them is how an interface
 * says something untrue: no database configured, the store unreachable, and a
 * chain that verified and failed. The first is a property of this deployment,
 * the second is an incident, the third is a disclosure.
 */

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 py-1 text-[13px]">
      <span className="text-[var(--muted)]">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

export async function AuditPanel({
  legalCase,
  accountId,
  memberships,
}: {
  legalCase: LegalCase;
  accountId: string;
  memberships: readonly import("@legalos/auth").Membership[];
}) {
  const view = await readAuditTrail({
    accountId,
    // Cases in this build carry no workspace id, so the permission check has
    // nothing to resolve a membership against and refuses. That is the correct
    // behaviour and it is why this panel currently renders a refusal: the
    // permission layer is real, and the case model has not caught up with it.
    workspaceId: (legalCase as { workspaceId?: string }).workspaceId ?? null,
    memberships,
    limit: 100,
  });

  // Capability state for this surface, derived rather than asserted.
  const badge = (await agentBadges(["compliance"])).compliance;

  /**
   * Re-verify on demand.
   *
   * A real action doing real work: it recomputes the chain and re-renders. It
   * deliberately writes nothing — the audit log is append-only and a page about
   * a record must not be able to add to it.
   */
  async function reverify() {
    "use server";
    revalidatePath("/workspace/cases/[id]", "page");
  }

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-[var(--shadow-soft)] sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Audit trail</h2>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-zinc-600">
            Every recorded action, hash-linked to the one before it. The chain is verified when this
            page loads rather than on a schedule, so what you see is checked now.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {badge ? (
            <Badge tone={maturityTone(badge.implementation)}>{badge.implementation}</Badge>
          ) : null}
          <form action={reverify}>
            <button
              type="submit"
              className="rounded-full border border-zinc-300 px-3 py-1 text-[12px] hover:border-zinc-500"
            >
              Verify again
            </button>
          </form>
        </div>
      </div>

      {!view.ok ? (
        <div className="mt-5 rounded-lg border border-zinc-200 p-4">
          <p className="text-[14px] font-medium">
            {view.unavailable.reason === "FORBIDDEN"
              ? "You do not have permission to read this audit trail."
              : view.unavailable.reason === "NO_DATABASE"
                ? "No audit trail on this instance."
                : "The audit trail could not be read."}
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-zinc-600">
            {view.unavailable.detail}
          </p>
        </div>
      ) : (
        <>
          {/* Verification first. It is the only thing on this page that decides
              whether the rest of it means anything. */}
          <div
            className={`mt-5 rounded-lg border p-4 ${
              view.verification.valid ? "border-zinc-200" : "border-[var(--danger)]"
            }`}
          >
            <p className="text-[14px] font-medium">
              {view.verification.valid
                ? "Chain verified"
                : `Chain broken at entry ${view.verification.brokenAt}`}
            </p>
            <p className="mt-1 text-[13px] text-zinc-600">
              {view.verification.valid
                ? `${view.total} entries recomputed and linked, checked at ${new Date(view.verification.checkedAt).toISOString()}.`
                : `${view.verification.reason}. An entry has been altered since it was written; this is a disclosure, not a display problem.`}
            </p>
          </div>

          {view.entries.length === 0 ? (
            <p className="mt-5 text-[13px] leading-relaxed text-zinc-600">
              No entries recorded. The chain verifies trivially, which is worth knowing when reading
              the line above — an empty log is not evidence that anything was audited.
            </p>
          ) : (
            <ul className="mt-5 divide-y divide-zinc-200">
              {view.entries.map((entry) => (
                <li key={entry.hash} className="py-3">
                  <div className="flex flex-wrap items-baseline gap-3">
                    <span className="tabular-nums text-[12px] text-zinc-500">#{entry.seq}</span>
                    <span className="text-[14px] font-medium">{entry.action}</span>
                    <span className="text-[13px] text-zinc-600">{entry.actor}</span>
                    <span className="text-[12px] text-zinc-500">{entry.at}</span>
                    {entry.tombstonedAt ? <Badge tone="warning">erased</Badge> : null}
                  </div>
                  <div className="mt-2">
                    <Row label="subject" value={entry.subject} />
                    <Row label="payload hash" value={`${entry.payloadHash.slice(0, 16)}…`} />
                    <Row label="entry hash" value={`${entry.hash.slice(0, 16)}…`} />
                    {entry.tombstonedAt ? (
                      <p className="mt-2 text-[13px] leading-relaxed text-zinc-600">
                        Content erased on request at {entry.tombstonedAt}. The fingerprint is kept
                        so the chain still verifies without it — the record that this happened
                        survives, and what was recorded about it does not.
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
