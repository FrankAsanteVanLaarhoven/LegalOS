/** Shared types and constants across LegalOS packages */

export type CaseStatus =
  | "intake"
  | "evidence_collection"
  | "analysis"
  | "lawyer_review"
  | "appeal_pending"
  | "submitted"
  | "closed";

export interface ConfidenceScore {
  value: number;
  label: "low" | "medium" | "high";
  rationale?: string;
}

export const APP_NAME = "LegalOS";
export const APP_TAGLINE = "Legal Intelligence Operating System";
