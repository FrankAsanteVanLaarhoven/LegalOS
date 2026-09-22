import type { LegalCase } from "@/lib/types";
import type {
  OrchestrationResult,
  ProposedAction,
  SpecialistAgentId,
  SpecialistFinding,
} from "./types";

export class LegalOSSupervisor {
  /**
   * Distributes task across specialist agents and synthesizes actionable findings.
   * Completely self-contained and independent of any external model provider.
   */
  public static orchestrate(
    userPrompt: string,
    legalCase: LegalCase | null
  ): OrchestrationResult {
    const prompt = userPrompt.toLowerCase().trim();

    // Fallback for general non-case queries
    if (!legalCase) {
      return this.handleGeneralQuery(userPrompt);
    }

    const activeAgents: SpecialistAgentId[] = ["supervisor"];
    const findings: SpecialistFinding[] = [];
    const proposedActions: ProposedAction[] = [];

    const wantsEvidence =
      prompt.includes("evidence") ||
      prompt.includes("document") ||
      prompt.includes("missing") ||
      prompt.includes("audit") ||
      prompt.includes("gap") ||
      prompt.includes("all");

    const wantsTimeline =
      prompt.includes("timeline") ||
      prompt.includes("chronology") ||
      prompt.includes("date") ||
      prompt.includes("history") ||
      prompt.includes("event") ||
      prompt.includes("all");

    const wantsLegal =
      prompt.includes("rule") ||
      prompt.includes("law") ||
      prompt.includes("eligibility") ||
      prompt.includes("asylum") ||
      prompt.includes("worker") ||
      prompt.includes("family") ||
      prompt.includes("route") ||
      prompt.includes("all");

    const wantsTasks =
      prompt.includes("task") ||
      prompt.includes("action") ||
      prompt.includes("plan") ||
      prompt.includes("todo") ||
      prompt.includes("create") ||
      prompt.includes("all");

    // 1. Intake Agent - Case facts & Client Profile
    activeAgents.push("intake");
    findings.push({
      agentId: "intake",
      agentName: "Intake Specialist",
      badge: "Intake & Profile",
      summary: `Client Profile: ${legalCase.clientName} (${legalCase.nationality}) — Ref: ${legalCase.reference}`,
      details: [
        `Matter classification: ${legalCase.matterTypes.join(", ")}`,
        `Assigned Counsel / Solicitor: ${legalCase.assignedSolicitor || "Unassigned"}`,
        `Current Risk Classification: ${legalCase.riskLevel.toUpperCase()}`,
        `Intake facts recorded: ${legalCase.summary || "Standard matter profile"}`,
      ],
    });

    // 2. Evidence Agent - Document register audit
    if (wantsEvidence || (!wantsTimeline && !wantsLegal && !wantsTasks)) {
      activeAgents.push("evidence");
      const received = legalCase.evidence.filter(
        (e) => e.status !== "missing" && e.status !== "requested"
      );
      const missing = legalCase.evidence.filter(
        (e) => e.status === "missing" || e.status === "requested"
      );

      const evidenceDetails: string[] = [
        `Register Completeness: ${received.length} of ${legalCase.evidence.length} items verified received.`,
      ];

      if (missing.length > 0) {
        evidenceDetails.push(
          `Outstanding / Missing Items (${missing.length}): ${missing.map((m) => m.title).join("; ")}`
        );
      } else {
        evidenceDetails.push("No immediate missing items flagged in primary register.");
      }

      findings.push({
        agentId: "evidence",
        agentName: "Evidence Specialist",
        badge: "Evidence Audit",
        summary: `Evidence Registry: ${received.length} verified / ${missing.length} pending`,
        details: evidenceDetails,
      });

      // Propose evidence actions if critical documents are missing
      if (missing.length > 0) {
        missing.forEach((item) => {
          proposedActions.push({
            type: "add_task",
            task: {
              title: `Procure missing evidence: ${item.title}`,
              description: `Request certified documentary copy of ${item.title} to resolve evidence gap for ${legalCase.clientName}.`,
              priority: "high",
              status: "pending",
              agentId: "evidence",
              assignee: legalCase.assignedSolicitor || "Case Handler",
              dueDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
            },
          });
        });
      } else if (prompt.includes("audit") || prompt.includes("add")) {
        // Recommend adding primary identity or residence verification if sparse
        if (!legalCase.evidence.some((e) => e.category === "police" || e.title.toLowerCase().includes("police"))) {
          proposedActions.push({
            type: "add_evidence",
            evidence: {
              title: "Police Registration Certificate / ACRO Check",
              category: "police",
              summary: "Overseas criminal record certificate or ACRO police check certificate for immigration filing.",
              status: "requested",
              confidence: 0.95,
              linkedIssues: ["Suitability", "Good Character"],
              linkedEvents: [],
              tags: ["suitability", "criminal_record", "compliance"],
            },
          });
        }
      }
    }

    // 3. Timeline Agent - Chronology & date audit
    if (wantsTimeline || (!wantsEvidence && !wantsLegal && !wantsTasks)) {
      activeAgents.push("timeline");
      const events = legalCase.timeline;
      const timelineDetails: string[] = [
        `Chronology Scope: ${events.length} chronological events logged.`,
      ];

      if (events.length > 0) {
        timelineDetails.push(
          `Earliest event: ${events[0]?.date} (${events[0]?.title})`
        );
        timelineDetails.push(
          `Latest event: ${events[events.length - 1]?.date} (${events[events.length - 1]?.title})`
        );
      } else {
        timelineDetails.push("Warning: No chronology events logged in file. Chronology is required for tribunal credibility.");
      }

      findings.push({
        agentId: "timeline",
        agentName: "Timeline Specialist",
        badge: "Chronology Audit",
        summary: `Chronology: ${events.length} events logged across case history`,
        details: timelineDetails,
      });

      if (events.length < 2) {
        proposedActions.push({
          type: "add_timeline",
          event: {
            date: new Date().toISOString().slice(0, 10),
            year: new Date().getFullYear(),
            title: "Pre-submission review and solicitor conference",
            description: `Formal review of documentary evidence bundle and statutory deadlines with ${legalCase.clientName}.`,
            category: "immigration",
            evidenceIds: [],
            legalIssues: ["Procedure", "Client Care"],
            source: "user",
            confidence: 1.0,
          },
        });
      }
    }

    // 4. Immigration / Legal Rules Specialist
    if (wantsLegal || (!wantsEvidence && !wantsTimeline && !wantsTasks)) {
      activeAgents.push("immigration");
      const legalFindings: string[] = [];

      if (legalCase.matterTypes.some((m) => m.toLowerCase().includes("asylum") || m.toLowerCase().includes("human rights"))) {
        legalFindings.push("Route: 1951 Refugee Convention / Humanitarian Protection / Article 3 & 8 ECHR.");
        legalFindings.push("Standard of proof: 'Reasonable degree of likelihood' (lower than civil balance of probabilities).");
        legalFindings.push("Credibility assessment: Consistency between witness testimony, chronology, and objective country guidance.");
      } else if (legalCase.matterTypes.some((m) => m.toLowerCase().includes("skilled worker"))) {
        legalFindings.push("Route: Appendix Skilled Worker (Points-Based System).");
        legalFindings.push("Mandatory requirements: Valid Certificate of Sponsorship (CoS), eligible SOC 2020 code, minimum salary thresholds, English B1.");
        legalFindings.push("Continuous residence: Max 180 days absence per 12 months under Appendix Continuous Residence.");
      } else if (legalCase.matterTypes.some((m) => m.toLowerCase().includes("family") || m.toLowerCase().includes("spouse"))) {
        legalFindings.push("Route: Appendix FM (Partner / Spouse / Dependant).");
        legalFindings.push("Requirements: Minimum Income Requirement (MIR), genuine and subsisting relationship, CEFR A1/A2 English.");
        legalFindings.push("Human Rights backstop: Paragraph GEN.3.1. exceptional circumstances under Article 8 ECHR.");
      } else {
        legalFindings.push("Route: General UK Immigration Acts & HC 395 Rules.");
        legalFindings.push("General Grounds for Refusal: Suitability checks under Part 9 of Immigration Rules.");
      }

      findings.push({
        agentId: "immigration",
        agentName: "Immigration Specialist",
        badge: "Legal Mapping",
        summary: `Statutory Framework: ${legalCase.matterTypes.join(", ")}`,
        details: legalFindings,
      });
    }

    // 5. Workflow Agent - Action items & Deadlines
    if (wantsTasks || proposedActions.length > 0) {
      activeAgents.push("workflow");
      const openTasks = legalCase.tasks.filter((t) => t.status !== "completed");
      const upcomingDeadlines = legalCase.deadlines.filter((d) => d.status !== "completed");

      findings.push({
        agentId: "workflow",
        agentName: "Workflow Specialist",
        badge: "Tasks & Deadlines",
        summary: `Workflow: ${openTasks.length} open tasks / ${upcomingDeadlines.length} tracked deadlines`,
        details: [
          `Pending tasks: ${openTasks.map((t) => t.title).slice(0, 3).join("; ") || "All current tasks completed."}`,
          `Upcoming deadlines: ${upcomingDeadlines.map((d) => `${d.title} (${d.date})`).join("; ") || "No upcoming hard statutory deadlines."}`,
        ],
      });

      // Suggest pre-submission deadline if none exists
      if (upcomingDeadlines.length === 0) {
        proposedActions.push({
          type: "add_deadline",
          deadline: {
            title: "Bundle Completion & Solicitor Sign-off",
            date: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
            type: "soft",
            status: "upcoming",
            notes: "Target milestone to assemble draft documents and formal evidence pack.",
          },
        });
      }
    }

    // 6. Human Review Gate - Mandatory Compliance
    activeAgents.push("human_review");
    findings.push({
      agentId: "human_review",
      agentName: "Human Review Gate",
      badge: "Compliance & OISC",
      summary: "Regulatory Gate: LegalOS assists with organisation and synthesis; reserved legal activities require qualified human solicitor approval.",
      details: [
        "In accordance with the Legal Services Act 2007 and SRA/OISC Codes of Standards:",
        "• Final submission of immigration notices or tribunal grounds constitutes reserved activity.",
        "• All drafted statements and statutory representations must be settled by a qualified legal adviser.",
      ],
      reservedActivity: true,
    });

    // Synthesize structured executive message
    const supervisorMessage = this.generateSupervisorSynthesis(
      legalCase,
      findings,
      proposedActions
    );

    return {
      supervisorMessage,
      activeAgents: Array.from(new Set(activeAgents)),
      findings,
      proposedActions,
      requiresHumanReview: true,
      guardrailNotice:
        "LegalOS is an independent legal operations platform. It does not replace regulated legal advice from a solicitor or OISC-registered adviser.",
    };
  }

  private static handleGeneralQuery(userPrompt: string): OrchestrationResult {
    return {
      supervisorMessage: `## General UK Legal Intelligence Inquiry
I have processed your query: **"${userPrompt}"**.

### What I Know
• No active client case file is currently selected in the workspace.
• LegalOS operates on a supervisor + specialist multi-agent architecture (Intake, Evidence, Timeline, Immigration, Workflow, and Human Review).

### How to Use the Multi-Agent System
1. **Select or Create a Case**: Open a case file from the sidebar or click **New Case** to attach client facts.
2. **Audit & Analysis**: Ask the Supervisor to *"Audit missing documents"*, *"Check chronology for tribunal credibility"*, or *"Assess eligibility under Immigration Rules"*.
3. **Task Distribution**: The Supervisor will automatically delegate to specialist agents and propose concrete tasks and evidence requests for your workspace.

---
*LegalOS is not a solicitor and does not replace regulated legal advice.*`,
      activeAgents: ["supervisor", "intake", "human_review"],
      findings: [
        {
          agentId: "supervisor",
          agentName: "Supervisor Agent",
          badge: "Platform",
          summary: "General inquiry processed without client context",
          details: ["Select an active matter in the workspace to trigger client-specific multi-agent auditing."],
        },
      ],
      proposedActions: [],
      requiresHumanReview: false,
      guardrailNotice: "General information only. Not legal advice.",
    };
  }

  private static generateSupervisorSynthesis(
    legalCase: LegalCase,
    findings: SpecialistFinding[],
    proposedActions: ProposedAction[]
  ): string {
    const sections: string[] = [];

    sections.push(`## Supervisor Multi-Agent Synthesis: ${legalCase.clientName} (${legalCase.reference})`);
    sections.push(
      `Coordinated review completed across **${findings.length} specialist agents** for **${legalCase.matterTypes.join(", ")}**.`
    );

    sections.push(`### 1. What I Know & Case Status`);
    sections.push(`• **Client:** ${legalCase.clientName} (${legalCase.nationality})`);
    sections.push(`• **Matter Types:** ${legalCase.matterTypes.join(", ")} | **Risk Level:** ${legalCase.riskLevel.toUpperCase()}`);
    sections.push(`• **Document Health:** ${legalCase.evidence.filter((e) => e.status !== "missing" && e.status !== "requested").length} verified items received out of ${legalCase.evidence.length} registered.`);
    sections.push(`• **Chronology:** ${legalCase.timeline.length} recorded events.`);

    sections.push(`### 2. Specialist Agent Findings`);
    findings.forEach((f) => {
      if (f.agentId !== "supervisor") {
        sections.push(`#### 🔹 ${f.agentName} (${f.badge})`);
        f.details.forEach((d) => sections.push(`• ${d}`));
      }
    });

    if (proposedActions.length > 0) {
      sections.push(`### 3. Recommended Actions Dispatched`);
      sections.push(
        `The Supervisor has prepared **${proposedActions.length} actionable updates** for this case (review and apply them via the action cards below):`
      );
      proposedActions.forEach((a) => {
        if (a.type === "add_task") {
          sections.push(`• **[Task]** ${a.task.title} (Priority: ${a.task.priority.toUpperCase()})`);
        } else if (a.type === "add_evidence") {
          sections.push(`• **[Evidence Request]** ${a.evidence.title} (${a.evidence.category})`);
        } else if (a.type === "add_timeline") {
          sections.push(`• **[Timeline Milestone]** ${a.event.date}: ${a.event.title}`);
        } else if (a.type === "add_deadline") {
          sections.push(`• **[Deadline]** ${a.deadline.title}: Due ${a.deadline.date}`);
        }
      });
    }

    sections.push(`---`);
    sections.push(
      `*LegalOS Human Review Gate: All drafted arguments and applications must be reviewed and signed off by a qualified solicitor or OISC-regulated adviser prior to formal submission.*`
    );

    return sections.join("\n\n");
  }
}
