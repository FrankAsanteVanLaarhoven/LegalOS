import { defineInvariant } from "../invariant.ts";

/**
 * Security invariants.
 *
 * Several name observations that do not exist yet. That is deliberate: the
 * registry has to be able to state a property nobody has instrumented, or the
 * only way to make the report look good is to delete the property. An invariant
 * with no observer reports `no_observer` and can never be satisfied, so it
 * appears as work rather than as a pass.
 */

export const SECURITY = [
  defineInvariant({
    id: "INV-001",
    title: "Tenant isolation",
    category: "tenancy",
    severity: "critical",
    rationale:
      "Evidence belonging to one workspace must never be observable from another. For someone whose asylum claim rests on documents they cannot replace, a leak across this boundary is not a privacy incident — it can reach the person they fled.",
    // Five boundaries, not one. A release policy that blocks the final answer
    // is no help if retrieval already crossed the boundary: the document was
    // read, and a cache or a log may already hold it.
    observations: [
      "tenant_scoped_lookup",
      "retrieval_boundary_enforced",
      "context_builder_boundary_enforced",
      "model_payload_boundary_enforced",
      "response_release_boundary_enforced",
    ],
    capability: "authentication",
    protects: [
      "packages/auth",
      "packages/database/src/session-store.ts",
      "packages/database/src/account-store.ts",
      "apps/web/src/middleware.ts",
    ],
    evidenceKinds: ["integration", "telemetry", "audit"],
  }),

  defineInvariant({
    id: "INV-002",
    title: "Session integrity",
    category: "security",
    severity: "critical",
    rationale:
      "A session must survive a restart, end when revoked, and make a replayed token visible rather than serving it.",
    observations: ["session_durability_survives_restart", "session_revocation_propagates"],
    capability: "authentication",
    protects: [
      "packages/auth/src/index.ts",
      "packages/database/src/session-store.ts",
      "packages/database/migrations/0003_auth.sql",
    ],
    evidenceKinds: ["integration", "telemetry"],
  }),

  defineInvariant({
    id: "INV-003",
    title: "Authentication required",
    category: "security",
    severity: "critical",
    rationale:
      "Every workspace action is attributable to an identity verified at the handler, not inferred from a cookie's shape at the edge.",
    observations: ["session_verified_in_route", "auth_middleware_present"],
    capability: "authentication",
    protects: ["apps/web/src/middleware.ts", "apps/web/src/lib/auth"],
    dependsOn: ["INV-002"],
    evidenceKinds: ["integration"],
  }),

  defineInvariant({
    id: "INV-004",
    title: "Authorisation enforced",
    category: "security",
    severity: "critical",
    rationale:
      "Membership decides what a person may do. There is no default role: absence of a membership is a refusal, not a reader.",
    observations: ["membership_required_in_route", "reserved_actions_gated"],
    capability: "authentication",
    protects: ["packages/auth/src/index.ts", "apps/web/src/lib/auth"],
    dependsOn: ["INV-003"],
    evidenceKinds: ["integration"],
  }),

  defineInvariant({
    id: "INV-005",
    title: "Emergency access expires",
    category: "security",
    severity: "high",
    rationale:
      "Access granted in an emergency must end on its own and be audited, or the emergency becomes the permanent state.",
    observations: ["emergency_access_time_limited", "emergency_access_audited"],
    capability: "authentication",
    protects: ["packages/auth", "packages/governance"],
    dependsOn: ["INV-004"],
    evidenceKinds: ["integration", "telemetry"],
  }),

  defineInvariant({
    id: "INV-006",
    title: "Secrets never exposed",
    category: "security",
    severity: "critical",
    rationale:
      "Bearer tokens are stored as hashes and API keys are never logged, so a database copy does not hand over live sessions.",
    observations: ["tokens_stored_hashed", "secrets_absent_from_logs"],
    capability: "authentication",
    protects: [
      "packages/auth/src/index.ts",
      "packages/database/migrations/0003_auth.sql",
      "packages/providers",
    ],
    evidenceKinds: ["integration", "audit"],
  }),

  defineInvariant({
    id: "INV-007",
    title: "Rate limits apply per identity",
    category: "security",
    severity: "high",
    rationale:
      "Limits are keyed to the account rather than the address, because asylum accommodation, libraries and charity offices put many people behind one IP and an address limit either locks out a building or protects nothing.",
    observations: ["rate_limiting_present"],
    capability: "authentication",
    protects: ["packages/ratelimit"],
    evidenceKinds: ["integration"],
  }),
] as const;
