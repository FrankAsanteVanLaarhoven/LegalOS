import { test } from "node:test";
import assert from "node:assert/strict";

import {
  governingMembership,
  selectOrganisation,
  signSelection,
  switchableOrganisations,
  verifySelection,
  type OrganisationMembership,
} from "../src/active-tenant.ts";

/**
 * Active-tenant selection, tested by attacking it.
 *
 * These are the rules that decide which tenancy a request acts in. Five
 * repositories refuse everything outside the answer, so an error here does not
 * produce a wrong page — it produces a correct page about the wrong
 * organisation's client.
 */

const ALPHA = "11111111-1111-4111-8111-111111111111";
const BETA = "22222222-2222-4222-8222-222222222222";
const SECRET = "test-secret";

const member = (over: Partial<OrganisationMembership> = {}): OrganisationMembership => ({
  membershipId: "m1",
  workspaceId: "w1",
  accountId: "a1",
  role: "caseworker",
  regulatoryReference: null,
  removedAt: null,
  organisationId: ALPHA,
  organisationName: "Alpha",
  ...over,
});

/* ---------------------------------------------------------------- */
/* Selection                                                         */
/* ---------------------------------------------------------------- */

test("an account with no memberships gets no organisation", () => {
  const result = selectOrganisation([], null);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.failure, "no_active_organisation");
});

test("one membership and no preference resolves deterministically", () => {
  const result = selectOrganisation([member()], null);
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.organisationId, ALPHA);
  assert.equal(result.ok && result.persist, true);
});

test("several memberships and no preference requires a choice, never the first row", () => {
  // The harm: a solicitor acting for two firms silently acts in whichever
  // tenancy was created first, and every repository then correctly refuses the
  // other firm's cases — which reads as a bug rather than as the wrong tenancy.
  const result = selectOrganisation(
    [member(), member({ organisationId: BETA, organisationName: "Beta", membershipId: "m2" })],
    null
  );
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.failure, "selection_required");
});

test("the order memberships arrive in never decides the answer", () => {
  // Attack: if selection depended on array order, a caller who could influence
  // row order — a new membership, a renamed organisation — could steer it.
  const a = member();
  const b = member({ organisationId: BETA, organisationName: "Beta", membershipId: "m2" });
  const forwards = selectOrganisation([a, b], null);
  const backwards = selectOrganisation([b, a], null);
  assert.deepEqual(forwards, backwards);
});

test("a valid preference resolves and is not re-persisted", () => {
  const result = selectOrganisation([member()], ALPHA);
  assert.equal(result.ok && result.organisationId, ALPHA);
  assert.equal(result.ok && result.persist, false);
});

test("a preference naming an organisation the account never joined is refused", () => {
  // The central attack: edit the cookie to another organisation's id. The
  // signature stops it reaching here; this is the layer that stops it anyway.
  const result = selectOrganisation([member()], BETA);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.failure, "invalid_active_organisation");
});

test("a revoked membership does not satisfy a preference that used to be valid", () => {
  // The harm: someone removed from a firm keeps working in it because their
  // browser still holds the cookie from before.
  const revoked = member({ removedAt: "2026-07-01T00:00:00.000Z" });
  const result = selectOrganisation([revoked], ALPHA);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.failure, "no_active_organisation");
});

test("every refusal for an unavailable organisation reads the same", () => {
  // Enumeration: a caller submitting organisation ids must not be able to tell
  // "not yours" from "does not exist" from "you were removed".
  const notAMember = selectOrganisation([member()], BETA);
  const nonexistent = selectOrganisation([member()], "33333333-3333-4333-8333-333333333333");
  assert.deepEqual(notAMember, nonexistent);
});

/* ---------------------------------------------------------------- */
/* Governing membership                                              */
/* ---------------------------------------------------------------- */

test("the strongest role governs, from an explicit order", () => {
  const governing = governingMembership(
    [
      member({ role: "client", membershipId: "m1" }),
      member({ role: "solicitor", membershipId: "m2", workspaceId: "w2" }),
      member({ role: "caseworker", membershipId: "m3", workspaceId: "w3" }),
    ],
    ALPHA
  );
  assert.equal(governing?.role, "solicitor");
});

test("a revoked membership never governs", () => {
  // The harm: a former partner's solicitor role continuing to authorise
  // reserved work because a live caseworker membership kept them signed in.
  const governing = governingMembership(
    [
      member({ role: "solicitor", removedAt: "2026-07-01T00:00:00.000Z", membershipId: "m1" }),
      member({ role: "caseworker", membershipId: "m2", workspaceId: "w2" }),
    ],
    ALPHA
  );
  assert.equal(governing?.role, "caseworker");
});

test("a membership in another organisation never governs this one", () => {
  assert.equal(governingMembership([member({ organisationId: BETA })], ALPHA), null);
});

/* ---------------------------------------------------------------- */
/* Signing                                                           */
/* ---------------------------------------------------------------- */

test("a signature round-trips", () => {
  assert.equal(verifySelection(signSelection(ALPHA, SECRET), SECRET), ALPHA);
});

test("an edited organisation id does not verify", () => {
  // The attack this is for: change the id in the cookie and keep the signature.
  const signed = signSelection(ALPHA, SECRET);
  const tampered = signed.replace(ALPHA, BETA);
  assert.equal(verifySelection(tampered, SECRET), null);
});

test("a signature from another secret does not verify", () => {
  assert.equal(verifySelection(signSelection(ALPHA, "other-secret"), SECRET), null);
});

test("an unsigned value does not verify", () => {
  assert.equal(verifySelection(ALPHA, SECRET), null);
  assert.equal(verifySelection("", SECRET), null);
  assert.equal(verifySelection(null, SECRET), null);
  assert.equal(verifySelection(`${ALPHA}.`, SECRET), null);
  assert.equal(verifySelection(`.${ALPHA}`, SECRET), null);
});

test("an id containing a dot is signed and verified whole", () => {
  // Attack: a value crafted so a naive split on "." reads part of it as the id
  // and the rest as a signature. The parser takes the *last* dot for exactly
  // this reason.
  const odd = "org.with.dots";
  assert.equal(verifySelection(signSelection(odd, SECRET), SECRET), odd);
});

test("truncating the signature does not verify", () => {
  const signed = signSelection(ALPHA, SECRET);
  assert.equal(verifySelection(signed.slice(0, -1), SECRET), null);
  assert.equal(verifySelection(signed.split(".")[0]!, SECRET), null);
});

test("signing carries no personal information", () => {
  // The cookie value is an id and a MAC. Nothing about the person, the
  // organisation's name or their role is recoverable from it.
  const signed = signSelection(ALPHA, SECRET);
  assert.ok(!/Alpha|caseworker|solicitor/i.test(signed));
  assert.equal(signed.split(".")[0], ALPHA);
});

/* ---------------------------------------------------------------- */
/* Client projection                                                 */
/* ---------------------------------------------------------------- */

test("switchable organisations exclude revoked memberships", () => {
  // The harm: a switcher listing an organisation the user cannot enter, which
  // discloses that it exists and that they were once in it.
  const list = switchableOrganisations([
    member(),
    member({ organisationId: BETA, organisationName: "Beta", removedAt: "2026-01-01T00:00:00Z" }),
  ]);
  assert.deepEqual(list, [{ id: ALPHA, name: "Alpha" }]);
});

test("the switchable list carries no role or membership detail", () => {
  const list = switchableOrganisations([member({ role: "solicitor", regulatoryReference: "SRA 1" })]);
  assert.deepEqual(Object.keys(list[0]!).sort(), ["id", "name"]);
});
