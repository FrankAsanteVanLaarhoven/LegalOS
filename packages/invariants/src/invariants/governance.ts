import { defineInvariant } from "../invariant.ts";

/**
 * Governance invariants — the framework watching itself.
 *
 * These exist because the failure mode this milestone kept hitting was not a
 * bug in a feature. It was a check that looked correct and asked nothing: a
 * capability reported `certified` because a file existed, because an identifier
 * appeared in source, or because a predicate was written `() => null`. Every
 * one was caught by a person doubting a good number, never by the system.
 *
 * Their observations come from the registry's own validator rather than from
 * the filesystem, so they are evaluated on exactly the same footing as every
 * other invariant. A governance rule that got special treatment would be the
 * first place the next quiet exemption appeared.
 */

export const GOVERNANCE = [
  defineInvariant({
    id: "GV-000",
    title: "Nothing is satisfied without a falsifiable observation",
    category: "governance",
    severity: "critical",
    rationale:
      "An observation that has never been seen to fail has not been shown to ask anything. Before a critical invariant may report satisfied, at least one of its observations must have been recorded going false while the property was deliberately broken.",
    observations: ["every_satisfied_critical_invariant_is_falsifiable"],
    capability: "capability_framework",
    protects: [
      "packages/invariants/src/evaluate.ts",
      "packages/invariants/src/falsification.ts",
      "docs/falsification",
    ],
    evidenceKinds: ["integration"],
  }),

  defineInvariant({
    id: "GV-001",
    title: "No capability certifies itself",
    category: "governance",
    severity: "critical",
    rationale:
      "A check gating `verified` or above must read a measurement. A hand-written constant at that level is a declaration wearing the clothes of a check.",
    observations: ["no_self_evident_check_above_operational"],
    capability: "capability_framework",
    protects: ["packages/capabilities/src/platform.ts", "packages/capabilities/src/registry.ts"],
    evidenceKinds: ["integration"],
  }),

  defineInvariant({
    id: "GV-002",
    title: "Every maturity level is derived",
    category: "governance",
    severity: "critical",
    rationale:
      "The level shown is computed from observations taken now. Nothing may raise it by being edited, including the declared ceiling, which was found silently discarding a measurement that had risen above it.",
    observations: ["no_capability_exceeds_its_observations"],
    capability: "capability_framework",
    protects: ["packages/capabilities/src/registry.ts", "packages/capabilities/src/observe.ts"],
    evidenceKinds: ["integration"],
  }),

  defineInvariant({
    id: "GV-003",
    title: "A missing observation fails closed",
    category: "governance",
    severity: "critical",
    rationale:
      "Unmeasurable is not a pass and not a zero. Treating 'I could not measure it' as 'it is fine' is the failure this architecture exists to prevent.",
    observations: ["unavailable_observations_fail_their_checks"],
    capability: "capability_framework",
    protects: ["packages/capabilities/src/observe.ts", "packages/capabilities/src/registry.ts"],
    evidenceKinds: ["integration"],
  }),

  defineInvariant({
    id: "GV-004",
    title: "No invariant without an observer",
    category: "governance",
    severity: "high",
    rationale:
      "An invariant naming no existing observation can never be satisfied. It is legitimate to state one — that is how the registry holds work nobody has instrumented — but it must be counted as work, never as silence.",
    observations: ["every_invariant_names_an_existing_observation"],
    capability: "capability_framework",
    protects: ["packages/invariants/src/registry.ts", "packages/invariants/src/validate.ts"],
    evidenceKinds: ["integration"],
  }),

  defineInvariant({
    id: "GV-005",
    title: "No observer without a test",
    category: "governance",
    severity: "high",
    // Stated without an observer on purpose. The obvious implementation — grep
    // for the observation id inside a test file — is the same shape as the
    // checks that failed here five times: it passes on a filename and a string
    // match, and would report this invariant satisfied while proving nothing.
    // Better to carry it as unmet work than to close it with a weak check.
    rationale:
      "An observation with no test behind it can change meaning silently. What is missing is a way to establish that mechanically; a string match on a test file is not one.",
    observations: ["every_observation_exercised_by_a_test"],
    capability: "capability_framework",
    protects: ["packages/invariants/src/validate.ts", "packages/capabilities/src/observe.ts"],
    evidenceKinds: ["integration"],
  }),
] as const;
