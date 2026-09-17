/**
 * AgentOS — agents as governed services rather than prompts.
 *
 * The platform had three agent lists and a fourth mapping: eleven ids in
 * packages/agents, fifteen in apps/web/src/lib/data/agents.ts, eight page slugs,
 * and a capability map naming twelve. They disagreed, and nothing noticed,
 * because nothing was comparing them.
 *
 * One decision here departs from the design as proposed, and it is the same
 * decision the capability layer already rests on.
 *
 * An agent does not have a `status` field. A status somebody writes into a
 * definition is a declaration, and a declaration is what this architecture
 * exists to remove — an agent marked `certified` because a developer typed it
 * is exactly the seven green badges the workspace used to show for agents whose
 * retrieval corpus did not exist. What a definition may hold is a *ceiling*:
 * the highest level this agent could reach. Where it actually sits is derived
 * from execution evidence, and can only ever be lower.
 */

export const DEPARTMENTS = [
  "migration",
  "visa",
  "settlement",
  "refugee",
  "public_services",
  "legal",
  "enterprise",
  "platform",
] as const;

export type Department = (typeof DEPARTMENTS)[number];

/**
 * What an agent is for, and therefore how a request is routed to a provider.
 *
 * Capabilities rather than vendors: `deep_reasoning` is a requirement, and
 * which model serves it is configuration that changes when something
 * benchmarks better.
 */
export const CAPABILITIES = [
  "conversation",
  "deep_reasoning",
  "retrieval",
  "translation",
  "ocr",
  "vision",
  "speech",
  "summarisation",
  "structured_extraction",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/**
 * The closed set of things an agent may be permitted to do.
 *
 * Closed on purpose. An open string would let a new permission be invented at a
 * call site, and the first anyone would know of it is when it had been granted.
 * Nothing is implicit: an agent holds exactly what it declares.
 */
export const PERMISSIONS = [
  "read_case",
  "read_evidence",
  "read_communications",
  "read_timeline",
  "write_timeline",
  "write_tasks",
  "write_draft",
  "assemble_bundle",
  "propose_action",
  "send_communication",
  "delete_evidence",
  "submit_filing",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * Permissions no agent may hold, whatever it declares.
 *
 * Filing and deletion are not withheld because they are unimplemented. They are
 * withheld because a machine performing either without a named human deciding
 * is the failure this platform is built to prevent — a reserved legal activity
 * and an irreversible loss of someone's evidence.
 */
export const NEVER_GRANTABLE: readonly Permission[] = ["submit_filing", "delete_evidence"];

export const LIFECYCLE = [
  "draft",
  "testing",
  "verified",
  "certified",
  "operational",
  "deprecated",
  "retired",
] as const;

export type Lifecycle = (typeof LIFECYCLE)[number];

export function lifecycleRank(level: Lifecycle): number {
  return LIFECYCLE.indexOf(level);
}

export interface AgentDefinition {
  readonly id: string;
  readonly name: string;
  readonly department: Department;
  readonly version: string;
  /**
   * The highest level this agent could reach, never where it is. Present so a
   * definition cannot raise its own standing; the observed level is derived
   * from execution evidence and is capped by this.
   */
  readonly declaredCeiling: Lifecycle;
  readonly description: string;
  readonly capabilities: readonly Capability[];
  /** Exactly what it may do. Absence is refusal, not a default. */
  readonly permissions: readonly Permission[];
  /** Retrieval domains it may search. An empty list means it retrieves nothing. */
  readonly retrievalDomains: readonly string[];
  /** Whether output must pass the verification gate before release. */
  readonly requiresVerification: boolean;
  /** Whether a named human must authorise before anything leaves the platform. */
  readonly requiresHumanReview: boolean;
  /** Invariants this agent is bound by, so a report links the two views. */
  readonly observableInvariants: readonly string[];
}

/** Where an agent actually sits, derived rather than declared. */
export interface AgentStanding {
  readonly id: string;
  readonly declaredCeiling: Lifecycle;
  readonly observed: Lifecycle;
  /** Why it is not higher, in words. */
  readonly reason: string;
  readonly executions: number;
  readonly verificationRate: number | null;
  readonly failureRate: number | null;
  readonly medianLatencyMs: number | null;
}
