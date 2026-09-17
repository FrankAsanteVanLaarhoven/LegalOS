import { test } from "node:test";
import assert from "node:assert/strict";

import {
  authorise,
  isReserved,
  propose,
  reject,
  submitForReview,
  type Actor,
} from "../src/approvals.ts";

const solicitor: Actor = {
  id: "user:solicitor-7",
  role: "solicitor",
  regulatoryReference: "SRA-123456",
};
const caseworker: Actor = { id: "user:caseworker-2", role: "caseworker" };
const client: Actor = { id: "user:client-1", role: "client" };

function reviewable(activity: string, proposedBy = "agent:immigration") {
  const result = submitForReview(propose({ id: "p-1", activity, proposedBy, summary: "…" }));
  assert.equal(result.ok, true);
  return result.proposal;
}

test("filing an application is recognised as reserved", () => {
  assert.equal(isReserved("file_application"), true);
  assert.equal(isReserved("summarise_documents"), false);
  assert.equal(
    propose({ id: "p", activity: "lodge_appeal", proposedBy: "a", summary: "" }).reserved,
    true
  );
});

test("a proposal starts as a draft authored by nobody", () => {
  const proposal = propose({
    id: "p-1",
    activity: "file_application",
    proposedBy: "agent:immigration",
    summary: "Submit FLR(FP)",
  });
  assert.equal(proposal.state, "DRAFT");
  assert.equal(proposal.authorisedBy, null);
});

test("a reserved activity cannot be authorised by a caseworker", () => {
  const result = authorise(reviewable("file_application"), caseworker);
  assert.equal(result.ok, false);
  assert.equal(result.failure, "ROLE_NOT_PERMITTED");
  assert.equal(result.proposal.state, "REVIEW");
});

test("a solicitor with no regulatory reference cannot authorise a reserved activity", () => {
  const result = authorise(reviewable("file_application"), {
    id: "user:solicitor-9",
    role: "solicitor",
  });
  assert.equal(result.ok, false);
  assert.equal(result.failure, "REGULATORY_REFERENCE_REQUIRED");
});

test("a qualified solicitor authorises, and is recorded as responsible", () => {
  const result = authorise(reviewable("file_application"), solicitor);
  assert.equal(result.ok, true);
  assert.equal(result.proposal.state, "AUTHORISED");
  assert.equal(result.proposal.authorisedBy, solicitor.id);
});

test("nobody can authorise their own proposal", () => {
  const result = authorise(reviewable("summarise_documents", solicitor.id), solicitor);
  assert.equal(result.ok, false);
  assert.equal(result.failure, "SELF_APPROVAL");
});

test("clients cannot authorise anything", () => {
  const result = authorise(reviewable("summarise_documents"), client);
  assert.equal(result.ok, false);
  assert.equal(result.failure, "ROLE_NOT_PERMITTED");
});

test("a non-reserved activity can be authorised by a caseworker", () => {
  const result = authorise(reviewable("summarise_documents"), caseworker);
  assert.equal(result.ok, true);
  assert.equal(result.proposal.state, "AUTHORISED");
});

test("a draft cannot skip review", () => {
  const draft = propose({
    id: "p-1",
    activity: "summarise_documents",
    proposedBy: "agent:x",
    summary: "",
  });
  assert.equal(authorise(draft, solicitor).failure, "ILLEGAL_TRANSITION");
});

test("an authorised proposal cannot be re-authorised or rejected", () => {
  const authorised = authorise(reviewable("summarise_documents"), caseworker).proposal;
  assert.equal(authorise(authorised, solicitor).failure, "ILLEGAL_TRANSITION");
  assert.equal(reject(authorised, solicitor, "changed mind").failure, "ILLEGAL_TRANSITION");
});

test("rejection records who rejected and why", () => {
  const result = reject(reviewable("file_application"), solicitor, "insufficient evidence");
  assert.equal(result.ok, true);
  assert.equal(result.proposal.state, "REJECTED");
  assert.equal(result.proposal.rejectedBy, solicitor.id);
  assert.equal(result.proposal.reason, "insufficient evidence");
});
