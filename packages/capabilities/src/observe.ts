import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import {
  observeAssertionTraceability,
  traceabilityUnavailable,
} from "./traceability.ts";

/**
 * Observation — the layer beneath capability maturity.
 *
 * Until now a check like `retrievalCorpusPopulated: false` was a hand-written
 * constant. It could not be raised by configuration, which stopped the obvious
 * abuse, but it still encoded a developer's belief rather than a measurement.
 * A capability system built on beliefs is only as honest as whoever last edited
 * the file.
 *
 * An Observation is a measurement of actual system state, taken now, that
 * records how it was taken. The capability layer consumes observations and
 * never asserts facts of its own.
 *
 * The critical rule is `unavailable`. When something cannot be measured — the
 * database is unreachable, the benchmark has never been run — that is NOT a
 * pass and NOT a zero. It is the absence of evidence, and every check reading
 * it must fail closed. Treating "I could not measure it" as "it is fine" is the
 * failure this whole architecture exists to prevent.
 */

export type ObservationSource =
  "filesystem" | "database" | "registry" | "benchmark" | "environment" | "unavailable";

export interface Observation {
  readonly id: string;
  /** null when the value could not be measured. */
  readonly value: number | boolean | string | null;
  readonly source: ObservationSource;
  /** How this was measured, in words. Shown in the UI as provenance. */
  readonly method: string;
  /** Why it could not be measured, when `source` is `unavailable`. */
  readonly unavailableReason: string | null;
}

/**
 * Authentication guarantees that only an integration test against a running
 * system can settle, and what each one demonstrates.
 *
 * One list, used twice: to read each record, and to decide whether any auth
 * integration test ran at all. Two lists would drift, and the drift would show
 * up as a capability vouching for a suite that no longer covers it.
 */
const AUTH_EVIDENCE = [
  [
    "session_durability_survives_restart",
    "a session written to the table is still valid after every connection is closed and reopened",
  ],
  ["session_revocation_propagates", "revoking a session takes effect on other instances"],
  ["cache_invalidation_correct", "a cached session is dropped when revoked"],
  ["mfa_enforced_by_policy", "MFA is required where policy says so"],
  ["cross_device_signout", "signing out elsewhere ends those sessions"],
  ["recovery_workflow_operational", "a person can actually recover an account"],
  ["auth_audit_events_emitted", "every authentication action appends to the audit chain"],
] as const;

const AUTH_EVIDENCE_IDS = new Set<string>(AUTH_EVIDENCE.map(([id]) => id));

/** The same, for the audit chain and the privacy duties that read it. */
const AUDIT_EVIDENCE = [
  ["audit_chain_valid", "the chain verifies and an altered payload is detected"],
  ["audit_append_only", "the database refuses to edit or remove an entry"],
  [
    "audit_chain_valid_after_tombstone",
    "an entry's payload can be erased and the chain still verifies",
  ],
  ["erasure_removes_payload", "an erasure request empties the payload in the database"],
  ["tombstone_preserves_hash", "the erased entry keeps every hash the chain depends on"],
  [
    "execution_recorded_for_every_invocation",
    "every provider invocation has exactly one immutable execution record, including calls that failed, timed out or were blocked",
  ],
  [
    "execution_replay_succeeds",
    "a recorded model execution is reconstructed from immutable artefacts, and an edited prompt, snapshot or ordering makes it unreproducible",
  ],
] as const;

/** The same, for the agent registry. */
const AGENT_EVIDENCE = [
  [
    "agent_metrics_projection_faithful",
    "the agent metrics projection is rebuilt from the immutable execution log and an edited or orphaned row is detected as drift",
  ],
  [
    "release_evidence_enforced",
    "a release without a passing readiness result, a migration set or passing health checks is refused, and a deployment history edited afterwards is detected",
  ],
  [
    "dataset_governance_enforced",
    "a benchmark dataset edited after its manifest was written is detected, and an under-reviewed sample is refused",
  ],
  [
    "routing_derived_from_benchmarks",
    "a provider is preferred over another only by citing current, adequate benchmark evidence, and routing refuses rather than picking silently",
  ],
  [
    "provider_selected_by_capability_router",
    "a caller supplies a capability, the routing table selects the provider, and an undeclared capability is refused",
  ],
  [
    "agent_resolved_from_registry",
    "an unregistered agent is refused before a provider is reachable, and a human-review agent is never auto-released",
  ],
] as const;

/** The same, for evidence ingestion. */
const INGESTION_EVIDENCE = [
  [
    "evidence_checksums_recomputed",
    "a stored checksum is recomputed on verification and detects a single flipped byte",
  ],
] as const;

export function unavailable(id: string, method: string, reason: string): Observation {
  return { id, value: null, source: "unavailable", method, unavailableReason: reason };
}

export function observed(
  id: string,
  value: number | boolean | string,
  source: Exclude<ObservationSource, "unavailable">,
  method: string
): Observation {
  return { id, value, source, method, unavailableReason: null };
}

export type ObservationSet = ReadonlyMap<string, Observation>;

/** Reads an observation, returning null when it is missing or unavailable. */
export function numberOf(observations: ObservationSet, id: string): number | null {
  const observation = observations.get(id);
  if (!observation || observation.source === "unavailable") return null;
  return typeof observation.value === "number" ? observation.value : null;
}

export function booleanOf(observations: ObservationSet, id: string): boolean | null {
  const observation = observations.get(id);
  if (!observation || observation.source === "unavailable") return null;
  return typeof observation.value === "boolean" ? observation.value : null;
}

/* ------------------------------------------------------------------ */
/* Observers                                                           */
/* ------------------------------------------------------------------ */

export interface ObserveOptions {
  /**
   * Epoch milliseconds used to judge whether integration evidence is still
   * fresh. Passed in so observation remains deterministic.
   */
  readonly now?: number;
  /** Repository root, so filesystem probes work from any working directory. */
  readonly repoRoot: string;
  /**
   * Optional query function against the application database. Injected rather
   * than imported so this package stays free of a driver dependency and stays
   * testable without a server.
   */
  readonly query?: (sql: string) => Promise<{ rows: Record<string, unknown>[] }>;
  /** Optional path to a benchmark report emitted by @legalos/bench. */
  readonly benchReportPath?: string;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function fileContains(path: string, needle: RegExp): Promise<boolean | null> {
  try {
    return needle.test(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

/** Counts non-comment source lines, as a crude "is this real or a stub" probe. */
async function sourceLines(dir: string): Promise<number | null> {
  try {
    const entries = await readdir(dir, { withFileTypes: true, recursive: true });
    let total = 0;
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
      const parent =
        (entry as unknown as { parentPath?: string; path?: string }).parentPath ??
        (entry as unknown as { path?: string }).path ??
        dir;
      const content = await readFile(join(parent, entry.name), "utf8");
      total += content.split("\n").filter((line) => {
        const t = line.trim();
        return t !== "" && !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
      }).length;
    }
    return total;
  } catch {
    return null;
  }
}

/**
 * Takes every observation the platform knows how to make.
 *
 * Each probe either measures something or reports that it could not.
 */
export async function observeSystem(options: ObserveOptions): Promise<ObservationSet> {
  const { repoRoot, query, benchReportPath } = options;
  const evidenceNow = options.now ?? Date.now();
  const out = new Map<string, Observation>();
  const add = (o: Observation) => out.set(o.id, o);

  // ---- Sources: how many are actually verified? ----
  if (query) {
    try {
      const result = await query(
        "SELECT count(*)::int AS n FROM legal_sources WHERE verification_status = 'verified'"
      );
      add(
        observed(
          "verified_source_count",
          Number(result.rows[0]?.n ?? 0),
          "database",
          "SELECT count(*) FROM legal_sources WHERE verification_status = 'verified'"
        )
      );
    } catch (error) {
      add(
        unavailable(
          "verified_source_count",
          "database query against legal_sources",
          `query failed: ${error instanceof Error ? error.message : "unknown error"}`
        )
      );
    }
  } else {
    // No database: fall back to counting verified entries in the shipped
    // registry source, which is a real measurement of the repository.
    const path = join(repoRoot, "packages/knowledge/src/sources.uk.ts");
    try {
      const text = await readFile(path, "utf8");
      const verified = (text.match(/verificationStatus: "verified"/g) ?? []).length;
      add(
        observed(
          "verified_source_count",
          verified,
          "registry",
          'count of verificationStatus: "verified" in packages/knowledge/src/sources.uk.ts'
        )
      );
    } catch {
      add(
        unavailable(
          "verified_source_count",
          "read packages/knowledge/src/sources.uk.ts",
          "source registry file could not be read"
        )
      );
    }
  }

  // ---- EV-005: is every source-backed assertion traceable to a document? ----
  add(query ? await observeAssertionTraceability(query) : traceabilityUnavailable());

  // ---- Retrieval corpus ----
  if (query) {
    try {
      const result = await query("SELECT count(*)::int AS n FROM source_chunks");
      add(
        observed(
          "source_chunk_count",
          Number(result.rows[0]?.n ?? 0),
          "database",
          "SELECT count(*) FROM source_chunks"
        )
      );
    } catch (error) {
      add(
        unavailable(
          "source_chunk_count",
          "database query against source_chunks",
          `query failed: ${error instanceof Error ? error.message : "unknown error"}`
        )
      );
    }
  } else {
    add(
      unavailable(
        "source_chunk_count",
        "database query against source_chunks",
        "no database configured, so the corpus cannot be measured"
      )
    );
  }

  // ---- Authentication: is there middleware, and does it gate anything? ----
  const middlewarePath = join(repoRoot, "apps/web/src/middleware.ts");
  const middlewareAltPath = join(repoRoot, "apps/web/middleware.ts");
  const hasMiddleware = (await exists(middlewarePath)) || (await exists(middlewareAltPath));
  add(
    observed(
      "auth_middleware_present",
      hasMiddleware,
      "filesystem",
      "existence of apps/web/src/middleware.ts"
    )
  );

  const authImpl = await sourceLines(join(repoRoot, "packages/auth/src"));
  add(
    authImpl === null
      ? unavailable("auth_package_lines", "count source lines in packages/auth/src", "unreadable")
      : observed(
          "auth_package_lines",
          authImpl,
          "filesystem",
          "non-comment source lines in packages/auth/src"
        )
  );

  // ---- Rate limiting ----
  // Measures behaviour rather than a name: the route must both consult a
  // limiter and have a path that refuses with 429. An earlier version matched
  // the identifier "rateLimit", which missed a limiter imported under any other
  // name — under-detecting is safer than over-detecting here, but measuring the
  // refusal path is better than either.
  const routePath = join(repoRoot, "apps/web/src/app/api/chat/route.ts");
  const consultsLimiter = await fileContains(routePath, /limitModelRoute|rateLimit|ratelimit/i);
  const refusesWith429 = await fileContains(routePath, /status:\s*429/);
  add(
    consultsLimiter === null || refusesWith429 === null
      ? unavailable("rate_limiting_present", "inspect the chat route", "route file unreadable")
      : observed(
          "rate_limiting_present",
          consultsLimiter && refusesWith429,
          "filesystem",
          "limiter call and a 429 refusal path in apps/web/src/app/api/chat/route.ts"
        )
  );

  // ---- Workflow engine: real or stub? ----
  const workflowLines = await sourceLines(join(repoRoot, "packages/workflows/src"));
  add(
    workflowLines === null
      ? unavailable("workflow_lines", "count source lines in packages/workflows/src", "unreadable")
      : observed(
          "workflow_lines",
          workflowLines,
          "filesystem",
          "non-comment source lines in packages/workflows/src"
        )
  );

  // ---- Ingestion service: real or stub? ----
  const ingestionLines = await sourceLines(join(repoRoot, "services/ingestion/src"));
  add(
    ingestionLines === null
      ? unavailable("ingestion_lines", "count source lines in services/ingestion/src", "unreadable")
      : observed(
          "ingestion_lines",
          ingestionLines,
          "filesystem",
          "non-comment source lines in services/ingestion/src"
        )
  );

  // ---- Graph persistence: do migrations define graph tables? ----
  const graphPersisted = await (async () => {
    try {
      const dir = join(repoRoot, "packages/database/migrations");
      const files = await readdir(dir);
      for (const file of files) {
        const text = await readFile(join(dir, file), "utf8");
        if (/CREATE TABLE graph_(nodes|edges)/.test(text)) return true;
      }
      return false;
    } catch {
      return null;
    }
  })();
  add(
    graphPersisted === null
      ? unavailable("graph_tables_present", "scan migrations", "migrations directory unreadable")
      : observed(
          "graph_tables_present",
          graphPersisted,
          "filesystem",
          "CREATE TABLE graph_nodes/graph_edges in packages/database/migrations"
        )
  );

  // ---- Rule locators recorded? ----
  const locators = await (async () => {
    try {
      const text = await readFile(
        join(repoRoot, "packages/rules/src/workflows/skilled-worker-switch.ts"),
        "utf8"
      );
      const nulls = (text.match(/locator: null/g) ?? []).length;
      return nulls === 0;
    } catch {
      return null;
    }
  })();
  add(
    locators === null
      ? unavailable("rule_locators_recorded", "inspect the workflow", "workflow file unreadable")
      : observed(
          "rule_locators_recorded",
          locators,
          "filesystem",
          "absence of `locator: null` in packages/rules/src/workflows"
        )
  );

  // ---- Benchmark: has it been run, and what did it score? ----
  if (benchReportPath) {
    try {
      const report = JSON.parse(await readFile(benchReportPath, "utf8")) as {
        passRate?: number;
      };
      add(
        typeof report.passRate === "number"
          ? observed(
              "bench_pass_rate",
              report.passRate,
              "benchmark",
              `passRate from ${benchReportPath}`
            )
          : unavailable("bench_pass_rate", `read ${benchReportPath}`, "report contains no passRate")
      );
    } catch {
      add(
        unavailable("bench_pass_rate", `read ${benchReportPath}`, "benchmark report not readable")
      );
    }
  } else {
    add(
      unavailable(
        "bench_pass_rate",
        "read a benchmark report",
        "no benchmark report has been produced for this build"
      )
    );
  }

  // Middleware existing is not authentication working. This measures whether a
  // route handler actually verifies a session against the store, which is the
  // difference between a shape check at the edge and a real identity.
  const routesDir = join(repoRoot, "apps/web/src/app/api");
  const verifiesSession = await (async () => {
    try {
      const entries = await readdir(routesDir, { withFileTypes: true, recursive: true });
      for (const entry of entries) {
        if (!entry.isFile() || entry.name !== "route.ts") continue;
        const parent =
          (entry as unknown as { parentPath?: string; path?: string }).parentPath ??
          (entry as unknown as { path?: string }).path ??
          routesDir;
        const text = await readFile(join(parent, entry.name), "utf8");
        if (/checkSession|requireSession/.test(text)) return true;
      }
      return false;
    } catch {
      return null;
    }
  })();
  add(
    verifiesSession === null
      ? unavailable("session_verified_in_route", "scan API routes", "routes unreadable")
      : observed(
          "session_verified_in_route",
          verifiesSession,
          "filesystem",
          "checkSession/requireSession call in an apps/web API route handler"
        )
  );

  // Sessions verified in a handler is not the same as sessions that survive a
  // restart or exist for a real person. This measures whether the store is
  // backed by the database and whether sign-in exists outside the dev route.
  // Measures the running state, not the source text: the store must have a
  // database-backed path AND a database must actually be configured. Either
  // alone leaves sessions in memory.
  const storeHasDatabasePath = await fileContains(
    join(repoRoot, "apps/web/src/lib/auth/session-store.ts"),
    /PostgresSessionStore/
  );
  const storeDurable =
    storeHasDatabasePath === null ? null : storeHasDatabasePath && Boolean(query);
  add(
    storeDurable === null
      ? unavailable("session_store_durable", "inspect the session store", "store file unreadable")
      : observed(
          "session_store_durable",
          storeDurable,
          "filesystem",
          "a PostgresSessionStore path in the session store, with a database configured"
        )
  );

  const realSignIn = await (async () => {
    try {
      const dir = join(repoRoot, "apps/web/src/app/api/auth");
      const entries = await readdir(dir, { withFileTypes: true, recursive: true });
      return entries.some((e) => {
        if (!e.isFile() || e.name !== "route.ts") return false;
        const parent =
          (e as unknown as { parentPath?: string; path?: string }).parentPath ??
          (e as unknown as { path?: string }).path ??
          "";
        return !parent.includes("dev-session");
      });
    } catch {
      return false;
    }
  })();
  // A sign-in route nobody can receive a code from is not sign-in. This
  // requires both the route and a configured delivery provider, because
  // without delivery the only person who can sign in is a developer reading
  // the response body.
  const deliveryConfigured = Boolean(
    process.env.EMAIL_PROVIDER_URL || process.env.SMS_PROVIDER_URL
  );
  add(
    observed(
      "real_sign_in_exists",
      realSignIn && deliveryConfigured,
      "filesystem",
      "a non-dev auth route in apps/web, with a message delivery provider configured"
    )
  );

  // The remaining conditions for certified authentication. Several cannot be
  // established by reading source at all — whether revocation propagates, or
  // cross-device sign-out works, is a question for an integration test against
  // a running system. Those report unavailable, which fails their checks closed
  // and names what is missing, rather than being quietly assumed.
  // This asked whether a file matching `auth.*.test.ts` existed under apps/web
  // — a filename, which any empty file satisfies. It now asks whether an auth
  // integration test actually ran recently and reported a result, which is the
  // only version of the question a test cannot pass by being named correctly.
  const authEvidence = await (async () => {
    const { allEvidence, FRESHNESS_MS } = await import("@legalos/integration");
    try {
      const records = await allEvidence(repoRoot);
      return records.some(
        (r) =>
          AUTH_EVIDENCE_IDS.has(r.checkId) &&
          evidenceNow - Date.parse(r.at) < FRESHNESS_MS &&
          !Number.isNaN(Date.parse(r.at))
      );
    } catch {
      return null;
    }
  })();
  add(
    authEvidence === null
      ? unavailable("auth_integration_tests", "read integration evidence", "evidence unreadable")
      : observed(
          "auth_integration_tests",
          authEvidence,
          "benchmark",
          "a recent evidence record produced by an auth integration test run"
        )
  );

  // Read from integration evidence rather than hardcoded. A suite writes a
  // record after asserting; this reads it. Passing raises the capability with
  // no status edited, and evidence that stops being produced — or goes stale —
  // stops counting, so a change that breaks a guarantee lowers the capability
  // on its own rather than waiting to be noticed.
  const { readEvidence } = await import("@legalos/integration");
  for (const [id, what] of AUTH_EVIDENCE) {
    const reading = await readEvidence(repoRoot, id, evidenceNow);
    add(
      reading.demonstrated === null
        ? unavailable(id, `integration test proving ${what}`, reading.reason)
        : observed(id, reading.demonstrated, "benchmark", reading.reason)
    );
  }

  for (const [id, what] of [...AUDIT_EVIDENCE, ...INGESTION_EVIDENCE, ...AGENT_EVIDENCE]) {
    const reading = await readEvidence(repoRoot, id, evidenceNow);
    add(
      reading.demonstrated === null
        ? unavailable(id, `integration test proving ${what}`, reading.reason)
        : observed(id, reading.demonstrated, "benchmark", reading.reason)
    );
  }

  // Whether the agent lists in the platform still agree with the registry.
  //
  // There were four: eleven ids in packages/agents, fifteen in the web app's
  // data file, eight page slugs, and a capability map naming twelve. They
  // disagreed, and nothing noticed, because nothing was comparing them. This
  // compares them.
  const agentsReconciled = await (async () => {
    try {
      const { agentIds } = await import("@legalos/agentos");
      const registered = new Set(agentIds());
      const sources: [string, RegExp][] = [
        ["packages/agents/src/index.ts", /\bid: "([a-z0-9-]+)"/g],
        ["apps/web/src/lib/data/agents.ts", /\bid: "([a-z0-9-]+)"/g],
        ["apps/web/src/lib/data/agent-pages.ts", /\bslug: "([a-z0-9-]+)"/g],
      ];
      for (const [path, pattern] of sources) {
        const text = await readFile(join(repoRoot, path), "utf8");
        for (const match of text.matchAll(pattern)) {
          const id = match[1];
          if (id && !registered.has(id)) return false;
        }
      }
      return true;
    } catch {
      return null;
    }
  })();
  add(
    agentsReconciled === null
      ? unavailable("agent_lists_reconciled", "read the agent lists", "a list was unreadable")
      : observed(
          "agent_lists_reconciled",
          agentsReconciled,
          "filesystem",
          "every agent id and page slug outside the registry resolves to a registered agent"
        )
  );

  // AU-005, second half. Recording is only unbypassable if there is no other
  // way to reach a model.
  //
  // This asked whether any package depended on @legalos/providers, and that was
  // the wrong question — providers is configuration, and apps/web reached the
  // model through the `openai` SDK directly. The observation reported true
  // while two routes were calling a model with no execution record between
  // them. It now names the SDKs themselves, which is the thing that actually
  // grants access.
  const MODEL_SDKS = ["openai", "@anthropic-ai/sdk", "@google/generative-ai", "@azure/openai"];
  const providerConfinement = await (async () => {
    try {
      const holders: string[] = [];
      for (const root of ["packages", "apps"]) {
        const entries = await readdir(join(repoRoot, root), { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          try {
            const manifest = JSON.parse(
              await readFile(join(repoRoot, root, entry.name, "package.json"), "utf8")
            ) as { name?: string; dependencies?: Record<string, string> };
            const deps = manifest.dependencies ?? {};
            const reaches =
              MODEL_SDKS.some((sdk) => deps[sdk]) ||
              (deps["@legalos/providers"] && manifest.name !== "@legalos/providers");
            if (reaches) holders.push(manifest.name ?? entry.name);
          } catch {
            // No manifest, or unreadable: not a package that can depend on one.
          }
        }
      }
      // @legalos/execution is the intended holder. Anything else is a route to
      // a model that does not pass through the runner, and therefore does not
      // produce an execution record.
      return holders.every((name) => name === "@legalos/execution");
    } catch {
      return null;
    }
  })();
  add(
    providerConfinement === null
      ? unavailable(
          "provider_access_confined_to_runner",
          "read package manifests",
          "package manifests unreadable"
        )
      : observed(
          "provider_access_confined_to_runner",
          providerConfinement,
          "filesystem",
          "no package other than @legalos/execution declares a model SDK or provider dependency"
        )
  );

  // AU-004. Whether the schema records enough to reconstruct an execution.
  //
  // Reads `ai_executions` from 0005 rather than `ai_outputs` from 0001. The
  // older table answered "what did we run" approximately: model, prompt,
  // versions, sources, verdict, time. It could not answer what the model was
  // actually shown, or who asked — so "why did it say that" had no exact
  // answer, which is the whole of AU-004.
  //
  // Nine fields checked in one observation rather than nine observations. Split
  // apart they would be the same measurement partitioned, each weaker than the
  // whole, and the report would show eight greens beside one red for a record
  // that is unusable without all nine.
  const aiReconstructible = await (async () => {
    try {
      const sql = await readFile(
        join(repoRoot, "packages/database/migrations/0005_ai_executions.sql"),
        "utf8"
      );
      const match = sql.match(/CREATE TABLE ai_executions \(([\s\S]*?)\n\);/);
      if (!match) return null;
      const columns = match[1] ?? "";
      const required = [
        /\bactor_id\b/,
        /\bactor_type\b/,
        /\bsession_id\b/,
        /\bretrieval_snapshot_id\b/,
        /\bprompt_template_version\b/,
        /\bmodel_version\b/,
        /\bagent_id\b/,
        /\bverification_verdict\b/,
        /\bguardrail_version\b/,
        /\bresolved_sources\b/,
      ];
      return required.every((r) => r.test(columns));
    } catch {
      return null;
    }
  })();
  add(
    aiReconstructible === null
      ? unavailable(
          "ai_execution_reconstructible",
          "parse the ai_executions table definition",
          "migration 0005 unreadable or the table definition could not be located"
        )
      : observed(
          "ai_execution_reconstructible",
          aiReconstructible,
          "filesystem",
          "columns in ai_executions for actor, actor type, session, retrieval snapshot, prompt template version, model version, agent, verdict, guardrail version and sources"
        )
  );

  // Whether the schema can hold the identity of a document at all.
  //
  // packages/evidence calls the sha-256 "the identity of this evidence" and the
  // type comment says nothing may modify the original — but `evidence_items`
  // has no column for it, so an OriginalDocument is never persisted and the
  // immutability the type claims cannot be enforced or even checked. This reads
  // the migration rather than the code, because the schema is where that
  // property either exists or does not.
  const evidenceSchema = await (async () => {
    // Content identity lives on the file version, not on the logical item —
    // one item can have several versions and each has its own bytes. This
    // probe looked in `evidence_items` until migration 0017 created the table
    // where a digest actually belongs, and reported EV-001 failed for the whole
    // programme because of where it was looking rather than what was true.
    try {
      const sql = await readFile(
        join(repoRoot, "packages/database/migrations/0017_evidence_foundation.sql"),
        "utf8"
      );
      const match = sql.match(/CREATE TABLE evidence_files \(([\s\S]*?)\n\);/);
      if (!match) return null;
      const body = match[1] ?? "";
      // Both halves: a digest, and the algorithm that produced it. A hash whose
      // algorithm nobody recorded cannot be recomputed by anyone else.
      return /\bdigest\b/i.test(body) && /digest_algorithm/i.test(body);
    } catch {
      return null;
    }
  })();
  add(
    evidenceSchema === null
      ? unavailable(
          "evidence_content_identity_persisted",
          "parse the evidence_files table definition",
          "migration unreadable or the table definition could not be located"
        )
      : observed(
          "evidence_content_identity_persisted",
          evidenceSchema,
          "filesystem",
          "a digest column and its algorithm in the evidence_files table definition"
        )
  );

  // ---- EV-001: are evidence records actually protected from rewriting? ----
  const evidenceAppendOnly = await (async () => {
    // Structural, and deliberately so: the behavioural proof is an integration
    // test that attempts the UPDATE and is refused. This asks the narrower
    // question of whether the guard was declared at all, on all three tables
    // that carry a record somebody may later dispute.
    try {
      const sql = await readFile(
        join(repoRoot, "packages/database/migrations/0017_evidence_foundation.sql"),
        "utf8"
      );
      return ["evidence_events", "evidence_provenance", "evidence_files"].every((table) =>
        new RegExp(`ON ${table}\\s`, "i").test(sql)
      );
    } catch {
      return null;
    }
  })();
  add(
    evidenceAppendOnly === null
      ? unavailable(
          "evidence_rows_append_only",
          "parse the evidence triggers in migration 0017",
          "migration unreadable"
        )
      : observed(
          "evidence_rows_append_only",
          evidenceAppendOnly,
          "filesystem",
          "append-only triggers declared on evidence_events, evidence_provenance and evidence_files"
        )
  );

  // ---- Evidence ingestion: contract vs engines ----
  const evidenceLines = await sourceLines(join(repoRoot, "packages/evidence/src"));
  add(
    evidenceLines === null
      ? unavailable(
          "evidence_contract_lines",
          "count source lines in packages/evidence/src",
          "unreadable"
        )
      : observed(
          "evidence_contract_lines",
          evidenceLines,
          "filesystem",
          "non-comment source lines in packages/evidence/src"
        )
  );

  const ocrWired = await fileContains(
    join(repoRoot, "packages/evidence/src/index.ts"),
    /createWorker|tesseract|textract|vision|documentai/i
  );
  add(
    ocrWired === null
      ? unavailable("ocr_engine_wired", "inspect the evidence package", "package unreadable")
      : observed(
          "ocr_engine_wired",
          ocrWired,
          "filesystem",
          "OCR engine reference in packages/evidence/src"
        )
  );

  // ---- Representation: preparation layer ----
  const repLines = await sourceLines(join(repoRoot, "packages/representation/src"));
  add(
    repLines === null
      ? unavailable(
          "representation_lines",
          "count source lines in packages/representation/src",
          "unreadable"
        )
      : observed(
          "representation_lines",
          repLines,
          "filesystem",
          "non-comment source lines in packages/representation/src"
        )
  );

  // ---- External audit and telemetry: nothing can observe these yet ----
  add(
    unavailable(
      "external_audit_record",
      "look for a signed external audit artefact",
      "no audit artefact format is defined yet"
    )
  );
  add(unavailable("production_telemetry", "query usage telemetry", "no telemetry pipeline exists"));

  return out;
}
