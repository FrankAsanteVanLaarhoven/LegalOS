import { defineInvariant } from "../invariant.ts";

/**
 * Audit invariants.
 *
 * The audit log is the record that has to hold when everything else is in
 * dispute, so it is the first subsystem measured end to end rather than
 * inferred from the code that writes it.
 *
 * AU-002 exists because of what building it found. The tombstone functions in
 * packages/privacy passed their unit tests while the database refused to
 * execute them: the append-only trigger blocked every UPDATE, and erasing a
 * payload is an UPDATE. Two duties that both had to hold, and the schema made
 * one impossible — visible only once something tried it against a real server.
 */

export const AUDIT = [
  defineInvariant({
    id: "AU-001",
    title: "Audit chain integrity",
    category: "audit",
    severity: "critical",
    rationale:
      "Every entry stays cryptographically linked to the one before it, and an alteration is detectable by recomputation. A log that records events without being able to show it has not been edited proves nothing in the only situation where it is needed.",
    observations: ["audit_chain_valid"],
    capability: "audit",
    protects: [
      "packages/database/src/audit-store.ts",
      "packages/database/migrations/0001_init.sql",
    ],
    evidenceKinds: ["integration", "telemetry", "audit"],
  }),

  defineInvariant({
    id: "AU-002",
    title: "Tombstones preserve chain integrity",
    category: "audit",
    severity: "critical",
    rationale:
      "A person can have their data erased and the history still verifies. The entry hash covers the payload fingerprint rather than the payload, so the content can go while the link survives — which is what lets the right to erasure and an append-only record coexist instead of one defeating the other.",
    observations: ["audit_chain_valid_after_tombstone"],
    capability: "audit",
    protects: [
      "packages/privacy/src/erasure.ts",
      "packages/database/migrations/0004_audit_tombstones.sql",
      "packages/database/src/audit-store.ts",
    ],
    dependsOn: ["AU-001"],
    evidenceKinds: ["integration", "audit"],
  }),

  defineInvariant({
    id: "AU-003",
    title: "Audit events are immutable",
    category: "audit",
    severity: "critical",
    rationale:
      "Entries are appended and never edited or removed. The single exception is erasing a payload, and that exception must permit nothing else — not a changed actor, not a tombstone that quietly keeps the content, not a second tombstone that would let a payload be substituted first.",
    observations: ["audit_append_only"],
    capability: "audit",
    protects: [
      "packages/database/migrations/0001_init.sql",
      "packages/database/migrations/0004_audit_tombstones.sql",
    ],
    evidenceKinds: ["integration", "audit"],
  }),

  defineInvariant({
    id: "AU-004",
    title: "Every model output is reproducible from immutable artefacts",
    category: "audit",
    severity: "critical",
    // Reproducibility rather than traceability. Recording metadata is the easy
    // half; the second observation tests what the first is supposed to
    // guarantee — that the metadata is sufficient, and that the artefacts it
    // cites are still the ones that were used.
    //
    // Replay reconstructs the inputs and does not re-run the model. Nobody can
    // offer deterministic replay of a language model, and claiming it here
    // would be the kind of over-claim this registry exists to catch.
    rationale:
      "When someone asks why the platform recommended something, the execution must be reproducible from immutable artefacts — actor, session, retrieval snapshot, prompt template version, model version, agent, guardrail version, sources and verification state. Approximately is not an answer when a decision affects someone's immigration status, and an appeal may be heard years later.",
    observations: ["ai_execution_reconstructible", "execution_replay_succeeds"],
    capability: "audit",
    protects: [
      "packages/database/migrations/0001_init.sql",
      "packages/ai",
      "packages/verification",
    ],
    evidenceKinds: ["integration", "audit"],
  }),

  defineInvariant({
    id: "AU-005",
    title: "Every AI execution is recorded",
    category: "audit",
    severity: "critical",
    // Strictly stronger than AU-004, which proves an execution can be replayed
    // *if* one exists. This one proves an execution cannot happen without one.
    // A recording system that can be bypassed records whatever nobody needed to
    // hide, which is the least useful subset.
    rationale:
      "A model is reachable only through the execution runner, and the runner writes the record before the provider is called — so a call that fails, times out or is blocked is recorded too. Nothing can be asked of a model in a way that leaves no trace, including by a developer who did not know the rule.",
    observations: ["execution_recorded_for_every_invocation", "provider_access_confined_to_runner"],
    capability: "audit",
    protects: [
      "packages/execution/src/index.ts",
      "packages/database/migrations/0006_execution_lifecycle.sql",
      "packages/providers",
    ],
    dependsOn: ["AU-004"],
    evidenceKinds: ["integration", "telemetry", "audit"],
  }),
] as const;
