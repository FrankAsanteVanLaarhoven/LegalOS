import { createHash, randomInt, timingSafeEqual } from "node:crypto";

/**
 * One-time codes for contact verification and sign-in.
 *
 * Codes are stored as hashes, compared in constant time, expire quickly, and
 * are burned after a small number of attempts. The attempt limit matters more
 * than usual here: a six-digit code is guessable by a script in minutes without
 * one, and the account it protects may hold someone's asylum evidence.
 */

export type ChallengePurpose = "verify_contact" | "sign_in";

export interface Challenge {
  readonly id: string;
  readonly purpose: ChallengePurpose;
  /** Email address or phone number the code was sent to. */
  readonly contact: string;
  readonly codeHash: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly attempts: number;
  readonly consumedAt: string | null;
}

/** Ten minutes: long enough to find the message, short enough to matter. */
export const CHALLENGE_TTL_MS = 10 * 60 * 1000;

/** After this many wrong guesses the challenge is dead and a new one is needed. */
export const MAX_ATTEMPTS = 5;

export function hashCode(code: string): string {
  return createHash("sha256").update(code, "utf8").digest("hex");
}

/** Six digits, uniformly distributed. `randomInt` is rejection-sampled. */
export function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export interface IssuedChallenge {
  readonly challenge: Challenge;
  /** Returned once, for delivery. Never stored and never logged. */
  readonly code: string;
}

export function issueChallenge(input: {
  id: string;
  purpose: ChallengePurpose;
  contact: string;
  now: string;
}): IssuedChallenge {
  const code = generateCode();
  return {
    code,
    challenge: {
      id: input.id,
      purpose: input.purpose,
      contact: input.contact,
      codeHash: hashCode(code),
      createdAt: input.now,
      expiresAt: new Date(Date.parse(input.now) + CHALLENGE_TTL_MS).toISOString(),
      attempts: 0,
      consumedAt: null,
    },
  };
}

export type ChallengeRejection =
  "UNKNOWN" | "EXPIRED" | "ALREADY_USED" | "TOO_MANY_ATTEMPTS" | "INCORRECT";

export interface ChallengeResult {
  readonly ok: boolean;
  readonly rejection: ChallengeRejection | null;
  /** The challenge with its attempt count advanced, to be persisted. */
  readonly challenge: Challenge | null;
  /** Shown to the person. Deliberately identical for wrong and unknown codes. */
  readonly message: string | null;
}

/**
 * Verifies a submitted code.
 *
 * An incorrect code and an unknown challenge return the same message on
 * purpose: distinguishing them tells an attacker whether a contact is
 * registered, which for this population can be information worth protecting in
 * itself.
 */
export function verifyChallenge(
  challenge: Challenge | null,
  code: string,
  now: string
): ChallengeResult {
  const generic = "That code was not correct, or it has expired. Ask for a new one.";

  if (!challenge) {
    return { ok: false, rejection: "UNKNOWN", challenge: null, message: generic };
  }
  if (challenge.consumedAt !== null) {
    return { ok: false, rejection: "ALREADY_USED", challenge, message: generic };
  }
  if (Date.parse(challenge.expiresAt) <= Date.parse(now)) {
    return { ok: false, rejection: "EXPIRED", challenge, message: generic };
  }
  if (challenge.attempts >= MAX_ATTEMPTS) {
    return {
      ok: false,
      rejection: "TOO_MANY_ATTEMPTS",
      challenge,
      message: "Too many attempts. Ask for a new code.",
    };
  }

  const submitted = Uint8Array.from(Buffer.from(hashCode(code), "hex"));
  const stored = Uint8Array.from(Buffer.from(challenge.codeHash, "hex"));
  const matches = submitted.length === stored.length && timingSafeEqual(submitted, stored);

  if (!matches) {
    return {
      ok: false,
      rejection: "INCORRECT",
      challenge: { ...challenge, attempts: challenge.attempts + 1 },
      message: generic,
    };
  }

  return {
    ok: true,
    rejection: null,
    challenge: { ...challenge, consumedAt: now },
    message: null,
  };
}
