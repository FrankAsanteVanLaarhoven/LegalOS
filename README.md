# LegalOS — Enterprise Legal Intelligence Operating System

<div align="center">

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-16.2-black?logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node-%3E%3D20-green?logo=node.js)](https://nodejs.org/)
[![Deployment](https://img.shields.io/badge/Deploy-Vercel%20Ready-black?logo=vercel)](https://vercel.com/)
[![Regulatory Alignment](https://img.shields.io/badge/Regulatory-OISC%20%2F%20IAA%20Aligned-darkgreen)](docs/OISC_CODE_OF_STANDARDS.md)
[![Invariants](https://img.shields.io/badge/Invariants-50%20Declared-purple)](docs/INVARIANTS.md)

**A high-assurance, observable legal intelligence platform for UK immigration, protection, and public sector integration.**

[Explore Architecture](#architecture) • [Enterprise Features](#enterprise-capabilities) • [Quick Start](#quick-start) • [Vercel Deployment](#deployment) • [Regulatory Standards](#regulatory-safeguards)

</div>

---

## Executive Summary

**LegalOS** is an enterprise-grade legal intelligence operating system designed for local authorities, law firms, legal advice charities, and corporate immigration teams navigating UK immigration, asylum, and nationality casework.

Navigating immigration law carries life-altering consequences. While conventional enterprise AI tools generate fluent answers backed by unmeasured "confidence scores", LegalOS operates on **zero-trust verifiable measurement**:

* **Trust by Construction:** Every AI model execution is routed through a single append-only execution runner. Unverified claims are withheld rather than softened.
* **Falsifiable Verification Gates:** Every capability status and system invariant is derived from runtime evidence rather than developer declarations.
* **Strict Regulatory Boundaries:** Built in strict alignment with Section 84 of the **Immigration and Asylum Act 1999** and the **OISC / IAA Code of Standards**. Reserved legal activities remain exclusively with qualified human practitioners; the platform refuses rather than approximates them.

**Repository:** [FrankAsanteVanLaarhoven/LegalOS](https://github.com/FrankAsanteVanLaarhoven/LegalOS) · `0.2.0-dev`

---

## Enterprise Capabilities

### 1. Multi-Tenant Case Management & Secure Workspace
* Comprehensive workspace pages for case tracking, deadline monitoring, evidence vaults, and task management.
* Strict tenant isolation enforcing organization-scoped access control across all database repositories and context builders.

### 2. Grounded Legal Knowledge & Citation Engine
* Machine-readable legal source registry covering primary UK legislation (*Immigration Act 1971*, *Modern Slavery Act 2015*), *Immigration Rules*, *Tribunal Procedure Rules*, and Home Office guidance.
* Strict citation requirement: No model statement can reach a user without mapping to a verified legal source and specific locator.

### 3. Cryptographic Hash-Linked Audit Trails
* Every model interaction, prompt context snapshot, retrieval, and human review is logged to append-only tables linked by cryptographic hashes.
* Tamper-evident ledger supporting full execution replay and GDPR-compliant erasure with cryptographic tombstones.

### 4. Regulatory Safeguards & Human-in-the-Loop Gating
* Strict separation between automated procedural assistance and reserved legal activities.
* High-stakes submissions and representations require qualified human professional sign-off (OISC/IAA Level 2/3, SRA Solicitor, or Bar Council Barrister).
* Comprehensive documentation and structural enforcement of the [OISC / IAA Code of Standards](docs/OISC_CODE_OF_STANDARDS.md).

---

## Architecture

```
Incoming Request
       │
Middleware ─────────────────────── Fail-closed path-based security & tenant guard
       │
Session Layer ──────────────────── Verifies cryptographic session against store
       │
ExecutionRunner
       ├─ Resolve Agent ────────── Validates against AgentOS registry (refuses if unregistered)
       ├─ Resolve Provider ─────── Evidence-backed capability router (refuses without benchmark)
       ├─ Persist Retrieval ────── Snapshots ground context before model invocation
       ├─ Write Execution ──────── Append-only ledger record before API dispatch
       ├─ Call Provider ────────── Model adapter (sandboxed)
       ├─ Verification Gate ────── Deterministic validation gate (withheld, never softened)
       ├─ Write Completion ─────── Immutable record of response and tokens
       └─ Refresh Projection ───── Real-time agent reliability metrics
       │
Audit Chain ────────────────────── Hash-linked, cryptographic tombstones on erasure
       │
/trust, /trust/agents ──────────── Publicly verifiable status derived from runtime telemetry
```

---

## Repository Structure

The platform is structured as an enterprise pnpm monorepo with 33 specialized packages:

| Layer | Packages | Enterprise Purpose |
| :--- | :--- | :--- |
| **Trust & Verification** | `capabilities`, `invariants`, `verification`, `bench` | Falsifiable invariant evaluator, runtime telemetry, and citation verification |
| **Domain & Storage** | `repositories`, `database`, `evidence`, `evidence-review` | Multi-tenant schema, append-only stores, migrations, and document digests |
| **Execution Engine** | `execution`, `agentos`, `providers`, `ratelimit` | Model execution runner, capability routing, rate limiting, and failover |
| **Governance & Policy** | `fiduciary`, `governance`, `policy`, `privacy` | Regulatory boundary enforcement, GDPR erasure, consent tracking |
| **Rules & Intelligence**| `rules`, `knowledge`, `workflows`, `representation` | Legal rules engine, proposition mapping, skilled worker & asylum workflows |
| **Web Application** | `apps/web` | Enterprise Next.js 16 workspace, public landing, trust portal, case dashboard |

---

## Measured State

LegalOS measures its operational reality. Recomputed by `pnpm check:docs` on every push; a figure that drifts from what it describes fails the build.

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

*In addition to the measured table: 505 unit tests, 293 integration tests, 61 contract guarantees, 14 enforced principles, and live HTTP smoke verification ([`docs/DEVELOPMENT_SMOKE.md`](docs/DEVELOPMENT_SMOKE.md)).*

---

## Quick Start

### Prerequisites
* **Node.js**: `>= 20.0.0`
* **pnpm**: `^10.20.0`
* **Docker & Docker Compose** (for local PostgreSQL)

### Setup & Run Locally

```bash
# 1. Install dependencies
pnpm install

# 2. Start PostgreSQL container
docker compose up -d

# 3. Apply migrations
DATABASE_URL=postgres://legalos:legalos@localhost:5433/legalos \
  pnpm --filter @legalos/database migrate

# 4. Bootstrap demonstration tenancy
pnpm bootstrap

# 5. Launch development server
pnpm dev
# Server ready at http://localhost:3011
```

---

## Deployment

LegalOS is enterprise deployment-ready for cloud platforms and Vercel.

### Deploying on Vercel

The monorepo includes a pre-configured [`vercel.json`](vercel.json) at the repository root.

1. Import **[FrankAsanteVanLaarhoven/LegalOS](https://github.com/FrankAsanteVanLaarhoven/LegalOS)** into your Vercel Dashboard.
2. Keep the **Root Directory** as `./` (default).
3. Configure Environment Variables (optional for demonstration mode):
   * `DATABASE_URL`: PostgreSQL connection string (Neon, Supabase, Vercel Postgres, AWS RDS).
   * `XAI_API_KEY`: Model provider key (optional).
4. Click **Deploy**.

### Production Enterprise Hosting
For regulated UK data environments, see [ADR-001: Deployment Target](docs/adr/ADR-001-deployment-target.md) detailing containerized deployment with pinned UK/EEA residency for sensitive immigration records.

---

## Verification & Automated Checks

```bash
pnpm check:invariants     # Evaluates all 50 invariants against the instance
pnpm check:principles     # Validates executable design principles
pnpm check:readiness      # Evaluates measured deployment prerequisites
pnpm check:docs           # Enforces zero-drift documentation metrics
pnpm check:contracts      # Validates repository contract guarantees
pnpm smoke:dev            # Drives 37 live HTTP cases through the Next.js server
pnpm assess               # Research-engineering assessment suite
```

---

## Documentation Directory

| Document | Description |
| :--- | :--- |
| [`PRINCIPLES.md`](PRINCIPLES.md) | Enforced design principles and code verification |
| [`docs/OISC_CODE_OF_STANDARDS.md`](docs/OISC_CODE_OF_STANDARDS.md) | OISC / IAA regulatory standards, adviser levels & conduct rules |
| [`docs/INVARIANTS.md`](docs/INVARIANTS.md) | The 50 system invariants, outcomes, and falsification rules |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Comprehensive system architecture and subsystem boundary guide |
| [`docs/PRODUCT_DOMAIN.md`](docs/PRODUCT_DOMAIN.md) | Domain structures for UK migration, citizenship, and integration |
| [`docs/OPERATOR_RUNBOOK.md`](docs/OPERATOR_RUNBOOK.md) | Production operation runbook and evidence verification matrix |
| [`docs/DEVELOPMENT_SMOKE.md`](docs/DEVELOPMENT_SMOKE.md) | HTTP smoke suite specification and contract guarantees |
| [`docs/adr/`](docs/adr/) | Architecture Decision Records (ADRs) |
| [`docs/KNOWN_DEFECTS.md`](docs/KNOWN_DEFECTS.md) | Transparent inventory of understood, unaddressed engineering debt |

---

## License & Compliance

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for more information.

> **Regulatory Notice:** LegalOS is software infrastructure for organizations and legal practitioners. It does not provide legal advice under Section 84 of the Immigration and Asylum Act 1999. All reserved legal activities remain with qualified, regulated human professionals.
