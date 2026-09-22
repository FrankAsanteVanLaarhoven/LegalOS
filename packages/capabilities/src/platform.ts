import { booleanOf, numberOf, type ObservationSet } from "./observe.ts";
import type { CapabilityCheck, CapabilityDefinition } from "./types.ts";

/**
 * The platform capability set.
 *
 * Every check reads an Observation rather than asserting a fact. A check can
 * therefore fail in two distinguishable ways: the state was measured and found
 * wanting, or nothing could measure it. Both fail closed — but the first needs
 * building and the second needs instrumenting, and a roadmap that conflates
 * them sends people to the wrong work.
 *
 * `declaredImplementation` and `declaredEvidence` are ceilings, not claims. The
 * level shown is whatever the observations support, and can only be lower.
 */

interface CheckSpec {
  readonly id: string;
  readonly label: string;
  readonly dimension: CapabilityCheck["dimension"];
  readonly gates: CapabilityCheck["gates"];
  readonly observationId: string;
  readonly detail: string;
  readonly nextAction: string;
}

/** Builds a check from an observation and a predicate over its value. */
function fromObservation(
  observations: ObservationSet,
  spec: CheckSpec,
  predicate: (observations: ObservationSet) => boolean | null
): CapabilityCheck {
  const observation = observations.get(spec.observationId);
  const result = predicate(observations);
  const unmeasured = result === null;

  return {
    id: spec.id,
    label: spec.label,
    dimension: spec.dimension,
    gates: spec.gates,
    // Fail closed: an unmeasurable check is never satisfied.
    satisfied: result === true,
    detail: unmeasured
      ? `Cannot be measured — ${observation?.unavailableReason ?? "no observer for this state"}.`
      : spec.detail,
    nextAction: unmeasured
      ? `Instrument this: ${observation?.method ?? spec.observationId} currently yields nothing.`
      : spec.nextAction,
    observationId: spec.observationId,
    method: observation?.method ?? null,
    unmeasured,
  };
}

/**
 * A check with no observation behind it — reserved for facts about this
 * repository that are true by construction, such as "this package exists and
 * has tests in it". Kept deliberately rare.
 */
function selfEvident(
  id: string,
  label: string,
  dimension: CapabilityCheck["dimension"],
  gates: CapabilityCheck["gates"],
  satisfied: boolean,
  detail: string,
  nextAction: string
): CapabilityCheck {
  return {
    id,
    label,
    dimension,
    gates,
    satisfied,
    detail,
    nextAction,
    observationId: null,
    method: "asserted in the capability definition",
    unmeasured: false,
  };
}

const gtZero = (id: string) => (o: ObservationSet) => {
  const n = numberOf(o, id);
  return n === null ? null : n > 0;
};

const isTrue = (id: string) => (o: ObservationSet) => booleanOf(o, id);

const benchAbove = (threshold: number) => (o: ObservationSet) => {
  const rate = numberOf(o, "bench_pass_rate");
  return rate === null ? null : rate >= threshold;
};

const linesAbove = (id: string, threshold: number) => (o: ObservationSet) => {
  const lines = numberOf(o, id);
  return lines === null ? null : lines > threshold;
};

export const PLATFORM_CAPABILITIES: readonly CapabilityDefinition[] = [
  {
    id: "verification",
    name: "Output verification",
    description: "Every model answer passes a fail-closed gate before it can reach a user.",
    declaredImplementation: "certified",
    declaredEvidence: "independent_replication",
    checks: (o) => [
      selfEvident(
        "impl",
        "Implemented and wired into both AI routes",
        "implementation",
        "operational",
        true,
        "",
        ""
      ),
      selfEvident("tested", "Unit tested", "evidence", "unit_tests", true, "", ""),
      fromObservation(
        o,
        {
          id: "authn",
          label: "Requests authenticated",
          dimension: "implementation",
          gates: "certified",
          observationId: "session_verified_in_route",
          detail:
            "Routes are gated at the edge, but no handler verifies the session, so output is not yet tied to a known caller.",
          nextAction: "Verify the session in route handlers so answers attach to an identity.",
        },
        isTrue("session_verified_in_route")
      ),
      fromObservation(
        o,
        {
          id: "benched",
          label: "Benchmark validated",
          dimension: "evidence",
          gates: "benchmark_validated",
          observationId: "bench_pass_rate",
          detail: "The benchmark scored below the 95% release threshold.",
          nextAction: "Raise the benchmark pass rate above 95%.",
        },
        benchAbove(0.95)
      ),
      fromObservation(
        o,
        {
          id: "audited",
          label: "Externally audited",
          dimension: "evidence",
          gates: "external_audit",
          observationId: "external_audit_record",
          detail: "No external audit record exists.",
          nextAction: "Commission an external review and record the artefact.",
        },
        isTrue("external_audit_record")
      ),
    ],
  },
  {
    id: "audit",
    name: "Audit trail",
    description: "Hash-chained, append-only record of every released or withheld answer.",
    declaredImplementation: "certified",
    declaredEvidence: "production_telemetry",
    checks: (o) => [
      selfEvident("impl", "Implemented", "implementation", "implemented", true, "", ""),
      fromObservation(
        o,
        {
          id: "durable",
          label: "Durable storage in use",
          dimension: "implementation",
          gates: "operational",
          observationId: "source_chunk_count",
          detail: "No database is reachable, so the chain is process-local.",
          nextAction: "Set DATABASE_URL and run the migrations.",
        },
        // The corpus count is queried through the same connection, so a
        // successful query is itself evidence that storage is reachable.
        (obs) => (obs.get("source_chunk_count")?.source === "database" ? true : null)
      ),
      selfEvident("tested", "Unit tested", "evidence", "unit_tests", true, "", ""),
      fromObservation(
        o,
        {
          id: "telemetry",
          label: "Measured in production",
          dimension: "evidence",
          gates: "production_telemetry",
          observationId: "production_telemetry",
          detail: "No telemetry is collected.",
          nextAction: "Instrument audit-write success rates in production.",
        },
        isTrue("production_telemetry")
      ),
    ],
  },
  {
    id: "rule_engine",
    name: "Rule engine",
    description: "Deterministic three-valued evaluation of legal requirements.",
    declaredImplementation: "certified",
    declaredEvidence: "benchmark_validated",
    checks: (o) => [
      selfEvident("impl", "Implemented", "implementation", "implemented", true, "", ""),
      selfEvident("tested", "Unit tested", "evidence", "unit_tests", true, "", ""),
      fromObservation(
        o,
        {
          id: "locators",
          label: "Rule locators recorded",
          dimension: "implementation",
          gates: "certified",
          observationId: "rule_locators_recorded",
          detail:
            "Paragraph locators are unrecorded, so no result is releasable as a legal conclusion.",
          nextAction:
            "Record the paragraph locator for each requirement against the published rule text.",
        },
        isTrue("rule_locators_recorded")
      ),
      fromObservation(
        o,
        {
          id: "benched",
          label: "Benchmark validated",
          dimension: "evidence",
          gates: "benchmark_validated",
          observationId: "bench_pass_rate",
          detail: "The benchmark scored below the 95% release threshold.",
          nextAction: "Raise the benchmark pass rate above 95%.",
        },
        benchAbove(0.95)
      ),
    ],
  },
  {
    id: "knowledge_sources",
    name: "Legal source registry",
    description: "Machine-readable sources with retrieval date, version and checksum.",
    declaredImplementation: "certified",
    declaredEvidence: "unit_tests",
    checks: (o) => [
      selfEvident("impl", "Implemented", "implementation", "implemented", true, "", ""),
      selfEvident("tested", "Unit tested", "evidence", "unit_tests", true, "", ""),
      fromObservation(
        o,
        {
          id: "verified_sources",
          label: "At least one verified source",
          dimension: "implementation",
          gates: "operational",
          observationId: "verified_source_count",
          detail: "Every registered source is unverified: nothing has been checksummed.",
          nextAction:
            "Retrieve each source, record its version and retrieval date, and store its checksum.",
        },
        gtZero("verified_source_count")
      ),
    ],
  },
  {
    id: "research_retrieval",
    name: "Research retrieval (RAG)",
    description: "Retrieval over an ingested corpus of legislation and guidance.",
    declaredImplementation: "certified",
    declaredEvidence: "benchmark_validated",
    checks: (o) => [
      fromObservation(
        o,
        {
          id: "impl",
          label: "Ingestion pipeline implemented",
          dimension: "implementation",
          gates: "implemented",
          observationId: "ingestion_lines",
          detail: "services/ingestion is a stub.",
          nextAction:
            "Build the ingestion service: fetch, parse, version and checksum official sources.",
        },
        linesAbove("ingestion_lines", 20)
      ),
      fromObservation(
        o,
        {
          id: "corpus",
          label: "Corpus populated",
          dimension: "implementation",
          gates: "operational",
          observationId: "source_chunk_count",
          detail: "The source_chunks table has no ingested content.",
          nextAction: "Run ingestion to populate source_chunks and generate embeddings.",
        },
        gtZero("source_chunk_count")
      ),
    ],
  },
  {
    id: "evidence_graph",
    name: "Evidence & knowledge graph",
    description: "Typed graph where every relationship records why it exists and who asserted it.",
    declaredImplementation: "certified",
    declaredEvidence: "unit_tests",
    checks: (o) => [
      selfEvident("impl", "Implemented", "implementation", "implemented", true, "", ""),
      selfEvident("tested", "Unit tested", "evidence", "unit_tests", true, "", ""),
      fromObservation(
        o,
        {
          id: "persisted",
          label: "Persisted to storage",
          dimension: "implementation",
          gates: "operational",
          observationId: "graph_tables_present",
          detail: "The graph is in-memory; no migration defines graph tables.",
          nextAction: "Add graph_nodes and graph_edges migrations and persist the graph.",
        },
        isTrue("graph_tables_present")
      ),
    ],
  },
  {
    id: "human_review",
    name: "Human review & approvals",
    description: "Reserved activities require a named, regulated human. AI proposes only.",
    declaredImplementation: "certified",
    declaredEvidence: "unit_tests",
    checks: (o) => [
      selfEvident("impl", "Implemented", "implementation", "implemented", true, "", ""),
      selfEvident("tested", "Unit tested", "evidence", "unit_tests", true, "", ""),
      fromObservation(
        o,
        {
          id: "identity",
          label: "Reviewer identity established",
          dimension: "implementation",
          gates: "operational",
          observationId: "session_verified_in_route",
          detail:
            "A middleware gate is not an identity. Until a handler verifies the session, an approval cannot be bound to a known person.",
          nextAction: "Verify sessions in handlers so an approval names a real reviewer.",
        },
        isTrue("session_verified_in_route")
      ),
    ],
  },
  {
    id: "authentication",
    name: "Authentication & authorisation",
    description: "Session identity, tenant isolation and per-identity rate limiting.",
    declaredImplementation: "certified",
    // Raised from `unit_tests` once integration evidence started arriving. The
    // ceiling was set when unit tests were all that existed, and a stale ceiling
    // silently discards a measurement that rose above it — which puts a
    // hand-edited constant back in charge of the level, the one thing this model
    // exists to prevent. Telemetry from a running system is the real target.
    declaredEvidence: "production_telemetry",
    checks: (o) => [
      fromObservation(
        o,
        {
          id: "impl",
          label: "Implemented",
          dimension: "implementation",
          gates: "implemented",
          observationId: "auth_package_lines",
          detail: "packages/auth is type declarations only; no route is authenticated.",
          nextAction: "Implement sessions, authorisation and tenant isolation.",
        },
        linesAbove("auth_package_lines", 40)
      ),
      fromObservation(
        o,
        {
          id: "rate_limit",
          label: "Rate limiting on model routes",
          dimension: "implementation",
          gates: "operational",
          observationId: "rate_limiting_present",
          detail: "No rate limiting is applied on the model-backed routes.",
          nextAction: "Add rate limiting on the model-backed routes.",
        },
        isTrue("rate_limiting_present")
      ),
      // Added after the capability briefly reported `certified` on the strength
      // of a package and a limiter alone. Sessions existing is not the same as
      // routes being authenticated, and without this check nothing measured the
      // difference.
      fromObservation(
        o,
        {
          id: "middleware",
          label: "Routes actually authenticated",
          dimension: "implementation",
          gates: "operational",
          observationId: "auth_middleware_present",
          detail:
            "Session handling exists but no middleware gates the routes, so nothing is authenticated yet.",
          nextAction: "Add middleware resolving a session and gating /api and /workspace.",
        },
        isTrue("auth_middleware_present")
      ),
      // Added after the capability reported `certified` on the strength of a
      // middleware file. The edge only checks a cookie's shape; until a handler
      // verifies the session against the store there is no identity behind it.
      fromObservation(
        o,
        {
          id: "session_verified",
          label: "Sessions verified in handlers",
          dimension: "implementation",
          gates: "certified",
          observationId: "session_verified_in_route",
          detail:
            "Middleware checks the cookie shape only; no route handler verifies the session against the store, so nothing establishes who is calling.",
          nextAction:
            "Verify the session in route handlers, and issue sessions through a real sign-in.",
        },
        isTrue("session_verified_in_route")
      ),
      // Fourth correction in this milestone, and the same shape each time: the
      // previous check asked an easier question than the one that mattered.
      // Verifying a session in a handler says nothing about whether sessions
      // survive a restart, or whether anyone but a developer can obtain one.
      fromObservation(
        o,
        {
          id: "durable_sessions",
          label: "Sessions durable and obtainable",
          dimension: "implementation",
          gates: "certified",
          observationId: "session_store_durable",
          // Two conditions, and the message used to assert the first regardless
          // of which failed — so a deployment with a durable store still read as
          // "sessions are held in memory". A check that reports the wrong reason
          // sends someone to fix something that is not broken.
          detail:
            "Either sessions are not backed by the sessions table, or the only way to obtain one is the development route. Both must hold: durable storage nobody can sign in to, and a sign-in that loses its sessions on restart, are each incomplete.",
          nextAction:
            "Back the session store with the sessions table, and build sign-in on the account, passkey and recovery logic that already exists.",
        },
        (obs) =>
          booleanOf(obs, "session_store_durable") === null
            ? null
            : Boolean(booleanOf(obs, "session_store_durable")) &&
              Boolean(booleanOf(obs, "real_sign_in_exists"))
      ),
      // The full bar for certified, defined up front rather than discovered.
      //
      // Four times in this milestone a capability reported certified and a
      // check was added afterwards to correct it. That is reactive by
      // construction and misses whatever nobody thought of. Stating every
      // condition now means certified is reached by satisfying a known list,
      // and the ones that cannot be measured by reading source say so — they
      // fail closed and name the integration test that would settle them.
      ...(
        [
          // Distinct from `durable_sessions` above, which reads the source and
          // the configuration — that a durable path is wired. This one is a
          // measurement: a session was written, every connection closed, and it
          // was still valid on the other side. The wiring can be right while the
          // behaviour is wrong, and only the second question protects anyone.
          [
            "durability_proven",
            "Durability proven across restart",
            "session_durability_survives_restart",
          ],
          ["revocation", "Revocation propagates", "session_revocation_propagates"],
          ["cache", "Cache invalidation correct", "cache_invalidation_correct"],
          ["mfa", "MFA enforced by policy", "mfa_enforced_by_policy"],
          ["signout", "Cross-device sign-out works", "cross_device_signout"],
          ["recovery_flow", "Recovery workflow operational", "recovery_workflow_operational"],
          ["auth_audit", "Authentication actions audited", "auth_audit_events_emitted"],
        ] as const
      ).map(([id, label, observationId]) =>
        fromObservation(
          o,
          {
            id,
            label,
            dimension: "implementation" as const,
            gates: "certified" as const,
            observationId,
            detail: "The integration suite ran and this guarantee did not hold.",
            nextAction: "Add an integration test against a running system that demonstrates this.",
          },
          // Reads the observation. It was `() => null` while these could only
          // ever be unavailable, which quietly meant the check asked nothing —
          // so producing evidence had no effect until this was fixed.
          isTrue(observationId)
        )
      ),
      fromObservation(
        o,
        {
          id: "integration_tested",
          label: "Middleware exercised by integration tests",
          dimension: "evidence",
          gates: "integration_tests",
          observationId: "auth_integration_tests",
          detail: "No integration test exercises the authentication middleware.",
          nextAction: "Add an integration suite covering the middleware and session lifecycle.",
        },
        isTrue("auth_integration_tests")
      ),
      selfEvident("tested", "Unit tested", "evidence", "unit_tests", true, "", ""),
    ],
  },
  {
    id: "workflow_engine",
    name: "Workflow engine",
    description: "Tasks, deadlines, bundles and evidence requests generated from case state.",
    declaredImplementation: "certified",
    declaredEvidence: "unit_tests",
    checks: (o) => [
      fromObservation(
        o,
        {
          id: "impl",
          label: "Implemented",
          dimension: "implementation",
          gates: "implemented",
          observationId: "workflow_lines",
          detail: "packages/workflows is a stub.",
          nextAction: "Implement task, deadline and bundle generation from case state.",
        },
        linesAbove("workflow_lines", 30)
      ),
    ],
  },
  {
    id: "evidence_ingestion",
    name: "Evidence ingestion",
    description:
      "Capture, integrity, quality gating and translation of documents, with case updates proposed rather than applied.",
    declaredImplementation: "certified",
    declaredEvidence: "external_audit",
    checks: (o) => [
      fromObservation(
        o,
        {
          id: "contract",
          label: "Ingestion contract implemented",
          dimension: "implementation",
          gates: "implemented",
          observationId: "evidence_contract_lines",
          detail: "packages/evidence is a stub.",
          nextAction: "Implement the ingestion contract and integrity layer.",
        },
        linesAbove("evidence_contract_lines", 100)
      ),
      selfEvident("tested", "Unit tested", "evidence", "unit_tests", true, "", ""),
      fromObservation(
        o,
        {
          id: "ocr",
          label: "OCR engine wired",
          dimension: "implementation",
          gates: "operational",
          observationId: "ocr_engine_wired",
          detail:
            "No OCR engine is connected: the contract exists but nothing reads text from an image.",
          nextAction: "Connect an OCR engine behind the OcrResult contract.",
        },
        isTrue("ocr_engine_wired")
      ),
    ],
  },
  {
    id: "representation",
    name: "Representation preparation",
    description:
      "Readiness described from case state, drafts requiring backed assertions, and procedural hearing practice.",
    declaredImplementation: "certified",
    declaredEvidence: "external_audit",
    checks: (o) => [
      fromObservation(
        o,
        {
          id: "impl",
          label: "Preparation layer implemented",
          dimension: "implementation",
          gates: "implemented",
          observationId: "representation_lines",
          detail: "packages/representation is a stub.",
          nextAction: "Implement readiness, draft provenance and practice.",
        },
        linesAbove("representation_lines", 100)
      ),
      selfEvident("tested", "Unit tested", "evidence", "unit_tests", true, "", ""),
      selfEvident(
        "regulated",
        "Regulated-advice registration",
        "implementation",
        "operational",
        false,
        "Producing regulated documents for another person requires IAA registration or a solicitor; that is not a code property.",
        "Resolve the regulatory position before any regulated document type is enabled."
      ),
    ],
  },
  {
    id: "timeline_reconstruction",
    name: "Timeline reconstruction",
    description: "Chronology derived automatically from uploaded evidence.",
    declaredImplementation: "certified",
    declaredEvidence: "unit_tests",
    checks: (o) => [
      fromObservation(
        o,
        {
          id: "impl",
          label: "Implemented",
          dimension: "implementation",
          gates: "implemented",
          observationId: "timeline_reconstruction_implemented",
          detail: "Timelines are authored by hand; nothing derives them from documents.",
          nextAction: "Implement chronology extraction from uploaded evidence.",
        },
        isTrue("timeline_reconstruction_implemented")
      ),
      selfEvident("tested", "Unit tested", "evidence", "unit_tests", true, "", ""),
    ],
  },
  {
    id: "benchmark",
    name: "LegalOS Bench",
    description: "Continuous scoring of the safety envelope and, later, legal accuracy.",
    declaredImplementation: "certified",
    declaredEvidence: "benchmark_validated",
    checks: (o) => [
      selfEvident("impl", "Implemented", "implementation", "implemented", true, "", ""),
      selfEvident("tested", "Unit tested", "evidence", "unit_tests", true, "", ""),
      fromObservation(
        o,
        {
          id: "run",
          label: "Run against this build",
          dimension: "implementation",
          gates: "operational",
          observationId: "bench_pass_rate",
          detail: "No benchmark report exists for this build.",
          nextAction: "Run LegalOS Bench in CI and publish the report as a build artefact.",
        },
        (obs) => (numberOf(obs, "bench_pass_rate") === null ? null : true)
      ),
      fromObservation(
        o,
        {
          id: "accuracy_tasks",
          label: "Substantive accuracy tasks",
          dimension: "evidence",
          gates: "benchmark_validated",
          observationId: "verified_source_count",
          detail:
            "Accuracy tasks are deferred until sources are verified; scoring against unchecked law would manufacture confidence.",
          nextAction: "Verify sources first, then add substantive accuracy tasks to the suite.",
        },
        gtZero("verified_source_count")
      ),
    ],
  },
];

/**
 * Agents shown in the workspace, mapped to the capability each depends on.
 * An agent can never display a status above the capability that powers it —
 * which is what stops a Research Agent showing "active" with no corpus.
 */
export const AGENT_CAPABILITY: Readonly<Record<string, string>> = {
  supervisor: "verification",
  intake: "verification",
  evidence: "evidence_graph",
  research: "research_retrieval",
  immigration: "rule_engine",
  employment: "rule_engine",
  medical: "evidence_graph",
  timeline: "timeline_reconstruction",
  compliance: "audit",
  solicitor_review: "human_review",
  human_review: "human_review",
  translation: "verification",
  document: "evidence_ingestion",
  voice: "verification",
  appeal: "rule_engine",
  hearing: "rule_engine",
  tribunal: "rule_engine",
  family: "rule_engine",
  housing: "rule_engine",
};
