# Known defects

Defects that are real, understood, and deliberately not fixed yet. Each names
what is wrong, what it costs, and what would repair it — so that a decision to
defer stays a decision rather than becoming an omission.

A defect leaves this file by being fixed, not by being forgotten.

---

## KD-001 — Evidence artefacts name the commit before their own

**Status:** open · **Found:** obligation 4, 2026-07-27 · **Severity:** provenance

Every evidence artefact in `docs/integration-evidence/` and
`docs/smoke-evidence/` stamps `commit` with `git rev-parse HEAD` at the moment
it is generated. It is then committed. So the artefact names its **parent**
commit, never the commit that contains it.

`docs/smoke-evidence/development-smoke.json` as published in `95a3da4` records
`"commit": "095466f..."`. The evidence was produced from the obligation-4
working tree; the hash it names is the tree before that work.

**Why it matters.** An artefact that claims to attest to one commit while naming
its parent creates an avoidable evidence-to-code ambiguity: a reader cannot tell
whether the evidence was produced from the named commit's tree or from an
uncommitted tree that later became a different commit. Both are consistent with
what is written down, and they are not the same claim.

**Scope.** Systemic to the emitters, not specific to any obligation. It affects
every artefact this repository has ever committed.

**Do not rewrite historical evidence.** The existing artefacts record what was
actually measured; re-stamping them with hashes chosen after the fact would
replace a known-imprecise record with a fabricated-precise one, which is worse.
The limitation is recorded here and the emitter protocol is fixed forward.

**Candidate repairs**, any one of which resolves it:

1. Generate evidence *after* the code commit and commit the evidence separately.
2. Attest to the **tree hash or a content manifest** rather than to a commit hash
   that does not exist yet.
3. A two-commit protocol — implementation commit, then an evidence commit that
   references it.
4. Generate a signed external attestation after push.

Option 2 is the only one that keeps a single commit per change; options 1 and 3
trade that for an unambiguous reference.

**Not in scope for Phase 4B.**

---

## KD-002 — Query-plan evidence can contradict itself after a re-run

**Status:** open · **Found:** obligation 3, 2026-07-26 · **Severity:** integrity

The query-plan suites embed a live `EXPLAIN` plan in the `demonstrates` field
beside prose describing what that plan showed. The prose is static; the plan is
captured per run. A re-run against differently-distributed data can therefore
produce a file whose prose and plan disagree.

**The committed artefacts are currently self-consistent.** Checked before
recording this: in `docs/integration-evidence/evidence_query_plans.json` as
published, the prose and the captured selective-read plan both name
`evidence_items_case_active_idx`.

The defect is latent rather than present. It was observed during obligation 3's
verification runs, in the working tree and never committed: a re-run produced a
file whose prose still named `evidence_items_case_active_idx` while the plan it
captured showed the planner had chosen `evidence_items_case_id_idx`. Both
statements are true of *some* run; they were not true of the same run. Only the
discipline of reverting per-run evidence churn kept that out of the repository,
which is not a mechanism.

**Why it matters.** The plan is not wrong — planner choice legitimately varies
with data distribution and `ANALYZE`. The defect is that a single artefact
asserts two things that cannot both describe one measurement, and it will be
cited eventually.

**Candidate repairs:** derive the prose from the captured plan rather than
writing it alongside; or assert the property the test actually cares about (an
index was used, or the planner's choice was reasonable for the distribution)
rather than naming a specific index in prose.

**Not in scope for Phase 4B.**
