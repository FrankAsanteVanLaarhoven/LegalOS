import { createRunner, type ExecutionContext, type GuardrailVerdict } from "@legalos/execution";

import { GUARDRAILS_VERSION, SYSTEM_GUARDRAILS } from "./guardrails";
import { guardOutput } from "./guard";

/**
 * The web app's single route to a model.
 *
 * `getAIClient()` used to live here and return an SDK client. Two routes called
 * it directly, and both were careful and correct — they verified the session,
 * applied the rate limit, ran the output through the verification gate. Neither
 * produced an execution record, so nothing could answer afterwards what a
 * particular answer had been based on.
 *
 * There is no exported way to obtain a client now. A caller gets a runner or a
 * reason it cannot have one.
 */

/** Bumped with the registry; recorded on every execution. */
export const REGISTRY_VERSION = "0.2.0-dev";

export const SYSTEM_TEMPLATE_ID = "legalos.system.guardrails";

/**
 * Bridges the platform verification gate to the runner's guardrail port.
 *
 * The gate decides releasability; the runner records the decision and withholds
 * on anything short of a pass. Both halves matter: a hedged unverified answer
 * is still unverified, and it reads as caution.
 */
const guardrails = {
  async check(context: ExecutionContext, response: string): Promise<GuardrailVerdict> {
    const guarded = await guardOutput({
      text: response,
      actor: context.caseId ? `case:${context.caseId}` : context.actorId,
      subject: context.caseId ?? "general",
      at: new Date().toISOString(),
    });

    return {
      verdict: guarded.released ? "pass" : guarded.withheld ? "block" : "flag",
      detail: guarded.withheld ? "withheld by the verification gate" : null,
      details: {
        released: guarded.released,
        withheld: guarded.withheld,
        disposition: guarded.disposition,
        certainty: guarded.certainty,
        provenance: guarded.provenance,
        text: guarded.text,
        policyReasons: guarded.policyReasons.map((r) => ({ code: r.code, detail: r.detail })),
        findings: guarded.findings.map((f) => ({ code: f.code, title: f.title, detail: f.detail })),
      },
    };
  },
};

export type WebRunner = Awaited<ReturnType<typeof openRunner>>;

/**
 * Opens a runner with the system prompt registered at its current version.
 *
 * Registering here rather than at call sites means every execution cites a
 * template body that is actually stored, which is what makes replay possible —
 * an execution naming a version nobody kept is unreproducible in exactly the
 * way AU-004 is meant to prevent.
 */
export async function openRunner() {
  const result = await createRunner({ guardrails });
  if (!result.ok) return result;

  await result.handle.registerTemplate({
    id: SYSTEM_TEMPLATE_ID,
    version: GUARDRAILS_VERSION,
    kind: "system",
    body: SYSTEM_GUARDRAILS,
  });
  return result;
}

/** The prompt shape the provider adapter expects. */
export function prompt(system: string, user: string): string {
  return JSON.stringify({ system, user });
}
