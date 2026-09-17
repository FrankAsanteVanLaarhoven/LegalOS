# Surface inventory

Route-to-entity and route-to-repository mapping for every case-workspace
surface, measured from the code rather than estimated. This is the entry gate
for the operations shell: a shell built over surfaces that have no data would be
a frame around fixtures, and Principle 16 now fails the build on that.

Measured 2026-07-27 against commit `ba72871`. Schema columns re-measured after
migrations 0010–0013; the repository and fixture columns are unchanged, because
those migrations added tables and nothing else.

## The headline

**11 of 11 workspace panels are typed against `LegalCase`**, the fixture type in
`apps/web/src/lib/types.ts`. Two panels import a fixture module directly; the
other nine receive one as a prop, which is the same dependency one level up.
Only `audit-panel` reads a repository.

That is the real position. `1 of 16` surfaces meeting the completeness rule is
not a UI shortfall — it is the visible consequence of one repository existing
where sixteen are needed.

## What `LegalCase` carries

```
id, reference, clientName, preferredName, nationality, languages, status,
matterTypes, summary, disclaimer, assignedSolicitor, firm, createdAt,
updatedAt, timeline, evidence, evidenceGraph, analyses, tasks, deadlines,
reviews, activeAgents, isDemo, riskLevel
```

Eight of those — `evidenceGraph`, `analyses`, `tasks`, `deadlines`, `reviews`,
`assignedSolicitor`, `firm`, `clientName` — have no table behind them anywhere.
The fixture is not standing in for a database; for those fields there is nothing
to stand in for.

## Schema present

```
accounts · account_contacts · auth_factors · recovery_codes · sessions
workspace_members · organizations · workspaces · users · clients
cases · timeline_events · evidence_items
legal_sources · source_chunks
ai_outputs · proposals · ai_executions · ai_execution_transitions
ai_execution_completions · retrieval_snapshots · prompt_templates
agent_metrics · audit_log
deadlines · deadline_events
review_requests · review_decisions · review_events
tasks · task_evidence_links · task_dependencies · task_events
graph_nodes · graph_edges · graph_assertions · graph_evidence_links
```

The last four groups arrived with migrations 0010–0013. They hold no rows
outside the test database and no repository reads them yet, so every surface
below that depends on them is still `not backed`. Schema is a precondition, not
a surface.

## Surface by surface

| Surface        | Required entities                     | Schema                     | Repository             | Fixture       | Status                                                            |
| -------------- | ------------------------------------- | -------------------------- | ---------------------- | ------------- | ----------------------------------------------------------------- |
| Overview       | cases, evidence, reviews, executions  | partial — no reviews       | none                   | direct import | not backed                                                        |
| Timeline       | timeline_events                       | **present**                | `case.ts`              | **removed**   | data, permissions, observable — no actions, audit or verification |
| Evidence       | evidence_items, files, provenance     | **present**                | `@legalos/repositories` | via prop      | repository built and proved — route not wired                     |
| Evidence graph | graph_nodes, graph_edges, assertions  | **present**                | `@legalos/repositories` | via prop      | repository built and proved — route not wired                     |
| Tasks          | tasks, assignments, events            | **present**                | `@legalos/repositories` | via prop      | repository built and proved — route not wired                     |
| Deadlines      | deadlines, deadline_events            | **present**                | `@legalos/repositories` | via prop      | repository built and proved — route not wired                     |
| Documents      | documents, versions                   | **absent**                 | none                   | via prop      | no schema                                                         |
| Lawyer review  | reviews, approvals, reviewer identity | **present**                | `@legalos/repositories` | via prop      | repository built and proved — route not wired                     |
| AI analysis    | ai_outputs, executions                | **present**                | none                   | direct import | not backed                                                        |
| AI assistant   | executions, retrieval snapshots       | **present**                | none                   | none          | not backed                                                        |
| Audit          | audit_log, completions                | **present**                | `audit.ts`             | none          | **complete**                                                      |
| Agents         | executions, agent_metrics             | **present**                | none (trust page only) | none          | not in workspace                                                  |
| Communications | messages, channels, consent           | **absent**                 | none                   | —             | no schema                                                         |
| Bundles        | bundles, bundle_items, versions       | **absent**                 | none                   | —             | no schema                                                         |
| Sources        | legal_sources, source_chunks          | **present**                | none                   | —             | not backed                                                        |
| Exports        | export_jobs, artefacts, hashes        | **absent**                 | none                   | —             | no schema                                                         |

## What this says about the ordering

**Timeline is now repository-backed** and reads `timeline_events` through the
case repository, with permissions enforced and its fixture removed. It is still
not _complete_: it has no write action, no audit integration and nothing to
verify. Three of six layers, honestly — adding the words to satisfy the checker
without the integrations would be the gaming this project exists to prevent.

**Two more could be repository-backed today** with no new schema: AI analysis
and Sources both have their tables. Evidence needs only a
files/provenance table to be complete rather than partial.

**Three still need schema**: documents, communications, bundles, exports.

So the six-surface threshold for starting the shell decomposes into:

| Surface   | Blocked by                                       |
| --------- | ------------------------------------------------ |
| Overview  | a repository                                     |
| Timeline  | a repository only                                |
| Evidence  | **a route** — schema and repository exist and are proved |
| Tasks     | **a route** — the repository exists and is proved |
| Deadlines | **a route** — the repository exists and is proved |
| Reviews   | **a route** — the repository exists and is proved |

After 0010–0013, five of the six were blocked on repository work alone. Only
Evidence still needs a migration. That was the whole effect of Phase 2: it moved
the blocker and moved nothing else.

Phase 3 finished the four migrated domains. `@legalos/repositories` provides
the deadline, review, task and graph repositories; **all thirty-five
pre-registered contract guarantees are honoured** against a real database, and
`pnpm check:pages` still reports the same `1 of 16` — correctly.

The graph work also closed the oldest gap in the invariant registry. EV-005,
"every assertion is traceable to a document", had reported `no_observer` since
the registry was written, because the tables it needed did not exist. It now has
a real observer in `packages/capabilities/src/traceability.ts` that reads
persisted assertions and refuses to be satisfied by a table existing, by rows
existing, by another assertion's evidence, by a blank locator, or by a document
belonging to a different case. A repository is not a surface. All four
panels remain incomplete until a route reads the repository, enforces
permissions, exposes its unavailable states, performs its writes and records
audit evidence.

## The four domains, as built

These notes were written before the migrations, so the tables were designed
around what has to be true rather than around what a panel currently renders.
Each is now `packages/database/migrations/0010`–`0013`, with the constraints
tested by violation in `packages/integration/test/domain/schema.test.ts`.

**Deadlines** (0010). The date is the least important column. A deadline answers
where it came from, who recorded it, whether it is statutory, directed,
contractual or internal, whether a professional verified it, and whether it was
later superseded. The rule that no deadline may be presented as authoritative
without a visible source is a CHECK constraint, not a panel convention: a date
rendered without provenance looks exactly like one that has been checked.

**Reviews** (0011). Three tables — request, decision, events — because a single
row moving from `pending` to `approved` records only the last state anyone left
it in. The decision copies the reviewer's role and regulatory reference as they
were at the moment of signing, because a person's role changes and the question
afterwards is what they were when they signed.

**Tasks** (0012). A task carries who created it and whether it requires a
professional, because "assigned to a caseworker" and "requires a solicitor to
authorise" are different facts and only the second is a regulatory constraint.
Event history is separate and append-only: a status that can be edited to
`completed` with no record of who did it is not a task, it is a label.

**Graph** (0013). Edges assert relationships between evidence, and the assertion
needs an author. `machine_proposed`, `source_backed`, `human_confirmed` and
`disputed` are states with meaning; a percentage is not one, and there is no
probability column anywhere in the schema — asserted by a test that scans
`information_schema` rather than by intent.

### What none of this does

It stores nothing. No repository reads these tables, no panel renders them, and
`pnpm check:pages` reports the same `1 of 16` it reported before. A migration
that raised a completeness count would be measuring the existence of a table and
calling it a working surface.

## The gate for beginning the operations shell

Not a date, and not a count of components. The shell may begin when:

- the six core surfaces are repository-backed and permission-enforced;
- no authenticated surface imports a fixture, directly or by prop type;
- writes create audit entries and are covered by tests against
  `TEST_DATABASE_URL`;
- `pnpm check:pages` reports at least 6 of 16;
- `pnpm check:principles` still reports Principle 16 holding.

Until then a new shell would be a frame around data that does not exist, and the
completeness gate would refuse every surface inside it — correctly.

## Limitations of this inventory

It reads imports and schema, not behaviour. A panel receiving `LegalCase` as a
prop is counted as fixture-dependent regardless of what it does with it, which
is right for the question being asked and would be wrong for any other. The
"required entities" column is a design judgement rather than a measurement, and
is the part of this document most likely to need revising once the repositories
are written.
