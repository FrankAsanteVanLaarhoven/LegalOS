import type { Capability } from "./types.ts";

/**
 * Provider routing, derived from benchmark evidence.
 *
 * This was a hand-written preference order per capability, with a `basis`
 * string that read "unmeasured". It was honest about itself and it was still a
 * ranking nobody had established — and the moment a second provider was
 * configured, that ranking would have started deciding which model answered a
 * person's question.
 *
 * A routing decision now either cites benchmark evidence or is not a ranking.
 * The distinction that makes this workable rather than paralysing:
 *
 *   One configured provider  — no choice is being made, so no evidence is
 *                              needed to justify one. Not a preference.
 *   Several, with evidence   — the highest scorer, citing the report.
 *   Several, no evidence     — refused. Choosing between providers on nothing
 *                              is the unsupported preference this exists to
 *                              prevent, and picking one silently would look
 *                              identical to a measured decision.
 *
 * The third case fails closed on purpose. Better for a capability to be
 * unavailable than for the platform to answer a question about someone's
 * immigration status using a model chosen by the order of a hand-written list.
 */

/** The shape of a benchmark record, as far as routing is concerned. */
export interface RoutingEvidenceLike {
  readonly benchmarkId: string;
  /**
   * The execution environment this evaluation ran against.
   *
   * Age is the weaker half of expiry. A ranking stays plausible for thirty days
   * while a prompt template, a guardrail version or a model id changes
   * underneath it, and the evidence goes on describing an evaluation of a
   * system that no longer exists. Binding the record to the environment means a
   * change to any of those retires it immediately rather than in a month.
   */
  readonly environmentDigest?: string;
  readonly capability: string;
  readonly datasetId: string;
  readonly datasetVersion: string;
  readonly expiresAt: string;
  readonly samples: number;
  readonly repeats: number;
  readonly scores: Readonly<Record<string, number>>;
}

export type RoutingFailure =
  | "NO_CONFIGURED_PROVIDER"
  | "NO_EVIDENCE_FOR_CHOICE"
  | "EVIDENCE_EXPIRED"
  | "EVIDENCE_SUPERSEDED"
  | "EVIDENCE_INADEQUATE";

export type RoutingBasis =
  /** One provider is configured, so nothing is being ranked. */
  | { readonly kind: "sole_provider"; readonly detail: string }
  /** A ranking, citing the evidence that supports it. */
  | {
      readonly kind: "benchmark";
      readonly benchmarkId: string;
      readonly datasetId: string;
      readonly datasetVersion: string;
      readonly expiresAt: string;
      readonly detail: string;
    }
  | { readonly kind: "refused"; readonly detail: string };

export interface RoutingResult {
  readonly provider: string | null;
  readonly failure: RoutingFailure | null;
  readonly basis: RoutingBasis;
}

export interface RouteOptions {
  readonly capability: Capability;
  /** Provider ids actually configured in this deployment. */
  readonly configured: readonly string[];
  /** Evidence records available. Filtered to this capability internally. */
  readonly evidence: readonly RoutingEvidenceLike[];
  /** Epoch milliseconds, passed in so routing is deterministic in tests. */
  readonly now: number;
  readonly minimumSamples?: number;
  readonly minimumRepeats?: number;
  /**
   * Digest of the current execution environment.
   *
   * Evidence produced against a different one is superseded. Omitted, the check
   * is skipped — which is the honest behaviour for a caller that cannot compute
   * it, rather than silently treating unknown as matching.
   */
  readonly environmentDigest?: string;
}

/** One run over a handful of samples is an anecdote, not a ranking. */
export const MINIMUM_SAMPLES = 100;
export const MINIMUM_REPEATS = 3;

export function route(options: RouteOptions): RoutingResult {
  const { capability, configured, evidence, now } = options;
  const minimumSamples = options.minimumSamples ?? MINIMUM_SAMPLES;
  const minimumRepeats = options.minimumRepeats ?? MINIMUM_REPEATS;

  if (configured.length === 0) {
    return {
      provider: null,
      failure: "NO_CONFIGURED_PROVIDER",
      basis: { kind: "refused", detail: `no provider is configured for ${capability}` },
    };
  }

  if (configured.length === 1) {
    // Not a preference. There is one option, and saying so is more honest than
    // manufacturing a justification for it.
    return {
      provider: configured[0]!,
      failure: null,
      basis: {
        kind: "sole_provider",
        detail: `${configured[0]} is the only configured provider for ${capability}; no ranking is claimed`,
      },
    };
  }

  const relevant = evidence.filter((e) => e.capability === capability);
  if (relevant.length === 0) {
    return {
      provider: null,
      failure: "NO_EVIDENCE_FOR_CHOICE",
      basis: {
        kind: "refused",
        detail: `${configured.length} providers are configured for ${capability} and no benchmark evidence ranks them`,
      },
    };
  }

  const current = relevant.filter((e) => {
    const expires = Date.parse(e.expiresAt);
    return !Number.isNaN(expires) && expires > now;
  });
  if (current.length === 0) {
    return {
      provider: null,
      failure: "EVIDENCE_EXPIRED",
      basis: {
        kind: "refused",
        detail: `benchmark evidence for ${capability} has expired; a stale ranking is not a ranking`,
      },
    };
  }

  // Superseded before inadequate: evidence for a system that no longer exists
  // is not made relevant by having had enough samples.
  const applicable =
    options.environmentDigest === undefined
      ? current
      : current.filter(
          (e) =>
            e.environmentDigest === undefined || e.environmentDigest === options.environmentDigest
        );
  if (applicable.length === 0) {
    return {
      provider: null,
      failure: "EVIDENCE_SUPERSEDED",
      basis: {
        kind: "refused",
        detail: `benchmark evidence for ${capability} was produced against a different execution environment; a prompt, guardrail or model version has changed since`,
      },
    };
  }

  const adequate = applicable.filter(
    (e) => e.samples >= minimumSamples && e.repeats >= minimumRepeats
  );
  if (adequate.length === 0) {
    return {
      provider: null,
      failure: "EVIDENCE_INADEQUATE",
      basis: {
        kind: "refused",
        detail: `benchmark evidence for ${capability} is below ${minimumSamples} samples or ${minimumRepeats} repeats`,
      },
    };
  }

  // Freshest evidence wins, not the first one read.
  const chosen = [...adequate].sort(
    (a, b) => Date.parse(b.expiresAt) - Date.parse(a.expiresAt)
  )[0]!;

  const ranked = configured
    .filter((id) => typeof chosen.scores[id] === "number")
    .sort((a, b) => (chosen.scores[b] ?? 0) - (chosen.scores[a] ?? 0));

  if (ranked.length === 0) {
    return {
      provider: null,
      failure: "NO_EVIDENCE_FOR_CHOICE",
      basis: {
        kind: "refused",
        detail: `${chosen.benchmarkId} scores no configured provider for ${capability}`,
      },
    };
  }

  const winner = ranked[0]!;
  return {
    provider: winner,
    failure: null,
    basis: {
      kind: "benchmark",
      benchmarkId: chosen.benchmarkId,
      datasetId: chosen.datasetId,
      datasetVersion: chosen.datasetVersion,
      expiresAt: chosen.expiresAt,
      detail: `${winner} scored ${chosen.scores[winner]} on ${chosen.benchmarkId} (${chosen.datasetId}@${chosen.datasetVersion}, ${chosen.samples} samples x ${chosen.repeats} repeats)`,
    },
  };
}
