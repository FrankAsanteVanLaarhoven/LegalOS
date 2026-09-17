import { defineInvariant } from "../invariant.ts";

/**
 * Privacy invariants.
 *
 * PR-001 and PR-006 are in tension by construction: erasure must remove the
 * content, and the audit chain must still verify afterwards. They are stated as
 * two invariants rather than one so that satisfying either by abandoning the
 * other is visible instead of quiet.
 */

export const PRIVACY = [
  defineInvariant({
    id: "PR-001",
    title: "Erasure removes the content",
    category: "privacy",
    severity: "critical",
    rationale:
      "When someone asks for their data to be deleted, the payload goes. For a person who has left an abusive household, this is not paperwork.",
    observations: ["erasure_removes_payload"],
    capability: "audit",
    protects: ["packages/privacy", "packages/database/src/audit-store.ts"],
    evidenceKinds: ["integration", "audit"],
  }),

  defineInvariant({
    id: "PR-002",
    title: "Consent precedes processing",
    category: "privacy",
    severity: "high",
    rationale:
      "Evidence is processed for the purpose the person agreed to, recorded at the time rather than inferred later.",
    observations: ["consent_recorded_before_processing"],
    capability: "ingestion",
    protects: ["packages/privacy", "packages/evidence"],
    evidenceKinds: ["integration"],
  }),

  defineInvariant({
    id: "PR-003",
    title: "Purpose limitation",
    category: "privacy",
    severity: "high",
    rationale:
      "Data gathered for a case is not reused for another purpose, including improving the system.",
    observations: ["purpose_recorded_per_record", "no_training_on_case_data"],
    capability: "ingestion",
    protects: ["packages/privacy", "packages/evidence"],
    evidenceKinds: ["integration", "audit"],
  }),

  defineInvariant({
    id: "PR-004",
    title: "Retention enforced",
    category: "privacy",
    severity: "high",
    rationale: "Records expire on a schedule that runs, rather than a policy that is written down.",
    observations: ["retention_job_runs", "expired_records_absent"],
    capability: "audit",
    protects: ["packages/privacy", "packages/database"],
    evidenceKinds: ["integration", "telemetry"],
  }),

  defineInvariant({
    id: "PR-005",
    title: "Export is complete",
    category: "privacy",
    severity: "high",
    rationale:
      "A person can take everything they put in, in a form another adviser can open. A partial export is worse than none, because it looks like the whole file.",
    observations: ["export_covers_all_tables"],
    capability: "ingestion",
    protects: ["packages/privacy", "packages/database"],
    evidenceKinds: ["integration"],
  }),

  defineInvariant({
    id: "PR-006",
    title: "Deletion is auditable and the chain still verifies",
    category: "privacy",
    severity: "critical",
    rationale:
      "Erasure leaves a tombstone carrying the payload hash, so the audit chain verifies without the content. Otherwise the two duties — delete on request, keep an append-only record — can only be met by breaking one.",
    observations: ["tombstone_preserves_hash", "audit_chain_valid_after_tombstone"],
    capability: "audit",
    protects: ["packages/privacy", "packages/database/src/audit-store.ts"],
    dependsOn: ["PR-001"],
    evidenceKinds: ["integration", "audit"],
  }),
] as const;
