# Database

## Principle

**Design around the case, not the user.**

```
Organization
  → Workspace
    → Client
      → Case
        → Timeline
        → Evidence
        → Documents
        → Tasks
        → AI Analysis
        → Human Review
        → Submission
```

## AI-first evidence model

Files become linked knowledge:

```
Passport → Identity → Visa → Expiry → Timeline → Risk → Evidence → Legal Issue
```

Relationships matter more than isolated PDFs.

## Technology (v0.2 target)

| Store                          | Use                           |
| ------------------------------ | ----------------------------- |
| PostgreSQL                     | System of record              |
| pgvector                       | Embeddings / RAG chunks       |
| Object storage (S3-compatible) | Original documents            |
| Neo4j (optional)               | Evidence / issue graph        |
| Redis                          | Sessions, rate limits, queues |

## Core entities

See TypeScript sketches in `packages/database`.

## Audit

Every AI and human decision writes an append-only audit row with:

- actor (user or agent)
- case id
- action
- payload hash
- timestamp
- correlation id
