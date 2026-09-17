# Programme phases

## The page completeness rule

> **A workspace page is complete only when it has real data, real actions,
> observable state, audit logging, permission enforcement and verification
> integrated. UI completeness alone does not constitute feature completion.**

Non-negotiable. `pnpm check:pages` reports each workspace page against the six
layers, and `STRICT_PAGES=1` turns a shortfall into a build failure.

It reports rather than fails by default because **almost every page currently
falls short**, and a check that failed the build on day one would be switched off
within a week. The baseline is recorded below so progress is measured against a
real starting point rather than a remembered one.

### The six layers

| Layer            | Means                                            |
| ---------------- | ------------------------------------------------ |
| Data             | Reads persisted state, not a fixture             |
| Actions          | Controls perform operations, not navigation only |
| Observable state | Status derived from measurement, never hardcoded |
| Audit            | Changes append to the audit chain                |
| Permissions      | Controls respect the acting user's role          |
| Verification     | AI output passes the gate before display         |

A page missing any layer is incomplete regardless of how finished it looks.
That is the point of the rule: the previous audit found a workspace that looked
complete and was rendering hand-typed percentages as tribunal readiness.

### The denominator

Pages are discovered from the workspace directory, never listed in the script.
A hardcoded list is a denominator that shrinks to fit the answer: add eight
pages, measure seven, and the score improves while the workspace does not.
Roadmap pages that do not exist yet are counted too, so an unbuilt page lowers
the score rather than being invisible. A new panel therefore _reduces_ the
number until it earns its place, which is the only direction that makes it worth
reading.

### How the check measures

Honestly: by inspection of each page's source for the integration points —
whether it reads from a repository, whether its controls call an operation,
whether it references permissions, audit and verification. It is a heuristic,
not a proof. A page can satisfy it superficially, and the check says so rather
than implying certainty it does not have.

---

## v0.2.x — Verification foundation

Landed. Eighteen packages, the trust ledger, executable principles, observable
capability maturity. See `PRINCIPLES.md` and `pnpm trust:ledger`.

The honest summary: the platform can describe what it knows and refuses to
overstate itself. It cannot yet answer a substantive legal question, because no
legal source has been retrieved and checksummed.

---

## v0.3 — Authentication and identity

Nothing else may depend on an anonymous user, and today everything does.

- Passkeys (WebAuthn) first, with recovery designed before authentication
- Email verification; SMS and WhatsApp as optional second factors, never sole
- Organisation registration and domain verification
- Multi-tenancy with row-level isolation
- Role-based access control
- Session and device management
- Privacy dashboard, account deletion, data export
- Provider key management, workspace-scoped

**Why recovery first.** `assessRecovery` already encodes what adequate means for
people who share handsets and change numbers. An account locked behind a dead
number may hold the only copy of someone's asylum evidence, so recovery is the
constraint the rest is designed around rather than a later addition.

**What this unlocks mechanically.** Principle 12 moves from declared to enforced;
`authentication` and `human_review` change level in the capability registry; the
navigation badges update. Nobody edits a status to make any of that happen — it
is the first real test of whether observable capability holds under change.

---

## v0.4 — Interactive case workspace

Every page satisfying the completeness rule, in dependency order. Higher layers
cannot come first: an assistant that reasons over a case needs the case to be
persisted, and analysis needs evidence to analyse.

1. Case data model and API — single source of truth
2. Documents and evidence — the foundation everything else reads
3. Timeline — derived from evidence and events, not authored
4. Tasks and deadlines
5. AI analysis over the persisted case
6. AI assistant using analysis and retrieval
7. Evidence graph, persisted
8. Professional review and collaborative editing
9. Communication hub
10. Audit, permissions, workspace settings

---

## v0.5 — Verified corpus

Ingestion, retrieval and source verification. Until this lands, verification
correctly blocks well-sourced answers and the platform is safe but not useful
for substantive questions. This is what changes that.

---

## Baseline at the time of writing

`pnpm check:pages` output is recorded in `docs/page-completeness.json` at each
milestone, so the claim "we improved" is checkable rather than asserted.

At the time of writing: **0 of 16**, eight of which do not exist yet.
