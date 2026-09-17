# ADR-002: Erasure under append-only history

**Status:** Proposed — must be decided before any real case data is stored.
**Date:** 2026-07-27

## The problem

Migrations 0010 to 0013 made a property true that nobody has yet decided is
acceptable:

> A case that has recorded history cannot be deleted by any statement.

Three independent mechanisms produce it — `ON DELETE RESTRICT` on the event
tables, a row trigger refusing UPDATE and DELETE, and a statement trigger
refusing TRUNCATE. It is tested, in
`packages/integration/test/domain/schema.test.ts`.

That is the right default for legal records. It is also, as it stands, a refusal
to comply with a data-protection erasure request, and this platform holds asylum
evidence for people whose reason for asking is not paperwork.

## What already works, and why it does not generalise

`audit_log` answers an erasure request without breaking its own guarantee. The
payload is replaced with `{}`, `tombstoned_at` is set, and the hash the chain
was built from is kept. Verification then skips the payload comparison for that
row and the chain still verifies end to end. This is invariant PR-001, with
falsification evidence behind it.

It works there because an audit entry has exactly one field that carries
personal content and the rest is structure. That is not true of the four new
domains:

| Table               | Free-text personal content                    |
| ------------------- | --------------------------------------------- |
| `deadlines`         | `source_locator`, `deadline_type`             |
| `deadline_events`   | `detail`                                      |
| `review_decisions`  | `basis`                                       |
| `review_events`     | `detail`                                      |
| `tasks`             | `title`, `description`                        |
| `task_events`       | `detail`                                      |
| `graph_nodes`       | `label`, `subject_id`                         |
| `graph_assertions`  | `reason`                                      |

A review decision's `basis` is the clearest case. It is the reviewer's reasoning
— quite possibly summarising a medical report or a trafficking account — and it
is also the single field that makes the approval defensible to a regulator.
Deleting the row destroys the evidence of who authorised what. Keeping the text
ignores the request.

## Options

**A. Cascade delete on erasure.** Drop the triggers for an erasure transaction
and let the case cascade. Simple, and it destroys the record that a decision was
ever made. An approval that vanishes is indistinguishable from one that never
happened, which damages the person whose case it was as often as it protects
them.

**B. Tombstone per table, following `audit_log`.** Each table gains a
`tombstoned_at` and an erasure procedure that nulls the content columns while
keeping identifiers, timestamps, actors and a digest of what was removed. The
shape of the record survives; the content does not.

**C. Content in a separate store, referenced by digest.** Domain tables hold no
free text at all; content lives in one place with one erasure path. Cleanest in
principle, and a substantial rewrite of four migrations plus every repository
that will read them.

**D. Encrypt per subject, erase the key.** Crypto-shredding. Attractive because
one key destruction erases everything for one person at once. Depends on key
management this platform does not have, and on nobody ever having logged the
plaintext.

## Recommendation

**B**, with **C** as the direction if a fifth or sixth domain arrives.

B keeps the existing pattern, so there is one erasure concept in the system
rather than two, and the audit chain's tombstone already proves the approach
survives contact with a verification mechanism. It also degrades honestly: a
tombstoned review decision still shows that a named solicitor approved something
on a date, which is the part a regulator needs, while the reasoning is gone.

What B requires, none of which exists yet:

1. `tombstoned_at` on the eight tables above, and a documented list of which
   columns are content and which are structure.
2. An erasure procedure that is itself audited — the request, who authorised it,
   what was removed, and the digest of the removed content.
3. A trigger exception narrow enough to permit only the content-to-null
   transition, matching AU-003, which established that the audit tombstone
   exception does not open a general update path.
4. An invariant and a falsification record. Without them this is a feature
   somebody believes works.

## Until then

The honest position, and the one the migrations currently implement: an erasure
request touching these domains **has no mechanism and will fail loudly**. That
is the correct behaviour for a platform holding no real case data. It stops
being correct on the day it does.

**This ADR is a release blocker.** No production case data may be stored while
erasure is unimplemented.

## The deadline repository, specifically

Recorded here because the deadline repository is implemented and its exposure is
now concrete rather than anticipated. `PERSONAL_TEXT_FIELDS` in
`packages/repositories/src/deadline-model.ts` names the same columns in code.

| Column                     | What it holds                                    | How it gets there                    |
| -------------------------- | ------------------------------------------------ | ------------------------------------ |
| `deadlines.deadline_type`  | free text — a caller may write anything          | `createDeadline`, `supersedeDeadline` |
| `deadlines.source_locator` | a page or paragraph reference, often quoting it  | `createDeadline`, `supersedeDeadline`, `recordDeadlineVerification` |
| `deadline_events.detail`   | why a date was recorded, corrected or disputed   | every write method                   |

`source_locator` is the one to watch. It is nominally a reference — "paragraph
4" — but the field is unconstrained text and the natural thing to write is the
sentence that carried the date, which on an asylum matter can quote a medical
report or an account of persecution. `deadline_events.detail` is worse: it is
where a caseworker explains a correction, in prose, with no structure at all.

Methods requiring revision when the tombstoning policy is approved:

- `createDeadline` and `supersedeDeadline` — must refuse to write to a
  tombstoned case rather than create new content under an erased subject.
- `recordDeadlineVerification` — writes `source_locator` and a `basis` into the
  event; both need the same treatment as `review_decisions.basis`.
- `recordDeadlineEvent` — the general append path, so the general case.
- `readDeadlinesForCase` and `readOpenDeadlinesForCase` — must render a
  tombstoned locator as erased rather than as absent. An erased locator that
  reads as "no locator recorded" would make `deriveAuthority` withhold authority
  for the wrong reason, and the reason is the part a caseworker acts on.

Nothing in the repository implements erasure, and nothing in it should until
this ADR is decided. The deadline domain is **not production-ready** while this
remains open, regardless of its contract status.

## The review repository, specifically

The sharpest case in the system, and the reason this ADR exists. `PERSONAL_TEXT_FIELDS`
in `packages/repositories/src/review-model.ts` names the same columns in code.

| Column                         | What it holds                                        |
| ------------------------------ | ---------------------------------------------------- |
| `review_decisions.basis`       | the reviewer's reasoning, in prose                    |
| `review_requests.reason`       | why a review was asked for, in the requester's words  |
| `review_requests.subject_id`   | an artefact identifier, often a human-written name    |
| `review_requests.reserved_activity` | which reserved activity, free text               |
| `review_events.detail`         | comments, escalations, withdrawal reasons             |

`review_decisions.basis` is the conflict in its purest form. It is where a
solicitor writes why they approved something — quite possibly summarising a
medical report or an account of persecution — and it is simultaneously the
single field that makes the approval defensible to a regulator. Deleting the row
destroys the evidence that a qualified person authorised the work. Keeping the
text ignores the request. Neither is acceptable, which is why option B exists.

**What must survive erasure**, on the reasoning that a tombstoned decision
should still answer "who authorised this, when, under what registration, and to
what effect" while carrying none of the reasoning:

- `decided_by`, `decided_by_role`, `regulatory_reference`, `decided_at`
- `decision` itself — the classification, not the prose
- `subject_digest` — so a later reader can still ask whether the artefact
  changed after approval
- the request's `id`, `case_id`, `organisation_id`, `requested_at`, `status`
- the `review_events` sequence: which events happened, in what order, by whom
- every hash in the audit chain, unchanged, so the chain still verifies

**What is erased**: `basis`, `reason`, `detail`, and any `subject_id` carrying
a person's name.

Methods requiring revision when the policy is approved:

- `recordReviewDecision` — writes `basis`; must refuse to write new reasoning
  against a tombstoned case.
- `createReviewRequest` — writes `reason` and `subject_id`.
- `reassignReview` and `withdrawReviewRequest` — both write event `detail`.
- `readReviewQueue`, `readReviewsForCase`, `readReviewHistory` — must render an
  erased basis as erased rather than as absent. A missing basis reads as a
  decision recorded without reasoning, which is a governance failure; an erased
  one is a data-protection request honoured, and the two must not look alike.

The review domain is **not production-ready** while this ADR is open. That is
independent of its nine honoured contract guarantees, which say the repository
does what it promises — not that the domain is safe to put real case material
into.

## Re-evaluate when

A fifth domain with free-text content is added (prefer C), key management exists
(reconsider D), or a regulator's guidance changes what "erasure" requires of a
record that must also be retained.

## The task repository, specifically

`PERSONAL_TEXT_FIELDS` in `packages/repositories/src/task-model.ts` names the
same columns in code.

| Column                        | What it holds                                       |
| ----------------------------- | --------------------------------------------------- |
| `tasks.title`                 | what needs doing, often naming a person or document  |
| `tasks.description`           | free text, unbounded                                 |
| `tasks.task_type`             | free text — no CHECK constrains it                   |
| `task_events.detail`          | why a task was updated, cancelled or reassigned      |
| `task_dependencies.reason`    | why one piece of work waits on another               |
| `task_evidence_links.note`    | why a document is attached                           |

`tasks.title` is the field that will carry the most personal content in
practice, because a task title is how a caseworker names the thing in front of
them — "chase Dr Okonkwo for the psychiatric report" is a realistic title and
names two people and a medical fact.

One deliberate design choice already limits the spread. `updateTask` records
**field names, not values**, in both its event detail and its audit payload:
`changed priority, title`, never the old and new titles. Copying before-and-after
values into the audit chain would put erasable content inside the one structure
that cannot be rewritten, and the chain's hashes would then depend on text a
data-protection request requires be removed. That is asserted by a test.

**What must survive erasure**: the task id, `case_id`, `organisation_id`,
`created_by`, `assigned_to`, `created_at`, `completed_at`, `cancelled_at`,
`status`, `priority`, `source`, `requires_professional`, `version`, the
`task_events` sequence with its actors and event classifications, the dependency
and evidence-link identifiers, and every hash in the audit chain.

**What is erased**: `title`, `description`, `task_type`, event `detail`,
dependency `reason`, evidence-link `note`.

Methods requiring revision: `createTask`, `updateTask`, `cancelTask`,
`addTaskDependency`, `removeTaskDependency`, `linkTaskEvidence`,
`unlinkTaskEvidence` — all write personal text — and the three read methods,
which must render an erased title as erased rather than blank. A blank title
reads as a malformed record; an erased one is a request honoured.

The task domain is **not production-ready** while this ADR is open, independent
of its nine honoured contract guarantees.

## The graph repository, specifically

`PERSONAL_TEXT_FIELDS` in `packages/repositories/src/graph-model.ts` names the
same columns in code.

| Column                            | What it holds                                     |
| --------------------------------- | ------------------------------------------------- |
| `graph_nodes.label`               | how a document or person is named on the diagram  |
| `graph_nodes.subject_id`          | an external reference, often a human-written name |
| `graph_assertions.reason`         | why somebody says two things are related          |
| `graph_assertions.asserted_by_id` | a user id, or an agent name                       |
| `graph_edges.invalidation_reason` | why a relationship stopped holding                |
| `graph_evidence_links.locator`    | a page or paragraph, often quoting it             |

Two are worse than they look. `graph_nodes.label` is the text a reader sees on
the diagram, so it is where a person's name will actually appear —
"Dr Okonkwo's report" is the obvious label and names a person and a medical
fact. And `graph_evidence_links.locator` is constrained to be non-blank
precisely so it says where to look, which means the natural content is the
sentence that carried the claim.

**What must survive erasure**: node and edge identifiers, `node_type`,
`relationship`, `assertion_type`, `asserted_by_type`, `execution_id`,
`asserted_at`, `valid_from`, `valid_to`, `supersedes_id`, the supersession
chain, `invalidated_by`, the evidence-link pair itself, and every hash in the
audit chain. A tombstoned graph should still answer "who asserted this, of what
kind, when, and was it later retracted" while carrying none of the reasoning.

**What is erased**: `label`, `subject_id`, `reason`, `invalidation_reason`,
`locator`.

An interaction specific to this domain: erasing a locator makes the assertion
untraceable by EV-005's own rule, because a blank locator is not a citation.
The tombstoning design must therefore distinguish *erased* from *never
recorded*, or a data-protection request will silently turn a satisfied
invariant into a violated one and look like a governance failure.

Methods requiring revision: `createNode`, `createEdge`, `createAssertion`,
`linkAssertionEvidence`, `invalidateEdge`, and all three reads.

The graph domain is **not production-ready** while this ADR is open.

## The evidence repository, specifically — the critical domain

Every field, classified as ADR-002 requires.

**Structural and retained** — identifiers, `organisation_id`, `case_id`,
`evidence_type`, `status`, `source_classification`, `verification_state`,
`sensitivity`, `retention_state`, `created_by`, `created_at`, `version`,
`digest`, `digest_algorithm`, `byte_size`, `media_type`, `uploaded_by`,
`uploaded_at`, `availability`, `acquisition`, `asserted_by`, `asserted_at`,
every event classification and actor, every audit hash.

**Personal text, tombstonable** — `evidence_items.title`,
`evidence_items.description`, `evidence_provenance.source_actor`,
`evidence_provenance.custody_note`, `evidence_provenance.original_locator`,
`evidence_events.detail`, `evidence_files.original_filename`.

**Derived text, regenerable** — none yet. OCR text and translations will be
derived items in their own right, linked through `evidence_derivations`, and
each will be tombstonable as its own row rather than as a field on another.

**File content, subject to deletion** — the object behind
`evidence_files.storage_key`. Deleting it is the one erasure this domain can
already perform without touching an append-only row: the file version keeps its
digest, `availability` moves to `unavailable`, and the record that a document
existed and was cited survives while the content does not.

**Hash retained after erasure** — `digest`. Keeping it is what lets a later
reader confirm that the thing which was erased is the thing that was cited, and
it reveals nothing about the content.

**Legally retained** — `verification_state` and the `evidence_events`
sequence, on the same reasoning as `review_decisions`: who accepted what, and
when, is the part a regulator asks for.

**Prohibited from immutable audit payloads** — all of the personal-text row
above. This is already enforced and tested: the audit payload for an evidence
write carries identifiers, classifications, the digest and the byte size, and a
test asserts that neither the file content nor the item's title appears in it.

`retention_state` exists (`active | restricted | erasure_requested | erased`)
so that the tombstone mechanism, when approved, needs no new column and no
foreign-key change. **Nothing implements erasure and nothing should until this
ADR is decided.** The evidence domain is **not production-ready**.
