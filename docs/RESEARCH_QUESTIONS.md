# Research question registry

Every research question, linked to the claims that would answer it, the
invariants that implement it, and the evidence that exists. Checked by
`pnpm check:questions`: a question cannot cite a claim or an invariant that does
not exist, and its status per evidence type is derived from the claims it rests
on rather than asserted.

This closes the loop. `PRINCIPLES.md` states what the platform must do,
`docs/INVARIANTS.md` states the properties, `docs/CLAIMS.md` types the evidence,
and this says what any of it was for.

## Status is derived

Each question carries three statuses, one per evidence type, computed from the
claims it cites. A question whose claims are all engineering-supported is
answered _as an engineering result_ and nothing more — which is the distinction
this registry exists to hold.

---

## RQ-001 — Can executable governance improve engineering assurance for LLM systems?

**Hypothesis.** Governance encoded as runtime checks, rather than as
documentation, detects violations that review does not.

**Claims**

- Capability maturity is derived from measurement, not declaration
- An unmeasurable check fails closed rather than passing
- A critical invariant cannot be satisfied without a falsifiable observation
- No route can reach a model except through the runner
- An unregistered agent is refused before a provider is reachable

**Invariants** — `GV-000`, `GV-001`, `GV-002`, `GV-003`, `AG-001`, `AU-005`

**Evidence.** Fourteen governance mechanisms implemented and falsified. Five
occasions where a check looked correct and measured nothing, each found by
mutation or by a person doubting a number, **none by review** — which is the
observation the hypothesis predicts and the closest thing here to a result.

**Status.** Engineering: supported. Scientific: unsupported — one system, one
author, no comparison against a project without executable governance.
Operational: unsupported — nothing deployed.

---

## RQ-002 — Can immutable execution provenance enable reproducible AI operations?

**Hypothesis.** Recording the inputs to a model call in append-only storage is
sufficient to reconstruct the execution context, without requiring the model
itself to be deterministic.

**Claims**

- Every model execution is recorded before the provider is called
- An execution's inputs are reconstructible from immutable artefacts
- The audit chain detects alteration by recomputation
- Erasure removes content while the chain still verifies

**Invariants** — `AU-001`, `AU-002`, `AU-003`, `AU-004`, `AU-005`, `PR-006`

**Evidence.** Replay reconstructs prompt, retrieval snapshot and configuration,
and detects an edited template, an edited snapshot or a reordering of what the
model saw. The limit is stated rather than elided: replay reconstructs inputs
and does not re-run the model, because no provider offers determinism behind a
version string.

**Status.** Engineering: supported. Scientific: unsupported — no independent
reproduction. Operational: unsupported — no production execution has been
recorded, so the mechanism has only ever reconstructed synthetic executions.

---

## RQ-003 — Can evidence-derived capability assessment replace manually maintained trust claims?

**Hypothesis.** A capability level computed from observations is more accurate
than one maintained by hand, and its errors are visible where a maintained one's
are not.

**Claims**

- Capability maturity is derived from measurement, not declaration
- Agent standing is derived from an auditable projection
- A provider is preferred over another only on benchmark evidence

**Invariants** — `GV-002`, `AG-004`, `AG-005`, `BM-001`, `BM-004`

**Evidence.** Capability levels move without anyone editing them, and the
projection behind agent standing is checked against the log it derives from.
Against the hypothesis: the derived system produced five wrong levels before the
checks were corrected, so "more accurate" is not established — only "wrong in a
way that could be found".

**Status.** Engineering: supported. Scientific: unsupported — the comparison
against a hand-maintained baseline has not been run, and it is the experiment
this question actually needs. Operational: unsupported.

---

## RQ-004 — Can mutation detect governance mechanisms that do not measure what they claim?

**Hypothesis.** Deliberately breaking the property a check exists to protect,
and requiring the check to report false, distinguishes a working check from one
that cannot fail.

This question was not planned. It came out of finding that five checks passed
while asking nothing, and it is the one where this project has something
resembling a finding.

**Claims**

- A critical invariant cannot be satisfied without a falsifiable observation
- A session survives restart, and revocation survives with it
- A benchmark dataset edited after its manifest is detected
- A release without passing readiness or health checks is refused

**Invariants** — `GV-000`, `INV-002`, `BM-002`, `DP-001`

**Evidence.** Nineteen falsification records. Four defects found _by the
mutation attempt itself_ rather than by the check under test: a drift check
comparing a stored digest to itself, evidence emitted after an assertion so a
failing run left a passing record, a precedence ordering that buried a measured
failure behind a missing observer, and a confinement check watching the wrong
dependency while two routes bypassed it.

**Status.** Engineering: supported. Scientific: unsupported — no controlled
comparison against code review, and the sample is one project. Operational:
unsupported.

---

## What every question needs next

All four are answered as engineering results and none as scientific ones. The
missing element is the same in each case and it is not more implementation:

- **RQ-001** needs a project without executable governance, assessed the same
  way, by someone else.
- **RQ-002** needs an independent party to reconstruct an execution from records
  they did not produce.
- **RQ-003** needs the hand-maintained baseline, which is the one experiment
  that could be run today and has not been.
- **RQ-004** needs a comparison against review — the same defects put in front
  of readers to see how many are found without mutation.

RQ-003's experiment is the cheapest and the most likely to be uncomfortable,
which is a reason to run it rather than a reason not to.
