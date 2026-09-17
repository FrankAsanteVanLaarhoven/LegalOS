import { createHash } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { evidenceCompleteness } from "@legalos/reliability";
import { z } from "zod";

import { GUARDRAILS_VERSION, SYSTEM_GUARDRAILS } from "@/lib/ai/guardrails";
import { buildCaseContext, explainabilityInstruction } from "@/lib/ai/prompts";
import { WITHHELD_MESSAGE } from "@/lib/ai/guard";
import { openRunner, prompt, REGISTRY_VERSION, SYSTEM_TEMPLATE_ID } from "@/lib/ai/runner";
import { limitModelRoute } from "@/lib/ai/rate-limit";
import { requireSession } from "@/lib/auth/require-session";
import { getCaseById } from "@/lib/data/sapana-case";

/** `caseId` is required here — analysis without a named case has no meaning. */
const RequestSchema = z.object({
  caseId: z.string().trim().min(1, "caseId is required.").max(64),
  focus: z.string().trim().max(500).optional(),
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

  const legalCase = getCaseById(parsed.data.caseId);
  if (!legalCase) {
    return NextResponse.json({ error: "Case not found." }, { status: 404 });
  }
  const focus = parsed.data.focus ?? "overall case readiness for tribunal appeal";

  // Derived from the evidence register rather than read from a stored score.
  const completeness = evidenceCompleteness(
    legalCase.evidence.map((e) => e.title),
    legalCase.evidence.map((e) => ({
      id: e.id,
      satisfies: e.title,
      received: e.status !== "missing" && e.status !== "requested",
    }))
  );

  const opened = await openRunner();
  if (!opened.ok) {
    // Offline is a real state and is reported as one. Note that a missing or
    // unreachable database lands here too: an execution that cannot be recorded
    // is refused rather than made and forgotten, which is the point of AU-005.
    return NextResponse.json({
      offline: true,
      reason: opened.unavailable.reason,
      analysis: {
        title: "Structured readiness (offline)",
        evidenceReceived: completeness.satisfied.length,
        evidenceRequired: completeness.required.length,
        basis: completeness.basis,
        missing: completeness.missing,
        openReviews: legalCase.reviews.filter((r) => r.status === "pending").length,
        note: opened.unavailable.detail,
      },
    });
  }

  const { handle } = opened;
  try {
    const outcome = await handle.runner.execute({
      capability: "deep_reasoning",
      context: {
        workspaceId: null,
        caseId: null,
        organisationId: null,
        actorId: auth.accountId,
        actorType: "client",
        sessionId: auth.session.id,
        deviceId: null,
        department: "case",
        agentId: "legal-analysis",
        agentVersion: "0.1.0",
        promptTemplateId: SYSTEM_TEMPLATE_ID,
        promptTemplateVersion: GUARDRAILS_VERSION,
        guardrailVersion: GUARDRAILS_VERSION,
        registryVersion: REGISTRY_VERSION,
        requestedAt: new Date().toISOString(),
      },
      prompt: prompt(
        `${SYSTEM_GUARDRAILS}\n\n${explainabilityInstruction()}\n\nCASE CONTEXT:\n${buildCaseContext(legalCase)}`,
        `Produce a concise explainable analysis focused on: ${focus}. Flag anything that requires solicitor approval.`
      ),
      userMessage: focus,
      systemPromptHash: createHash("sha256").update(SYSTEM_GUARDRAILS, "utf8").digest("hex"),
      resolvedSources: [],
      verifiedSourceCount: 0,
      unverifiedSourceCount: 0,
      timeoutMs: 30_000,
    });

    if (outcome.state !== "completed" && outcome.state !== "blocked") {
      return NextResponse.json(
        {
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
      offline: false,
      // The execution id is returned deliberately: it is how a person asks
      // afterwards what this answer was based on, and it resolves to an
      // immutable record rather than to a log line.
      executionId: outcome.executionId,
      analysis: outcome.response ?? WITHHELD_MESSAGE,
      verified: details.released ?? false,
      withheld: details.withheld ?? true,
      disposition: details.disposition ?? null,
      policyReasons: details.policyReasons ?? [],
      findings: details.findings ?? [],
      certainty: details.certainty ?? null,
      provenance: details.provenance ?? null,
      completeness: {
        received: completeness.satisfied.length,
        required: completeness.required.length,
        basis: completeness.basis,
        missing: completeness.missing,
      },
      caseId: legalCase.id,
    });
  } finally {
    await handle.close();
  }
}
