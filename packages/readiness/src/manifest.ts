/**
 * The readiness manifest.
 *
 * Every check the platform knows how to make, declared once. The manifest is
 * versioned and the required list is explicit, so a check cannot disappear
 * through a refactor without CI noticing — which is the failure this guards
 * against. A readiness model that can be weakened by deleting a function is
 * exactly as strong as whoever last edited that file.
 */

export const MANIFEST_VERSION = 1;

/**
 * Three states, and the distinction between the last two is the whole point.
 *
 *   pass            measured, and satisfied
 *   fail            measured, and not satisfied
 *   not_measurable  the environment cannot answer the question
 *
 * Collapsing `not_measurable` into `fail` would give every contributor without
 * production secrets a permanently red pipeline, and a pipeline that is always
 * red teaches people to stop reading it. It would also be untrue: "no database
 * configured here" and "the database is broken" are different facts.
 */
export type ReadinessState = "pass" | "fail" | "not_measurable";

/** Who supplies the thing being checked. */
export type ReadinessOwner = "platform_operator" | "legal_review_board" | "platform";

/**
 * When a check is required.
 *
 *   structural   the engine itself — always, and never needs a secret
 *   environment  measured where the environment allows it
 *   deployment   required before a release, where not_measurable is a failure
 */
export type ReadinessTier = "structural" | "environment" | "deployment";

export interface ReadinessCheck {
  readonly id: string;
  readonly label: string;
  readonly owner: ReadinessOwner;
  readonly tier: ReadinessTier;
  /** What to do about it, for the person reading the report. */
  readonly remedy: string;
  /** Checks that must be measurable first; otherwise this is not_measurable. */
  readonly dependsOn?: readonly string[];
  /**
   * Required at deployment only under a condition, e.g. benchmark evidence is
   * owed only once a second provider is configured. Absent means always.
   */
  readonly conditional?: string;
}

export const CHECKS: readonly ReadinessCheck[] = [
  {
    id: "provider_credential",
    label: "AI provider credential",
    owner: "platform_operator",
    tier: "deployment",
    remedy:
      "Configure the provider named by AI_PROVIDER: a gateway needs AI_GATEWAY_URL, AI_GATEWAY_API_KEY and AI_GATEWAY_MODEL. The runner refuses to issue a runner without them.",
  },
  {
    id: "database",
    label: "Database",
    owner: "platform_operator",
    tier: "deployment",
    remedy: "Set DATABASE_URL. Model execution is refused rather than performed unrecorded.",
  },
  {
    id: "migrations",
    label: "Migrations applied",
    owner: "platform_operator",
    tier: "deployment",
    dependsOn: ["database"],
    remedy: "Run pnpm --filter @legalos/database migrate.",
  },
  {
    id: "append_only_triggers",
    label: "Append-only triggers",
    owner: "platform_operator",
    tier: "deployment",
    dependsOn: ["database"],
    remedy:
      "Apply the migrations. These triggers are what make the ledger append-only; their absence is invisible until something rewrites history.",
  },
  {
    id: "delivery_provider",
    label: "Message delivery provider",
    owner: "platform_operator",
    tier: "deployment",
    remedy:
      "Set EMAIL_PROVIDER_URL or SMS_PROVIDER_URL. Without one, sign-in returns 503 in production and nobody outside development can obtain a session.",
  },
  {
    id: "audit_chain",
    label: "Audit chain verifies",
    owner: "platform",
    tier: "deployment",
    dependsOn: ["database"],
    remedy: "Investigate immediately. A chain that does not verify has been altered.",
  },
  {
    id: "production_executions",
    label: "Production executions recorded",
    owner: "platform_operator",
    tier: "deployment",
    dependsOn: ["database"],
    remedy:
      "Perform an authenticated request through /api/chat. Until one exists the platform is architecturally complete and operationally unevidenced.",
  },
  {
    id: "deployment_profile_declared",
    label: "Deployment profile declared",
    owner: "platform",
    tier: "structural",
    remedy:
      "Declare the deployment assumptions in packages/readiness/src/profile.ts, naming the ADR they implement.",
  },
  {
    id: "database_encrypted",
    label: "Database connection encrypted",
    owner: "platform_operator",
    tier: "deployment",
    dependsOn: ["database"],
    remedy:
      "Require TLS on the database connection. Case evidence crossing a network in clear text is a disclosure, not a configuration detail.",
  },
  {
    id: "database_managed",
    label: "Database separate from the application host",
    owner: "platform_operator",
    tier: "deployment",
    dependsOn: ["database"],
    conditional: "required when the profile expects a managed database",
    remedy:
      "Use a managed database rather than one colocated with the application. A colocated database shares the blast radius of the process it serves.",
  },
  {
    id: "health_endpoint",
    label: "Health endpoint responding",
    owner: "platform_operator",
    tier: "deployment",
    conditional: "measured when HEALTH_URL names a running deployment",
    remedy:
      "Expose the profile's health endpoint and set HEALTH_URL so the release workflow can verify it before recording a release.",
  },
  {
    id: "benchmark_dataset",
    label: "LegalBench-UK-v1 dataset",
    owner: "legal_review_board",
    tier: "deployment",
    conditional: "required once benchmarking is enabled",
    remedy:
      "Install a reviewed dataset under datasets/. It must be authored by qualified people; the platform ships without one deliberately.",
  },
  {
    id: "reviewer_approvals",
    label: "Reviewer approvals",
    owner: "legal_review_board",
    tier: "deployment",
    dependsOn: ["benchmark_dataset"],
    conditional: "required once a dataset is installed",
    remedy: "Two independent reviewers per sample, with any disagreement resolved on the record.",
  },
  {
    id: "benchmark_evidence",
    label: "Benchmark evidence",
    owner: "platform_operator",
    tier: "deployment",
    conditional: "required once more than one provider is configured",
    remedy:
      "Run the benchmark suite. With a single provider nothing is ranked and none is owed; with several, routing refuses until evidence exists.",
  },
];

/**
 * Checks that must exist for the model to be intact.
 *
 * Listed separately from CHECKS on purpose. If the required list were derived
 * from the checks themselves, deleting a check would delete its own requirement
 * and the model would weaken silently — which is the failure mode this whole
 * manifest exists to catch.
 */
export const REQUIRED_CHECKS: readonly string[] = [
  "deployment_profile_declared",
  "database_encrypted",
  "provider_credential",
  "database",
  "migrations",
  "append_only_triggers",
  "delivery_provider",
  "audit_chain",
  "production_executions",
];
