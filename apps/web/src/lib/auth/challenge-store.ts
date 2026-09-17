import type { Challenge } from "@legalos/auth";

/**
 * Challenge storage.
 *
 * In memory, and short-lived by nature — a challenge lives ten minutes, so
 * losing them on restart costs someone one retry rather than access. That is a
 * materially different risk from losing sessions, which is why this is not
 * blocking the way the session store was.
 */
const challenges = new Map<string, Challenge>();

export function putChallenge(challenge: Challenge): void {
  challenges.set(challenge.id, challenge);
}

export function getChallenge(id: string): Challenge | null {
  return challenges.get(id) ?? null;
}

/** Whether a message-delivery provider is configured. */
export function deliveryIsConfigured(): boolean {
  return Boolean(process.env.EMAIL_PROVIDER_URL || process.env.SMS_PROVIDER_URL);
}
