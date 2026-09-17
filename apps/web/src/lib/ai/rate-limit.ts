import {
  checkAll,
  MemoryCounter,
  POLICIES,
  rateLimitHeaders,
  type Decision,
} from "@legalos/ratelimit";
import type { NextRequest } from "next/server";

/**
 * Rate limiting for the model-backed routes.
 *
 * The counter is in-memory, which is correct for one process and wrong for
 * more than one: behind several instances each enforces the limit separately
 * and the effective limit is multiplied by the instance count. That is recorded
 * here rather than assumed away, and is why `rateLimitIsDistributed()` reports
 * false — the capability layer should not claim more than this provides.
 */
const counter = new MemoryCounter();

export function rateLimitIsDistributed(): boolean {
  return false;
}

/** Best-effort client address. Never trusted as identity — see the package. */
function addressOf(req: NextRequest): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() ?? null;
  return req.headers.get("x-real-ip");
}

export interface LimitOutcome {
  readonly decision: Decision;
  readonly headers: Record<string, string>;
}

/**
 * Applies the model-route limits.
 *
 * Both policies apply, identity first: a signed-in person is judged on their
 * own usage rather than their building's, and the address limit is only a
 * backstop against anonymous automated traffic.
 */
export async function limitModelRoute(
  req: NextRequest,
  identity: string | null,
  now = Date.now()
): Promise<LimitOutcome> {
  const decision = await checkAll(
    [POLICIES.model_address!],
    { identity, address: addressOf(req) },
    counter,
    now
  );
  return { decision, headers: rateLimitHeaders(decision) };
}
