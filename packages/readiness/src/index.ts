/**
 * @legalos/readiness — deployment prerequisites, measured rather than ticked.
 *
 * Three tiers, because a contributor without production secrets and a release
 * pipeline are asking different questions. Structural asks whether the platform
 * still knows how to measure readiness; environment measures what the
 * environment can answer; deployment treats "could not tell" as a failure.
 */

export {
  CHECKS,
  REQUIRED_CHECKS,
  MANIFEST_VERSION,
  type ReadinessCheck,
  type ReadinessState,
  type ReadinessOwner,
  type ReadinessTier,
} from "./manifest.ts";
export { validateManifest, type ReadinessDefect } from "./validate.ts";
export { DEPLOYMENT_PROFILE, type DeploymentProfile } from "./profile.ts";
export {
  evaluate,
  verdict,
  type Measurement,
  type ReadinessResult,
  type Verdict,
  type Tier,
  type EvaluateOptions,
} from "./evaluate.ts";
export {
  recordRelease,
  recordRollback,
  verifyDeploymentHistory,
  currentVersion,
  GENESIS_HASH,
  type ReleaseRecord,
  type RollbackRecord,
  type ReleaseAttempt,
  type ReleaseDefect,
  type DeploymentEvent,
  type HealthCheck,
} from "./release.ts";
