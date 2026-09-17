import { SiteHeader } from "@/components/layout/site-header";
import { CaseWorkspace } from "@/components/workspace/case-workspace";
import { getCaseById } from "@/lib/data/sapana-case";
import { agentBadges } from "@/lib/capabilities";
import { AuditPanel } from "@/components/workspace/audit-panel";
import type { LegalCase } from "@/lib/types";

export function generateStaticParams() {
  return [{ id: "case-sabinah-001" }];
}

function createScaffoldCase(id: string): LegalCase {
  return {
    id,
    reference: "LOS-ACTIVE",
    clientName: "Active Case File",
    preferredName: "Client",
    nationality: "Recorded in Case Register",
    languages: ["English"],
    status: "intake",
    matterTypes: ["Immigration"],
    summary: "Active client case file.",
    disclaimer:
      "LegalOS helps you understand your legal situation, prepare evidence, organise documents, and work with qualified legal professionals. It is not a solicitor and does not replace regulated legal advice.",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isDemo: false,
    riskLevel: "medium",
    activeAgents: [
      "evidence",
      "immigration",
      "medical",
      "research",
      "compliance",
      "solicitor_review",
      "supervisor",
    ],
    timeline: [],
    evidence: [],
    evidenceGraph: [],
    analyses: [],
    tasks: [],
    deadlines: [],
    reviews: [],
  };
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const legalCase = getCaseById(id) ?? createScaffoldCase(id);
  return {
    title: legalCase.clientName,
  };
}

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const legalCase = getCaseById(id) ?? createScaffoldCase(id);

  return (
    <>
      <SiteHeader />
      <CaseWorkspace
        legalCase={legalCase}
        agentBadges={await agentBadges(legalCase.activeAgents)}
        auditSlot={<AuditPanel legalCase={legalCase} accountId="" memberships={[]} />}
      />
    </>
  );
}
