import { evidenceCompleteness } from "@legalos/reliability";

import type { LegalCase } from "@/lib/types";

/**
 * A general prompt for questions that are not about a specific case.
 *
 * Used by every public surface. Injecting an unrelated case file into a
 * stranger's question causes the model to reason about someone else's asylum
 * and medical history, so a case-free path must exist and must be the default.
 */
export function buildGeneralContext(): string {
  return `No case file is attached to this conversation. Answer only in general terms about how UK immigration and access-to-justice processes work. Do not speculate about the user's own circumstances, and do not assume any facts about them that they have not stated.`;
}

export function buildCaseContext(legalCase: LegalCase): string {
  const timeline = legalCase.timeline
    .map((e) => `- ${e.year}: ${e.title} — ${e.description}`)
    .join("\n");

  const evidence = legalCase.evidence
    .map((e) => `- [${e.status}] ${e.title} (${e.category}): ${e.summary}`)
    .join("\n");

  const missingItems = legalCase.evidence.filter(
    (e) => e.status === "missing" || e.status === "requested"
  );
  const missing = missingItems.map((e) => `- ${e.title}`).join("\n");

  // Derived from the evidence register, not read from a stored score. The old
  // `COMPLETENESS: 72%` line passed a hand-typed constant to the model as though
  // it were a measurement of tribunal readiness.
  const completeness = evidenceCompleteness(
    legalCase.evidence.map((e) => e.title),
    legalCase.evidence.map((e) => ({
      id: e.id,
      satisfies: e.title,
      received: e.status !== "missing" && e.status !== "requested",
    }))
  );

  return `
CASE REFERENCE: ${legalCase.reference}
CLIENT: ${legalCase.clientName}
NATIONALITY: ${legalCase.nationality}
LANGUAGES: ${legalCase.languages.join(", ")}
STATUS: ${legalCase.status}
MATTERS: ${legalCase.matterTypes.join(", ")}
EVIDENCE ON FILE: ${completeness.basis}
RISK: ${legalCase.riskLevel}

SUMMARY:
${legalCase.summary}

TIMELINE:
${timeline}

EVIDENCE:
${evidence}

MISSING / REQUESTED EVIDENCE:
${missing || "None flagged"}

DISCLAIMER:
${legalCase.disclaimer}
`.trim();
}

export const PROMPT_VERSION = "2026-07-26.2";

export function explainabilityInstruction(): string {
  // The previous version of this instruction required a "## Confidence (0-100%)"
  // heading on every substantive answer. A model has no calibrated probability
  // over UK immigration outcomes, so that heading manufactured a precise-looking
  // trust signal out of nothing — and it is the single most decision-influencing
  // line on the screen for someone deciding whether to act. It is replaced by
  // the two questions that can be answered honestly.
  return `Structure every substantive answer as:

## What I know
## Evidence used
## Relevant law / policy
## What I could not verify
## What would change this answer
## Alternative interpretations
## Missing evidence
## Recommended next actions

Never state a confidence percentage, probability, or likelihood of success anywhere in the answer.

End with a short reminder that LegalOS is not a solicitor and important steps need human legal review.`;
}
