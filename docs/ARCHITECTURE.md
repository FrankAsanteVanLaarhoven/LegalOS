# Architecture

## System shape (target monorepo)

```
LegalOS-AI
├── apps/
│   ├── web/          # Public + workspace Next.js app
│   ├── admin/        # Ops console (future)
│   └── mobile/       # Future
├── packages/
│   ├── ui/
│   ├── auth/
│   ├── ai/
│   ├── legal/
│   ├── database/
│   ├── agents/
│   ├── workflows/
│   └── shared/
├── services/
│   ├── ingestion/
│   ├── search/
│   ├── embeddings/
│   └── notifications/
├── docs/
├── benchmarks/
├── datasets/
├── infrastructure/
├── scripts/
└── tests/
```

## Runtime layers

```
Presentation            apps/web (Next.js App Router)
        |
Agent orchestration     packages/agents
        |
Verification            packages/verification   <- nothing reaches a user unchecked
        |
Legal reasoning         packages/rules          <- law as executable workflows
        |
Knowledge               packages/knowledge      <- sources with provenance
        |
Fiduciary + governance  packages/fiduciary, packages/governance
        |
Data                    packages/database (PostgreSQL + pgvector)
        |
Human review            approval state machine, reserved activities
```

The load-bearing idea is that **the verification layer sits between the model
and the user, and is fail-closed**. A language model is treated as an untrusted
source of text, not as an authority:

- every citation-shaped token in model output must resolve to a registered,
  verified source, or the output is not releasable;
- outcome guarantees, numeric confidence, and advice to proceed without a
  solicitor are withheld outright;
- an eligibility claim that disagrees with the deterministic rule engine is
  withheld;
- what remains is returned marked `verified: false` unless the verdict is clean.

### Why there is no confidence percentage anywhere

`packages/reliability` separates two things that are easy to conflate:

- **Measured metrics** — citation precision and recall, hallucination rate,
  calibration error, Brier score, reviewer agreement. These are computed over
  labelled data and are legitimate because they are measured.
- **Per-answer certainty** — what resolved, what could not be verified, what
  evidence is missing, and what would change the answer. This deliberately emits
  no number, because nothing in the system produces a calibrated one.

### Three-valued legal logic

`packages/rules` evaluates requirements as `satisfied` / `not_satisfied` /
`insufficient_evidence`. The third value is the point: collapsing "we do not
have the evidence" into "you do not qualify" is how a system tells someone they
are ineligible when nobody has asked them for a payslip yet. No policy figure
(salary threshold, eligible occupation table) is hardcoded — those arrive as
evidenced facts from a verified source, and their absence yields
`insufficient_evidence` rather than a guess.

## Core principles

- **Case-centric**: every artefact links to a case
- **Human-in-the-loop**: reserved activities require a named, regulated human;
  AI proposes and never authorises
- **Explainability**: evidence → law → what could not be verified → alternatives → gaps
- **No outcome guarantees, and no fabricated certainty**
- **Audit by default**: hash-chained and append-only at the database level

Several of these are enforced in the schema rather than in application code —
see `packages/database/migrations` — because that is the only place they cannot
be bypassed.

## AI topology

```
Supervisor
├── Intake Agent
├── Immigration Agent
├── Employment Agent
├── Family Agent
├── Housing Agent
├── Research Agent
├── Evidence Agent
├── Timeline Agent
├── Translation Agent
├── Document Agent
└── Human Review Agent
```

Each agent: tools, bounded responsibilities, structured outputs, confidence, audit.

## Security posture

See [SECURITY.md](./SECURITY.md). Zero Trust direction, UK GDPR, field encryption for sensitive attributes, immutable audit.
