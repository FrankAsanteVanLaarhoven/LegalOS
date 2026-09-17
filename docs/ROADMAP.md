# LegalOS Roadmap

## Foundation — v0.1.0 (tagged)

- Marketing site and Mission Control demo UI
- Multi-agent product narrative
- Multilingual / plain English modes
- Theme, utilities, public legal resources
- Film library with unique placement

## Core Platform — v0.2.0 (current focus)

| Workstream     | Deliverable                                   |
| -------------- | --------------------------------------------- |
| Authentication | Email + SSO (enterprise), sessions, MFA path  |
| Organizations  | Multi-tenant orgs (firms, NGOs, universities) |
| Case Workspace | Persistent cases (not demo-only)              |
| User Profiles  | Clients, advisers, solicitors, admins         |
| Database       | PostgreSQL + pgvector + audit tables          |
| AI Framework   | Structured agent I/O, SpaceXAI, tools         |
| Infrastructure | Environments, secrets, observability          |

```
v0.2.0
│
├── Authentication
├── Organizations
├── Case Workspace
├── User Profiles
├── Database
├── AI Framework
└── Infrastructure
```

## v0.2.x — Verification foundation (landed)

| Layer                  | Package                 | State                                           |
| ---------------------- | ----------------------- | ----------------------------------------------- |
| Knowledge / provenance | `@legalos/knowledge`    | Landed — every seeded source ships `unverified` |
| Legal engineering      | `@legalos/rules`        | Landed — three-valued executable workflows      |
| Verification engine    | `@legalos/verification` | Landed — fail-closed, wired into both AI routes |
| Reliability metrics    | `@legalos/reliability`  | Landed — measured metrics, no per-answer score  |
| Governance / audit     | `@legalos/governance`   | Landed — hash chain + approval state machine    |
| Fiduciary duties       | `@legalos/fiduciary`    | Landed — confidentiality, conflicts, candour    |
| LegalOS Bench          | `@legalos/bench`        | Landed — safety envelope suite                  |
| Database               | `@legalos/database`     | Landed — schema, migrations, durable audit      |

### Next, in dependency order

1. **Authentication and rate limiting.** Nothing else should ship first: there
   is currently no session check on any route, and a persistent case store
   behind an unauthenticated `getCaseById` would expose special-category data.
2. **Source verification.** Retrieve, version and checksum the seeded sources so
   the registry can serve `verified` entries. Until then every citation is
   correctly reported as unresolved, and no legal conclusion is releasable —
   the system is safe but not yet useful for substantive answers.
3. **Retrieval.** Ingestion and embeddings over `source_chunks`, so the
   verification layer resolves citations against real retrieved text.
4. **Rule locators.** Fill in the paragraph references in
   `SKILLED_WORKER_SWITCH`; this is a sourcing task, not a coding task.
5. **Bench expansion.** Substantive legal-accuracy tasks, once (2) and (3) make
   it possible to score against law that has actually been checked.

## v0.3.0 — Evidence intelligence

- Document upload, OCR, classification
- Evidence graph persistence
- Completeness scoring productionised
- Deadline engine

## v0.4.0 — Human-in-the-loop production

- Solicitor review queues
- Approval gates for reserved activities
- Immutable audit export
- Privilege / sharing controls

## v0.5.0 — Multilingual access

- Speech STT/TTS
- Translation QA
- Low-literacy modes

## v1.0.0 — Legal Intelligence OS

- AI case workspaces
- Evidence intelligence
- Multilingual support
- Workflow automation
- Human-in-the-loop review
- Enterprise security
- Explainable legal reasoning
- Full audit trails

This is a stronger objective than “building a legal chatbot.”
