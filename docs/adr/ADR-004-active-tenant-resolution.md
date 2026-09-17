# ADR-004: Active-tenant resolution

**Status:** Accepted — implemented and proved in Phase 4A′.
**Date:** 2026-07-27

## The decision to make

Five repositories take `context.organisationId` and refuse anything outside it.
The dual-membership falsification — one account with real memberships in two
organisations, a session scoped to the first — is the case each of them refuses
on that predicate alone, and it is the strongest tenancy proof in the
programme.

None of it means anything until something decides which organisation a request
is acting in. Nothing did. See `docs/SESSION_INVENTORY.md`.

This is written before the code because nothing in the system constrains the
answer, so nothing would catch a bad one.

## Decisions

### Where the active organisation lives

A signed, `HttpOnly`, `SameSite=Lax`, `Secure`-in-production cookie carrying
**only an opaque organisation identifier**. Never a membership list, never a
role, never a permission.

### The cookie is a preference, not authority

This is the load-bearing decision. The cookie says which organisation the user
last chose. Authority comes from `workspace_members`, read **on every request**.
A valid cookie value never overrides a revoked membership, a suspended account
or a suspended organisation — it is an input to a check, not the result of one.

Signing it prevents a user from silently editing it to another organisation's
id and having that value flow into logs and audit payloads as an attempted
tenancy. It does **not** grant anything: an attacker who forges a valid
signature still fails the membership check.

### How it is selected

| Situation | Outcome |
| --- | --- |
| no memberships | `no_active_organisation` |
| one membership, no preference | select it deterministically, persist the preference |
| several memberships, no preference | `selection_required` — never pick the first row |
| preference valid | resolve it |
| preference names an organisation the actor has left | clear the cookie, fall through to the rules above |
| organisation suspended | not activated |

"Never pick the first row" is deliberate: `ORDER BY` omitted means insertion
order, and a solicitor acting for two firms would silently act in whichever
tenancy was created first.

### URL precedence

**The URL never selects an organisation.** A case identifier belonging to
another organisation produces the platform's existing non-disclosing
`NOT_PERSISTED`, exactly as the repositories already return. There is no
organisation segment in any route and none is added.

The alternative — deriving the tenancy from the resource being requested — is
the single most attractive wrong answer here, because it makes deep links
"just work". It also means any identifier a user can guess or be sent selects
the tenancy it belongs to, which is the whole boundary handed to the URL bar.

### Switching

One explicit server action, `POST` only, protected by the framework's server
action mechanism plus an origin check. It reloads memberships, verifies current
membership of the target, writes the audit entry, and **only then** sets the
cookie.

### Ordering, and what is not claimed

A cookie and a database row are two systems and there is no transaction across
them. The order is: verify target → write audit → set cookie.

- Audit write fails → no cookie change. The user stays where they were.
- Cookie write fails after audit success → an audit entry describes a switch
  that did not take effect. The next request re-resolves from the unchanged
  cookie and the user is still in the old organisation, which is safe and
  visible. The alternative order — cookie first — would move the security
  context with no record, which is the failure that matters.

**No database-cookie atomicity is claimed.**

### Switching to the organisation already active

Idempotent: verified, no audit entry, no cookie rewrite. Auditing a no-op would
fill the chain with events that record nothing.

### Refused switches

Refusal writes no successful action. A separate bounded refusal action is
**not** implemented in this phase: recording refused attempts against
organisation identifiers a caller supplied would create an audit-side
enumeration surface, and that needs its own thinking.

### Caching

Request-scoped only, via the framework's per-request memoisation, keyed on
account **and** selected organisation. No process-global cache. Revocation is
visible on the next request. Request memoisation is **not** durable
authorisation state and is not described as such anywhere.

### Permissions

The context carries organisation-level facts: role, membership id, and whether
a professional registration is on record. **Case-level access stays with the
repositories**, which already prove it and already refuse foreign cases. Moving
it into the session would duplicate a decision five repositories make correctly.

A role label alone is never treated as professional registration — the same rule
`mayAuthoriseReserved` and the review repository already apply.

### Client exposure

A client-safe projection: display name, active organisation id and name,
switchable organisation summaries, a role label. The `RepositoryContext` itself
is server-only, and ST-A7 rejects a client component importing the modules that
produce it.

## Consequences

Every authenticated route obtains its context from one factory. A route that
constructs one by hand, or accepts `organisationId` from a form field, is a
`pnpm check:identity-architecture` failure rather than a code review note.

**What that gate enforces, precisely.** It parses every file under
`apps/web/src` with the TypeScript compiler API and rejects seven defined
patterns (ST-A1…ST-A8, no ST-A3). It is **not** information-flow analysis: a
value assigned to a variable, passed through a helper and then into a context is
not tracked. The honest claim is that the canonical path is enforced for the
defined construction and call patterns — not that no code can ever bypass tenant
resolution.

Deep links to another organisation's case return not-found rather than
switching. That is the intended cost of refusing to let the URL choose the
tenancy.

## Re-evaluate when

An organisation segment is genuinely needed in URLs (then §4's equality proof
becomes mandatory); a second active-scope concept appears, such as acting on
behalf of a client; or refused-switch auditing is designed with its enumeration
surface addressed.

## Proved behaviour (Phase 4A′ completion)

Twelve guarantees registered as `SessionAndActiveTenant` and all twelve
honoured, proved against a real database: real `accounts`, `organizations`,
`workspaces`, `workspace_members`, `sessions` and `audit_log`. Membership is
read by query on every resolution and never from an array a test supplied.

Seven mutations were executed. Two produced findings rather than clean failures,
and both are recorded as such:

- **Removing the membership check in `selectOrganisation` alone did not fail.**
  `governingMembership` refuses independently for the same case, so the property
  is enforced by two mechanisms. Mutating both together turned the proving tests
  false. The guarantee holds; the single-mutation claim would not have.
- **The first URL/resource-precedence mutation did not fail**, because ST-G6's
  test enumerated a hand-written list of parameter names and a mutation adding a
  *new* parameter walked past it. The test now submits nine plausible resource
  keys behaviourally; re-run, the mutation bit.

## Correction: organisation suspension is not modelled

The first draft of the membership query read `COALESCE(o.status, 'active')`.
**`organizations` has no `status` column.** That was a fabricated suspension
model — a check that would always have passed, with a test proving it did. It is
removed, along with the `organisation_suspended` outcome and the two tests that
exercised it.

`accounts.status` *is* real (`pending_recovery | active | suspended | closed`)
and a suspended account is refused, proved against the real column. Membership
revocation via `workspace_members.removed_at` is real and proved across two
request scopes.

**Limitation:** an organisation cannot be suspended. There is no domain model
for it and none was invented to satisfy a test.
