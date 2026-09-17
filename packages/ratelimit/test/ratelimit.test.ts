import { test } from "node:test";
import assert from "node:assert/strict";

import {
  check,
  checkAll,
  MemoryCounter,
  POLICIES,
  rateLimitHeaders,
  type Counter,
} from "../src/index.ts";

const NOW = 1_800_000_000_000;

/** A counter that always fails, standing in for an unreachable store. */
const brokenCounter: Counter = {
  async increment() {
    throw new Error("store unreachable");
  },
};

/** A counter that returns null rather than throwing. */
const nullCounter: Counter = {
  async increment() {
    return null;
  },
};

test("requests within the limit are allowed and count down", async () => {
  const counter = new MemoryCounter();
  const policy = POLICIES.model_identity!;
  const first = await check({ policy, subject: "a1", counter, now: NOW });
  assert.equal(first.allowed, true);
  assert.equal(first.remaining, policy.limit - 1);
  assert.equal(first.degraded, false);
});

test("exceeding the limit refuses and explains why", async () => {
  const counter = new MemoryCounter();
  const policy = POLICIES.model_identity!;
  let decision = await check({ policy, subject: "a1", counter, now: NOW });
  for (let i = 1; i <= policy.limit; i += 1) {
    decision = await check({ policy, subject: "a1", counter, now: NOW });
  }
  assert.equal(decision.allowed, false);
  assert.equal(decision.remaining, 0);
  assert.match(decision.message ?? "", /paid model/);
});

test("the window slides, so a limit is not permanent", async () => {
  const counter = new MemoryCounter();
  const policy = { ...POLICIES.model_identity!, limit: 1 };
  await check({ policy, subject: "a1", counter, now: NOW });
  const blocked = await check({ policy, subject: "a1", counter, now: NOW });
  assert.equal(blocked.allowed, false);

  const later = await check({
    policy,
    subject: "a1",
    counter,
    now: NOW + policy.windowMs + 1,
  });
  assert.equal(later.allowed, true);
});

test("identities are counted separately", async () => {
  const counter = new MemoryCounter();
  const policy = { ...POLICIES.model_identity!, limit: 1 };
  await check({ policy, subject: "a1", counter, now: NOW });
  const other = await check({ policy, subject: "a2", counter, now: NOW });
  assert.equal(other.allowed, true);
});

/* ---------------- failure direction ---------------- */

test("a limiter guarding spend fails closed when it cannot count", async () => {
  const decision = await check({
    policy: POLICIES.model_identity!,
    subject: "a1",
    counter: brokenCounter,
    now: NOW,
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.degraded, true);
  assert.match(decision.message ?? "", /temporarily unavailable/);
});

test("a limiter guarding reading fails open, because denial is the worse harm", async () => {
  const decision = await check({
    policy: POLICIES.read_identity!,
    subject: "a1",
    counter: brokenCounter,
    now: NOW,
  });
  assert.equal(decision.allowed, true);
  assert.equal(decision.degraded, true);
});

test("a counter returning null is treated the same as one that throws", async () => {
  const closed = await check({
    policy: POLICIES.model_identity!,
    subject: "a1",
    counter: nullCounter,
    now: NOW,
  });
  assert.equal(closed.allowed, false);
});

test("an anonymous caller cannot satisfy an identity policy on a paid route", async () => {
  const decision = await check({
    policy: POLICIES.model_identity!,
    subject: null,
    counter: new MemoryCounter(),
    now: NOW,
  });
  assert.equal(decision.allowed, false);
  assert.match(decision.message ?? "", /signed in/);
});

/* ---------------- shared networks ---------------- */

test("the address limit is far looser than the identity limit", () => {
  assert.ok(
    POLICIES.model_address!.limit >= POLICIES.model_identity!.limit * 5,
    "a shared building must not trip the address backstop in ordinary use"
  );
});

test("a signed-in person is judged on their own usage, not the building's", async () => {
  const counter = new MemoryCounter();
  const identity = { ...POLICIES.model_identity!, limit: 5 };
  const address = { ...POLICIES.model_address!, limit: 5 };

  // Four other people at the same address have already used the network quota.
  for (let i = 0; i < 5; i += 1) {
    await counter.increment(`${address.id}:10.0.0.1`, address.windowMs, NOW);
  }

  // The signed-in person is refused by the address backstop, not their own use.
  const decision = await checkAll(
    [identity, address],
    { identity: "a1", address: "10.0.0.1" },
    counter,
    NOW
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.policyId, address.id, "identity passed; the address limit refused");
});

test("identity is evaluated before address", async () => {
  const counter = new MemoryCounter();
  const identity = { ...POLICIES.model_identity!, limit: 0 };
  const address = { ...POLICIES.model_address!, limit: 1000 };
  const decision = await checkAll(
    [address, identity],
    { identity: "a1", address: "10.0.0.1" },
    counter,
    NOW
  );
  assert.equal(decision.policyId, identity.id);
});

/* ---------------- housekeeping ---------------- */

test("sweeping drops expired entries", async () => {
  const counter = new MemoryCounter();
  await counter.increment("k", 1000, NOW);
  counter.sweep(NOW + 5000, 1000);
  assert.equal(await counter.increment("k", 1000, NOW + 5000), 1);
});

test("headers describe the decision without inventing a remaining count", () => {
  const degraded = rateLimitHeaders({
    allowed: false,
    policyId: "model_identity",
    remaining: null,
    resetAt: NOW,
    message: null,
    degraded: true,
  });
  assert.equal("RateLimit-Remaining" in degraded, false);
  assert.equal(degraded["RateLimit-Policy"], "model_identity");
});
