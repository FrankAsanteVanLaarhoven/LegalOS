/**
 * @legalos/ratelimit — per-identity limits, with shared networks in mind.
 *
 * Two decisions here are specific to who uses this platform, and both cut
 * against the usual defaults.
 *
 * **Identity before address.** Asylum accommodation, libraries, charity offices
 * and family homes put many people behind one IP. An address-based limit tuned
 * for one person locks out a building; tuned for a building it protects
 * nothing. So an identity limit is the real control, and the address limit
 * exists only to bound anonymous traffic — deliberately generous, and never the
 * sole control on a route that costs money.
 *
 * **Failure direction depends on what is being protected.** A limiter guarding
 * spend on a paid model must fail closed: if it cannot count, it cannot let
 * unbounded calls through. A limiter guarding a read path must fail open, since
 * denying someone their own evidence because a counter is unavailable is a
 * worse outcome than serving an extra page. Getting this backwards is how a
 * storage outage becomes a person missing a tribunal deadline.
 */

export type Scope = "identity" | "address";

export type FailureMode =
  /** Cannot count, so refuse. For anything that costs money or calls a model. */
  | "closed"
  /** Cannot count, so allow. For read paths where denial is the worse harm. */
  | "open";

export interface Policy {
  readonly id: string;
  readonly scope: Scope;
  /** Requests permitted per window. */
  readonly limit: number;
  readonly windowMs: number;
  readonly onCounterUnavailable: FailureMode;
  /** Why this limit exists, surfaced when it triggers. */
  readonly reason: string;
}

/**
 * Default policies.
 *
 * The address limits are an order of magnitude looser than the identity limits
 * for the reason above — they are a backstop against a script, not a per-person
 * quota, and a shared building must not trip them in ordinary use.
 */
export const POLICIES: Readonly<Record<string, Policy>> = {
  model_identity: {
    id: "model_identity",
    scope: "identity",
    limit: 30,
    windowMs: 60 * 60 * 1000,
    onCounterUnavailable: "closed",
    reason: "Limits how often one account can call a paid model in an hour.",
  },
  model_address: {
    id: "model_address",
    scope: "address",
    // Generous on purpose: a hotel or library shares one address.
    limit: 300,
    windowMs: 60 * 60 * 1000,
    onCounterUnavailable: "closed",
    reason: "Backstop against automated traffic from one network.",
  },
  read_identity: {
    id: "read_identity",
    scope: "identity",
    limit: 600,
    windowMs: 60 * 60 * 1000,
    // Denying someone their own case file is worse than serving extra reads.
    onCounterUnavailable: "open",
    reason: "Limits ordinary reading of case data.",
  },
} as const;

export interface Counter {
  /** Increments and returns the count within the current window, or null. */
  increment(key: string, windowMs: number, now: number): Promise<number | null>;
}

export interface Decision {
  readonly allowed: boolean;
  readonly policyId: string;
  /** Requests remaining, or null when the counter was unavailable. */
  readonly remaining: number | null;
  /** When the window resets, as an epoch millisecond value. */
  readonly resetAt: number;
  /** Present when refused, in words the caller can show. */
  readonly message: string | null;
  /** True when the decision came from the failure mode, not a real count. */
  readonly degraded: boolean;
}

export interface CheckInput {
  readonly policy: Policy;
  /** Account id for identity scope, address for address scope. */
  readonly subject: string | null;
  readonly counter: Counter;
  /** Epoch milliseconds. Passed in so decisions are deterministic in tests. */
  readonly now: number;
}

/**
 * Applies one policy.
 *
 * An identity policy with no subject cannot be applied at all — that is an
 * anonymous caller, and the answer depends on the failure mode rather than
 * silently passing.
 */
export async function check(input: CheckInput): Promise<Decision> {
  const { policy, subject, counter, now } = input;
  const resetAt = now + policy.windowMs;

  if (!subject) {
    const allowed = policy.onCounterUnavailable === "open";
    return {
      allowed,
      policyId: policy.id,
      remaining: null,
      resetAt,
      message: allowed ? null : "This action requires you to be signed in.",
      degraded: true,
    };
  }

  const count = await counter
    .increment(`${policy.id}:${subject}`, policy.windowMs, now)
    .catch(() => null);

  if (count === null) {
    const allowed = policy.onCounterUnavailable === "open";
    return {
      allowed,
      policyId: policy.id,
      remaining: null,
      resetAt,
      message: allowed
        ? null
        : "This service is temporarily unavailable. Please try again shortly.",
      degraded: true,
    };
  }

  const remaining = Math.max(0, policy.limit - count);
  const allowed = count <= policy.limit;

  return {
    allowed,
    policyId: policy.id,
    remaining,
    resetAt,
    message: allowed ? null : `${policy.reason} You have reached the limit; it resets shortly.`,
    degraded: false,
  };
}

/**
 * Applies several policies, refusing on the first that says no.
 *
 * Order matters: identity is checked before address, so a signed-in person on a
 * busy shared network is judged on their own usage rather than the building's.
 */
export async function checkAll(
  policies: readonly Policy[],
  subjects: { identity: string | null; address: string | null },
  counter: Counter,
  now: number
): Promise<Decision> {
  const ordered = [...policies].sort((a, b) =>
    a.scope === b.scope ? 0 : a.scope === "identity" ? -1 : 1
  );

  let last: Decision | null = null;
  for (const policy of ordered) {
    const subject = policy.scope === "identity" ? subjects.identity : subjects.address;
    const decision = await check({ policy, subject, counter, now });
    if (!decision.allowed) return decision;
    last = decision;
  }

  return (
    last ?? {
      allowed: true,
      policyId: "none",
      remaining: null,
      resetAt: now,
      message: null,
      degraded: true,
    }
  );
}

/**
 * In-memory sliding-window counter.
 *
 * Adequate for a single process and explicitly not for more than one — a
 * deployment behind several instances needs a shared store, or each instance
 * enforces the limit separately and the real limit is multiplied by the
 * instance count.
 */
export class MemoryCounter implements Counter {
  readonly #hits = new Map<string, number[]>();

  async increment(key: string, windowMs: number, now: number): Promise<number> {
    const cutoff = now - windowMs;
    const existing = (this.#hits.get(key) ?? []).filter((t) => t > cutoff);
    existing.push(now);
    this.#hits.set(key, existing);
    return existing.length;
  }

  /** Drops expired entries so a long-lived process does not grow unbounded. */
  sweep(now: number, windowMs: number): void {
    const cutoff = now - windowMs;
    for (const [key, hits] of this.#hits) {
      const live = hits.filter((t) => t > cutoff);
      if (live.length === 0) this.#hits.delete(key);
      else this.#hits.set(key, live);
    }
  }
}

/** Headers describing the decision, for a caller that wants to show them. */
export function rateLimitHeaders(decision: Decision): Record<string, string> {
  const headers: Record<string, string> = {
    "RateLimit-Policy": decision.policyId,
    "RateLimit-Reset": String(Math.ceil(decision.resetAt / 1000)),
  };
  if (decision.remaining !== null) {
    headers["RateLimit-Remaining"] = String(decision.remaining);
  }
  return headers;
}
