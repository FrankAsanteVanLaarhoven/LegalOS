import { defineInvariant } from "../invariant.ts";

/**
 * Benchmark-derived routing.
 *
 * The routing table was a hand-written preference order whose `basis` field
 * read "unmeasured". It was honest about itself and it was still a ranking
 * nobody had established, and the moment a second provider was configured that
 * ranking would have begun deciding which model answered a person's question.
 *
 * BM-002 and BM-005 are declared without observers. Both need benchmark
 * datasets with legal ground truth, and none exists in this repository —
 * building nine suites over datasets that do not exist would be the horizontal
 * expansion that produces artefacts looking like measurement. Stated as unmet
 * work, they are counted; deleted, they would be invisible.
 */

export const BENCHMARK_INVARIANTS = [
  defineInvariant({
    id: "BM-001",
    title: "Routing decisions are derived, never hand-written",
    category: "governance",
    severity: "high",
    rationale:
      "A provider is chosen over another only by citing a benchmark report, its dataset and version. Where one provider is configured nothing is being ranked and the decision says so; where several are and no evidence ranks them, routing refuses rather than picking silently — a silent pick is indistinguishable from a measured one.",
    observations: ["routing_derived_from_benchmarks"],
    capability: "agents",
    protects: [
      "packages/agentos/src/routing.ts",
      "packages/bench/src/routing-evidence.ts",
      "packages/execution/src/runner-factory.ts",
    ],
    dependsOn: ["AG-005"],
    evidenceKinds: ["integration", "static"],
  }),

  defineInvariant({
    id: "BM-002",
    title: "Benchmark datasets are immutable and versioned",
    category: "governance",
    severity: "high",
    rationale:
      "A routing decision cites a dataset at a version and digest. A dataset edited without its digest changing would leave every decision that cited it describing an evaluation that no longer exists.",
    observations: ["dataset_governance_enforced"],
    capability: "agents",
    protects: ["packages/bench/src/routing-evidence.ts"],
    evidenceKinds: ["integration", "audit"],
  }),

  defineInvariant({
    id: "BM-003",
    title: "Routing evidence is current",
    category: "governance",
    severity: "high",
    rationale:
      "Evidence expires and expired evidence supports nothing. Models change behind a version string, so a ranking from six months ago describes a system that may no longer exist — and a stale ranking reads exactly like a fresh one.",
    observations: ["routing_derived_from_benchmarks"],
    capability: "agents",
    protects: ["packages/agentos/src/routing.ts"],
    dependsOn: ["BM-001"],
    evidenceKinds: ["integration"],
  }),

  defineInvariant({
    id: "BM-004",
    title: "No provider is preferred without evidence",
    category: "governance",
    severity: "critical",
    rationale:
      "Choosing between configured providers requires a benchmark that ranks them, at adequate sample size and repeated. Better for a capability to be unavailable than for the platform to answer a question about someone's immigration status using a model chosen by the order of a hand-written list.",
    observations: ["routing_derived_from_benchmarks"],
    capability: "agents",
    protects: ["packages/agentos/src/routing.ts"],
    dependsOn: ["BM-001"],
    evidenceKinds: ["integration", "audit"],
  }),

  defineInvariant({
    id: "BM-005",
    title: "Routing evidence is reproducible",
    category: "governance",
    severity: "high",
    // No observer: reproducing a benchmark requires a benchmark to reproduce.
    // The sample and repeat floors are enforced today, which is a weaker
    // property than reproducibility and is not claimed as the same thing.
    rationale:
      "A ranking is reproducible from its dataset version, evaluation commit and repeat count, so a routing change can be checked by someone outside the project rather than taken on the report's word.",
    observations: ["routing_evidence_reproduced"],
    capability: "agents",
    protects: ["packages/bench/src/routing-evidence.ts"],
    dependsOn: ["BM-002"],
    evidenceKinds: ["integration", "audit"],
  }),

  defineInvariant({
    id: "BM-006",
    title: "Routing evidence is bound to the environment it measured",
    category: "governance",
    severity: "high",
    // Age alone is the weaker half of expiry. Thirty days is a guess about how
    // long a ranking stays true; a changed prompt template, guardrail version
    // or model id is a fact that it stopped being true, and the two should not
    // be treated as the same kind of reason.
    rationale:
      "Evidence records the execution environment it was produced against, and a change to any prompt template, guardrail version, model id or retrieval configuration retires it immediately rather than in a month. Evidence for a system that no longer exists reads exactly like current evidence.",
    observations: ["routing_derived_from_benchmarks"],
    capability: "agents",
    protects: ["packages/bench/src/routing-evidence.ts", "packages/agentos/src/routing.ts"],
    dependsOn: ["BM-003"],
    evidenceKinds: ["integration"],
  }),
] as const;
