# ADR-001: Deployment target

**Status:** Proposed — awaiting a decision that is not the engineering team's to
make alone.
**Date:** 2026-07-27

## Purpose

LegalOS can measure deployment readiness and has no deployment target. This
records the options, the trade-offs, and the criteria — and, at the end, the
mechanism by which the decision becomes observable rather than merely written
down.

## Requirements

Must support immutable deployments, PostgreSQL, persistent storage, append-only
audit tables, secret management, rollback, HTTPS, custom domains, health checks,
deployment automation and operational logging.

Preferred: infrastructure as code, autoscaling, private networking, managed
database, managed backups, monitoring.

## One requirement that is not deferrable

The original draft placed **geographical region** under deferred decisions. For
this platform it is not deferrable, and it narrows the options before any of the
other criteria are weighed.

LegalOS holds asylum evidence: medical reports, trafficking accounts, documents
naming people still in the country somebody fled. Where those bytes physically
rest, and which government can compel access to them, is a property of the case
file rather than of the infrastructure. A provider that cannot guarantee a
specific region, or whose support operations routinely access customer data from
elsewhere, is unsuitable at any price.

Concretely, the deployment target must offer:

- a UK or EEA region that can be pinned, not a "multi-region" default
- a contractual position on lawful access requests
- backups that stay in the same jurisdiction as the primary
- support access that is logged and can be refused

This does not select a provider. It removes some, and it belongs in the
requirements rather than in a later ADR, because choosing a target first and
discovering the residency constraint afterwards means choosing twice.

## Options

|                       | Operational simplicity | Scalability | High availability | Control | Disaster recovery | Cost   | Maturity |
| --------------------- | ---------------------- | ----------- | ----------------- | ------- | ----------------- | ------ | -------- |
| A. Single VPS         | High                   | Low         | Low               | High    | Low               | High   | Medium   |
| B. Managed containers | High                   | Medium      | Medium            | Medium  | Medium            | Medium | High     |
| C. Kubernetes         | Low                    | High        | High              | High    | High              | Low    | High     |
| D. Hybrid             | Medium                 | High        | High              | High    | High              | Medium | High     |

**A — Single VPS.** Lowest cost, simplest, complete control. Single point of
failure, manual scaling, backups and failover. Suitable for a pilot; not for
regulated production.

**B — Managed containers.** Managed scaling, networking and deployment; low
operational overhead. Provider lock-in, less infrastructure control, cold starts
on some platforms.

**C — Kubernetes.** Most flexible, horizontal scaling, workload isolation. Real
operational complexity and a maintenance burden that needs someone whose job it
is.

**D — Hybrid.** Application on Kubernetes, managed database and object storage.
Resilient and scalable; highest cost and complexity.

## Current state

The architecture requires PostgreSQL, append-only audit storage, immutable
execution records and readiness verification. It does **not** currently require
horizontal scaling, distributed execution, orchestration, a service mesh or
multi-region deployment.

No measurement in this repository demonstrates a need for Kubernetes. There is
one application, zero recorded executions and no load. Choosing C now would be
selecting infrastructure for a workload nobody has observed.

## Recommendation

**Managed container platform with managed PostgreSQL**, in a pinned UK or EEA
region.

It meets the current requirements, keeps the operational burden proportionate to
a platform with no production traffic, supports the deployment evidence and
rollback workflows already built, and preserves a migration path to C if
measured load ever justifies it.

This is a recommendation, not a decision. Selecting it commits money, a vendor
relationship and a jurisdiction — none of which is an engineering call, and the
last of which affects the people whose evidence the platform holds.

## Re-evaluate when

Sustained load exceeds the platform's limits; several independently deployable
services emerge; availability requirements harden; measured operational evidence
shows a need for orchestration; multi-region becomes a requirement.

Re-evaluation on measured evidence, not on anticipated need. That rule is the
same one applied to model routing, and for the same reason.

## Deferred

Cloud provider, networking topology, monitoring stack, CDN, secret-management
platform. Region is **not** deferred, per above.

## Making this ADR observable

An ADR describes an intended state. Left there, it drifts: the deployment ends
up on a colocated database, or an unencrypted connection, and the document goes
on describing a system that stopped existing.

So the assumptions are declared in `packages/readiness` as a deployment profile,
and the readiness checks verify the live environment against them:

| Assumption                                 | Check                         | How                                  |
| ------------------------------------------ | ----------------------------- | ------------------------------------ |
| A profile exists and names this ADR        | `deployment_profile_declared` | Structural                           |
| The database connection is encrypted       | `database_encrypted`          | `pg_stat_ssl` on the live connection |
| The database is not colocated with the app | `database_managed`            | Connection host is not loopback      |
| A health endpoint responds                 | `health_endpoint`             | HTTP probe when `HEALTH_URL` is set  |

Three assumptions are **not** machine-checkable from inside the application, and
are recorded as such rather than given a check that would pass without asking
anything:

- **Region.** The application cannot establish where its database physically
  sits. This is verified at procurement and in the provider's console, and the
  profile records the expected region so a human comparison is possible.
- **Backups.** Whether managed backups are enabled and restorable is a property
  of the provider. A restore test is the only real check, and it is an
  operational exercise rather than a probe.
- **Immutable deployments.** Whether a platform replaces rather than mutates
  instances cannot be observed from within one.

Writing weak checks for these would be worse than having none. A green tick
against "backups enabled" that only confirmed a config flag would be read as
"backups work", and the first time anyone needed that to be true would be the
worst possible moment to discover the difference.

## Next steps, once a target is chosen

Provision, configure PostgreSQL and secrets, run
`pnpm check:readiness:deployment`, deploy, produce the first release evidence
record, perform the first authenticated production request, and verify audit,
execution and readiness evidence end to end.

Steps 5 to 7 are the ones that turn this platform from architecturally complete
into operationally evidenced.
