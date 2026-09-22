import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createHash } from "node:crypto";

import { GUARDRAILS_VERSION, SYSTEM_GUARDRAILS } from "@/lib/ai/guardrails";
import { openRunner, prompt, REGISTRY_VERSION, SYSTEM_TEMPLATE_ID } from "@/lib/ai/runner";
import { buildCaseContext, buildGeneralContext, explainabilityInstruction } from "@/lib/ai/prompts";
import { WITHHELD_MESSAGE } from "@/lib/ai/guard";
import { limitModelRoute } from "@/lib/ai/rate-limit";
import { requireSession } from "@/lib/auth/require-session";
import { getCaseById } from "@/lib/data/sapana-case";
import { LegalOSSupervisor } from "@/lib/agents/orchestrator";
import { formatSafeError } from "@/lib/security/data-leakage-guard";
import type { LegalCase } from "@/lib/types";

const RequestSchema = z.object({
  message: z.string().trim().min(1, "Message is required.").max(4000),
  caseId: z.string().trim().max(64).optional(),
  caseData: z.custom<LegalCase>().optional(),
});

import { answerLegalQuestion } from "@/lib/ai/companion-engine";

export async function POST(req: NextRequest) {
  const auth = await requireSession(req);

  const body = await req.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body." },
      { status: 400 }
    );
  }

  const { message, caseId, caseData } = parsed.data;

  // Case-specific queries require an authenticated session
  if ((caseId || caseData) && !auth.ok) {
    return NextResponse.json(
      { error: "Sign in to access specific case records.", code: "UNAUTHENTICATED" },
      { status: 401 }
    );
  }

  // Rate-limit per account or per client IP for public visitors
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "public_client";
  const rateLimitIdentity = auth.ok ? auth.accountId : `public_client_${ip}`;
  const { decision, headers } = await limitModelRoute(req, rateLimitIdentity);
  if (!decision.allowed) {
    return NextResponse.json(
      { error: decision.message ?? "Too many requests. Please wait a moment." },
      { status: 429, headers }
    );
  }

  const legalCase: LegalCase | null =
    caseData ?? (caseId ? getCaseById(caseId) ?? null : null);

  // If no case is attached, answer via the LegalOS Companion Engine
  if (!legalCase) {
    const companionAnswer = await answerLegalQuestion(message);
    const opened = await openRunner();

    if (!opened.ok) {
      return NextResponse.json({
        reply: companionAnswer.reply,
        spokenSummary: companionAnswer.spokenSummary,
        activeAgents: ["supervisor", "companion"],
        findings: [
          {
            agentId: "companion",
            agentName: "LegalOS Companion",
            badge: "Legal Intelligence",
            summary: companionAnswer.spokenSummary,
            details: companionAnswer.statutoryCitations,
          },
        ],
        proposedActions: [],
        verified: true,
        withheld: false,
        offline: true,
        caseId: null,
        disposition: "answered",
        certainty: "measured",
        policyReasons: [],
        requiresHumanReview: companionAnswer.requiresHumanReview,
        guardrailNotice: companionAnswer.guardrailNotice,
      });
    }

    const { handle } = opened;
    try {
      const outcome = await handle.runner.execute({
        capability: "conversation",
        context: {
          workspaceId: null,
          caseId: null,
          organisationId: null,
          actorId: auth.ok ? auth.accountId : "public-visitor",
          actorType: "client",
          sessionId: auth.ok ? auth.session.id : "public-session",
          deviceId: null,
          department: "companion",
          agentId: "public-companion",
          agentVersion: "0.2.0",
          promptTemplateId: SYSTEM_TEMPLATE_ID,
          promptTemplateVersion: GUARDRAILS_VERSION,
          guardrailVersion: GUARDRAILS_VERSION,
          registryVersion: REGISTRY_VERSION,
          requestedAt: new Date().toISOString(),
        },
        prompt: prompt(
          `${SYSTEM_GUARDRAILS}\n\n${explainabilityInstruction()}\n\nSTATUTORY CONTEXT:\n${companionAnswer.reply}`,
          message
        ),
        userMessage: message,
        systemPromptHash: createHash("sha256").update(SYSTEM_GUARDRAILS, "utf8").digest("hex"),
        timeoutMs: 30_000,
      });

      const replyText = outcome.response || companionAnswer.reply;
      return NextResponse.json({
        reply: replyText,
        spokenSummary: companionAnswer.spokenSummary,
        activeAgents: ["supervisor", "companion"],
        findings: [
          {
            agentId: "companion",
            agentName: "LegalOS Companion",
            badge: "Legal Intelligence",
            summary: companionAnswer.spokenSummary,
            details: companionAnswer.statutoryCitations,
          },
        ],
        proposedActions: [],
        executionId: outcome.executionId,
        verified: true,
        withheld: false,
        caseId: null,
      });
    } catch {
      return NextResponse.json({
        reply: companionAnswer.reply,
        spokenSummary: companionAnswer.spokenSummary,
        activeAgents: ["supervisor", "companion"],
        verified: true,
        caseId: null,
      });
    } finally {
      await handle.close();
    }
  }

  // Run the native LegalOS Supervisor Multi-Agent Orchestrator for case-attached queries
  const orchestration = LegalOSSupervisor.orchestrate(message, legalCase);

  const opened = await openRunner();
  if (!opened.ok) {
    return NextResponse.json({
      reply: orchestration.supervisorMessage,
      activeAgents: orchestration.activeAgents,
      findings: orchestration.findings,
      proposedActions: orchestration.proposedActions,
      verified: true,
      withheld: false,
      offline: true,
      caseId: legalCase?.id ?? null,
      disposition: "orchestrated",
      certainty: "measured",
      policyReasons: [],
      requiresHumanReview: orchestration.requiresHumanReview,
      guardrailNotice: orchestration.guardrailNotice,
    });
  }

  const context = legalCase ? buildCaseContext(legalCase) : buildGeneralContext();
  const { handle } = opened;

  try {
    const outcome = await handle.runner.execute({
      capability: "conversation",
      context: {
        workspaceId: null,
        caseId: legalCase?.id ?? null,
        organisationId: null,
        actorId: auth.ok ? auth.accountId : "authenticated-client",
        actorType: "client",
        sessionId: auth.ok ? auth.session.id : "authenticated-session",
        deviceId: null,
        department: "companion",
        agentId: legalCase ? "supervisor" : "public-companion",
        agentVersion: "0.2.0",
        promptTemplateId: SYSTEM_TEMPLATE_ID,
        promptTemplateVersion: GUARDRAILS_VERSION,
        guardrailVersion: GUARDRAILS_VERSION,
        registryVersion: REGISTRY_VERSION,
        requestedAt: new Date().toISOString(),
      },
      prompt: prompt(
        `${SYSTEM_GUARDRAILS}\n\n${explainabilityInstruction()}\n\nCONTEXT:\n${context}`,
        message
      ),
      userMessage: message,
      systemPromptHash: createHash("sha256").update(SYSTEM_GUARDRAILS, "utf8").digest("hex"),
      timeoutMs: 30_000,
    });

    if (outcome.state !== "completed" && outcome.state !== "blocked") {
      return NextResponse.json({
        reply: orchestration.supervisorMessage,
        activeAgents: orchestration.activeAgents,
        findings: orchestration.findings,
        proposedActions: orchestration.proposedActions,
        offline: true,
        ref: outcome.executionId,
        state: outcome.state,
        caseId: legalCase?.id ?? null,
      });
    }

    const details = (outcome.details ?? {}) as Record<string, unknown>;
    return NextResponse.json({
      reply: outcome.response ?? orchestration.supervisorMessage ?? WITHHELD_MESSAGE,
      activeAgents: orchestration.activeAgents,
      findings: orchestration.findings,
      proposedActions: orchestration.proposedActions,
      executionId: outcome.executionId,
      verified: details.released ?? false,
      withheld: details.withheld ?? true,
      disposition: details.disposition ?? null,
      policyReasons: details.policyReasons ?? [],
      certainty: details.certainty ?? null,
      provenance: details.provenance ?? null,
      offline: false,
      caseId: legalCase?.id ?? null,
      requiresHumanReview: orchestration.requiresHumanReview,
      guardrailNotice: orchestration.guardrailNotice,
    });
  } catch (error) {
    const safe = formatSafeError(error);
    return NextResponse.json(safe, { status: 500 });
  } finally {
    await handle.close();
  }
}

