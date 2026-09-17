import { test } from "node:test";
import assert from "node:assert/strict";

import {
  decisionCoversDigest,
  isDigest,
  mayDecide,
  queueStateOf,
  validateRequest,
} from "../src/index.ts";
import type { AuthorityInput } from "../src/review-model.ts";

/**
 * The rules that decide who may authorise what, tested by taking an actor who
 * qualifies and disqualifying them one attribute at a time.
 *
 * These are the rules a regulator would ask about. They should be legible
 * without reading SQL, and they should be wrong in a way a test can catch.
 */

const permitted: AuthorityInput = {
  requiresProfessional: true,
  reservedActivity: "filing",
  requiredRole: "solicitor",
  actorRole: "solicitor",
  regulatoryReference: "SRA 123456",
  requestedBy: "caseworker-1",
  actorId: "solicitor-1",
};

const decide = (over: Partial<AuthorityInput> = {}) => mayDecide({ ...permitted, ...over });

test("a registered solicitor may decide a reserved activity", () => {
  const result = decide();
  assert.equal(result.permitted, true);
  assert.equal(result.because, null);
});

test("the person who asked for a review may not decide it", () => {
  // Absolute, and the one refusal that passes every other check here: this
  // actor is a registered solicitor with exactly the required role. A review
  // whose requester decides it is a record of somebody agreeing with
  // themselves.
  const result = decide({ requestedBy: "solicitor-1" });
  assert.equal(result.permitted, false);
  assert.match(result.because!, /may not be the person who decides it/);
});

test("a caseworker cannot decide a review that requires a professional", () => {
  const result = decide({ actorRole: "caseworker", requiredRole: "caseworker" });
  assert.equal(result.permitted, false);
  assert.match(result.because!, /requires a regulated professional/);
});

test("a solicitor with no registration on record cannot decide one either", () => {
  // The registration is the thing that makes the role mean something. Without
  // it there is nobody a regulator could ask about this approval.
  assert.equal(decide({ regulatoryReference: null }).permitted, false);
  assert.equal(decide({ regulatoryReference: "   " }).permitted, false);
  assert.match(decide({ regulatoryReference: null }).because!, /registration on record/);
});

test("a client may not decide anything", () => {
  const result = decide({
    actorRole: "client",
    requiresProfessional: false,
    reservedActivity: null,
    requiredRole: null,
  });
  assert.equal(result.permitted, false);
  assert.match(result.because!, /may not decide a review/);
});

test("a review naming a required role refuses every other role", () => {
  const result = decide({
    requiresProfessional: false,
    reservedActivity: null,
    requiredRole: "reviewer",
    actorRole: "caseworker",
    regulatoryReference: null,
  });
  assert.equal(result.permitted, false);
  assert.match(result.because!, /requires the reviewer role/);
});

test("a reserved activity without a professional requirement is refused", () => {
  // Defence in depth against a row predating the schema constraint. Reaching
  // this branch means the database constraint was added after the row.
  const result = decide({ requiresProfessional: false, requiredRole: null });
  assert.equal(result.permitted, false);
  assert.match(result.because!, /reserved activity/);
});

test("an ordinary review can be decided by a caseworker who did not ask for it", () => {
  const result = decide({
    requiresProfessional: false,
    reservedActivity: null,
    requiredRole: null,
    actorRole: "caseworker",
    regulatoryReference: null,
  });
  assert.equal(result.permitted, true);
});

/* -------------------------------------------------------------- */

test("queue state distinguishes waiting on material from waiting on a person", () => {
  // The failure this prevents: a review blocked on a document nobody sent
  // looks identical to one nobody has picked up, so the second gets chased and
  // the first waits.
  assert.equal(queueStateOf({ status: "awaiting_material", assignedTo: "u1" }), "awaiting_material");
  assert.equal(queueStateOf({ status: "open", assignedTo: null }), "unassigned");
  assert.equal(queueStateOf({ status: "open", assignedTo: "u1" }), "assigned");
  assert.equal(queueStateOf({ status: "decided", assignedTo: "u1" }), "decided");
  assert.equal(queueStateOf({ status: "withdrawn", assignedTo: null }), "withdrawn");
  assert.equal(queueStateOf({ status: "expired", assignedTo: null }), "expired");
});

test("an assigned request is never reported as decided", () => {
  // Assignment is not approval. Reporting it as such would let a queue show
  // work as done because somebody's name is against it.
  assert.notEqual(queueStateOf({ status: "open", assignedTo: "u1" }), "decided");
});

/* -------------------------------------------------------------- */

test("a digest is 64 lowercase hex characters or it is not a digest", () => {
  assert.equal(isDigest("a".repeat(64)), true);
  assert.equal(isDigest("A".repeat(64)), false);
  assert.equal(isDigest("a".repeat(63)), false);
  assert.equal(isDigest(""), false);
  assert.equal(isDigest("not a digest"), false);
});

test("a decision stops covering an artefact once it changes", () => {
  // The failure: a draft is approved, then edited, and the approval appears to
  // cover the edited text.
  const decision = { subjectDigest: "b".repeat(64) };
  assert.equal(decisionCoversDigest(decision, "b".repeat(64)), true);
  assert.equal(decisionCoversDigest(decision, "c".repeat(64)), false);
});

/* -------------------------------------------------------------- */

const request = (over: Record<string, unknown> = {}) =>
  validateRequest({
    caseId: "c",
    subjectType: "draft_document",
    subjectId: "draft-1",
    reason: "needs a solicitor to check the grounds",
    ...over,
  } as Parameters<typeof validateRequest>[0]);

test("a review request must say why it is being asked for", () => {
  assert.match(request({ reason: "  " })!, /say why/);
});

test("a reserved activity cannot be requested without a professional requirement", () => {
  assert.match(request({ reservedActivity: "filing" })!, /reserved legal activity/);
});

test("a professional requirement must name which professional role", () => {
  assert.match(request({ requiresProfessional: true })!, /which professional role/);
  assert.equal(request({ requiresProfessional: true, requiredRole: "solicitor" }), null);
  // `reviewer` is a role for checking work, not a professional qualification.
  assert.match(request({ requiresProfessional: true, requiredRole: "reviewer" })!, /which professional/);
});

test("a subject digest must be a sha-256 if it is given at all", () => {
  assert.match(request({ subjectDigest: "short" })!, /sha-256/);
  assert.equal(request({ subjectDigest: "d".repeat(64) }), null);
});

test("an ordinary request validates", () => {
  assert.equal(request(), null);
});
