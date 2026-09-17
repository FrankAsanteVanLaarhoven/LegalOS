# Evidence dependency inventory

Measured before designing the Evidence foundation, because four repositories,
one invariant observer and two open ADRs already point at evidence and none of
them agree about what an evidence item is.

Measured 2026-07-27 against commit `eb2eaed`.

## The headline

**`evidence_items` is a stub.** Seven columns, no digest, no file, no
provenance, no organisation, no version:

```sql
id, case_id, title, category, status, summary, received_at, created_at
```

`category` is free text with no CHECK. `status` is
`received | requested | missing | expired`, which describes whether somebody
sent a thing — not whether it is what it claims to be.

Meanwhile `packages/evidence/src/types.ts` contains a considered domain model —
`OriginalDocument` with `sha256`, `byteLength`, `mediaType`, `filename` and
`CaptureMetadata`, plus OCR, translation and quality artefacts. **None of it is
persisted anywhere.** It is a well-designed in-memory contract with no table
behind it, which is the same gap the workspace surfaces had before Phase 2.

## Measured consequence

`EV-001 Evidence is immutable once accepted` reports **failed**, not
unmeasured. Its observer `evidence_content_identity_persisted` parses
`0001_init.sql` looking for a checksum column in `evidence_items` and does not
find one. That has been a measured, published failure for the whole programme,
and it is the thing this phase exists to fix.

| Invariant | Status | Observer |
| --- | --- | --- |
| EV-001 Evidence is immutable once accepted | **failed** | no checksum column in `evidence_items` |
| EV-002 Checksums are verified, not merely stored | satisfied | in-memory `verifyIntegrity`, integration evidence |
| EV-003 OCR provenance is recorded | **failed** | no OCR engine wired |
| EV-004 Translation is linked to its original | no_observer | — |
| EV-005 Every assertion is traceable to a document | unmeasured | real observer, no data in the gate's environment |

## Every current reference

| Referrer | Reference | Enforced? | Notes |
| --- | --- | --- | --- |
| `task_evidence_links.evidence_id` | FK → `evidence_items` | **yes**, `ON DELETE CASCADE` | Cascade is inconsistent with the graph's RESTRICT. A deleted evidence item would silently drop task links. |
| `graph_evidence_links.evidence_id` | FK → `evidence_items` | **yes**, `ON DELETE RESTRICT` | Plus a non-blank `locator` CHECK from 0016. The strongest of the four. |
| `deadlines.source_id` | untyped `text` | **no** | May mean `evidence_items` or `legal_sources`. ADR-003. |
| `review_requests.subject_id` | untyped `text` | **no** | Plus `subject_digest char(64)` — a digest of the artefact, not of a file. |
| `review_decisions.subject_digest` | `char(64)` | n/a | What the reviewer looked at. Independent of any file. |
| `bootstrapTenancy` | writes `evidence_items` rows | — | The only writer in the system today. |
| EV-005 observer | joins `graph_evidence_links` → `evidence_items` → case | — | Already requires the evidence row to exist and to belong to the same case. |
| `packages/evidence/src` | `OriginalDocument`, OCR, translation | — | In-memory only. Never persisted. |
| `apps/web` fixtures | `LegalCase.evidence` | — | Typed against the fixture, per the surface inventory. |

## What is missing, stated as questions the schema cannot answer

1. **What are these bytes?** No digest, so two uploads of the same document are
   indistinguishable from two different documents, and a modified file is
   indistinguishable from the original.
2. **Where is the file?** No storage reference of any kind. An evidence item
   today is a title and a status.
3. **How did it get here?** No provenance. A document a client photographed on
   a phone and one a tribunal sent are the same row shape.
4. **Which version?** No file versioning, so a corrected scan can only overwrite.
5. **Who may see it?** No sensitivity classification, and no `organisation_id` —
   tenancy is reachable only through `case_id`.
6. **Is it still there?** No availability state, so an evidence item whose file
   is gone still reads as evidence.

## Decisions this inventory forces

**One identity, extended — not a second model.** `evidence_items` keeps its id.
Every existing foreign key stays valid. The alternative — a new
`evidence_documents` table alongside — would leave two competing identities and
four repositories pointing at the older one.

**Case association stays single.** `evidence_items.case_id` is `NOT NULL` and
every downstream tenancy proof derives the organisation through it. A
many-to-many `evidence_case_links` would create a second path to the same
question and invalidate those proofs. Sharing one document between matters
raises consent questions nobody has answered, and inventing the cardinality now
would be the same mistake ADR-003 records for `deadlines.source_id`.

**`category` is superseded, not dropped.** It is free text with no CHECK and is
written by the bootstrap. A bounded `evidence_type` is added beside it; the old
column is left alone rather than migrated on a guess about what its values mean.

**`task_evidence_links` cascade is a defect.** RESTRICT everywhere else, CASCADE
here. Corrected in this phase as a bounded compatibility change.
