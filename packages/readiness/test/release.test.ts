import { test } from "node:test";
import assert from "node:assert/strict";

import {
  GENESIS_HASH,
  currentVersion,
  recordRelease,
  recordRollback,
  verifyDeploymentHistory,
  type DeploymentEvent,
  type ReleaseAttempt,
} from "../src/index.ts";

/**
 * A deployment is not successful because a workflow completed. It is successful
 * because the evidence was produced and verified, and these tests are where
 * that distinction is enforced rather than asserted.
 */

const attempt: ReleaseAttempt = {
  version: "v0.4.0",
  commit: "0fce808",
  environment: "production",
  at: "2026-07-27T10:00:00.000Z",
  operator: "release workflow",
  migrations: ["0001_init.sql", "0007_agent_metrics.sql"],
  readinessManifestVersion: 1,
  readinessPassed: true,
  readinessBlocking: [],
  healthChecks: [{ name: "audit chain", passed: true, detail: "intact" }],
};

test("a complete release is recorded and chains from genesis", () => {
  const result = recordRelease(attempt);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.record.previousHash, GENESIS_HASH);
  assert.equal(result.record.hash.length, 64);
});

test("DP-001 a release without a passing readiness check is refused", () => {
  const result = recordRelease({
    ...attempt,
    readinessPassed: false,
    readinessBlocking: ["provider_credential"],
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.defects.includes("READINESS_NOT_PASSED"));
});

test("DP-004 a release with no recorded migration set is refused", () => {
  const result = recordRelease({ ...attempt, migrations: [] });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.defects.includes("NO_MIGRATIONS_RECORDED"));
});

test("DP-005 a release with no health checks is refused", () => {
  // Not the same as a release whose health checks failed. Both are refused,
  // and only one of them means somebody ran the checks.
  const result = recordRelease({ ...attempt, healthChecks: [] });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.defects.includes("NO_HEALTH_CHECKS"));
});

test("DP-005 a release with a failed health check is refused", () => {
  const result = recordRelease({
    ...attempt,
    healthChecks: [{ name: "audit chain", passed: false, detail: "broken at 4" }],
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.defects.includes("HEALTH_CHECK_FAILED"));
});

test("every defect is reported, not only the first", () => {
  const result = recordRelease({
    ...attempt,
    readinessPassed: false,
    migrations: [],
    healthChecks: [],
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.defects.length, 3);
});

test("DP-003 a rollback is always recordable, because refusing one strands an outage", () => {
  const rollback = recordRollback({
    fromVersion: "v0.4.0",
    toVersion: "v0.3.9",
    environment: "production",
    at: "2026-07-27T10:30:00.000Z",
    operator: "on-call",
    reason: "verification rate collapsed after release",
    automatic: false,
  });
  assert.equal(rollback.hash.length, 64);
  assert.equal(rollback.toVersion, "v0.3.9");
});

function history(): DeploymentEvent[] {
  const first = recordRelease(attempt);
  assert.ok(first.ok);
  const rollback = recordRollback(
    {
      fromVersion: "v0.4.0",
      toVersion: "v0.3.9",
      environment: "production",
      at: "2026-07-27T10:30:00.000Z",
      operator: "on-call",
      reason: "verification rate collapsed",
      automatic: true,
    },
    first.record.hash
  );
  return [
    { kind: "release", record: first.record },
    { kind: "rollback", record: rollback },
  ];
}

test("a well-formed history verifies", () => {
  assert.equal(verifyDeploymentHistory(history()).valid, true);
});

test("an edited release record is detected", () => {
  // The case this exists for: a deployment history rewritten after an incident
  // to say something more comfortable.
  const events = history();
  const tampered: DeploymentEvent[] = [
    { kind: "release", record: { ...events[0]!.record, version: "v0.4.1" } as never },
    events[1]!,
  ];
  const result = verifyDeploymentHistory(tampered);
  assert.equal(result.valid, false);
  assert.equal(result.brokenAt, 0);
});

test("a removed record breaks the chain rather than shortening it", () => {
  const result = verifyDeploymentHistory([history()[1]!]);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "previous hash does not link");
});

test("the current version accounts for rollbacks", () => {
  assert.equal(currentVersion(history(), "production"), "v0.3.9");
  assert.equal(currentVersion(history(), "staging"), null);
});
