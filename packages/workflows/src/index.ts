/** Temporal-style workflow definitions (v0.2+). */
export type WorkflowName =
  "evidence_collection" | "medico_legal_request" | "solicitor_review" | "bundle_assembly";

export interface WorkflowRun {
  id: string;
  caseId: string;
  name: WorkflowName;
  status: "running" | "completed" | "failed" | "cancelled";
}
