# LegalOS

**A migration and integration platform whose trust claims are measured rather
than declared.**

LegalOS supports people navigating UK immigration, asylum and integration —
often without a solicitor, often to a deadline, often in a second language. That
audience is why the architecture looks the way it does: when the person relying
on a system cannot easily check it, the system has to be checkable by someone
else on their behalf.

> Not an AI solicitor. Reserved legal activities remain with qualified humans,
> and the platform is built to refuse rather than approximate them.

**Repository:** [FAVL-AI/LegalOS-AI](https://github.com/FAVL-AI/LegalOS-AI) ·
`0.2.0-dev`

---

## The problem

AI systems make claims about themselves. A dashboard shows a capability as
"active", a badge says "verified", an answer carries a confidence percentage.
Almost none of it is measured — it is written by a developer, and it stays true
only until the code beneath it changes.

That is tolerable in most software. It is not tolerable where an answer affects
whether someone can remain in the country, and where the person receiving it
cannot tell a grounded answer from a fluent one.

## What this repository does differently

Every status is derived from a measurement taken when it is shown, and the
measurements are themselves falsifiable.

- Capability maturity is computed from observations of the running system.
  Nothing raises it by being edited.
- Invariants are stated once and evaluated from evidence. Most are not
  satisfied, and the report says so.
- A critical invariant may not report satisfied unless one of its observations
  has been deliberately broken and recorded reporting false.
- Model output passes a verification gate or is withheld — never softened, since
  a hedged unverified answer is still unverified and reads as caution.
- Every execution is recorded before the provider is called, so a call that
  fails, times out or is blocked is recorded too.
- No confidence percentage appears anywhere, by design.

Most of the numbers below are uncomfortable. They are supposed to be.

## Measured state

Recomputed by `pnpm check:docs` on every push. A figure that drifts from what it
describes fails the build.

| Metric                          | Value |
| ------------------------------- | ----- |
| Packages                        | 33    |
| Migrations                      | 17    |
| Invariants                      | 50    |
| Invariants satisfied            | 27    |
| Invariants awaiting an observer | 16    |
| Falsification records           | 47    |
| Readiness checks                | 14    |
| Readiness checks required       | 9     |
| Architecture decision records   | 4     |

Needing a test run or a database, so not in the table: 505 unit tests, 293
integration tests, 61 contract guarantees, 14 of 14 enforced principles, and
**1 of 16 workspace pages** meeting the completeness rule.

`pnpm smoke:dev` starts the real development server and drives 37 live HTTP
cases through it — the only observation in this repository on the `apps/web`
side of the dependency boundary. Contract: [docs/DEVELOPMENT_SMOKE.md](docs/DEVELOPMENT_SMOKE.md).

That last figure is the honest state of the product surface, published rather
than hidden. Defects that are known, understood and deliberately not fixed yet
are listed in [docs/KNOWN_DEFECTS.md](docs/KNOWN_DEFECTS.md) rather than left
unstated.

## The five ideas

**Observable Capability Maturity.** A capability declares a ceiling and is shown
at whatever its observations support, never higher. Two axes — implementation
and evidence — because "the code is written" and "we have grounds to believe it
works" are different claims.

**Executable System Invariants.** Properties stated once and evaluated across
whatever they touch. Six outcomes rather than pass/fail, because "not satisfied"
hides the difference between work not started, missing instrumentation, a real
defect, and a symptom of something upstream.

**Falsification as an entry condition.** A check only ever observed passing is
indistinguishable from one that cannot fail. Forty-seven observations have been
deliberately broken and recorded reporting false, each record naming the
mutation precisely enough to repeat.

**Trust by construction.** Every model call goes through one runner that records
before it calls, resolves the agent from a registry, enforces the agent's
declared policy, and refuses when it cannot record. No route can reach a model
another way — enforced by the dependency graph, not by convention.

**Verification debt.** Stated properties minus demonstrated ones, per
capability. An integer, so it cannot be improved by declaring more. It has
chosen the work order twice, which is not yet enough to call it validated.

## Architecture

```
Request
   │
Middleware  ── fail-closed by path
   │
Route       ── verifies the session against the store
   │
ExecutionRunner
   ├─ resolve agent        registry; refuses if unregistered
   ├─ resolve provider     capability router; refuses without evidence
   ├─ persist retrieval    snapshot, before the model is invoked
   ├─ write execution      append-only, before the provider is called
   ├─ call provider        adapter
   ├─ guardrails           verification gate; withheld, never softened
   ├─ write completion     append-only
   └─ refresh projection   agent metrics
   │
Audit chain ── hash-linked, tombstoned on erasure
   │
/trust, /trust/agents ── derived; nothing typed by hand
```

## Repository

| Package                              | Purpose                                                          |
| ------------------------------------ | ---------------------------------------------------------------- |
| `capabilities`                       | Observation layer and capability maturity                        |
| `invariants`                         | Invariant registry, evaluator, falsification records             |
| `contracts`                          | Repository guarantees, declared before the code                  |
| `repositories`                       | Domain repositories — deadlines, reviews, tasks, graph, evidence |
| `readiness`                          | Deployment prerequisites, release and rollback evidence          |
| `execution`                          | The runner — the only route to a model                           |
| `agentos`                            | Agent registry, permissions, capability routing                  |
| `database`                           | Schema, migrations, append-only stores                           |
| `auth`                               | Accounts, sessions, recovery                                     |
| `bench`                              | Benchmark and dataset governance                                 |
| `evidence`, `evidence-review`        | Document ingestion and integrity                                 |
| `verification`, `rules`, `knowledge` | Output verification and legal sources                            |
| `privacy`, `governance`, `policy`    | Erasure, consent, policy                                         |
| `integration`                        | Evidence-producing integration suites                            |

The remainder cover UI, workflows, graph, reliability and shared types.

## Quick start

```bash
pnpm install
docker compose up -d
DATABASE_URL=postgres://legalos:legalos@localhost:5433/legalos \
  pnpm --filter @legalos/database migrate
pnpm bootstrap                                  # a demonstration tenancy
pnpm dev                                        # http://localhost:3011
```

Provider configuration is in `apps/web/.env.local`; see the operator runbook.

Checks:

```bash
pnpm check:invariants     # every invariant against this instance
pnpm check:principles     # the executable principles
pnpm check:readiness      # deployment prerequisites, measured
pnpm check:docs           # the figures above
pnpm check:pages          # workspace page completeness
pnpm check:contracts      # repository guarantees, proved or owed
pnpm check:identity-architecture           # the tenant boundary, enforced syntactically
pnpm check:identity-architecture:selftest  # the checker's own regression fixtures
pnpm check:videos         # one film per placement
pnpm check:claims         # no claim typed above its evidence
pnpm check:questions      # no question answered above its claims
pnpm assess [path]        # research-engineering assessment, any repository
```

## What is not built

Stated here rather than discovered later.

- **No production execution has ever run.** The runner, recording, replay and
  metrics are proven against a real database with a test provider. No model has
  answered a real request, because no credential exists.
- **No sign-in for anyone but a developer.** Production sign-in returns 503
  without a message delivery provider.
- **No benchmark dataset.** LegalBench-UK needs qualified legal reviewers.
  Generating one would produce material indistinguishable from expert-reviewed
  ground truth that no expert had seen.
- **No deployment target.** ADR-001 records the options and recommends one; the
  decision commits money and a jurisdiction, and has not been made.
- **1 of 16 workspace pages** meets the completeness rule. The first one required building a repository layer that did not exist, which is why the number was zero rather than low.

## Documentation

| Document                                               | Contents                                         |
| ------------------------------------------------------ | ------------------------------------------------ |
| [`PRINCIPLES.md`](PRINCIPLES.md)                       | The principles, and the code enforcing them      |
| [`docs/INVARIANTS.md`](docs/INVARIANTS.md)             | The registry, its outcomes, falsification        |
| [`docs/OPERATOR_RUNBOOK.md`](docs/OPERATOR_RUNBOOK.md) | Deployment prerequisites and the evidence matrix |
| [`docs/adr/`](docs/adr/)                               | Architecture decisions                           |
| [`PROGRAMME_PHASES.md`](PROGRAMME_PHASES.md)           | Delivery phases                                  |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)         | Component architecture                           |

## Research status

Three of the five ideas have running code and falsified evidence. Two do not yet
have results that would make them research claims rather than architectural
ones:

- **Agent Capability Governance** — registry, permissions, ceilings and refusals
  are implemented and falsified, and every agent still stands at `draft` with
  zero executions. The governance has never been tested against an agent that
  did something.
- **Evidence-driven provider routing** — the mechanism refuses to rank providers
  without benchmark evidence, and no benchmark has been run.

Nothing here is published, and no result has been externally replicated.

## Licence

See [`LICENSE`](LICENSE).
