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

/**
 * `caseId` is optional and has NO default.
 *
 * It previously fell back to the demo case, so every public question — including
 * those from the globally mounted voice widget — was answered with an unrelated
 * client's asylum, trafficking and medical history in the system prompt. A
 * question with no case attached now gets a case-free prompt.
 */
const RequestSchema = z.object({
  message: z.string().trim().min(1, "Message is required.").max(4000),
  caseId: z.string().trim().max(64).optional(),
});

export async function POST(req: NextRequest) {
  // Verified here rather than at the edge: middleware checks the cookie shape,
  // this establishes who is calling.
  const auth = await requireSession(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }

  // With an identity, the per-account limit applies rather than only the
  // shared-address backstop — which is the point of preferring identity.
  const { decision, headers } = await limitModelRoute(req, auth.accountId);
  if (!decision.allowed) {
    return NextResponse.json(
      { error: decision.message ?? "Too many requests." },
      { status: 429, headers }
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body." },
      { status: 400 }
    );
  }

  const { message, caseId } = parsed.data;
  const legalCase = caseId ? getCaseById(caseId) : null;
  if (caseId && !legalCase) {
    return NextResponse.json({ error: "Case not found." }, { status: 404 });
  }

  const opened = await openRunner();
  if (!opened.ok) {
    // A missing or unreachable database lands here as well as a missing key.
    // An execution that cannot be recorded is refused rather than made and
    // forgotten — the alternative is a system that stops recording exactly when
    // its storage is in trouble, which is when the record matters most.
    return NextResponse.json({
      reply: null,
      offline: true,
      reason: opened.unavailable.reason,
      error:
        opened.unavailable.reason === "NO_API_KEY"
          ? "Live AI is not configured for this deployment. The workspace still provides structured case intelligence."
          : opened.unavailable.detail,
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
        actorId: auth.accountId,
        actorType: "client",
        sessionId: auth.session.id,
        deviceId: null,
        department: "companion",
        // Named so a later question can be answered with which subsystem
        // produced an answer, not merely which model did.
        agentId: legalCase ? "case-companion" : "public-companion",
        agentVersion: "0.1.0",
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
      // The execution id is the reference now. It resolves to an immutable
      // record rather than to a log line somebody has to go and find.
      return NextResponse.json(
        {
          reply: null,
          offline: true,
          error: "Upstream unavailable.",
          ref: outcome.executionId,
          state: outcome.state,
        },
        { status: 502 }
      );
    }

    const details = (outcome.details ?? {}) as Record<string, unknown>;
    return NextResponse.json({
      reply: outcome.response ?? WITHHELD_MESSAGE,
      executionId: outcome.executionId,
      // The UI must not present unreleased text as vetted legal guidance.
      verified: details.released ?? false,
      withheld: details.withheld ?? true,
      disposition: details.disposition ?? null,
      policyReasons: details.policyReasons ?? [],
      findings: details.findings ?? [],
      certainty: details.certainty ?? null,
      provenance: details.provenance ?? null,
      offline: false,
      caseId: legalCase?.id ?? null,
    });
  } finally {
    await handle.close();
  }
}
