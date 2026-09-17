import { test } from "node:test";
import assert from "node:assert/strict";

import {
  generateCode,
  hashCode,
  issueChallenge,
  MAX_ATTEMPTS,
  verifyChallenge,
  type Challenge,
} from "../src/challenge.ts";

const NOW = "2026-07-26T10:00:00.000Z";

function issued(purpose: "verify_contact" | "sign_in" = "sign_in") {
  return issueChallenge({ id: "c1", purpose, contact: "s@example.invalid", now: NOW });
}

test("a code is six digits and only its hash is kept", () => {
  const { challenge, code } = issued();
  assert.match(code, /^\d{6}$/);
  assert.equal(challenge.codeHash, hashCode(code));
  assert.equal(JSON.stringify(challenge).includes(code), false);
});

test("generated codes span the full range including leading zeros", () => {
  const codes = Array.from({ length: 400 }, () => generateCode());
  assert.ok(codes.every((c) => /^\d{6}$/.test(c)));
  assert.ok(new Set(codes).size > 100, "codes should not repeat heavily");
});

test("the correct code succeeds and consumes the challenge", () => {
  const { challenge, code } = issued();
  const result = verifyChallenge(challenge, code, NOW);
  assert.equal(result.ok, true);
  assert.equal(result.challenge?.consumedAt, NOW);
});

test("a consumed challenge cannot be reused", () => {
  const { challenge, code } = issued();
  const used = verifyChallenge(challenge, code, NOW).challenge!;
  assert.equal(verifyChallenge(used, code, NOW).rejection, "ALREADY_USED");
});

test("an expired challenge is refused", () => {
  const { challenge, code } = issued();
  const later = "2026-07-26T10:11:00.000Z";
  assert.equal(verifyChallenge(challenge, code, later).rejection, "EXPIRED");
});

test("a wrong code advances the attempt count", () => {
  const { challenge } = issued();
  const result = verifyChallenge(challenge, "000000", NOW);
  assert.equal(result.ok, false);
  assert.equal(result.challenge?.attempts, 1);
});

test("the challenge dies after the attempt limit", () => {
  let challenge: Challenge = issued().challenge;
  for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
    challenge = verifyChallenge(challenge, "000000", NOW).challenge!;
  }
  const result = verifyChallenge(challenge, "000000", NOW);
  assert.equal(result.rejection, "TOO_MANY_ATTEMPTS");
});

test("even the correct code fails once attempts are exhausted", () => {
  const { challenge: first, code } = issued();
  let challenge: Challenge = first;
  for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
    challenge = verifyChallenge(challenge, "000000", NOW).challenge!;
  }
  assert.equal(verifyChallenge(challenge, code, NOW).ok, false);
});

test("an unknown challenge and a wrong code are indistinguishable to the caller", () => {
  const { challenge } = issued();
  const unknown = verifyChallenge(null, "123456", NOW);
  const wrong = verifyChallenge(challenge, "000000", NOW);
  assert.equal(unknown.message, wrong.message);
});
