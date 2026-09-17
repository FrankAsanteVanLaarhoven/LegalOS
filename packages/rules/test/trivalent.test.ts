import { test } from "node:test";
import assert from "node:assert/strict";

import { and, fromBoolean, not, or } from "../src/trivalent.ts";

test("conjunction: a single failure decides", () => {
  assert.equal(and(["satisfied", "not_satisfied", "insufficient_evidence"]), "not_satisfied");
  assert.equal(and(["satisfied", "satisfied"]), "satisfied");
});

test("conjunction: ignorance dominates when nothing has failed", () => {
  assert.equal(and(["satisfied", "insufficient_evidence"]), "insufficient_evidence");
});

test("disjunction: a single success decides", () => {
  assert.equal(or(["not_satisfied", "satisfied"]), "satisfied");
  assert.equal(or(["insufficient_evidence", "satisfied"]), "satisfied");
});

test("disjunction: ignorance dominates when nothing has succeeded", () => {
  assert.equal(or(["not_satisfied", "insufficient_evidence"]), "insufficient_evidence");
  assert.equal(or(["not_satisfied", "not_satisfied"]), "not_satisfied");
});

test("negation leaves ignorance untouched", () => {
  assert.equal(not("satisfied"), "not_satisfied");
  assert.equal(not("not_satisfied"), "satisfied");
  assert.equal(not("insufficient_evidence"), "insufficient_evidence");
});

test("empty conjunction is vacuously satisfied, empty disjunction is not", () => {
  assert.equal(and([]), "satisfied");
  assert.equal(or([]), "not_satisfied");
});

test("fromBoolean never yields the third value", () => {
  assert.equal(fromBoolean(true), "satisfied");
  assert.equal(fromBoolean(false), "not_satisfied");
});
