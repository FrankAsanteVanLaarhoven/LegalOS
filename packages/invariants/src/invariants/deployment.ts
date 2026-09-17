import { defineInvariant } from "../invariant.ts";

/**
 * Deployment invariants.
 *
 * A deployment is not successful because a workflow completed. It is successful
 * because the required evidence was produced and verified — and the difference
 * only shows when someone asks, months later, on what basis a version went to
 * production. "The pipeline was green" is not an answer anybody can check.
 *
 * DP-002 has no observer, and the reason is worth stating rather than hiding:
 * no deployment has happened. The rule that every release produces evidence
 * cannot be measured against a history with nothing in it, and an observation
 * that is true because there is nothing to check is the vacuous pass this
 * registry already refuses for GV-000.
 */

export const DEPLOYMENT_INVARIANTS = [
  defineInvariant({
    id: "DP-001",
    title: "No release without a passing readiness check",
    category: "governance",
    severity: "critical",
    rationale:
      "A release record carrying a failed readiness result is refused rather than written as unsuccessful. An unsuccessful deployment is a rollback; recording it as a release would leave a record of something that did not happen.",
    observations: ["release_evidence_enforced"],
    capability: "audit",
    protects: ["packages/readiness/src/release.ts", ".github/workflows/deployment-readiness.yml"],
    evidenceKinds: ["integration", "audit"],
  }),

  defineInvariant({
    id: "DP-002",
    title: "Every production deployment produces immutable release evidence",
    category: "governance",
    severity: "high",
    // No observer: nothing has been deployed. Measuring this against an empty
    // history would pass because there is nothing to check, which is the
    // vacuous pass GV-000 exists to refuse.
    rationale:
      "Each release appends a record carrying its commit, migration set, readiness result and health checks, chained so the history cannot be rewritten after an incident.",
    observations: ["release_history_complete"],
    capability: "audit",
    protects: ["packages/readiness/src/release.ts"],
    dependsOn: ["DP-001"],
    evidenceKinds: ["integration", "telemetry", "audit"],
  }),

  defineInvariant({
    id: "DP-003",
    title: "Every rollback produces immutable evidence",
    category: "governance",
    severity: "high",
    rationale:
      "A rollback is an operational event with a reason, an operator and a target, not the silent replacement of one deployment by another. It is always recordable — refusing to record one would strand an outage behind a governance rule.",
    observations: ["release_evidence_enforced"],
    capability: "audit",
    protects: ["packages/readiness/src/release.ts"],
    dependsOn: ["DP-001"],
    evidenceKinds: ["integration", "audit"],
  }),

  defineInvariant({
    id: "DP-004",
    title: "Applied migrations are recorded with the release",
    category: "governance",
    severity: "high",
    rationale:
      "A release names the migration set it ran against, so a later question about what schema was live on a given day has an answer that does not depend on anyone remembering.",
    observations: ["release_evidence_enforced"],
    capability: "audit",
    protects: ["packages/readiness/src/release.ts"],
    dependsOn: ["DP-001"],
    evidenceKinds: ["integration"],
  }),

  defineInvariant({
    id: "DP-005",
    title: "Health checks pass before a release is recorded",
    category: "governance",
    severity: "critical",
    rationale:
      "A release with no health checks and a release whose health checks failed are both refused, and only one of them means somebody ran the checks. Recording either as successful would make the history say a deployment was verified when it was not.",
    observations: ["release_evidence_enforced"],
    capability: "audit",
    protects: ["packages/readiness/src/release.ts"],
    dependsOn: ["DP-001"],
    evidenceKinds: ["integration"],
  }),
] as const;
