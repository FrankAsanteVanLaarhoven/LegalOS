import { defineInvariant } from "../invariant.ts";

/**
 * Agent governance.
 *
 * The platform had four agent lists that disagreed with each other, and an
 * `agentId` was a string a route passed through. Neither is a governance
 * failure on its own; together they mean nobody could say what an agent was
 * permitted to do, because there was no single answer to what the agents were.
 */

export const AGENT_INVARIANTS = [
  defineInvariant({
    id: "AG-001",
    title: "Every execution names a registered agent",
    category: "governance",
    severity: "critical",
    rationale:
      "An id nobody registered is refused before a provider is reachable. Otherwise work runs under a name with no declared permissions, no department and no invariants — and having no permissions reads as unrestricted rather than as refused.",
    observations: ["agent_resolved_from_registry"],
    capability: "agents",
    protects: ["packages/agentos/src/registry.ts", "packages/execution/src/index.ts"],
    dependsOn: ["AU-005"],
    evidenceKinds: ["integration", "telemetry"],
  }),

  defineInvariant({
    id: "AG-002",
    title: "The registry is the only list of agents",
    category: "governance",
    severity: "high",
    rationale:
      "Four lists disagreed — eleven ids in one package, fifteen in a data file, eight page slugs and a map naming twelve — and nothing compared them, so a page could advertise an agent the platform did not have.",
    observations: ["agent_lists_reconciled"],
    capability: "agents",
    protects: [
      "packages/agentos/src/registry.ts",
      "packages/agents/src/index.ts",
      "apps/web/src/lib/data/agents.ts",
      "apps/web/src/lib/data/agent-pages.ts",
    ],
    evidenceKinds: ["integration", "static"],
  }),

  defineInvariant({
    id: "AG-003",
    title: "No agent may file or delete",
    category: "governance",
    severity: "critical",
    // Enforced structurally rather than observed at runtime: an agent declaring
    // either permission fails the build, so there is no state of the system in
    // which one holds it. Withheld not because they are unimplemented but
    // because a machine doing either without a named human deciding is a
    // reserved legal activity and an irreversible loss of someone's evidence.
    rationale:
      "No agent may submit a filing or delete evidence, whatever it declares. A machine doing either without a named person deciding is the failure this platform exists to prevent, and it must not be reachable by editing a definition.",
    observations: ["agent_resolved_from_registry"],
    capability: "agents",
    protects: ["packages/agentos/src/validate.ts", "packages/agentos/src/types.ts"],
    evidenceKinds: ["integration", "audit"],
  }),

  defineInvariant({
    id: "AG-004",
    title: "Agent standing is derived from an auditable projection",
    category: "governance",
    severity: "critical",
    // The projection exists so standing does not scan an append-only event log
    // on every read. That is a performance decision; what makes it *safe* is
    // that whether the projection still matches the log is itself measurable.
    // Without that, a stale or edited metrics table is indistinguishable from a
    // correct one, and standing would rest on a number nobody can trace — the
    // failure this architecture exists to prevent, reintroduced through a cache.
    rationale:
      "Agent standing is computed from agent_metrics, which is derived from the immutable execution log and never edited. A projection that has drifted from the log is detected rather than read, so no agent can appear to be doing well on the strength of a number with nothing behind it.",
    observations: ["agent_metrics_projection_faithful"],
    capability: "agents",
    protects: [
      "packages/database/src/agent-metrics.ts",
      "packages/database/migrations/0007_agent_metrics.sql",
      "packages/agentos/src/standing.ts",
    ],
    dependsOn: ["AU-005"],
    evidenceKinds: ["integration", "telemetry", "audit"],
  }),

  defineInvariant({
    id: "AG-005",
    title: "Providers are selected by capability, never named by a caller",
    category: "governance",
    severity: "high",
    // The point is not that one model is better than another. It is that which
    // model serves a capability must be changeable in one table without
    // touching an agent definition or a route — and a caller that can name a
    // provider has already made the routing table a description of a decision
    // nobody makes.
    //
    // The request type omits provider, model and model version, so this holds
    // at compile time as well as being measured at runtime.
    rationale:
      "A request declares the capability it needs and the routing table resolves a provider. Changing which model serves a capability is then a change to one table, and an agent asking for a capability it never declared is refused rather than served.",
    observations: ["provider_selected_by_capability_router"],
    capability: "agents",
    protects: [
      "packages/agentos/src/routing.ts",
      "packages/execution/src/index.ts",
      "apps/web/src/app/api/chat/route.ts",
      "apps/web/src/app/api/analyze/route.ts",
    ],
    dependsOn: ["AG-001"],
    evidenceKinds: ["integration", "static"],
  }),
] as const;
