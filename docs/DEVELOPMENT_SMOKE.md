# Development smoke

`pnpm smoke:dev`

The first behavioural observation of this application across the `apps/web`
boundary. Everything else in this repository tests `packages/`; nothing under
`packages/` may import `apps/web`, so the framework entry points —
`requireSession`, `resolveServerSession`, the middleware — had never been
observed running. This starts the real Next.js development server, drives real
HTTP requests through it, and shuts it down.

## What it is not

- **Not end-to-end browser certification.** No browser is involved. Nothing here
  shows that a client stores a cookie, honours `HttpOnly`, or renders anything.
- **Not proof of production configuration.** It runs one machine's development
  build against a test database. It says nothing about a deployment.
- **Not a replacement for the obligation-3 structural guards or harnesses.** A
  smoke observes one configuration once; a guard holds on every commit. It adds
  a stronger instrument alongside the weaker one — it does not retire it.
- **Not part of `pnpm test`.** It starts a server and needs a database. It is a
  separate command, run deliberately.

## Contract

|                 |                                                                                                                               |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Process started | `next dev --port <ephemeral> --hostname 127.0.0.1`, spawned as a child, stdout and stderr captured                            |
| Environment     | `NODE_ENV=development`, no production credential read or required                                                             |
| Build directory | `.next-smoke`, so a developer's own `pnpm dev` is neither disturbed nor blocking                                              |
| Database        | `SMOKE_DATABASE_URL`, else `TEST_DATABASE_URL`; admitted only by the canonical `assertTestDatabase` guard                     |
| Session         | seeded through canonical persistence, consumed over real HTTP (see below)                                                     |
| Port            | ephemeral, allocated by binding port 0 and releasing it                                                                       |
| Readiness       | polling `/api/health` on a bounded deadline — never a fixed sleep                                                             |
| Shutdown        | `SIGTERM`, then `SIGKILL` after 5s; liveness read back afterwards                                                             |
| Cleanup         | tag-scoped deletes on success, failure and interruption                                                                       |
| Evidence        | `docs/smoke-evidence/development-smoke.json`                                                                                  |
| Gate            | `pnpm check:smoke`, fail-closed                                                                                               |
| Exit            | `0` all mandatory cases passed and cleanup succeeded · `1` a case or cleanup failed · `2` preflight refused, nothing launched |

### Prerequisites

1. `pnpm install`
2. A PostgreSQL database whose name ends in `_test`, reachable, migrated:
   `TEST_DATABASE_URL=... pnpm test:db:setup`
3. Node 22+
4. No other `next dev` using the `.next-smoke` build directory. A developer's
   ordinary `pnpm dev` on `.next` is fine and unaffected; a second _smoke_ fails
   clearly at startup with the first server's pid.

No message-delivery provider, AI gateway, or deployed secret is needed. The
smoke sets its own `SESSION_SIGNING_KEY` and blanks the AI gateway variables so
no external service can be contacted.

## Session seeding

**Strategy: canonical persistence.** The smoke writes an account, two
organisations it belongs to, one it does not, two memberships and two sessions
directly through the same functions the application uses — `issueToken`,
`hashToken`, `signSelection` — and then makes the application consume them over
real HTTP. No cookie is hand-forged, no signature check is skipped, and no
permanent bypass is added.

**Why not the existing `/api/auth/dev-session` route.** It is a genuine
development-only facility and the smoke exercises it as one — but it cannot
authenticate the cases this obligation needs. It creates its account at
`pending_recovery`, and the schema constraint `active_accounts_can_be_recovered`
forbids promoting an account to `active` without a recovery factor. A non-active
account resolves no tenancy, and that account has no membership to resolve into.
It can prove a session is issued and accepted; it cannot prove anything about
tenancy, organisation selection or switching. Weakening either the route or the
constraint to make it convenient was the wrong trade.

**Why not the normal sign-in flow.** No message-delivery provider is configured.
The smoke observes that path's real behaviour rather than depending on it.

## What is exercised

| Route                   | Why                                                           |
| ----------------------- | ------------------------------------------------------------- |
| `/api/health`           | readiness                                                     |
| `/`                     | a public route serves                                         |
| `/api/analyze`          | a real route behind `requireSession`                          |
| `/api/dev/identity`     | both framework entry points in one request (development-only) |
| `/workspace`            | a protected page, middleware redirect                         |
| `/api/auth/start`       | delivery-provider behaviour                                   |
| `/api/auth/dev-session` | the existing development session facility                     |

### The diagnostic route

`/api/dev/identity` returns what `requireSession` and `resolveServerSession`
_each independently_ resolved for one request, so the smoke can compare them at
runtime rather than by reading source. It is development-only (404 in
production, keyed off `NODE_ENV` like the dev-session route and the CSP
relaxation), requires a valid session, and returns only truncated SHA-256
digests of identifiers — enough to answer "did these two agree", never enough to
disclose who. Its production refusal is covered by a test.

## Two mechanisms, again

The middleware answers a _missing_ cookie itself, with `code: "UNAUTHENTICATED"`.
So "an unauthenticated request is refused" proves the edge check and says
nothing about the route behind it — a mutation making the route accept a missing
session left every case passing.

This is the two-mechanism problem for the fourth time in this programme, and the
fix is the same as obligation 3's: ask a question only one mechanism can answer.
A well-formed cookie naming no session passes the shape test, so its refusal must
come from the route. The smoke records which layer refused each vector.

## Limitations, measured rather than assumed

**The switch server action is not invoked live.** No component renders it, and
calling one over HTTP means reproducing the `Next-Action` protocol and a
build-time action id. The smoke proves the downstream half — that a signed
active-organisation cookie of exactly the form the adapter emits is honoured by
the next real request — and leaves the adapter itself to
`switch-production.test.ts` and `set-cookie-observation.test.ts`.

**Exact-at-expiry is not observed live.** The smoke sees valid versus expired.
The boundary instant is proved under a controlled clock in
`session-equivalence.test.ts`.

**Production sign-in behaviour is not observed.** `/api/auth/start` returns 503
only when `NODE_ENV === "production"` and no provider is configured. In
development it returns the code it would have delivered. A development smoke
cannot reach the production branch; it records the development one it saw.

**One configuration, once.** Everything here is a single observation on one
machine. It is evidence that the system runs, not that it always will.
