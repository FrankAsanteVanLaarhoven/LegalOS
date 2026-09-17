# ADR-003: Polymorphic source references

**Status:** Proposed — recorded now, decided before the deadline repository
reads `source_id`.
**Date:** 2026-07-27

## The problem

`deadlines.source_id` is `text`, with no foreign key. It may point at an
`evidence_items` row, a `legal_sources` row, or — today — at nothing at all,
because nothing checks it.

The column exists because a deadline can come from several kinds of thing: a
Home Office letter in the evidence store, a paragraph of the Immigration Rules
in the legal-source store, a tribunal direction, or a calculation from another
date. `source_type` records which kind. `source_id` records which one.

Untyped text references work. They also give up every guarantee the database
would otherwise provide: nothing stops a typo, nothing stops the referent being
deleted, and nothing tells a reader which table to look in without first reading
`source_type` and knowing the mapping by heart.

For this column specifically that matters more than usual, because DL-G3 in the
deadline contract promises that an authoritative deadline is returned *with its
source or not at all*. A dangling `source_id` satisfies the schema and breaks the
guarantee — the repository would emit a locator pointing at a document that is
not there, which is worse than emitting nothing, because it looks checked.

## Options

**A. Leave as text.** Zero work. The guarantee becomes the repository's problem,
enforced by a join that may silently return nothing.

**B. One nullable FK column per source domain.** `source_evidence_id`,
`source_legal_source_id`, with a CHECK that exactly one is set and that it agrees
with `source_type`. Full referential integrity. Adds a column per domain, so it
scales badly past three or four.

**C. A `deadline_sources` join table.** One row per (deadline, source), typed and
foreign-keyed per kind. Handles a deadline with more than one source, which is
real — a date can be set by a direction and confirmed by a letter.

**D. A single `sources` registry that every source domain registers into**, with
one FK from anything that cites a source. Uniform, and the largest change: it
puts a level of indirection between a deadline and the document it came from,
and every reader pays for it.

## Recommendation

**B** for now, **C** if a deadline needs more than one source in practice.

Two source domains exist. Two nullable FKs with a CHECK tying them to
`source_type` is small, readable, and gives the database the job of ensuring the
referent exists — which is exactly the job DL-G3 depends on. D is the right
answer for a system with six source domains and the wrong one for a system with
two.

The reason not to decide this now is that the argument for C rests on a question
nobody has answered yet: whether a single deadline routinely cites more than one
source. That is a question about how caseworkers actually record dates, and
guessing it is how the wrong join table gets built.

## Consequence of deferring

`source_id` stays `text` and unenforced. Any repository reading it must treat a
missing referent as an absent source rather than as an error, and DL-G3's
proving check must include a deadline whose `source_id` points at nothing —
otherwise the guarantee is only tested on the happy path, which is where it was
never going to fail.

## Partially answered by the graph work

`graph_evidence_links.evidence_id` is a **real foreign key** to
`evidence_items`, and Phase 3D asserts it rather than assuming it: inserting a
link to a non-existent evidence id is refused by the database, in a test.

That is the referential integrity `deadlines.source_id` lacks, and it makes the
contrast concrete rather than theoretical. Two things follow.

**A foreign key is necessary and not sufficient.** The graph's key proves the
evidence row exists; it says nothing about *which case* it belongs to. A link to
a real document from another organisation's matter satisfies the constraint
completely, and the EV-005 observer had to check the case separately — which is
also asserted, by removing that check and watching the observation go false.

**The recommendation is unchanged and now has a worked example.** Option B —
typed foreign keys per source domain — is what `graph_evidence_links` already
does for one domain, and it works. `deadlines.source_id` should follow, with the
same caveat: the key proves existence, and the repository must still prove
belonging.

ADR-003 stays **open**. `deadlines.source_id` is still untyped text, and DL-G3's
proving check still includes a deadline whose source resolves to nothing.

## Narrowed by the evidence work, not resolved

Phase 4A gave the evidence domain a canonical identity with real foreign keys
from `task_evidence_links`, `graph_evidence_links`, `evidence_files`,
`evidence_provenance`, `evidence_events` and `evidence_derivations`. Two
untyped references remain, and both are deliberately left alone.

**`deadlines.source_id`.** Still `text`. The choice between two typed nullable
keys and a `deadline_sources` join table turns on whether one deadline normally
cites one source or several, and this repository still contains no workflow
evidence either way. Choosing now would be inventing the cardinality, which is
the mistake this ADR was written to avoid. It stays open.

**`graph_nodes.subject_id`.** Assessed and deliberately untyped. A node stands
for a row in whichever table owns its subject — `evidence_items`,
`timeline_events`, `deadlines` — and a typed key per `node_type` would mean
seven nullable columns and a CHECK tying each to its type. That is option B at a
cardinality where option B stops being reasonable. The mitigation already in
place is that EV-005 never resolves an assertion through `subject_id`: it
resolves through `graph_evidence_links.evidence_id`, which is a real key.

**ADR-003 remains open.** Material untyped references remain, so it is not
marked resolved.
