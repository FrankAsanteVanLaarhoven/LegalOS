import { CHECKS, type ReadinessCheck, type ReadinessState } from "./manifest.ts";

/**
 * Turning measurements into a verdict, per tier.
 *
 * The tier decides how `not_measurable` is treated, and nothing else does. At
 * structural and environment tiers it is an honest absence and passes; at
 * deployment it fails, because a release is exactly the moment when "we could
 * not tell" is not an acceptable answer about the audit chain.
 */

export interface Measurement {
  readonly id: string;
  readonly state: ReadinessState;
  readonly detail: string;
}

export interface ReadinessResult extends Measurement {
  readonly check: ReadinessCheck;
  /** Whether this result blocks at the tier it was evaluated for. */
  readonly blocking: boolean;
}

export type Tier = "structural" | "environment" | "deployment";

export interface EvaluateOptions {
  readonly tier: Tier;
  readonly measurements: readonly Measurement[];
  readonly checks?: readonly ReadinessCheck[];
  /** Conditional checks that this deployment has actually opted into. */
  readonly applicable?: readonly string[];
}

export function evaluate(options: EvaluateOptions): readonly ReadinessResult[] {
  const checks = options.checks ?? CHECKS;
  const byId = new Map(options.measurements.map((m) => [m.id, m] as const));
  const applicable = new Set(options.applicable ?? []);

  return checks.map((check) => {
    const measured = byId.get(check.id);
    const state: ReadinessState = measured?.state ?? "not_measurable";
    const detail = measured?.detail ?? "no measurement was taken";

    // A conditional check the deployment has not opted into is not owed. Marking
    // it failed would train an operator to ignore a line that will one day
    // matter.
    const conditionalAndNotApplicable = Boolean(check.conditional) && !applicable.has(check.id);

    const blocking =
      options.tier === "deployment" &&
      !conditionalAndNotApplicable &&
      (state === "fail" || state === "not_measurable");

    return { id: check.id, check, state, detail, blocking };
  });
}

export interface Verdict {
  readonly ready: boolean;
  readonly blocking: readonly ReadinessResult[];
  readonly counts: Readonly<Record<ReadinessState, number>>;
}

export function verdict(results: readonly ReadinessResult[]): Verdict {
  const counts = { pass: 0, fail: 0, not_measurable: 0 };
  for (const result of results) counts[result.state] += 1;
  const blocking = results.filter((r) => r.blocking);
  return { ready: blocking.length === 0, blocking, counts };
}
