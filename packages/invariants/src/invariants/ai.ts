import { defineInvariant } from "../invariant.ts";

/** Invariants over what a model may say, and on whose behalf. */

export const AI = [
  defineInvariant({
    id: "AI-001",
    title: "Every legal statement cites a verified source",
    category: "verification",
    severity: "critical",
    rationale:
      "A statement about the law that cannot be traced to a source someone can read is not advice, it is a guess with a confident tone. The person acting on it carries the consequence.",
    observations: ["verified_source_count", "rule_locators_recorded"],
    capability: "verification",
    protects: ["packages/verification", "packages/rules", "packages/knowledge"],
    evidenceKinds: ["integration", "audit"],
  }),

  defineInvariant({
    id: "AI-002",
    title: "The model never bypasses verification",
    category: "verification",
    severity: "critical",
    rationale:
      "Output reaches a person through the verification gate or not at all. An unverifiable answer is withheld rather than softened, because a hedged wrong answer is still a wrong answer and reads as caution.",
    observations: ["verification_gate_on_all_model_routes"],
    capability: "verification",
    protects: ["packages/verification", "packages/ai", "apps/web/src/app/api"],
    evidenceKinds: ["integration"],
  }),

  defineInvariant({
    id: "AI-003",
    title: "The Companion cannot act outside delegated capability",
    category: "ai",
    severity: "critical",
    rationale:
      "A conversational surface must not become a way to reach actions the person could not otherwise take. Delegation is explicit and narrower than the person's own permissions, never equal to them.",
    observations: ["companion_capability_delegation_enforced"],
    capability: "agents",
    protects: ["packages/agents", "packages/policy"],
    dependsOn: ["INV-004"],
    evidenceKinds: ["integration"],
  }),

  defineInvariant({
    id: "AI-004",
    title: "No prompt crosses a workspace boundary",
    category: "tenancy",
    severity: "critical",
    rationale:
      "The request sent to a model is the last place a boundary can fail silently, because nothing downstream inspects it. What was assembled must be provably from one workspace.",
    observations: ["context_builder_boundary_enforced", "model_payload_boundary_enforced"],
    capability: "agents",
    protects: ["packages/ai", "packages/providers", "packages/knowledge"],
    dependsOn: ["INV-001"],
    evidenceKinds: ["integration", "audit"],
  }),

  defineInvariant({
    id: "AI-005",
    title: "System instructions are not user-controllable",
    category: "ai",
    severity: "high",
    rationale:
      "If a person's own text can rewrite the instructions governing the model, every other guarantee here is advisory.",
    observations: ["system_prompt_immutable_from_input"],
    capability: "agents",
    protects: ["packages/ai", "packages/providers"],
    evidenceKinds: ["integration", "security"],
  }),
] as const;
