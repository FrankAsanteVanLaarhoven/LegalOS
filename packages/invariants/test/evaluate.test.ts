import { test } from "node:test";
import assert from "node:assert/strict";

import {
  canBeRaised,
  defineInvariant,
  evaluateInvariant,
  type Falsification,
  type ObservationLike,
  type ObservationLookup,
} from "../src/index.ts";

/** Six outcomes, each reached deliberately rather than observed in passing. */

function lookup(values: Record<string, number | boolean | string | null>): ObservationLookup {
  const map = new Map<string, ObservationLike>(
    Object.entries(values).map(([id, value]) => [id, { id, value, method: "test" }])
  );
  return { get: (id) => map.get(id) };
}

const falsified = (id: string): ReadonlyMap<string, Falsification> =>
  new Map([
    [
      id,
      {
        observationId: id,
        mutation: "test",
        observedFalse: true as const,
        at: "2026-07-26T00:00:00.000Z",
        commit: null,
        performedBy: "test",
      },
    ],
  ]);

const none: ReadonlyMap<string, Falsification> = new Map();

const base = {
  id: "T-001",
  title: "A property",
  category: "security" as const,
  rationale: "A rationale long enough to explain to a reviewer why this property matters at all.",
  capability: "authentication",
  protects: ["packages/invariants"],
  evidenceKinds: ["integration" as const],
};

const critical = defineInvariant({ ...base, severity: "critical", observations: ["a", "b"] });
const high = defineInvariant({ ...base, severity: "high", observations: ["a", "b"] });

test("an observation nobody built reports no_observer, never satisfied", () => {
  const r = evaluateInvariant(critical, {
    observations: lookup({ a: true }),
    falsifications: falsified("a"),
  });
  assert.equal(r.status, "no_observer");
  assert.match(r.nextAction, /Instrument b/);
});

test("an observation measured false reports failed", () => {
  const r = evaluateInvariant(critical, {
    observations: lookup({ a: true, b: false }),
    falsifications: falsified("a"),
  });
  assert.equal(r.status, "failed");
});

test("an observation that could not be measured fails closed as unmeasured", () => {
  // Not a pass and not a zero. This is the rule the whole architecture rests on.
  const r = evaluateInvariant(critical, {
    observations: lookup({ a: true, b: null }),
    falsifications: falsified("a"),
  });
  assert.equal(r.status, "unmeasured");
});

test("a measured failure outranks a broken dependency, because it is real information", () => {
  const dep = defineInvariant({ ...base, id: "T-000", severity: "high", observations: ["d"] });
  const child = defineInvariant({
    ...base,
    id: "T-002",
    severity: "high",
    observations: ["a"],
    dependsOn: ["T-000"],
  });
  const options = {
    observations: lookup({ a: false, d: false }),
    falsifications: none,
    registry: [dep, child],
  };
  assert.equal(evaluateInvariant(child, options).status, "failed");
});

test("an otherwise-holding invariant with a broken dependency reports blocked", () => {
  const dep = defineInvariant({ ...base, id: "T-000", severity: "high", observations: ["d"] });
  const child = defineInvariant({
    ...base,
    id: "T-002",
    severity: "high",
    observations: ["a"],
    dependsOn: ["T-000"],
  });
  const r = evaluateInvariant(child, {
    observations: lookup({ a: true, d: false }),
    falsifications: none,
    registry: [dep, child],
  });
  assert.equal(r.status, "blocked");
  assert.equal(r.blockedBy, "T-000");
});

test("a critical invariant holding on observations never seen to fail is unfalsified", () => {
  // GV-000. Everything measured true, and still not satisfied, because nothing
  // demonstrates these observations can report anything else.
  const r = evaluateInvariant(critical, {
    observations: lookup({ a: true, b: true }),
    falsifications: none,
  });
  assert.equal(r.status, "unfalsified");
  assert.match(r.nextAction, /docs\/falsification/);
});

test("one falsification record on one observation is enough to satisfy a critical invariant", () => {
  const r = evaluateInvariant(critical, {
    observations: lookup({ a: true, b: true }),
    falsifications: falsified("b"),
  });
  assert.equal(r.status, "satisfied");
});

test("a non-critical invariant does not require falsification", () => {
  const r = evaluateInvariant(high, {
    observations: lookup({ a: true, b: true }),
    falsifications: none,
  });
  assert.equal(r.status, "satisfied");
});

test("a count observation holds only above zero", () => {
  const counted = defineInvariant({ ...base, severity: "high", observations: ["n"] });
  assert.equal(
    evaluateInvariant(counted, { observations: lookup({ n: 0 }), falsifications: none }).status,
    "failed"
  );
  assert.equal(
    evaluateInvariant(counted, { observations: lookup({ n: 3 }), falsifications: none }).status,
    "satisfied"
  );
});

test("adversarial evidence alone cannot raise an invariant", () => {
  assert.equal(
    canBeRaised(
      defineInvariant({
        ...base,
        severity: "high",
        observations: ["a"],
        evidenceKinds: ["security"],
      })
    ),
    false
  );
  assert.equal(
    canBeRaised(
      defineInvariant({
        ...base,
        severity: "high",
        observations: ["a"],
        evidenceKinds: ["security", "integration"],
      })
    ),
    true
  );
});
