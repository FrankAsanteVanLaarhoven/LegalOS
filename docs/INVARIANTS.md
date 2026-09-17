# System Invariants

Properties that must hold, stated once and evaluated from measurements taken
now. Run `pnpm check:invariants`.

The capability layer answers _how mature is this subsystem_. That is the wrong
unit for trust: a subsystem can be mature and still let evidence cross a tenant
boundary, because the property spans several subsystems and maturity is measured
inside one. An invariant is stated once and evaluated across whatever it
touches.

## What an invariant may contain

Three things: what must hold, which observations would demonstrate it, and which
capability it belongs to. No logic. An invariant that can compute its own answer
can be written to compute a convenient one — which is how five checks in the
authentication milestone came to look correct while asking nothing.

## Six outcomes

| Status        | Meaning                                                                           |
| ------------- | --------------------------------------------------------------------------------- |
| `satisfied`   | Every observation measured and held, and at least one can fail.                   |
| `unfalsified` | Measured true throughout, but no observation has been shown able to report false. |
| `failed`      | An observation was measured and did not hold.                                     |
| `blocked`     | A dependency is not satisfied; this one would otherwise hold.                     |
| `unmeasured`  | An observation exists but could not be measured. Fails closed.                    |
| `no_observer` | Nothing measures this property yet.                                               |

`no_observer` is the majority state and is meant to be. A registry that can only
express solved problems is worth nothing, because the cheapest way to a clean
report becomes deleting the invariant.

## Precedence

Fixed in `STATUS_PRECEDENCE`, worst first:

```
failed → no_observer → unmeasured → blocked → unfalsified → satisfied
```

The rule behind it: report the strongest thing actually known. A measured
failure is knowledge, and outranks every form of not-knowing — including a
broken dependency and a missing observer.

That last one was a defect in the first version of this package. `no_observer`
was tested before `failed`, so an invariant with one observation measured false
and another never built reported `no_observer`, burying a real failure behind a
gap — the same mistake the blocked-versus-failed rule was written to avoid.
Fixing it moved EV-003 from `no_observer` to `failed`: `ocr_engine_wired` had
been measured false the whole time.

`unfalsified` sits below `unmeasured` rather than above it. It is a claim
_about observations that held_, so an invariant with anything unmeasured has not
earned the description.

## Falsification records

`docs/falsification/<observation>.json` records that an observation was
deliberately broken in a named way and reported false.

This exists because every over-claim in the authentication milestone was caught
by a person doubting a good number, never by the system. What those checks had
in common was not a bug — it was that none of them had ever been observed
producing a different answer. A check that has only ever been seen passing is
indistinguishable from a check that cannot fail.

A record is not proof an observation is correct. It proves only that the
observation is capable of answering. Critical invariants may not report
`satisfied` without one.

### What is recorded

| Observation                                  | Broken by                                                   |
| -------------------------------------------- | ----------------------------------------------------------- |
| `session_durability_survives_restart`        | `PostgresSessionStore.put` returned before its INSERT.      |
| `no_capability_exceeds_its_observations`     | Authentication's declared ceiling reverted to `unit_tests`. |
| `no_self_evident_check_above_operational`    | A `selfEvident()` check moved to gate `certified`.          |
| `unavailable_observations_fail_their_checks` | A predicate replaced with `() => true`.                     |

### What is not recorded, and why

`every_satisfied_critical_invariant_is_falsifiable` — the observation behind
GV-000 — is currently true **vacuously**. No critical invariant outside the
governance category has yet reached the point where the rule would bite, so
there is no state of the system in which it could report false today.

GV-000 therefore reports `unfalsified`: the framework declines to mark its own
central rule satisfied. The evaluator's behaviour _is_ tested directly in
`packages/invariants/test/evaluate.test.ts`, which is a different and weaker
claim than the system-level observation holding, and the report should not blur
the two.

## What fails the build

Structural defects only: a duplicate id, a dependency on an invariant that does
not exist, a cycle, an invariant no evidence kind may raise, a rationale too
thin to review. These are defects in the declarations, and none is visible from
inside a single declaration.

`no_observer` and `unmeasured` do not fail the build. They are the honest state
of the system and belong in the report.

## Traceability

Every invariant names the paths it protects, and those paths are checked against
the filesystem on every run. A stale traceability list is worse than none: it is
followed, and it sends the next person to a directory renamed two milestones
ago. A path that does not exist fails the build.

## Verification debt

```
capability             stated observable satisfied  debt
ingestion                   7          1         0     7
authentication              7          3         1     6
```

- **stated** — properties declared for this capability
- **observable** — how many can be measured at all today
- **satisfied** — how many are demonstrated, falsification included
- **debt** — `stated − satisfied`, a count of properties

Debt is an integer, not a ratio, so it cannot be improved by declaring more
invariants. It goes down one way: by satisfying a property that was stated.

There is deliberately no "implementation %, verification %, gap %". An
implementation percentage has no honest denominator — it would be a five-point
rank rendered as a percentage, a file count, or an estimate. This project
removed a hardcoded confidence percentage from the workspace for that reason,
and reintroducing one in the layer everything else is measured against would be
worse. Read `debt` beside the capability's implementation level from
`pnpm trust:ledger`: a high level with a high debt is the signal — functionality
has outrun what anyone can show about it.

## Evidence asymmetry

| Kind        | May lower | May raise |
| ----------- | --------- | --------- |
| unit        | yes       | no        |
| integration | yes       | yes       |
| security    | yes       | **no**    |
| static      | yes       | no        |
| telemetry   | yes       | yes       |
| audit       | yes       | yes       |

A passing adversarial test demonstrates resistance to one attack somebody
thought of. It says nothing about the class. Treated as proof it becomes the
most dangerous evidence in the system, because it reads as coverage — so
security tests can pull an invariant down and can never hold one up.
