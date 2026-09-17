/**
 * @legalos/capabilities — what the platform may claim about itself.
 *
 * A capability declares a level on two axes — implementation and evidence — but
 * is displayed at the level its checks support. A declaration can only lower the
 * shown status, never raise it, so the UI cannot overstate what is built.
 * `overstated()` names any capability whose claim outruns its evidence, and
 * `roadmap()` turns the outstanding checks into the work that would clear them.
 */

export { CapabilityRegistry, resolve } from "./registry.ts";
export {
  booleanOf,
  numberOf,
  observed,
  observeSystem,
  unavailable,
  type Observation,
  type ObservationSet,
  type ObservationSource,
  type ObserveOptions,
} from "./observe.ts";
export { AGENT_CAPABILITY, PLATFORM_CAPABILITIES } from "./platform.ts";
export {
  EVIDENCE_ORDER,
  evidenceRank,
  IMPLEMENTATION_ORDER,
  implementationRank,
  type CapabilityCheck,
  type CapabilityDefinition,
  type CapabilityStatus,
  type Dimension,
  type EvidenceLevel,
  type ImplementationLevel,
} from "./types.ts";

import { CapabilityRegistry } from "./registry.ts";
import { PLATFORM_CAPABILITIES } from "./platform.ts";

export function createPlatformRegistry(): CapabilityRegistry {
  return new CapabilityRegistry(PLATFORM_CAPABILITIES);
}

export {
  observeAssertionTraceability,
  readingOf,
  traceabilityUnavailable,
  TRACEABILITY_OBSERVATION,
  TRACEABILITY_SQL,
  type TraceabilityReading,
} from "./traceability.ts";
