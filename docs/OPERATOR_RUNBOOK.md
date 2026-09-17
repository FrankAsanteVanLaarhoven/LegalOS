# LegalOS Operator Runbook

## From verified architecture to operational evidence

This runbook defines what a platform operator must supply before LegalOS can
produce production evidence. Every item is something software cannot manufacture
for itself, which is why the platform refuses to simulate any of them.

**Do not tick these boxes by hand.** Run `pnpm check:readiness`. It measures each
prerequisite against the deployment and reports what is outstanding and who owns
it. A checklist a person ticks is a declaration, and this project does not accept
declarations anywhere else.

## Databases

Three names, and the application never shares one with the tests.

| Variable            | Used by                 | Guard                                                  |
| ------------------- | ----------------------- | ------------------------------------------------------ |
| `DATABASE_URL`      | the application         | refuses a `*_test` database when `NODE_ENV=production` |
| `TEST_DATABASE_URL` | destructive suites only | refuses anything not named `*_test`                    |

`pnpm test:integration` drops and recreates the test database each run. It does
not reset by truncation, because the append-only tables refuse to be truncated
and should — a suite that resets by emptying the audit log is exercising a
system without the property it exists to demonstrate.

That guard exists because the platform's first live model execution was
destroyed by its own integration suite an hour after it was recorded. The
tables' row-level triggers guarded UPDATE and DELETE; `TRUNCATE` fires
statement-level triggers only and ran straight past them.

## Three tiers

| Tier        | Command                           | Asks                                                   | Needs secrets   | Fails on                                         |
| ----------- | --------------------------------- | ------------------------------------------------------ | --------------- | ------------------------------------------------ |
| Structural  | `pnpm check:readiness:structural` | Does the platform still know how to measure readiness? | No              | A defective model only                           |
| Environment | `pnpm check:readiness`            | What can this environment answer?                      | Whatever it has | Nothing; it reports                              |
| Deployment  | `pnpm check:readiness:deployment` | Is this release safe to ship?                          | Yes             | Any required check failing **or** not measurable |

The structural tier runs on every push in CI. It never requires a credential,
because a contributor without production secrets should not have a red pipeline
— a pipeline that is always red teaches people to stop reading it.

Three states, and the distinction between the last two carries the design:

| State            | Meaning                       | Structural | Environment | Deployment |
| ---------------- | ----------------------------- | ---------- | ----------- | ---------- |
| `pass`           | Measured and satisfied        | ✓          | ✓           | ✓          |
| `not_measurable` | The environment cannot answer | ✓          | ✓           | **blocks** |
| `fail`           | Measured and unsatisfied      | ✓          | reported    | **blocks** |

"No database configured here" and "the database is broken" are different facts.
Collapsing them would make the report say something untrue in both directions.

## The manifest

`packages/readiness` holds a versioned manifest: every check, its owner, its
tier, its remedy, and a separate list of checks that must exist. The required
list is kept apart from the checks themselves on purpose — derived from them,
deleting a check would delete its own requirement, and the model would weaken
silently. That is the failure this guards against, and removing a required check
turns the structural tier red immediately.

---

## Current readiness

As shipped, against a local database with no credentials configured:

```
  ✗ AI provider credential          XAI_API_KEY is not set
  ✓ Database                        reachable
  ✓ Migrations applied              7 applied, none pending
  ✓ Append-only triggers            6 installed
  ✗ Production executions recorded  none
  ✓ Audit chain verifies            chain intact
  ✗ Message delivery provider       none — no one outside development can sign in
  ✗ LegalBench-UK-v1 dataset        none installed
  — Reviewer approvals              not measurable without a dataset
  ✗ Benchmark evidence              none produced
```

---

## Three corrections to the checklist as drafted

**Redis is not an integration point.** There is no Redis code anywhere in the
repository. Listing it as "recommended" would imply a wiring that does not exist;
when a shared cache is added, session invalidation and the cache-not-truth rule
have to be settled at the same time, and `cache_invalidation_correct` is already
declared as an unmet observation waiting for it.

**There is a third blocker, not two.** Part 8 says "authenticate", but in
production `/api/auth/start` returns 503 without a message delivery provider —
so an operator following this runbook cannot obtain a session at all. The
development session route is disabled outside development, correctly. A delivery
provider is as much a prerequisite as the model credential, and an operator who
supplied only the API key would get as far as the sign-in page and stop.

**Benchmark evidence is not blocking with one provider.** With a single
configured provider nothing is being ranked, so no evidence is owed. It becomes
blocking the moment a second is configured, at which point routing refuses until
a benchmark ranks them. The readiness check reports this distinction rather than
flagging a permanent failure.

---

## Part 1 — AI provider credential

The platform integrates a provider _interface_; which vendor sits behind it is
configuration. A multi-model gateway is the default, because it makes adding a
model a configuration change rather than an integration — which is what the
capability router and benchmark-derived routing were built to assume.

```bash
AI_PROVIDER=gateway            # or xai
AI_GATEWAY_URL=<base url>
AI_GATEWAY_API_KEY=<key>
AI_GATEWAY_MODEL=<model id>
AI_GATEWAY_MODEL_DEEP_REASONING=<model id>   # optional, per capability
```

No model id and no endpoint appears anywhere in the source. That is deliberate:
a default model written into code is a statement about which model suits a
capability, and nothing here has measured that. The routing table already
refuses to rank providers without benchmark evidence, and a hard-coded model
would be the same claim made where the router cannot see it.

A per-capability model is an override, not a ranking. With one model configured
for a capability there is nothing being chosen between — the same reasoning as
one configured provider.

In `.env.local`, which is git-ignored. Never in a dataset, a fixture, or a
commit. The runner refuses to issue a runner without a complete configuration,
so the failure is a clean refusal rather than a broken request.

Owner: platform operator.

## Part 2 — Database

```bash
DATABASE_URL=postgres://user:password@host:5432/legalos
```

| Condition   | Result                  |
| ----------- | ----------------------- |
| Unreachable | Model execution refused |
| Reachable   | Execution permitted     |

The refusal is deliberate. An execution that cannot be recorded is declined
rather than performed and forgotten — otherwise the system stops recording
exactly when its storage is in trouble, which is when the record matters most.

## Part 3 — Verify infrastructure

`pnpm --filter @legalos/database migrate`, then `pnpm check:readiness`, which
confirms migrations are applied and the six append-only triggers are installed.
Those triggers are what make the ledger append-only; their absence would be
invisible until something rewrote history.

Record the deployment commit, the migration set and the database version.

## Part 4 — Message delivery provider

```bash
EMAIL_PROVIDER_URL=<url>   # or SMS_PROVIDER_URL
```

Without one, sign-in returns 503 in production rather than pretending a message
was sent. Nobody can obtain a session, and Parts 8 to 10 cannot be performed.

Owner: platform operator.

## Part 5 — LegalBench-UK-v1

The platform ships without a dataset, deliberately. Generating plausible legal
questions and answers would produce something indistinguishable from
expert-reviewed material that no expert had seen, and every ranking derived from
it would be an unverified claim in a benchmark's clothing.

Required: versioned, immutable, SHA-256 manifest over sample content,
jurisdiction and sources recorded, and **no model-generated ground truth**.

Install under `datasets/<id>/` with `manifest.json` and `samples/*.json`.
`pnpm check:readiness` verifies the digest and the reviewer rules.

Owner: legal review board.

## Part 6 — Reviewer approval

Every sample requires two independent reviewers. One reviewer is an opinion.
Where they disagreed, the resolution is recorded — a disagreement that vanished
was settled by whoever wrote last. A sample failing either rule is refused by
`verifyDataset`, not merely flagged.

Owner: legal review board.

## Part 7 — Execute the benchmark suite

Run every configured provider against the same dataset, with no
provider-specific prompt tuning. Each evidence record carries provider, model,
model version, dataset id, version and digest, evaluation commit, environment
digest, sample count, repeat count and expiry.

Floors before evidence may rank anything: 100 samples, 3 repeats.

Evidence retires when its expiry passes **or** when the environment digest
changes — a changed prompt template, guardrail version, model id or retrieval
configuration. Age is a guess about how long a ranking stays true; an
environment change is a fact that it stopped being true.

## Part 8 — Verify routing

| Configuration                  | Expected                             |
| ------------------------------ | ------------------------------------ |
| One provider                   | Selected, no ranking claimed         |
| Several, with current evidence | Highest scorer, citing the benchmark |
| Several, no evidence           | **Refused**                          |

No routing decision is editable by hand. `pnpm check:invariants` reports BM-001
through BM-006.

## Part 9 — First production request

Authenticate, then `POST /api/chat`. Confirm the request produced an immutable
execution record, a retrieval snapshot where retrieval was used, prompt hashes, a
completion record, an audit entry and an agent metrics update. The response
carries the execution id; everything above is reachable from it.

## Part 10 — Verify the trust surface

At `/trust/agents`, confirm execution counts rise, standing changes on its own,
latency and verification statistics populate, and routing cites benchmark
evidence. Nothing on that page is entered by hand, so anything appearing there
that you typed somewhere is a defect.

## Part 11 — Acceptance criteria

Operational when `pnpm check:readiness` reports no outstanding prerequisites and
`pnpm check:invariants` shows no failed invariant. Both are measured; neither
accepts an assertion.

---

## Evidence Provenance Matrix

What this system relies on today, who supplied it, and how anyone knows it is
still valid. Kept here because "we have a benchmark" and "we have a benchmark
somebody can still reproduce" are different claims, and only the second is worth
anything after a year.

| Input                     | Owner              | Versioned       | Digest                     | Retention                        | Review cadence                  | Status           |
| ------------------------- | ------------------ | --------------- | -------------------------- | -------------------------------- | ------------------------------- | ---------------- |
| AI provider credential    | Platform operator  | No              | n/a                        | Rotate on suspicion or 90 days   | Quarterly                       | Not supplied     |
| Database deployment       | Platform operator  | Migration set   | n/a                        | Life of deployment               | On each migration               | Local only       |
| Message delivery provider | Platform operator  | No              | n/a                        | Rotate on suspicion              | Quarterly                       | Not supplied     |
| LegalBench-UK-v1          | Legal review board | Yes             | sha-256 over samples       | Permanent, immutable             | Annual, or on law change        | Not supplied     |
| Reviewer approvals        | Legal review board | Per sample      | Within sample digest       | Permanent                        | Per revision                    | Not supplied     |
| Benchmark evidence        | Platform operator  | Per report      | Environment digest         | Until superseded                 | On expiry or environment change | Not produced     |
| Execution records         | Platform (derived) | Immutable       | Prompt and response hashes | Permanent                        | Continuous                      | None recorded    |
| Audit chain               | Platform (derived) | Immutable       | Hash chain                 | Permanent, tombstoned on erasure | Continuous                      | Verifying, empty |
| Agent metrics             | Platform (derived) | Projection      | `source_digest`            | Rebuildable                      | Continuous                      | Empty            |
| Falsification records     | Engineering        | Per observation | Commit-stamped             | Permanent                        | On observation rewrite          | 20 recorded      |

Three of these are derived and need no supplier: execution records, the audit
chain and agent metrics are computed from what the platform does, and their
provenance is the immutable log. Everything above them in the table comes from
outside, and none of it can be produced by the software.

### Retention and validity

- **Immutable inputs** (dataset, execution records, audit chain) are never
  edited. A correction is a new version, and the old one stays resolvable so a
  decision made against it can still be explained.
- **Expiring inputs** (benchmark evidence) stop counting on their own, by expiry
  and by environment change. Nothing has to remember to retire them.
- **Rotating inputs** (credentials) leave no record here by design. A runbook is
  not a place to record where a secret is.

### What to archive after a deployment

Deployment commit, migration set, benchmark reports and their evidence records,
the environment digest they were produced against, the audit verification
output, a `/trust/agents` snapshot, and the reviewer approval records. Together
these answer the only question that matters afterwards: on what basis did the
system say what it said, on that day.

---

## Outstanding, and on whom

1. **A production AI provider credential** — platform operator.
2. **A message delivery provider** — platform operator, without which nobody can
   sign in.
3. **A legally reviewed LegalBench-UK-v1** — legal review board.

Everything that consumes these is built, tested and falsified. None of them can
come from the software itself, and the platform is designed to say so rather than
approximate them.
