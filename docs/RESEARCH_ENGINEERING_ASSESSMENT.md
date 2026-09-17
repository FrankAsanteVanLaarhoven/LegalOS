# Research-engineering assessment

A reproducible way to ask what a software platform can **evidence** about
itself. Eight dimensions, twenty-four criteria, three states per criterion, and
no overall score.

```bash
pnpm assess              # this repository
pnpm assess <path>       # any other repository
```

The instrument imports nothing from LegalOS. Every probe looks for artefacts any
project might have.

## Method

| Dimension             | Asks                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Provenance            | Is the request recorded before the call, with retrieval captured and the answering model distinguished from the requested one? |
| Auditability          | Is the record append-only at the storage layer, verified by recomputation, and erasable without invalidating verification?     |
| Governance            | Are properties enumerable, is status derived rather than declared, does an unmeasurable check fail closed?                     |
| Reproducibility       | Can an execution's inputs be reconstructed, are versions recorded, is the limit of reproducibility stated?                     |
| Falsifiability        | Is there a record of checks demonstrated capable of failing, covering more than a token number, with evidence that expires?    |
| Operational readiness | Are prerequisites measured, is there a health endpoint, has anything actually been deployed?                                   |
| Documentation         | Are decisions recorded with alternatives, is there an operator runbook, are stated figures checked against the system?         |
| Benchmarking          | Is there a versioned dataset with ground truth, is its integrity verified, have results been produced?                         |

### Three states

`met`, `not_met`, and `no_evidence` — and the third is distinct from the second
on purpose. A repository with no deployment evidence may have no deployments; a
repository with a broken audit chain has a defect. Collapsing them would make
every young project look negligent and every incomplete probe look conclusive.

### No overall score

A weighted total invites a platform to raise one dimension to compensate for
another, and these dimensions are not commensurable — provenance and
documentation do not trade off. A reader wanting one number has to choose which
dimension they care about, which is the honest position anyway.

## Results

Run across four repositories on one machine, 2026-07-27:

| Repository   | Met | Not met | No evidence |
| ------------ | --- | ------- | ----------- |
| LegalOS      | 21  | 0       | 3           |
| Repository B | 6   | 0       | 18          |
| Repository C | 6   | 0       | 18          |
| Repository D | 2   | 0       | 22          |

LegalOS scores `no_evidence` on: benchmark datasets, benchmark results, and
release evidence — the three things it genuinely does not have.

## Threats to validity

These are the reason this document exists, and they are more important than the
table above.

### The instrument scores its author's system highest

This was written by the author of the system that scores 21 of 24, and the
dimensions are ones that system was built around. That is not a bias that can be
engineered away. What can be done is to state it, publish every probe so anyone
can disagree with them, and include dimensions where the authoring system scores
badly — benchmarking, at 1 of 3, is the clearest.

A useful instrument would have been designed before the system, or by someone
else. This one was not.

### Most probes detect discussion, not behaviour

This is the strongest objection and it is worth stating precisely.

Fifteen of the twenty-four probes are pattern matches over source text. `AUD-1`
reports "24 files matching an append-only constraint" — but a file _discussing_
append-only storage matches as readily as one implementing it. A repository
could score well by writing about properties it does not have.

That is the same defect this project has caught in its own checks five times:
grepping for an identifier that appeared in an unrelated function, requiring a
file to exist, a predicate written to return null. The instrument currently
commits the error it was built to detect.

The fix is executable probes — running a project's own tests, or attempting the
mutation the criterion describes — rather than reading its source. Nine probes
already do something stronger by counting artefacts. The remaining fifteen do
not, and until they do, a high score means "this repository is organised as
though it cared about these properties", which is a weaker claim than it looks.

### Absence dominates the comparison

Across the three other repositories, every unmet criterion returned
`no_evidence` and none returned `not_met`. The instrument is currently measuring
the presence of artefacts, not their correctness. It can tell a repository built
around evidence from one that was not; it cannot yet tell a good audit chain
from a broken one in a codebase it did not write.

### Not externally applied, no inter-rater reliability

Four repositories, one machine, one author, one run. Nobody else has applied it,
and nobody has disagreed with a result. A discrimination study across
independently built systems, assessed by people who did not write them, is what
would move this from an instrument to a finding.

## Status

**Proposed instrument. Not validated.**

It is reproducible — anyone can run it against anything and get the same answer
— which is a necessary condition for a benchmark and nowhere near a sufficient
one. Reproducibly measuring the wrong thing is still measuring the wrong thing.

What would make it a research contribution, in order:

1. Executable probes replacing pattern matches, so the instrument stops
   committing the error it detects.
2. Application by someone to systems they did not build.
3. A discrimination study with enough repositories to say whether the dimensions
   separate anything that matters.
4. Evidence that a low score predicts something — an incident, a failed audit, a
   claim that turned out to be untrue. Without that, the dimensions are a
   plausible list rather than a validated one.

Until at least the first two, the honest description is: a checklist that runs,
applied by its author, to systems including their own.
