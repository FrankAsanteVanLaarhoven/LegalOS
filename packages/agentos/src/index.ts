/**
 * @legalos/agentos — agents as governed, versioned, permission-scoped services.
 *
 * The registry is the single source of truth. Nothing creates an agent ad hoc,
 * and the runner resolves every agent through here — an id that is not
 * registered is refused before a provider is reached.
 */

export {
  DEPARTMENTS,
  CAPABILITIES,
  PERMISSIONS,
  NEVER_GRANTABLE,
  LIFECYCLE,
  lifecycleRank,
  type Department,
  type Capability,
  type Permission,
  type Lifecycle,
  type AgentDefinition,
  type AgentStanding,
} from "./types.ts";
export { AGENTS, findAgent, agentIds, byDepartment, may } from "./registry.ts";
export {
  route,
  MINIMUM_SAMPLES,
  MINIMUM_REPEATS,
  type RouteOptions,
  type RoutingBasis,
  type RoutingEvidenceLike,
  type RoutingResult,
  type RoutingFailure,
} from "./routing.ts";
export { validateAgents, type AgentDefect } from "./validate.ts";
export { standingFor, standingChecks, type StandingInput, type StandingCheck } from "./standing.ts";
