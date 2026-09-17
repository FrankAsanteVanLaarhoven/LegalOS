#!/usr/bin/env node
/**
 * Principles conformance.
 *
 * PRINCIPLES.md names, for each principle, the mechanism that enforces it. This
 * exercises those mechanisms against the real packages. A principles document
 * nobody checks decays into a statement of intent within a release or two —
 * which is the exact failure this architecture exists to prevent, applied to
 * itself.
 *
 * Each check calls the actual code and asserts the constraint still holds. It
 * does not read the document and tick boxes.
 */
import assert from "node:assert/strict";

import { assertNeutralLanguage, observe } from "../packages/evidence-review/src/index.ts";
import { SourceRegistry } from "../packages/knowledge/src/index.ts";
import { verify } from "../packages/verification/src/index.ts";
import { decide } from "../packages/policy/src/index.ts";
import { authorise, propose, submitForReview } from "../packages/governance/src/index.ts";
import {
  requiresProfessionalReview,
  reviewDraft,
  scoreDemeanour,
  assessReadiness,
} from "../packages/representation/src/index.ts";
import { proposeCaseUpdates } from "../packages/evidence/src/index.ts";
import { planErasure } from "../packages/privacy/src/index.ts";
import { createPlatformRegistry, observeSystem } from "../packages/capabilities/src/index.ts";
import { isPermitted, assessRecovery } from "../packages/identity/src/index.ts";
import { ConsentLedger } from "../packages/privacy/src/index.ts";
import { evaluateWorkflow, SKILLED_WORKER_SWITCH } from "../packages/rules/src/index.ts";
import { activate, mayAuthoriseReserved, membershipFor } from "../packages/auth/src/index.ts";

const results = [];
const unenforced = [];

/** A principle whose mechanism does not exist yet. Reported, never passed. */
function declaredOnly(number, name, missing) {
  unenforced.push({ number, name, missing });
}

async function principle(number, name, fn) {
  try {
    await fn();
    results.push({ number, name, held: true, detail: null });
  } catch (error) {
    results.push({ number, name, held: false, detail: error.message });
  }
}

const registry = new SourceRegistry([]);

await principle(1, "Observe, never accuse", () => {
  assert.throws(() => assertNeutralLanguage("This shows a credibility problem."));
  assert.throws(() => assertNeutralLanguage("The account is fabricated."));
  assert.doesNotThrow(() => assertNeutralLanguage("These records give different dates."));
});

await principle(2, "Evidence before opinion", () => {
  const verdict = verify({
    text: "Under paragraph 276ADE you qualify for leave to remain.",
    registry,
  });
  assert.equal(verdict.releasable, false, "an unresolvable citation must not be releasable");

  const review = reviewDraft({
    id: "d",
    documentType: "witness_statement",
    audience: "tribunal",
    assertions: [{ id: "a", kind: "fact", text: "It happened.", backing: [] }],
  });
  assert.equal(review.renderable, false, "an unbacked fact must block the draft");
});

await principle(3, "Human review for regulated activities", () => {
  assert.equal(requiresProfessionalReview(), true);
  const reviewable = submitForReview(
    propose({ id: "p", activity: "file_application", proposedBy: "agent:x", summary: "" }),
  ).proposal;
  assert.equal(
    authorise(reviewable, { id: "u", role: "caseworker" }).ok,
    false,
    "a caseworker must not authorise a reserved activity",
  );
  assert.equal(
    authorise(reviewable, { id: "u", role: "solicitor" }).ok,
    false,
    "a solicitor with no regulatory reference must not authorise",
  );
});

await principle(4, "Difference is not dishonesty", () => {
  assert.throws(
    () =>
      observe({
        id: "o",
        level: "clarification_invited",
        observation: "The records give different months.",
        records: [],
      }),
    /without offering any ordinary explanation/,
  );
});

await principle(5, "Explainability", async () => {
  const observations = await observeSystem({ repoRoot: new URL("..", import.meta.url).pathname });
  for (const status of createPlatformRegistry().all(observations)) {
    for (const failing of status.failing) {
      assert.ok(failing.nextAction.length > 10, `${status.id}/${failing.id} has no next action`);
      assert.ok(failing.detail.length > 10, `${status.id}/${failing.id} has no explanation`);
    }
  }
});

await principle(6, "Observable capability", async () => {
  const observations = await observeSystem({ repoRoot: new URL("..", import.meta.url).pathname });
  const research = createPlatformRegistry().status("research_retrieval", observations);
  assert.equal(
    research?.implementation,
    "prototype",
    "a capability with no engine behind it must not report above prototype",
  );
  // An unmeasurable observation must never satisfy a check.
  const unmeasured = [...observations.values()].filter((o) => o.source === "unavailable");
  assert.ok(unmeasured.length > 0, "expected some state to be unmeasurable");
});

await principle(7, "Trust over convenience", () => {
  const guaranteed = decide({
    verdict: verify({ text: "Your appeal will succeed.", registry }),
  });
  assert.equal(guaranteed.displayable, false, "an outcome guarantee must be withheld");

  const confident = decide({ verdict: verify({ text: "Confidence: 94%.", registry }) });
  assert.equal(confident.displayable, false, "a fabricated confidence figure must be withheld");

  const readiness = assessReadiness({
    evidenceRequired: ["Passport"],
    evidenceReceived: [],
    evidenceAwaited: [],
    witnessStatementState: "in_progress",
    deadlines: [],
    practiceSessionsCompleted: 0,
    professionalReviewState: "not_started",
    asOf: "2026-07-26",
  });
  assert.equal(
    /\d+(\.\d+)?\s*%/.test(JSON.stringify(readiness)),
    false,
    "readiness must not emit a percentage",
  );
});

await principle(8, "Privacy by design", () => {
  const outcome = planErasure({ subjectId: "u", requestedAt: "2026-07-26T00:00:00.000Z" });
  assert.ok(outcome.erased.includes("evidence_bytes"));
  assert.ok(outcome.erased.includes("embeddings"));
  assert.deepEqual(outcome.tombstoned, ["audit_entry"]);
  assert.ok(outcome.limitations.length >= 3, "erasure must state what it cannot reach");
  for (const rule of outcome.actions) {
    if (rule.action !== "erased") assert.ok(rule.reason.trim().length > 20, rule.dataClass);
  }
});

await principle(9, "AI assists, humans decide", () => {
  assert.throws(() => scoreDemeanour(), /Demeanour is not scored/);

  const updates = proposeCaseUpdates(
    {
      documentId: "d",
      engine: { name: "e", version: "1", ranAt: "2026-07-26T00:00:00.000Z" },
      fields: [
        {
          name: "deadline",
          value: "2026-08-14",
          sourceSegmentId: "s",
          sourceText: "respond by 14 August 2026",
        },
      ],
      notFound: [],
    },
    { proposedBy: "agent:document" },
  );
  assert.ok(updates.length > 0);
  for (const update of updates) {
    assert.equal(update.proposal.state, "DRAFT", "case updates must be proposals, not writes");
    assert.equal(update.proposal.authorisedBy, null);
  }
});

await principle(10, "Continuous transparency", async () => {
  const observations = await observeSystem({ repoRoot: new URL("..", import.meta.url).pathname });
  const platform = createPlatformRegistry();
  assert.ok(platform.all(observations).length > 0);
  // Every capability must be able to say what would move it forward.
  const blocked = platform.roadmap(observations);
  for (const entry of blocked) assert.ok(entry.action.length > 10, entry.capability);
});

await principle(11, "Progressive disclosure", () => {
  assert.equal(isPermitted("read_public_legal_information", "visitor"), true);
  assert.equal(isPermitted("ask_general_question", "visitor"), true);
  assert.equal(isPermitted("invite_team_member", "verified_account"), false);
  assert.equal(isPermitted("delete_everything", "organisation_verified"), false);
  const recovery = assessRecovery([
    { factor: "sms_code", enrolledAt: "2026-07-26", boundTo: "+447700900000" },
    { factor: "whatsapp_code", enrolledAt: "2026-07-26", boundTo: "+447700900000" },
  ]);
  assert.equal(recovery.adequate, false, "recovery must not depend on one number");
});

await principle(12, "Least privilege", () => {
  const memberships = [
    {
      workspaceId: "ws-1",
      accountId: "a1",
      role: "solicitor",
      regulatoryReference: "SRA-1",
      removedAt: null,
    },
    {
      workspaceId: "ws-2",
      accountId: "a1",
      role: "client",
      regulatoryReference: null,
      removedAt: null,
    },
  ];

  // A non-member gets nothing, not a default role.
  assert.equal(membershipFor(memberships, "a2", "ws-1"), null);
  assert.equal(membershipFor(memberships, "a1", "ws-9"), null);

  // Permissions do not travel between workspaces.
  assert.equal(mayAuthoriseReserved(membershipFor(memberships, "a1", "ws-1")), true);
  assert.equal(mayAuthoriseReserved(membershipFor(memberships, "a1", "ws-2")), false);
  assert.equal(mayAuthoriseReserved(null), false);

  // An account cannot become usable without a way back into it.
  const blocked = activate({
    account: { id: "a", preferredName: "S", status: "pending_recovery", recoveryReadyAt: null },
    contactVerified: true,
    factors: [{ factor: "sms_code", enrolledAt: "2026-07-26", boundTo: "+447700900000" }],
    at: "2026-07-26T00:00:00.000Z",
  });
  assert.equal(blocked.ok, false, "one factor must not activate an account");
});

await principle(13, "Explicit uncertainty", () => {
  const result = evaluateWorkflow(SKILLED_WORKER_SWITCH, {});
  assert.equal(
    result.decision,
    "insufficient_evidence",
    "missing facts must not collapse into a negative finding",
  );
  const verdict = verify({ text: "Under paragraph 276ADE you qualify.", registry });
  assert.equal(verdict.releasable, false);
});

declaredOnly(14, "Evidence retention policy", "per-item owner, purpose and legal basis are not modelled yet");

await principle(15, "Consent is granular", () => {
  const ledger = new ConsentLedger();
  assert.throws(
    () =>
      ledger.record({
        permission: "camera",
        kind: "granted",
        at: "2026-06-12T00:00:00.000Z",
        scope: "  ",
        grantedTo: null,
        expiresAt: null,
      }),
    /no stated scope/,
  );
  assert.equal(ledger.isActive("email_sync", "2026-07-26T00:00:00.000Z"), false);
});

await principle(16, "Interfaces derive state from repositories, not fixtures", async () => {
  // The discovery behind this: no workspace page could satisfy the completeness
  // rule, and it was not because the pages were unfinished. There was no
  // repository layer, so "real data" had nowhere to come from, and every panel
  // read a constant. A page reading a literal looks identical to one reading a
  // database — which is how a workspace came to render hand-typed percentages
  // as tribunal readiness.
  const { readdir, readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const root = new URL("..", import.meta.url).pathname;

  const repositories = await readdir(join(root, "apps/web/src/lib/repositories")).catch(() => []);
  assert.ok(
    repositories.length > 0,
    "a repository layer must exist, or no interface can read evidence",
  );

  // A repository must not import a fixture. If it does, the abstraction is a
  // rename rather than a boundary.
  for (const name of repositories) {
    if (!name.endsWith(".ts")) continue;
    const source = await readFile(join(root, "apps/web/src/lib/repositories", name), "utf8");
    assert.ok(
      !/from "@\/lib\/data\//.test(source),
      `${name} imports a fixture; a repository reading a literal is not a repository`,
    );
    assert.ok(
      /server-only/.test(source),
      `${name} must be server-only, so a fixture cannot be substituted in a client bundle`,
    );
  }
});

const failed = results.filter((r) => !r.held);

for (const result of results) {
  const mark = result.held ? "✓" : "✗";
  console.log(`${mark} Principle ${result.number} — ${result.name}`);
  if (!result.held) console.log(`    ${result.detail}`);
}

console.log(
  `\n${results.length - failed.length}/${results.length} enforced principles hold against the current code.`,
);

if (unenforced.length > 0) {
  console.log(`\n${unenforced.length} declared but not yet enforceable:`);
  for (const entry of unenforced) {
    console.log(`  Principle ${entry.number} — ${entry.name}`);
    console.log(`    missing: ${entry.missing}`);
  }
  console.log("\n  These are not counted as held. They become enforceable when the mechanism exists.");
}

if (failed.length > 0) {
  console.error("\nA principle lost its enforcement. Restore it, or amend PRINCIPLES.md honestly.");
  process.exit(1);
}
