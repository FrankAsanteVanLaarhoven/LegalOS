# Security

## Principles

- Zero Trust network and application design
- Least privilege RBAC
- Data minimisation and purpose limitation (UK GDPR)
- Encryption in transit (TLS) and at rest
- Field-level encryption for highly sensitive attributes
- Immutable audit logs with provenance
- Secrets never in client bundles or git

## Controls (target)

| Control                   | Status                                                    |
| ------------------------- | --------------------------------------------------------- |
| HTTPS only                | Required in prod                                          |
| Security headers          | Implemented (CSP, HSTS, frame-ancestors, Referrer-Policy) |
| Env secrets               | `.env*` gitignored; `.env.example` committed              |
| Output verification       | Implemented (`@legalos/verification`, fail-closed)        |
| Audit log                 | Implemented; durable only when `DATABASE_URL` is set      |
| Authentication            | **Not implemented** — no route is authenticated           |
| Rate limiting             | **Not implemented**                                       |
| SSO (enterprise)          | Planned v0.2+                                             |
| SOC2 / ISO27001 alignment | Architecture goals                                        |
| Dependency scanning       | **Planned** — not in CI                                   |
| Secret scanning           | **Planned** — not in CI                                   |

The last four rows previously read as though they were in place. Dependency and
secret scanning were listed as "CI (Dependabot / audit)" and "CI (gitleaks /
GitHub)" while the workflow ran neither and no `.github/dependabot.yml` existed,
so a reviewer could reasonably have skipped checking by hand. Authentication and
rate limiting were not listed at all.

## Known gaps

These are open, and are listed here rather than discovered later:

- **No authentication or authorisation on any route.** There is no middleware
  and no session check. `packages/auth` is types only. Case data is currently a
  single fictional fixture, so nothing real is exposed today — but the access
  pattern is already IDOR-shaped, and this must be closed before any persistent
  case store goes live.
- **No rate limiting.** `/api/chat` and `/api/analyze` call a paid model on the
  owner's key with no session, quota or origin check.
- **No retrieval corpus yet.** The storage schema exists (`source_chunks`), but
  ingestion and embeddings are unimplemented, so the verification layer can only
  resolve citations against the small seeded source registry — and every seeded
  source is `unverified`, which is why citations are reported as unresolved
  rather than confirmed.

## Legal / product constraints

- Platform does not provide reserved legal activities
- High-stakes actions require human approval
- No automated filing of regulated submissions without solicitor gate

## Incident response (outline)

1. Contain
2. Assess impact
3. Notify as required under UK GDPR
4. Remediate and post-mortem
