/**
 * @legalos/invariants — properties that must hold, evaluated from measurements.
 *
 * The capability layer answers how mature a subsystem is. This answers whether
 * a property holds across whatever subsystems it touches, which is the unit
 * trust is actually asserted in.
 */

export {
  defineInvariant,
  CATEGORIES,
  SEVERITIES,
  EVIDENCE_KINDS,
  type Category,
  type Severity,
  type EvidenceKind,
  type Invariant,
  type InvariantSpec,
} from "./invariant.ts";
export { INVARIANTS, invariant, forCapability, requiredObservations } from "./registry.ts";
export {
  evaluateInvariant,
  evaluateAll,
  canBeRaised,
  STATUS_PRECEDENCE,
  type InvariantResult,
  type InvariantStatus,
  type ObservationLike,
  type ObservationLookup,
  type EvaluateOptions,
} from "./evaluate.ts";
export { readFalsifications, falsificationDirectory, type Falsification } from "./falsification.ts";
export { selfObservations, withSelfObservations } from "./self-observations.ts";
export { validateRegistry, validateProtectedPaths, type RegistryDefect } from "./validate.ts";
export {
  coverageByCapability,
  totalVerificationDebt,
  formatCoverage,
  type CapabilityCoverage,
} from "./coverage.ts";
export { formatReport, summarise, type Summary } from "./report.ts";
