import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/layout/site-header";
import { CaseWorkspace } from "@/components/workspace/case-workspace";
import { getCaseById } from "@/lib/data/sapana-case";
import { agentBadges } from "@/lib/capabilities";
import { AuditPanel } from "@/components/workspace/audit-panel";
import { TimelinePanel } from "@/components/workspace/timeline-panel";

export function generateStaticParams() {
  return [{ id: "case-sabinah-001" }];
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const legalCase = getCaseById(id);
  return {
    title: legalCase ? legalCase.clientName : "Case",
  };
}

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const legalCase = getCaseById(id);
  if (!legalCase) notFound();

  return (
    <>
      <SiteHeader />
      {/* Capability status is measured server-side and passed down, so the
          client tree cannot assert a maturity of its own. */}
      {/* The audit panel reads the append-only log on the server and arrives as
          a slot, because the shell holding tab state is a client component and
          a server component cannot be nested inside one.

          No session is resolved on this route yet, so it renders a refusal:
          without a membership there is nothing to authorise the read against.
          That is the permission layer working rather than a gap to paper over —
          passing a placeholder account would make the check decorative. */}
      <CaseWorkspace
        legalCase={legalCase}
        agentBadges={await agentBadges(legalCase.activeAgents)}
        auditSlot={<AuditPanel legalCase={legalCase} accountId="" memberships={[]} />}
        timelineSlot={<TimelinePanel caseId={id} accountId="" memberships={[]} />}
      />
    </>
  );
}
