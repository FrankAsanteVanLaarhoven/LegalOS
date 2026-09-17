import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BINDING,
  CLASSIFICATIONS,
  deriveAuthority,
  mayConfirmProfessionally,
  VERIFICATION_STATES,
  type AuthorityInput,
} from "../src/index.ts";
import { __validateCreate as validateCreate } from "../src/deadline.ts";

/**
 * The authority rule, tested by taking a deadline that qualifies and breaking
 * it one column at a time.
 *
 * Written this way because the rule is a conjunction, and a conjunction tested
 * only on its happy path is tested on the one input that cannot reveal a
 * missing clause.
 */

const confirmed: AuthorityInput = {
  classification: "statutory",
  status: "open",
  verificationState: "source_matched",
  sourceType: "document",
  sourceLocator: "paragraph 4",
  sourceResolution: "resolved",
};

const withOnly = (over: Partial<AuthorityInput>) => deriveAuthority({ ...confirmed, ...over });

test("a source-matched statutory deadline with a resolved source is authoritative", () => {
  const result = deriveAuthority(confirmed);
  assert.equal(result.authoritative, true);
  assert.equal(result.withheldBecause, null);
});

test("an internal target never becomes authoritative, however well evidenced", () => {
  // The strongest possible evidence on a classification that binds nobody.
  const result = withOnly({
    classification: "internal_target",
    verificationState: "professional_confirmed",
  });
  assert.equal(result.authoritative, false);
  assert.match(result.withheldBecause!, /binds nobody outside it/);
});

test("an unverified date is not authoritative, because nobody has checked it", () => {
  const result = withOnly({ verificationState: "unverified" });
  assert.equal(result.authoritative, false);
  assert.match(result.withheldBecause!, /matched this date to the source/);
});

test("a disputed date is not authoritative", () => {
  assert.equal(withOnly({ verificationState: "disputed" }).authoritative, false);
});

test("a superseded deadline is not authoritative", () => {
  assert.equal(withOnly({ status: "superseded" }).authoritative, false);
  assert.equal(withOnly({ verificationState: "superseded" }).authoritative, false);
});

test("a missing locator withholds authority, because nothing can be checked", () => {
  assert.match(withOnly({ sourceLocator: null }).withheldBecause!, /no locator/);
  assert.match(withOnly({ sourceLocator: "   " }).withheldBecause!, /no locator/);
});

test("an unknown source type withholds authority", () => {
  assert.match(withOnly({ sourceType: "unknown" }).withheldBecause!, /no source was recorded/);
});

test("a dangling source reference withholds authority — the ADR-003 case", () => {
  // `source_id` is untyped text with no foreign key, so a reference to a
  // document that is not there satisfies the schema completely. A locator
  // pointing at nothing is worse than no locator: it looks checked.
  const result = withOnly({ sourceResolution: "dangling" });
  assert.equal(result.authoritative, false);
  assert.match(result.withheldBecause!, /does not resolve/);
});

test("a deadline with no source reference at all is still authoritative if matched", () => {
  // A date read from a paper direction nobody scanned. The locator is what
  // makes it checkable; a stored source id is a convenience.
  assert.equal(withOnly({ sourceResolution: "unreferenced" }).authoritative, true);
});

test("every classification and verification state produces a decision, never a throw", () => {
  // A rule that raises on an unexpected combination fails closed in the worst
  // way — as a 500 on a page that should have said why a date is unverified.
  for (const classification of CLASSIFICATIONS) {
    for (const verificationState of VERIFICATION_STATES) {
      const result = deriveAuthority({ ...confirmed, classification, verificationState });
      assert.equal(typeof result.authoritative, "boolean");
      assert.equal(result.authoritative, result.withheldBecause === null);
    }
  }
});

test("only binding classifications can ever reach authoritative", () => {
  for (const classification of CLASSIFICATIONS) {
    const reachable = deriveAuthority({ ...confirmed, classification }).authoritative;
    assert.equal(reachable, BINDING.includes(classification));
  }
});

test("no field the rule returns is a number", () => {
  // The abstention, at the level it would first be broken: somebody adding a
  // score to this return value would be doing something that reads as helpful.
  const result = deriveAuthority(confirmed);
  for (const value of Object.values(result)) {
    assert.notEqual(typeof value, "number");
  }
});

/* -------------------------------------------------------------- */

test("validation refuses a binding deadline with no source", () => {
  const problem = validateCreate({
    caseId: "c",
    deadlineType: "appeal",
    deadlineAt: "2026-09-01T16:00:00Z",
    classification: "statutory",
    sourceType: "unknown",
    certaintyState: "exact",
  });
  assert.match(problem!, /where it came from/);
});

test("validation accepts an internal target with no source", () => {
  assert.equal(
    validateCreate({
      caseId: "c",
      deadlineType: "chase client",
      deadlineAt: "2026-09-01T16:00:00Z",
      classification: "internal_target",
      sourceType: "unknown",
      certaintyState: "estimated",
    }),
    null
  );
});

test("validation refuses an unrecognised timezone", () => {
  const problem = validateCreate({
    caseId: "c",
    deadlineType: "appeal",
    deadlineAt: "2026-09-01T16:00:00Z",
    timezone: "Middle-earth/Shire",
    classification: "statutory",
    sourceType: "document",
    sourceLocator: "p4",
    certaintyState: "exact",
  });
  assert.match(problem!, /not a timezone/);
});

test("validation accepts a timezone a client might actually be reading in", () => {
  assert.equal(
    validateCreate({
      caseId: "c",
      deadlineType: "appeal",
      deadlineAt: "2026-09-01T16:00:00Z",
      timezone: "Africa/Lagos",
      classification: "statutory",
      sourceType: "document",
      sourceLocator: "p4",
      certaintyState: "exact",
    }),
    null
  );
});

test("validation refuses a calculated date claiming to be exact", () => {
  const problem = validateCreate({
    caseId: "c",
    deadlineType: "appeal",
    deadlineAt: "2026-09-01T16:00:00Z",
    classification: "statutory",
    sourceType: "calculated",
    sourceLocator: "rule 19(2)",
    certaintyState: "exact",
  });
  assert.match(problem!, /cannot be recorded as exact/);
});

/* -------------------------------------------------------------- */

const member = (over: Record<string, unknown> = {}) => ({
  workspaceId: "w",
  accountId: "a",
  role: "solicitor" as const,
  regulatoryReference: "SRA 123456",
  removedAt: null,
  ...over,
});

test("a professional confirmation needs a regulated role and a registration", () => {
  assert.equal(mayConfirmProfessionally(member()), true);
  assert.equal(mayConfirmProfessionally(member({ regulatoryReference: null })), false);
  assert.equal(mayConfirmProfessionally(member({ regulatoryReference: "  " })), false);
  assert.equal(mayConfirmProfessionally(member({ role: "caseworker" })), false);
  // A reviewer checks work; the role is not a qualification.
  assert.equal(mayConfirmProfessionally(member({ role: "reviewer" })), false);
  assert.equal(mayConfirmProfessionally(null), false);
});
