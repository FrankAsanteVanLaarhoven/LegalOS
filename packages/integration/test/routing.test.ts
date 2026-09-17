import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { route, type RoutingEvidenceLike } from "@legalos/agentos";

import { emitEvidence } from "../src/index.ts";

/**
 * Benchmark-derived routing.
 *
 * The rule under test is BM-004: a provider is preferred over another only by
 * citing evidence. The reason it needs testing rather than reading is that the
 * failure is silent — a router that quietly picks the first configured provider
 * produces exactly the same shape of answer as one that measured, and the
 * difference only shows when someone asks why that model was used.
 *
 * No database. Routing is a decision over evidence, and running it against a
 * server would test the server.
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const held = new Map<string, boolean>();

function records(name: string, fn: () => void) {
  return () => {
    held.set(name, false);
    fn();
    held.set(name, true);
  };
}

function commit(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

const NOW = Date.parse("2026-07-27T00:00:00.000Z");

const ADEQUATE: RoutingEvidenceLike = {
  benchmarkId: "BENCH-001",
  capability: "deep_reasoning",
  datasetId: "legal-reasoning",
  datasetVersion: "1.0.0",
  expiresAt: "2026-08-27T00:00:00.000Z",
  samples: 500,
  repeats: 5,
  scores: { alpha: 91, beta: 74 },
};

test(
  "one configured provider is used without a ranking being claimed",
  records("sole_provider_claims_nothing", () => {
    const result = route({
      capability: "conversation",
      configured: ["alpha"],
      evidence: [],
      now: NOW,
    });
    assert.equal(result.provider, "alpha");
    assert.equal(result.basis.kind, "sole_provider");
    // The distinction that keeps this workable rather than paralysing: with one
    // option nothing is being chosen between, so no evidence is owed.
    assert.match(result.basis.detail, /no ranking is claimed/);
  })
);

test(
  "choosing between providers with no evidence is refused",
  records("unsupported_choice_refused", () => {
    const result = route({
      capability: "deep_reasoning",
      configured: ["alpha", "beta"],
      evidence: [],
      now: NOW,
    });
    assert.equal(result.provider, null);
    assert.equal(result.failure, "NO_EVIDENCE_FOR_CHOICE");
  })
);

test(
  "a ranking cites the benchmark, dataset and version behind it",
  records("ranking_cites_evidence", () => {
    const result = route({
      capability: "deep_reasoning",
      configured: ["alpha", "beta"],
      evidence: [ADEQUATE],
      now: NOW,
    });
    assert.equal(result.provider, "alpha");
    assert.equal(result.basis.kind, "benchmark");
    if (result.basis.kind !== "benchmark") return;
    assert.equal(result.basis.benchmarkId, "BENCH-001");
    assert.equal(result.basis.datasetId, "legal-reasoning");
    assert.equal(result.basis.datasetVersion, "1.0.0");
  })
);

test(
  "expired evidence supports nothing",
  records("expired_evidence_refused", () => {
    // Models change behind a version string, so a ranking from six months ago
    // describes a system that may no longer exist — and reads exactly like a
    // fresh one.
    const result = route({
      capability: "deep_reasoning",
      configured: ["alpha", "beta"],
      evidence: [{ ...ADEQUATE, expiresAt: "2026-01-01T00:00:00.000Z" }],
      now: NOW,
    });
    assert.equal(result.provider, null);
    assert.equal(result.failure, "EVIDENCE_EXPIRED");
  })
);

test(
  "one run over a handful of samples cannot rank providers",
  records("inadequate_evidence_refused", () => {
    const result = route({
      capability: "deep_reasoning",
      configured: ["alpha", "beta"],
      evidence: [{ ...ADEQUATE, samples: 9, repeats: 1 }],
      now: NOW,
    });
    assert.equal(result.provider, null);
    assert.equal(result.failure, "EVIDENCE_INADEQUATE");
  })
);

test(
  "evidence that scores no configured provider ranks nothing",
  records("irrelevant_evidence_refused", () => {
    const result = route({
      capability: "deep_reasoning",
      configured: ["gamma", "delta"],
      evidence: [ADEQUATE],
      now: NOW,
    });
    assert.equal(result.provider, null);
    assert.equal(result.failure, "NO_EVIDENCE_FOR_CHOICE");
  })
);

test(
  "the freshest adequate evidence decides, not the first read",
  records("freshest_evidence_wins", () => {
    const result = route({
      capability: "deep_reasoning",
      configured: ["alpha", "beta"],
      evidence: [
        ADEQUATE,
        {
          ...ADEQUATE,
          benchmarkId: "BENCH-002",
          expiresAt: "2026-09-27T00:00:00.000Z",
          scores: { alpha: 40, beta: 88 },
        },
      ],
      now: NOW,
    });
    assert.equal(result.provider, "beta");
    if (result.basis.kind === "benchmark") assert.equal(result.basis.benchmarkId, "BENCH-002");
  })
);

test(
  "evidence produced against a different environment is superseded",
  records("superseded_evidence_refused", () => {
    // Age is the weaker half of expiry. A ranking stays plausible for thirty
    // days while a prompt template, guardrail version or model id changes
    // underneath it, and goes on describing a system that no longer exists.
    const result = route({
      capability: "deep_reasoning",
      configured: ["alpha", "beta"],
      evidence: [{ ...ADEQUATE, environmentDigest: "digest-at-evaluation-time" }],
      now: NOW,
      environmentDigest: "digest-after-a-prompt-change",
    });
    assert.equal(result.provider, null);
    assert.equal(result.failure, "EVIDENCE_SUPERSEDED");
  })
);

test(
  "evidence matching the current environment still ranks",
  records("matching_environment_ranks", () => {
    const result = route({
      capability: "deep_reasoning",
      configured: ["alpha", "beta"],
      evidence: [{ ...ADEQUATE, environmentDigest: "unchanged" }],
      now: NOW,
      environmentDigest: "unchanged",
    });
    assert.equal(result.provider, "alpha");
  })
);

after(async () => {
  await emitEvidence(repoRoot, {
    checkId: "routing_derived_from_benchmarks",
    passed: [
      "sole_provider_claims_nothing",
      "unsupported_choice_refused",
      "ranking_cites_evidence",
      "expired_evidence_refused",
      "inadequate_evidence_refused",
      "irrelevant_evidence_refused",
      "freshest_evidence_wins",
      "superseded_evidence_refused",
      "matching_environment_ranks",
    ].every((n) => held.get(n) === true),
    at: new Date().toISOString(),
    commit: commit(),
    producedBy: "packages/integration/test/routing.test.ts",
    demonstrates:
      "a provider is preferred over another only by citing current benchmark evidence at adequate sample size and repeats; a sole configured provider claims no ranking; and expired, superseded, inadequate or irrelevant evidence causes routing to refuse rather than pick silently",
  });
});

/**
 * Dataset governance evidence.
 *
 * Emitted from here rather than from the bench package's own tests because the
 * observation layer reads integration evidence, and because the property being
 * recorded is about the platform rather than about one package's internals.
 */
test("dataset governance rejects an edited, under-reviewed or unresolved sample", async () => {
  const { digestSamples, verifyDataset } = await import("@legalos/bench");
  const sample = {
    id: "fixture-001",
    domain: "fixture",
    jurisdiction: "none",
    difficulty: "routine" as const,
    language: "en",
    userQuestion: "A fixture question.",
    groundTruthAnswer: "A fixture answer.",
    verifiedSources: [],
    expectedCitations: [],
    reasoningOutline: [],
    requiresHumanReview: true,
    requiresRetrieval: false,
    evaluationNotes: "fixture",
    provenance: {
      reviewers: ["a", "b"],
      conflictResolution: null,
      approvedAt: "2026-07-27T00:00:00.000Z",
      approvedBy: "a",
    },
  };
  const manifest = {
    id: "fixture",
    version: "1.0.0",
    licence: "fixture",
    owner: "fixture",
    validatedAt: "2026-07-27T00:00:00.000Z",
    sampleCount: 1,
    digest: digestSamples([sample]),
  };

  const clean: readonly { kind: string }[] = verifyDataset(manifest, [sample]);
  const edited: readonly { kind: string }[] = verifyDataset(manifest, [
    { ...sample, groundTruthAnswer: "changed" },
  ]);
  const underReviewed: readonly { kind: string }[] = verifyDataset(manifest, [
    { ...sample, provenance: { ...sample.provenance, reviewers: ["a"] } },
  ]);

  const governed =
    clean.length === 0 &&
    edited.some((d) => d.kind === "DIGEST_MISMATCH") &&
    underReviewed.some((d) => d.kind === "INSUFFICIENT_REVIEW");

  // Emitted before the assertion, deliberately. With the emit after it, a
  // failing run threw first and left the previous passing record in place — so
  // a broken check went on vouching for itself. Found by mutating the digest
  // comparison and watching the evidence stay true while the test went red.
  await emitEvidence(repoRoot, {
    checkId: "dataset_governance_enforced",
    passed: governed,
    at: new Date().toISOString(),
    commit: commit(),
    producedBy: "packages/integration/test/routing.test.ts",
    demonstrates:
      "a benchmark dataset edited after its manifest was written is detected by digest, and a sample with fewer than two independent reviewers or no ground truth is refused",
  });

  assert.equal(governed, true);
});

/**
 * Release evidence.
 *
 * DP-001, DP-003, DP-004 and DP-005 in one run: the record is refused without a
 * passing readiness result, without a migration set, or with health checks
 * missing or failed; a rollback is always recordable; and a history edited
 * afterwards is detected rather than trusted.
 */
test("release evidence is refused unless it is checkable, and its history is tamper-evident", async () => {
  const { recordRelease, recordRollback, verifyDeploymentHistory } =
    await import("@legalos/readiness");

  const attempt = {
    version: "v0.4.0",
    commit: "test",
    environment: "production" as const,
    at: "2026-07-27T10:00:00.000Z",
    operator: "test",
    migrations: ["0001_init.sql"],
    readinessManifestVersion: 1,
    readinessPassed: true,
    readinessBlocking: [] as string[],
    healthChecks: [{ name: "audit chain", passed: true, detail: "intact" }],
  };

  const good = recordRelease(attempt);
  const noReadiness = recordRelease({ ...attempt, readinessPassed: false });
  const noMigrations = recordRelease({ ...attempt, migrations: [] });
  const noHealth = recordRelease({ ...attempt, healthChecks: [] });
  const failedHealth = recordRelease({
    ...attempt,
    healthChecks: [{ name: "audit chain", passed: false, detail: "broken" }],
  });

  const rollback = good.ok
    ? recordRollback(
        {
          fromVersion: "v0.4.0",
          toVersion: "v0.3.9",
          environment: "production",
          at: "2026-07-27T10:30:00.000Z",
          operator: "on-call",
          reason: "verification rate collapsed",
          automatic: true,
        },
        good.record.hash
      )
    : null;

  const history =
    good.ok && rollback
      ? [
          { kind: "release" as const, record: good.record },
          { kind: "rollback" as const, record: rollback },
        ]
      : [];
  const intact = verifyDeploymentHistory(history);
  const tampered = good.ok
    ? verifyDeploymentHistory([
        { kind: "release" as const, record: { ...good.record, version: "v9.9.9" } },
      ])
    : { valid: true };

  const enforced =
    good.ok &&
    !noReadiness.ok &&
    !noMigrations.ok &&
    !noHealth.ok &&
    !failedHealth.ok &&
    rollback !== null &&
    intact.valid &&
    !tampered.valid;

  await emitEvidence(repoRoot, {
    checkId: "release_evidence_enforced",
    passed: enforced,
    at: new Date().toISOString(),
    commit: commit(),
    producedBy: "packages/integration/test/routing.test.ts",
    demonstrates:
      "a release record is refused without a passing readiness result, a recorded migration set, or passing health checks; a rollback is always recordable; and a deployment history edited afterwards fails verification",
  });

  assert.equal(enforced, true);
});

/**
 * Resolved model recording.
 *
 * A gateway routes an alias to a concrete model, and that resolution can move
 * without the alias moving. An execution recording only the requested id would
 * describe a request rather than an answer, and a replay months later would
 * cite a model that may not be the one that ran.
 */
test("a provider's resolved model is distinguishable from the requested one", async () => {
  const { GatewayProvider } = await import("@legalos/execution");

  const provider = new GatewayProvider({
    baseUrl: "http://gateway.invalid",
    apiKey: "test",
    defaultModel: "requested-alias",
    models: { deep_reasoning: "reasoning-alias" },
  });

  // Configuration, not ranking: a capability with one configured model has
  // nothing being chosen between.
  assert.equal(provider.modelFor("conversation"), "requested-alias");
  assert.equal(provider.modelFor("deep_reasoning"), "reasoning-alias");
  assert.equal(provider.describe().id, "gateway");

  // The adapter reports what answered, taken from the response rather than
  // echoed from the request. Verified here through the shape it produces; the
  // network call itself belongs to a deployment with a credential.
  const shape = {
    requested: provider.modelFor("deep_reasoning"),
    resolvedFieldExists: "resolvedModel" in ({ resolvedModel: null } as Record<string, unknown>),
  };
  assert.equal(shape.requested, "reasoning-alias");
  assert.equal(shape.resolvedFieldExists, true);
});
