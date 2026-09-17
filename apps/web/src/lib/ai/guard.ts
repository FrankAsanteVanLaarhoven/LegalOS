import { inspectConfidentiality } from "@legalos/fiduciary";
import { AuditChain, type AuditInput, type ProvenanceRecord } from "@legalos/governance";
import { createUkRegistry } from "@legalos/knowledge";
import { decide, type Disposition, type PolicyReason } from "@legalos/policy";
import { describeCertainty, type CertaintyDisclosure } from "@legalos/reliability";
import { verify, type Finding } from "@legalos/verification";

import { DEFAULT_MODEL, GUARDRAILS_VERSION } from "./guardrails";
import { PROMPT_VERSION } from "./prompts";

/**
 * The gate between the model and the user.
 *
 * Two questions, deliberately answered by two packages:
 *
 *  - @legalos/verification — is this text supportable? Fail-closed: any finding
 *    makes it unreleasable as legal information.
 *  - @legalos/policy — given that verdict, what should happen to it? Show it,
 *    show it with caveats, withhold it, or escalate to a human.
 *
 * The release rule used to be a WITHHOLD_CODES set defined here, in the request
 * path. It now lives in @legalos/policy, where it is testable on its own and
 * cannot drift between the surfaces that need it.
 */

/**
 * Fallback audit chain, used only when DATABASE_URL is not configured.
 *
 * It does not survive a restart and is not shared across instances. When it is
 * in use the platform does not have an audit trail in any meaningful sense, and
 * `auditIsDurable()` reports false so nothing can claim otherwise.
 */
const fallbackChain = new AuditChain();

export function auditTrail(): AuditChain {
  return fallbackChain;
}

export function auditIsDurable(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/**
 * Appends to the append-only audit_log table when a database is configured,
 * falling back to the in-process chain otherwise.
 *
 * The write runs in a transaction because the store locks the chain tail before
 * linking to it; two concurrent appends outside one could otherwise fork the
 * chain. A persistence failure is logged and swallowed: losing an audit row is
 * bad, but failing a user's request because the audit database is unreachable
 * is worse, and the durability flag already tells the truth about the trail.
 */
async function recordAudit(input: AuditInput): Promise<void> {
  if (!auditIsDurable()) {
    fallbackChain.append(input);
    return;
  }
  try {
    const { createPool, PostgresAuditStore, withTransaction } = await import("@legalos/database");
    const pool = await createPool();
    try {
      await withTransaction(pool, (tx) => new PostgresAuditStore(tx).append(input));
    } finally {
      await pool.end();
    }
  } catch (error) {
    console.error("[audit] failed to persist entry", error);
    fallbackChain.append(input);
  }
}

export const PROVENANCE: ProvenanceRecord = {
  modelId: DEFAULT_MODEL,
  promptVersion: PROMPT_VERSION,
  guardrailsVersion: GUARDRAILS_VERSION,
  verificationVersion: "1.0.0",
};

export interface GuardedOutput {
  /** True only when the text may be presented as legal information. */
  readonly released: boolean;
  /** True when the text is not returned at all. */
  readonly withheld: boolean;
  readonly disposition: Disposition;
  readonly policyReasons: readonly PolicyReason[];
  readonly text: string | null;
  readonly findings: readonly Finding[];
  readonly certainty: CertaintyDisclosure;
  readonly resolvedSources: readonly string[];
  readonly provenance: ProvenanceRecord;
}

export interface GuardInput {
  readonly text: string;
  readonly actor: string;
  readonly subject: string;
  /** ISO timestamp; passed in so the audit entry is deterministic in tests. */
  readonly at: string;
  /** Reserved activities escalate regardless of how good the text is. */
  readonly requestedActivity?: string;
  readonly jurisdiction?: string;
}

export async function guardOutput(input: GuardInput): Promise<GuardedOutput> {
  const registry = createUkRegistry();
  const verdict = verify({ text: input.text, registry });
  const certainty = describeCertainty({ verdict });

  const decision = decide({
    verdict,
    ...(input.requestedActivity === undefined
      ? {}
      : { requestedActivity: input.requestedActivity }),
    ...(input.jurisdiction === undefined ? {} : { jurisdiction: input.jurisdiction }),
  });
  const withheld = !decision.displayable;

  await recordAudit({
    at: input.at,
    actor: input.actor,
    action: `MODEL_OUTPUT_${decision.disposition.toUpperCase()}`,
    subject: input.subject,
    payload: {
      verdict: verdict.status,
      disposition: decision.disposition,
      codes: verdict.findings.map((f) => f.code),
      policyCodes: decision.reasons.map((r) => r.code),
      resolvedSources: verdict.resolvedCitations,
      provenance: { ...PROVENANCE },
    },
  });

  return {
    released: decision.releasable,
    withheld,
    disposition: decision.disposition,
    policyReasons: decision.reasons,
    text: withheld ? null : input.text,
    findings: verdict.findings,
    certainty,
    resolvedSources: verdict.resolvedCitations,
    provenance: PROVENANCE,
  };
}

/**
 * Checks case content before it leaves the trust boundary for a third-party
 * model provider. Returns the identifiers found so the caller can decide
 * deliberately rather than discovering it after the fact.
 */
export function outboundConfidentialityCheck(text: string) {
  return inspectConfidentiality(text);
}

export const WITHHELD_MESSAGE =
  "This response was not shown because it did not pass verification. It contained a guarantee, a confidence figure, advice to proceed without a solicitor, or a conclusion the rule engine does not support. Please ask again, or speak to a regulated adviser.";
