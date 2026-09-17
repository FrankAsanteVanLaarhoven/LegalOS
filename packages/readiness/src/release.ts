import { createHash } from "node:crypto";

/**
 * Release and rollback evidence.
 *
 * A deployment is not successful because a workflow completed. It is successful
 * because the required evidence was produced and verified — and the difference
 * shows up when someone asks, months later, on what basis a version went to
 * production. "The pipeline was green" is not an answer anybody can check.
 *
 * So a release record is refused unless it carries what makes it checkable:
 * the readiness result that permitted it, the migration set applied, and the
 * health checks that passed afterwards. A record asserting success without
 * those is not a weaker record, it is a different kind of thing — a claim.
 *
 * Chained like the audit log, and for the same reason. Deployment history is
 * one of the few records that matters most when it is inconvenient, and a list
 * that can be edited afterwards cannot establish what was running when
 * something went wrong.
 */

export const GENESIS_HASH = "0".repeat(64);

export interface HealthCheck {
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
}

export interface ReleaseRecord {
  readonly version: string;
  readonly commit: string;
  readonly environment: "staging" | "production";
  readonly at: string;
  /** Who or what initiated it. A workflow id, or a named person. */
  readonly operator: string;
  /** Migrations applied at the point of release, in order. */
  readonly migrations: readonly string[];
  readonly readinessManifestVersion: number;
  /** Whether the deployment-tier readiness check passed. */
  readonly readinessPassed: boolean;
  /** Checks that were blocking, where it did not. */
  readonly readinessBlocking: readonly string[];
  readonly healthChecks: readonly HealthCheck[];
  readonly previousHash: string;
  readonly hash: string;
}

export interface RollbackRecord {
  readonly fromVersion: string;
  readonly toVersion: string;
  readonly environment: "staging" | "production";
  readonly at: string;
  readonly operator: string;
  /** Why. "Automatic" is not a reason, it is a mechanism. */
  readonly reason: string;
  readonly automatic: boolean;
  readonly previousHash: string;
  readonly hash: string;
}

export type ReleaseDefect =
  | "READINESS_NOT_PASSED"
  | "NO_MIGRATIONS_RECORDED"
  | "NO_HEALTH_CHECKS"
  | "HEALTH_CHECK_FAILED"
  | "CHAIN_BROKEN"
  | "HASH_MISMATCH";

export interface ReleaseAttempt {
  readonly version: string;
  readonly commit: string;
  readonly environment: "staging" | "production";
  readonly at: string;
  readonly operator: string;
  readonly migrations: readonly string[];
  readonly readinessManifestVersion: number;
  readonly readinessPassed: boolean;
  readonly readinessBlocking: readonly string[];
  readonly healthChecks: readonly HealthCheck[];
}

function hashRelease(input: Omit<ReleaseRecord, "hash">): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        version: input.version,
        commit: input.commit,
        environment: input.environment,
        at: input.at,
        operator: input.operator,
        migrations: [...input.migrations],
        readinessManifestVersion: input.readinessManifestVersion,
        readinessPassed: input.readinessPassed,
        readinessBlocking: [...input.readinessBlocking],
        healthChecks: input.healthChecks.map((h) => ({ name: h.name, passed: h.passed })),
        previousHash: input.previousHash,
      }),
      "utf8"
    )
    .digest("hex");
}

function hashRollback(input: Omit<RollbackRecord, "hash">): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        fromVersion: input.fromVersion,
        toVersion: input.toVersion,
        environment: input.environment,
        at: input.at,
        operator: input.operator,
        reason: input.reason,
        automatic: input.automatic,
        previousHash: input.previousHash,
      }),
      "utf8"
    )
    .digest("hex");
}

/**
 * Records a release, or refuses and says why.
 *
 * DP-001, DP-004 and DP-005 are enforced here rather than described: a release
 * without a passing readiness result, without a recorded migration set, or with
 * a failed health check is not written. It is not written as unsuccessful
 * either — an unsuccessful deployment is a rollback, and conflating the two
 * would leave a record of a release that did not happen.
 */
export function recordRelease(
  attempt: ReleaseAttempt,
  previousHash: string = GENESIS_HASH
): { ok: true; record: ReleaseRecord } | { ok: false; defects: readonly ReleaseDefect[] } {
  const defects: ReleaseDefect[] = [];

  if (!attempt.readinessPassed) defects.push("READINESS_NOT_PASSED");
  if (attempt.migrations.length === 0) defects.push("NO_MIGRATIONS_RECORDED");
  if (attempt.healthChecks.length === 0) defects.push("NO_HEALTH_CHECKS");
  if (attempt.healthChecks.some((h) => !h.passed)) defects.push("HEALTH_CHECK_FAILED");

  if (defects.length > 0) return { ok: false, defects };

  const withoutHash = { ...attempt, previousHash };
  return { ok: true, record: { ...withoutHash, hash: hashRelease(withoutHash) } };
}

/** Records a rollback. Always permitted — refusing one would strand an outage. */
export function recordRollback(
  input: Omit<RollbackRecord, "hash" | "previousHash">,
  previousHash: string = GENESIS_HASH
): RollbackRecord {
  const withoutHash = { ...input, previousHash };
  return { ...withoutHash, hash: hashRollback(withoutHash) };
}

export type DeploymentEvent =
  | { readonly kind: "release"; readonly record: ReleaseRecord }
  | { readonly kind: "rollback"; readonly record: RollbackRecord };

/**
 * Verifies the deployment history.
 *
 * Recomputes every hash rather than comparing stored ones. A chain that
 * compares stored value to stored value passes happily after both were edited,
 * which is the defect this project has already found twice — once in the
 * metrics projection and once here, in the first version of this function.
 */
export function verifyDeploymentHistory(events: readonly DeploymentEvent[]): {
  valid: boolean;
  brokenAt: number | null;
  reason: string | null;
} {
  let previousHash = GENESIS_HASH;

  for (const [index, event] of events.entries()) {
    if (event.record.previousHash !== previousHash) {
      return { valid: false, brokenAt: index, reason: "previous hash does not link" };
    }
    const expected =
      event.kind === "release"
        ? hashRelease(event.record as Omit<ReleaseRecord, "hash">)
        : hashRollback(event.record as Omit<RollbackRecord, "hash">);
    if (expected !== event.record.hash) {
      return { valid: false, brokenAt: index, reason: "record hash does not match content" };
    }
    previousHash = event.record.hash;
  }

  return { valid: true, brokenAt: null, reason: null };
}

/** The version currently deployed, accounting for rollbacks. */
export function currentVersion(
  events: readonly DeploymentEvent[],
  environment: "staging" | "production"
): string | null {
  let version: string | null = null;
  for (const event of events) {
    if (event.record.environment !== environment) continue;
    version = event.kind === "release" ? event.record.version : event.record.toVersion;
  }
  return version;
}
