# API

## Current (demo web)

| Route               | Purpose                         |
| ------------------- | ------------------------------- |
| `POST /api/chat`    | Case-aware assistant (SpaceXAI) |
| `POST /api/analyze` | Structured analysis             |
| `GET /api/weather`  | London 7-day forecast           |
| `GET /api/currency` | GBP FX conversion               |

## v0.2 planned surface

### Auth

- `POST /v1/auth/login`
- `POST /v1/auth/logout`
- `GET /v1/auth/me`

### Organizations & workspaces

- `GET/POST /v1/orgs`
- `GET/POST /v1/workspaces`

### Cases

- `GET/POST /v1/cases`
- `GET/PATCH /v1/cases/:id`
- `GET /v1/cases/:id/timeline`
- `GET/POST /v1/cases/:id/evidence`
- `GET/POST /v1/cases/:id/documents`
- `GET/POST /v1/cases/:id/reviews`

### Agents

- `POST /v1/cases/:id/agents/:agentId/run`
- Structured JSON responses with confidence and audit

## Conventions

- JSON over HTTPS
- Bearer or cookie session
- Idempotency keys for submissions
- Problem Details (`application/problem+json`) for errors
