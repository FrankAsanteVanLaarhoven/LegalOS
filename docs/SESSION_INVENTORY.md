# Session and identity inventory

Measured before designing the active-tenant boundary, because the previous
phase's report claimed the Evidence route was unblocked without checking this
layer.

Measured 2026-07-27 against commit `d969c65`.

## The headline

**There is no server-side identity boundary.** Five repositories require a
`RepositoryContext` carrying `actorId`, `accountId`, `organisationId` and
`memberships`. Nothing in the application can produce one.

| Component                           | Exists? | Backed by                                                                      |
| ----------------------------------- | ------- | ------------------------------------------------------------------------------ |
| `requireSession(req: NextRequest)`  | yes     | production — verifies token, expiry, replay                                    |
| Server-component session resolution | **no**  | nothing imports `next/headers` anywhere in `apps/web`                          |
| Membership loading                  | **no**  | nothing reads `workspace_members` in `apps/web`                                |
| Active organisation                 | **no**  | absent from `Session`, from any cookie, from any URL                           |
| Correlation id                      | **no**  | zero occurrences in `apps/web`; repositories accept one, nothing generates one |
| `RepositoryContext` factory         | **no**  | —                                                                              |
| Organisation switching              | **no**  | —                                                                              |

## What exists

**`packages/auth`** — `checkSession`, `hashToken`, `tokenMatches`,
`rotateSession`, `revokeSession`, `membershipFor(memberships, accountId,
workspaceId)`, `mayAuthoriseReserved`. Pure, tested, and the right primitives.
`Session` carries `accountId` and no organisation.

**`apps/web/src/lib/auth/require-session.ts`** — the only verifier. Takes a
`NextRequest`, so it is reachable from API routes and server actions and _not_
from server components.

**`apps/web/src/middleware.ts`** — matches `/api/:path*` and
`/workspace/:path*`, checks a cookie is present and well formed. It declares
its own `SESSION_COOKIE = "legalos_session"` literal, a **second copy** of the
name defined in `require-session.ts`.

**Consumers** — `/api/analyze` and `/api/chat` call `requireSession` and then
pass `auth.accountId` as `actorId` into the execution runner. That is a
conflation: `accountId` is an `accounts` row and `actorId` should be a `users`
row. It does not violate a constraint because `ai_executions.actor_id` is
untyped `text`, which is why nothing has caught it.

**`workspace/cases/[id]/page.tsx`** — `generateStaticParams()`, reads the
`sapana-case` fixture, and passes `accountId=""` with `memberships=[]` to the
audit and timeline panels. Both correctly render refusals. The route is
statically generated and therefore cannot resolve a session at all.

## What is absent, and what each absence costs

1. **Server-component session resolution.** Every Mission Control page is a
   server component. Without this there is no authenticated page.
2. **Active organisation.** This is the gap that blocked Phase 4B. The
   dual-membership falsification that has carried the tenancy proof through four
   phases is _entirely about which organisation a session is scoped to_, and no
   such concept exists.
3. **Membership loading.** `membershipFor` is a pure function over a list nobody
   fetches.
4. **Correlation id.** Every repository write accepts one and every audit
   payload carries it when present. In production nothing would set it, so
   audit entries would be uncorrelatable.

## Duplication to remove

- `SESSION_COOKIE` is declared twice (`middleware.ts`, `require-session.ts`).
- Verification must not fork: one low-level verifier, wrappers for the three
  entry points (API route, server action, server component).

## Ad hoc identity construction

| Site                            | What it does                                                               |
| ------------------------------- | -------------------------------------------------------------------------- |
| `workspace/cases/[id]/page.tsx` | passes empty credentials — honest, and the reason two panels show refusals |
| `/api/analyze`, `/api/chat`     | uses `accountId` where `actorId` is meant                                  |
| `audit-panel.tsx`               | receives `accountId` and `memberships` as props from the route             |

No route parses the session cookie independently today. That property is worth
keeping and is enforced statically in this phase.

## Consequence for the ADR

An active-organisation mechanism has to be chosen, not discovered. Nothing
constrains it, which means nothing will catch a bad choice later — the reason
ADR-004 is written before the code rather than after it.

## Obligation 2 inventory: the production switch action

Measured 2026-07-27 against `6b59dd2`, before any refactor.

### Sequence as implemented

| #   | Step                                         | Line  |
| --- | -------------------------------------------- | ----- |
| 1   | `resolveServerSession()`                     | 48    |
| 2   | `headers()` → origin/host, inline comparison | 53–63 |
| 3   | target id shape check, inline regex          | 65    |
| 4   | `loadMemberships()`                          | 69    |
| 5   | target lookup, **inline `.find()`**          | 70    |
| 6   | `cookies()` → previous selection             | 73–74 |
| 7   | idempotency check                            | 78    |
| 8   | audit append                                 | 85    |
| 9   | cookie issued                                | 109   |

### Two findings that change the shape of obligation 2

**1. The action does not call the rules that were proved.**

`maySwitchTo` and `maySwitchFrom` live in `packages/auth/src/tenant-resolution.ts`
and are proved by pure tests. **Neither is imported by the action.** Step 5 is an
inline `.find()`; step 2 is an inline origin comparison.

So ST-G7 and ST-G11 are not merely honoured on pure-rule rather than
production-path evidence — they are honoured on evidence from _functions the
production action never executes_. Two implementations already exist; the
constraint against creating one is retrospective.

The two implementations differ:

- `maySwitchTo` requires `removedAt === null`; the inline `.find()` does not.
  Not exploitable today because `loadMemberships` filters `removed_at IS NULL`
  in SQL — but revocation then rests on that single filter, with no second
  mechanism. The opposite of the two-mechanism property found in `4A′`.
- `maySwitchFrom` requires `method === "POST"`; the action asserts no method.
  Server actions are POST by framework, which is an assumption the action does
  not state and no test checks.

**2. Ordering differs from the target sequence.** Session resolution precedes
origin validation. Both must pass, so this is not a defect — but an
unauthenticated cross-origin request performs a session lookup it did not need.
The obligation-2 order puts origin first.

### The read seam

`packages/integration/test/authentication/membership-read-seam.test.ts` proves
the instrument before it is pointed at the action: it wraps the real PostgreSQL
loader, counts entries, revokes immediately before the delegated query, and is
shown to separate a fresh-reading core from a snapshot-reusing one — including a
case where both cores return the same outcome and only the read count differs.

That last test exists because of the Phase 4A′ finding that a property enforced
by two mechanisms cannot be attributed to either by observing outcomes.

## Obligation 2 outcome

The seven defects listed above are resolved. `switchOrganisationCore` in
`packages/auth/src/switch-core.ts` is the one implementation; the exported
action in `apps/web/src/lib/auth/switch-organisation.ts` is a thin adapter that
reads `headers()` and `cookies()`, wires production dependencies, and delivers
the cookie the core returns. The inline `.find()` and origin comparison are
deleted.

**Method semantics.** Next.js 16.2.12 dispatches server actions on POST only —
every branch of `getServerActionRequestMetadata`
(`next/dist/server/lib/server-action-request-meta.js`) tests
`req.method === 'POST'` — and `headers()` exposes no method. The trusted adapter
therefore states POST and `maySwitchFrom` verifies it, so a framework change
fails closed. No caller-supplied method reaches the rule.

**Ordering.** Invocation authorisation now runs _before_ session resolution and
any database work, proved by asserting zero session lookups, membership loads,
audit writes and cookie serializations on ten invalid invocations.

**Revocation is defence in depth again.** The SQL filter excludes removed rows
and `maySwitchTo` independently requires `removedAt === null`. Both execute on
the production path.

### Two limitations recorded rather than solved

**A same-host scheme change passes `maySwitchFrom`.** The rule compares hosts,
so `http://` against an `https://` host is accepted. Transport security is
configuration, not this rule, and the test states that instead of implying
coverage.

**A cookie-delivery failure after a committed audit is not idempotent.** The
entry exists, the browser preference is unchanged, the caller stays on the old
organisation — and a retry writes a second audit entry, because the core cannot
see that the first attempt's cookie never arrived. Measured, not redesigned. No
database–cookie atomicity is claimed.

### Why one falsification could not bite behaviourally

Replacing `maySwitchTo` with an inline `.find()` changes no outcome: the loader
already filters removed rows in SQL, and `.find()` returns undefined for a
malformed id. Both of the rule's extra checks are absorbed upstream, so
behaviour cannot distinguish the rule from a copy — which is exactly how the
action drifted in the first place. A structural guard now asserts the core
imports and calls both rules and that neither core nor adapter holds an inline
lookup or origin comparison.

## Obligation 3 — session entry equivalence and the emitted cookie

Two questions, deliberately answered together: do all the ways into the
application agree about who you are, and what does the server actually send when
you switch organisation.

### The opening question: can two cookie access paths disagree?

They cannot, and the reason is structural rather than fortunate.
`NextRequest.cookies` and the jar returned by `cookies()` from `next/headers`
are the **same `RequestCookies` class** from Next's vendored
`@edge-runtime/cookies`. One parser stands behind both. Its `parseCookie` builds
a `Map` in header order, so for a repeated cookie name the **last** occurrence
wins, and a value whose percent-encoding will not decode is **silently dropped**
by a `decodeURIComponent` inside an empty `catch` rather than reported.

Both behaviours are inherited, not chosen. Both are now asserted, so a future
Next upgrade that changes either fails a test instead of changing who is
authenticated.

There is therefore no authorisation split at the cookie layer.

### The inconsistency was one layer up

The harness was expected to confirm equivalence. It found a real divergence
instead — not in cookie parsing, but in what the application did with the token
afterwards. Three separate places each held their own copy of the same sequence:
read the token, look up the session, call `checkSession`, handle replay, refuse.
They had already begun to drift: `requireSession` collapsed an expired session
into the same answer as an absent one, while `resolveServerSession`
distinguished them.

Agreement between three copies is a property that must be re-established every
time one of them is edited. Agreement between three callers of one function is a
property of the code. `packages/auth/src/session-verdict.ts` is that function;
`requireSession`, `resolveServerSession` and `resolveTenant` now call it.

This is the redesign the brief permits only on proof of an actual inconsistency.
The proof is above.

### Equivalence, defined

Two entry points agree when, for the same session state, they reach the same
**authentication verdict**, resolve the same **account**, and classify the
refusal into the same **public class**. Eleven vectors were run through the
shared verifier, the tenant resolver and the switch path against real `sessions`
rows.

Public class deliberately collapses `absent` and `unauthenticated` into one
answer, `sign_in`, while keeping `expired` and `replayed` distinct. A caller
who sent no cookie and one who sent an unrecognised token must both sign in;
telling them apart is a disclosure with no use to the caller.

Session failures are also kept separate from tenancy failures. A dual-membership
account with no stated preference gets `selection_required` — a _tenancy_
answer, reached only because the session was **accepted**. Reading that as a
refusal would have reported an authorisation split that does not exist.

### The expiry boundary

Measured under a controlled clock at three points — before expiry, exactly at
the expiry instant, and after — and identical at all three across every entry
point. Exactly at expiry is a refusal.

### The active-organisation fallback

A preference is a preference, never an authority. A valid one selects its
organisation; a missing one with several memberships yields `selection_required`
rather than a first-row default; an unsigned one is ignored entirely; a revoked
membership stops being effective on the next request; and a real-but-inaccessible
organisation is refused **identically** to a nonexistent one, so identifiers
cannot be walked to discover which organisations exist.

### What the server actually emits

Parsed from the emitted header rather than read off the constants that build it:

    legalos_active_org=<id>.<mac>; Path=/; Max-Age=2592000; HttpOnly;
    SameSite=Lax; Secure

`Secure` is **environment-dependent** — the adapter sets
`secure: process.env.NODE_ENV === "production"`, so the development header
genuinely lacks it. Both configurations are measured; neither is presented as
universal. Every other attribute is identical between them.

The value carries an organisation id and a MAC, and nothing else: no account id,
name, role, permission set, membership list or session token.

**No cookie at all** is emitted on a refused target, a cross-origin invocation,
a failed audit, or a switch to the organisation already active. The last of
those is a success that correctly produces no mutation.

Identifiers carrying `;`, CR or LF were refused before serialization, and the
signer independently emits no delimiter, so a header cannot be split or given
attributes the adapter never chose. Submitted `httpOnly`, `secure`, `sameSite`,
`path`, `maxAge` and `domain` fields did not reach the header.

### Four separate things, not one

Stating them apart because conflating them is how cookie claims become untrue:

1. **What the server emits.** Measured above.
2. **What a browser stores and returns.** _Not measured._ A property of a user
   agent; no server-side test can establish it. `HttpOnly` and `SameSite` are
   requests to the client, and this evidence does not show any client honouring
   them.
3. **Route-level authorisation equivalence.** Measured, for the three entry
   points reachable from `packages/`.
4. **Switch invocation policy.** Same-origin POST, proved in obligation 2.

### Two limits found by falsification, and what was done

**A second mechanism absorbed a mutation.** Weakening `selectOrganisation`'s
membership test changed no outcome, because `governingMembership` refuses the
same preference immediately afterwards. An outcome-only harness reports the
surviving check's answer as though both were intact. This is the two-mechanism
problem for the third time in this programme. The harness now asks the rule
directly and compares its answer with the resolved one, so weakening either
mechanism is a visible disagreement.

**Two entry points were out of behavioural reach.** Nothing under `packages/`
may import `apps/web`, so `requireSession` and `resolveServerSession` are absent
from the vector table. Two real mutations proved the gap rather than assuming
it: making `requireSession` admit an `expired` verdict, and making
`resolveServerSession` read the _first_ duplicate cookie while every other path
reads the last. Both left all seven tests passing.

> **Corrected in obligation 4.** Only the first of those two mutations shows
> what it was said to show. Run against a live server, the duplicate-cookie
> mutation again changed nothing, which prompted a direct check of the parser:
> `RequestCookies` over a `Cookie` header carrying one name twice reports
> `size` 1, and `getAll(name)` returns a single value — the last. Duplicates are
> collapsed into a Map before any application code can look, so
> `getAll(name)[0]` **is** `get(name)` and that mutation was inert, not merely
> unobserved. The correction strengthens the finding rather than weakening it:
> no application code can select a different duplicate, because by the time it
> runs there is only one value to select. The `requireSession` mutation is
> unaffected — it is real, it is out of reach from `packages/`, and it is why
> the structural guard and its recorded limitation stand. A structural guard now
> asserts that neither makes its refusal conditional on which refusal it is, and
> that neither selects among duplicate session cookies itself. A structural guard
> is the weaker instrument; it is used here only because the stronger one is
> architecturally out of reach, and that is stated rather than glossed.

## Obligation 4 — development smoke

The contract is `docs/DEVELOPMENT_SMOKE.md`; this records what running it found.

`pnpm smoke:dev` starts the real Next.js development server on an ephemeral
port, drives real HTTP through it, and shuts it down. **37 cases, 36 mandatory,
about 4.3 seconds.** It is the first behavioural observation of this application
on the `apps/web` side of the dependency boundary.

### Session seeding: canonical persistence

The existing `/api/auth/dev-session` route is a real development facility and the
smoke exercises it — but it cannot authenticate these cases. It creates its
account at `pending_recovery`, and the schema constraint
`active_accounts_can_be_recovered` forbids promoting an account to `active`
without a recovery factor. A non-active account resolves no tenancy, and that
account has no membership to resolve into.

Weakening the route or the constraint to make it convenient was the wrong trade.
The smoke instead writes an account, three organisations, two memberships and two
sessions through the same canonical functions the application uses, and then
makes the application consume them over real HTTP. No cookie is hand-forged, no
signature check is skipped, no permanent bypass is added.

### What the runtime confirmed

Both framework entry points authenticate the same session and resolve the same
account, through one real request. Duplicate cookies resolve last-wins at
runtime — unknown-then-valid authenticates, valid-then-unknown refuses, and
alpha-then-beta resolves beta — so **the framework agrees with the obligation-3
harness**. Expired sessions are refused. Active-organisation behaviour matches
obligation 3 exactly: no preference with two memberships requires a selection, a
valid preference resolves it, inaccessible and nonexistent are refused
identically, an unsigned preference is ignored, and a revoked membership stops
being effective on the next request. Submitted `x-account-id`, `x-actor-id`,
`x-organisation-id` and `x-role` headers changed nothing.

### A real defect, found by running it

`/api/auth/start` and `/api/auth/verify` were not in the middleware's public
list, so **the gate returned 401 to every unauthenticated caller of the two
endpoints whose entire purpose is to serve unauthenticated callers.** Sign-in
could not be started and its code could not be verified.

Nothing caught it because nothing crosses this boundary: the middleware only
runs inside a real server. The smoke found it by observing 401 where it expected
the delivery-provider response. Both paths are now public, and a test asserts it.

### The two-mechanism problem, fourth occurrence

The middleware answers a _missing_ cookie itself, with `code: "UNAUTHENTICATED"`.
So "an unauthenticated request is refused" proves the edge check and says nothing
about the route behind it — a mutation making the route accept a missing session
left every case passing.

The fix is obligation 3's: ask a question only one mechanism can answer. A
well-formed cookie naming no session passes the shape test, so its refusal must
come from the route. The smoke now records which layer refused each vector:
missing → middleware, malformed → middleware, unknown → route.

### A correction to obligation 3

Obligation 3 recorded two mutations as evidence that the framework entry points
were out of behavioural reach. Only one of them shows that.

Run against a live server, making `resolveServerSession` read
`getAll(SESSION_COOKIE)[0]` again changed nothing — which prompted a direct
check of the parser rather than a second assumption. `RequestCookies` over a
`Cookie` header carrying one name twice reports `size` 1, and `getAll(name)`
returns a single value: the last. **Duplicates are collapsed into a Map before
any application code can look, so `getAll(name)[0]` is `get(name)` and that
mutation was inert, not merely unobserved.**

The correction strengthens the finding. No application code can select a
different duplicate, because by the time it runs there is only one value to
select. The `requireSession` mutation is unaffected — it is real, it is out of
reach from `packages/`, and it is why the structural guard and its recorded
limitation stand.

### Defects in the runner itself, found and fixed

Three, each measured rather than reasoned about. Cleanup was guarded on a
completed seed, so a seed that threw halfway left its rows behind — cleanup is
now unconditional. Cleanup attempted `DELETE FROM audit_log`, which a BEFORE
DELETE trigger refuses by design, aborting cleanup entirely — audit rows are now
counted and retained, with isolation by test database and per-run tag instead.
And the first process-leak falsification hung rather than failing, because a
child with piped stdio keeps the runner's own event loop alive.

A fourth was found in the design: Next rewrites the **tracked**
`apps/web/tsconfig.json` on every dev start to add an include entry for its
build directory, so a per-run directory appended two lines every single run.
Fifteen runs had already added thirty. The smoke now uses one stable
`.next-smoke`, which adds them once.

### Limitations

**The switch server action is not invoked live.** No component renders it, and
calling one over HTTP means reproducing the `Next-Action` protocol and a
build-time action id. The smoke proves the downstream half — a signed
active-organisation cookie of exactly the form the adapter emits is honoured by
the next real request — and leaves the adapter to obligations 2 and 3.

**Exact-at-expiry is not observed live**; the boundary instant stays proved
under a controlled clock in the obligation-3 harness.

**Production sign-in behaviour is not observed.** `/api/auth/start` returns 503
only under `NODE_ENV === "production"`; a development smoke cannot reach that
branch and records the development one it saw.

**Two smokes cannot run at once.** The second meets Next's own build-directory
lock and fails at startup with the first server's pid — clearly, not silently.

**One configuration, once.** This is evidence that the system runs, not that it
always will, and it does not replace the obligation-3 guards or harnesses.
