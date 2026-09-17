# Claims register

Every claim this project makes, classified by the kind of evidence behind it,
because mixing the three is how an architecture gets mistaken for a result.

Checked by `pnpm check:claims`. A claim typed above what its evidence supports
fails the build.

## The three kinds

**Engineering** — this was built and behaves as described. Evidenced by code
that runs, tests that fail when it breaks, and a falsification record showing
the check can report false. This is the only kind of evidence this project
currently has in quantity.

**Scientific** — this generalises beyond the system that produced it. Evidenced
by a method others can apply, results reproduced independently, and a comparison
against alternatives. Almost nothing here reaches this bar yet, and the register
says so.

**Operational** — this works in production. Evidenced by telemetry from real
use, incidents and their absence, and users who are not the author. Nothing here
reaches this bar, because nothing has been deployed.

A claim may only be typed at a level its evidence supports. An engineering claim
dressed as a scientific one is the failure this register exists to prevent.

## Register

| Claim                                                                      | Type        | Evidence                                                | Status      |
| -------------------------------------------------------------------------- | ----------- | ------------------------------------------------------- | ----------- |
| Capability maturity is derived from measurement, not declaration           | engineering | `packages/capabilities`, 3 falsification records        | supported   |
| An unmeasurable check fails closed rather than passing                     | engineering | `unavailable_observations_fail_their_checks`, falsified | supported   |
| A critical invariant cannot be satisfied without a falsifiable observation | engineering | `GV-000`, evaluator tested directly                     | supported   |
| A session survives restart, and revocation survives with it                | engineering | `session_durability_survives_restart`, falsified        | supported   |
| The audit chain detects alteration by recomputation                        | engineering | `audit_chain_valid`, falsified                          | supported   |
| Erasure removes content while the chain still verifies                     | engineering | `audit_chain_valid_after_tombstone`, falsified          | supported   |
| Every model execution is recorded before the provider is called            | engineering | `execution_recorded_for_every_invocation`, falsified    | supported   |
| An execution's inputs are reconstructible from immutable artefacts         | engineering | `execution_replay_succeeds`, falsified                  | supported   |
| No route can reach a model except through the runner                       | engineering | `provider_access_confined_to_runner`, falsified         | supported   |
| An unregistered agent is refused before a provider is reachable            | engineering | `agent_resolved_from_registry`, falsified               | supported   |
| Agent standing is derived from an auditable projection                     | engineering | `agent_metrics_projection_faithful`, falsified          | supported   |
| A provider is preferred over another only on benchmark evidence            | engineering | `routing_derived_from_benchmarks`, falsified            | supported   |
| A release without passing readiness or health checks is refused            | engineering | `release_evidence_enforced`, falsified                  | supported   |
| A benchmark dataset edited after its manifest is detected                  | engineering | `dataset_governance_enforced`, falsified                | supported   |
| Observable Capability Maturity generalises to other systems                | scientific  | none                                                    | unsupported |
| Executable System Invariants generalise to other systems                   | scientific  | none                                                    | unsupported |
| Verification debt improves engineering prioritisation                      | scientific  | chose the work order twice, n=2, by the author          | unsupported |
| The assessment instrument measures research-engineering quality            | scientific  | 4 repositories, one author, pattern-matching probes     | unsupported |
| The architecture reduces harm to people relying on it                      | scientific  | none                                                    | unsupported |
| Agent governance holds for agents that do work                             | operational | zero executions recorded                                | unsupported |
| Routing selects well among providers                                       | operational | no benchmark has run                                    | unsupported |
| The platform is reliable under load                                        | operational | never deployed                                          | unsupported |
| The verification gate withholds the answers it should                      | operational | no production answer has been generated                 | unsupported |

## What would move a claim up

**To scientific.** The method applied by someone else, to a system they built, with
a result the author did not choose. For the assessment instrument specifically:
executable probes replacing pattern matches, then external application. For
verification debt: enough prioritisation decisions to say whether the metric
beat the alternative, judged by someone who did not design it.

**To operational.** A deployment, real users, and enough time for something to go
wrong. Fourteen engineering claims are supported here; not one of them has been
tested by anything other than its own test suite.

## The literature review problem

A monograph needs a literature review, and this project cannot generate one.

Citations that are not verified against the actual papers are the most damaging
possible failure in a research document — worse than an unsupported claim,
because a fabricated citation borrows credibility from work that does not say
what it is cited as saying. This platform refuses to let a model state a rule
number that does not appear in retrieved context; the same rule applies to its
own bibliography, and more strictly, because nobody downstream will check.

The literature review must be written against a real bibliographic database, by
someone reading the papers. A generated one would fail the standard the platform
enforces on itself, in the document arguing that the standard matters.
