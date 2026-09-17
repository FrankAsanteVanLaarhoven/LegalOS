import { Badge } from "@/components/ui/badge";
import { agentBadges } from "@/lib/capabilities";
import { readCase } from "@/lib/repositories/case";
import type { Membership } from "@legalos/auth";

/**
 * Case chronology, read from `timeline_events`.
 *
 * The second repository-backed surface, and the first that needed no new
 * schema — the table has existed since the first migration and nothing read it.
 *
 * Every event shows how it came to be known. That is the column doing the work
 * here: what a person told you, what a document shows and what a model inferred
 * are three different kinds of fact, and a chronology that renders them
 * identically invites a submission built on the weakest of them. The
 * distinction is in the schema as a constraint, not a convention.
 */

const SOURCE_LABEL: Record<string, string> = {
  client_stated: "stated by the client",
  document: "from a document",
  ai_inferred: "inferred by a model",
};

const SOURCE_TONE: Record<string, "neutral" | "success" | "warning"> = {
  client_stated: "neutral",
  document: "success",
  ai_inferred: "warning",
};

export async function TimelinePanel({
  caseId,
  accountId,
  memberships,
}: {
  caseId: string;
  accountId: string;
  memberships: readonly Membership[];
}) {
  const view = await readCase({ caseId, accountId, memberships });
  const badge = (await agentBadges(["timeline"])).timeline;

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-[var(--shadow-soft)] sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Chronology</h2>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-zinc-600">
            Every event carries how it came to be known. A chronology that shows a recollection and
            a document the same way invites a submission built on the weaker of the two.
          </p>
        </div>
        {badge ? <Badge tone="neutral">{badge.implementation}</Badge> : null}
      </div>

      {!view.ok ? (
        <div className="mt-5 rounded-lg border border-zinc-200 p-4">
          <p className="text-[14px] font-medium">
            {view.unavailable.reason === "FORBIDDEN"
              ? "You do not have permission to read this case."
              : view.unavailable.reason === "NOT_PERSISTED"
                ? "This case is not in the database."
                : view.unavailable.reason === "NO_DATABASE"
                  ? "No case store on this instance."
                  : "The case could not be read."}
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-zinc-600">
            {view.unavailable.detail}
          </p>
        </div>
      ) : (
        <>
          {view.record.isDemo ? (
            <p className="mt-4 rounded-lg border border-[var(--warning)]/30 p-3 text-[13px] text-zinc-700">
              Demonstration matter. Nothing here describes a real person, and no date is a real
              deadline.
            </p>
          ) : null}

          {view.timeline.length === 0 ? (
            <p className="mt-5 text-[13px] leading-relaxed text-zinc-600">
              No events recorded. An empty chronology is not evidence that nothing happened — it
              means nothing has been entered, and the gap is the finding.
            </p>
          ) : (
            <ol className="mt-5 border-l border-zinc-200 pl-5">
              {view.timeline.map((event) => (
                <li key={event.id} className="relative pb-5 last:pb-0">
                  <span
                    aria-hidden
                    className="absolute -left-[27px] top-1 h-2 w-2 rounded-full bg-zinc-400"
                  />
                  <div className="flex flex-wrap items-baseline gap-2">
                    <time className="font-mono text-[12px] text-zinc-500">
                      {event.occurredOn.slice(0, 10)}
                    </time>
                    <span className="text-[14px] font-medium">{event.title}</span>
                    <Badge tone={SOURCE_TONE[event.source] ?? "neutral"}>
                      {SOURCE_LABEL[event.source] ?? event.source}
                    </Badge>
                  </div>
                  {event.description ? (
                    <p className="mt-1 text-[13px] leading-relaxed text-zinc-600">
                      {event.description}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </div>
  );
}
