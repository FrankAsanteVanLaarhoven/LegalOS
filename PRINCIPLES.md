# LegalOS Core Engineering Principles v1.0

These are constraints, not aspirations. Each one names the mechanism that
enforces it and the test that would fail if the mechanism were removed.
`pnpm check:principles` verifies every enforcement point still exists.

A principle may also be **declared but not yet enforceable**, where the
mechanism depends on something unbuilt. Those are listed with what is missing,
and the conformance check reports them as unenforced rather than passing them.
Counting an unenforceable principle as held would be the same defect this
document exists to prevent.

A principle with no enforcement mechanism is a comment. Where something is
genuinely unenforceable in code — a regulatory registration, a human judgement —
it says so, rather than implying a guarantee the software cannot give.

---

## Principle 1 — Observe, never accuse

The platform shall never infer or state that a person is lying, deceptive,
dishonest, fabricating evidence, or lacking credibility. It identifies missing
information, records that differ, missing explanations, ambiguity, and matters
needing clarification or professional review.

**Enforced by** `assertNeutralLanguage` in `packages/evidence-review`, which
throws on the vocabulary of accusation. Every observation passes through it on
construction, so a prompt template or copy edit cannot reintroduce those terms.

---

## Principle 2 — Evidence before opinion

Every statement must trace to uploaded evidence, a verified legal source, or
observable system state. Where nothing supports it, the platform says so.

**Enforced by** `packages/verification`, which resolves every citation-shaped
token against the source registry and blocks output that cites law it cannot
resolve; and `reviewDraft` in `packages/representation`, where an unbacked fact
or unsourced legal proposition blocks the entire draft rather than being
footnoted.

---

## Principle 3 — Human review for regulated activities

The platform prepares. A qualified human decides. No regulated document is ever
presented as ready to file without human review.

**Enforced by** the approval state machine in `packages/governance` — reserved
activities require a named actor with a regulatory reference, and nobody may
authorise their own proposal — and by `requiresProfessionalReview()`, which
returns a constant rather than a computation so no code path can conclude
otherwise.

**Not enforceable in code:** whether this platform may lawfully produce a given
document for another person is an IAA registration question.
`REGULATED_DOCUMENT_TYPES` blocks rendering; it does not answer the question.

---

## Principle 4 — Difference is not dishonesty

A discrepancy between records is never treated as evidence of dishonesty.
Trauma, translation, calendar conversion, clerical error, approximate dates,
documents written by others, and simply describing different events are all
ordinary explanations.

**Enforced by** `observe()` in `packages/evidence-review`, which throws if an
observation puts a difference to someone without carrying candidate
explanations. The difference and its ordinary reasons cannot be separated.

---

## Principle 5 — Explainability

Every observation answers: what was observed, which evidence supports it, why it
was raised, what action is suggested, and who should review it.

**Enforced by** required fields — `RecordReference.quote` on every observation,
`basis` on every readiness item, `nextAction` on every failing capability check,
and `sourceText` on every extracted field — plus tests asserting no failing
check ships without an explanation.

---

## Principle 6 — Observable capability

No badge, maturity level, trust signal or claim unless backed by observable
system state.

**Enforced by** `packages/capabilities`: maturity is derived from observations
taken from the running system, a declared level is a ceiling that can only lower
what is shown, and an observation that cannot be taken fails its check closed
rather than passing.

---

## Principle 7 — Trust over convenience

If something cannot be verified, withhold it, caveat it, or escalate it. Never
invent certainty.

**Enforced by** `packages/policy`, which returns withhold / escalate /
release-with-caveats / release and treats an unverifiable answer as
unreleasable; and by the absence of any per-answer confidence figure anywhere in
the platform — `packages/reliability` emits measured metrics over labelled data
and no per-answer score, because nothing here is calibrated.

---

## Principle 8 — Privacy by design

People own their information and can export, delete and revoke access to it.
Audit records preserve integrity without unnecessarily retaining personal
content.

**Enforced by** `packages/privacy`: erasure removes content while tombstoning
audit entries so the hash chain still verifies, anything retained must state
why, and the outcome states plainly what erasure cannot reach.

---

## Principle 9 — AI assists, humans decide

The platform reduces administrative burden. It does not replace legal judgement.

**Enforced by** `proposeCaseUpdates` and `proposeFiling` in
`packages/evidence`, which return proposals rather than writing to a case, and
by `scoreDemeanour()` in `packages/representation`, which exists only to throw —
coaching how a person presents while giving evidence can suppress recognised
trauma responses and make truthful testimony appear rehearsed.

---

## Principle 10 — Continuous transparency

Every surface honestly communicates what is implemented, what is experimental,
what is verified, and what still needs professional review.

**Enforced by** the `/trust` route, which derives every level from observations
and states what is below target; and `pnpm trust:ledger`, which snapshots what
the platform could honestly claim at a commit, entirely from measurement.

---

## Principle 11 — Progressive disclosure

Information is requested only when it is needed for the task in hand. Nobody is
asked for identity documents to read about the law.

**Enforced by** `REQUIRED_ASSURANCE` in `packages/identity`: reading legal
information and asking a general question require no account at all, opening a
case requires a verified contact, and only actions affecting other people
require more. `isPermitted` fails closed on an unknown action.

---

## Principle 12 — Least privilege

Every user, agent, service and key holds the minimum permissions necessary.

**Enforced by** `@legalos/auth`: `membershipFor` returns null for a non-member
rather than a default role, permissions do not travel between workspaces, and
`mayAuthoriseReserved` requires a solicitor holding a regulatory reference.
`activate` additionally refuses an account that cannot be recovered, so a
usable identity always has a way back into it.

---

## Principle 13 — Explicit uncertainty

Unknown is represented as unknown. A guess never fills the space where a fact is
missing.

**Enforced by** the three-valued logic in `packages/rules`, where
`insufficient_evidence` is a distinct outcome from `not_satisfied`; by
`packages/verification`, which blocks output citing law it cannot resolve; and
by the observation layer in `packages/capabilities`, where a measurement that
cannot be taken fails its check rather than defaulting.

---

## Principle 14 — Evidence retention policy

Every stored item carries an owner, a purpose, a retention period, a deletion
policy and a legal basis.

**Status: partially enforceable.** `packages/privacy` requires a stated reason
for anything not erased, but per-item owner, purpose and legal basis are not yet
modelled — that arrives with the storage layer and tenancy. The conformance
check verifies the part that exists and reports the rest as unenforced.

---

## Principle 15 — Consent is granular

Consent is never global. Email access, messaging import, cloud drives, AI
processing, translation, voice processing and sharing with professionals are
each consented to separately, and each may be withdrawn.

**Enforced by** the consent ledger in `packages/privacy`: consent is recorded as
per-permission events, a grant with no stated scope is refused, withdrawal is a
new event rather than a mutation, and `accessWasPermitted` can answer after the
fact whether something was touched after a permission was withdrawn.

---

## What these principles cost

Stating this plainly, because a principles document that only lists benefits is
marketing:

- Verification currently blocks correct, well-sourced answers, because no legal
  source has been retrieved and checksummed yet. The platform is safe and not
  yet useful for substantive legal questions.
- Refusing a per-answer confidence figure removes something users ask for.
- Requiring human authorisation for case updates makes the product slower than
  one that writes extracted deadlines straight to a timeline.

These are deliberate. The alternative in each case is a system that appears more
capable than it is, aimed at people who cannot check.

## 16. Interfaces derive state from repositories, not fixtures

A user interface reads evidence through a repository, never a literal in the
source. Enforced by `pnpm check:principles`, which requires the repository layer
to exist, to be server-only, and to import no fixture.

This was not designed. It was found: no workspace page could satisfy the
completeness rule, and the reason was not that the pages were unfinished. There
was no repository layer, so "real data" had nowhere to come from and every panel
read a constant.

The failure it prevents is specific. A page reading a fixture looks exactly like
a page reading a database — same layout, same confidence, same absence of any
signal that the numbers came from nowhere. That is how this workspace once came
to render hand-typed percentages as tribunal readiness, and no amount of visual
polish would have exposed it.
