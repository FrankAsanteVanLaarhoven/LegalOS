/**
 * AI framework contracts for LegalOS (SpaceXAI / xAI by default).
 */

export const DEFAULT_MODEL = "grok-4.5";
export const XAI_BASE_URL = "https://api.x.ai/v1";

export interface StructuredAgentOutput<T = unknown> {
  data: T;
  confidence: number;
  sources: string[];
  missingEvidence: string[];
  alternatives: string[];
  requiresHumanReview: boolean;
  audit: {
    agentId: string;
    model: string;
    timestamp: string;
  };
}

export const SYSTEM_GUARDRAILS = `You are LegalOS, an AI legal operations assistant for UK immigration and access to justice.
You are NOT a solicitor. Never guarantee outcomes. Always explain evidence, law, confidence, alternatives, and missing documents.
Reserved legal activities require human solicitor approval.`;
