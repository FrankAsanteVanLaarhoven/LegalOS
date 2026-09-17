/**
 * @legalos/rules — the Legal Engineering layer.
 *
 * Law as executable workflows over evidenced facts, evaluated deterministically
 * with no model in the loop. Results carry a `releasable` flag: the engine
 * refuses to present a conclusion that rests on unverified sources, unrecorded
 * paragraph locators, or unevidenced assertions.
 */

export { and, or, not, fromBoolean, type Trivalent } from "./trivalent.ts";
export type {
  Fact,
  FactSheet,
  FactValue,
  LegalWorkflow,
  ReleaseBlocker,
  Requirement,
  RequirementOutcome,
  ResolvedFacts,
  WorkflowResult,
} from "./types.ts";
export { evaluateWorkflow, fact, type EvaluateOptions } from "./engine.ts";
export { SKILLED_WORKER_SWITCH } from "./workflows/skilled-worker-switch.ts";

import { SKILLED_WORKER_SWITCH } from "./workflows/skilled-worker-switch.ts";
import type { LegalWorkflow } from "./types.ts";

export const WORKFLOWS: readonly LegalWorkflow[] = [SKILLED_WORKER_SWITCH];

export function findWorkflow(id: string): LegalWorkflow | null {
  return WORKFLOWS.find((workflow) => workflow.id === id) ?? null;
}
