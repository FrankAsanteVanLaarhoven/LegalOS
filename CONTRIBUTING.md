# Contributing to LegalOS

Thank you for your interest in contributing to LegalOS. This project is built on the principle that trust claims must be measured and falsifiable rather than declared.

---

## Code of Conduct & Principles

All contributors must respect the core tenets of the platform:
1. **Never Present LegalOS as a Solicitor:** The platform is built to refuse rather than approximate reserved legal activities.
2. **Never Invent Rules or Outcomes:** Every legal proposition must resolve to a registered, verified UK legal source.
3. **Falsifiability as an Entry Condition:** No capability or invariant is deemed satisfied without executable, falsifiable evidence.
4. **Zero-Trust Security:** Strict organisation boundaries must be enforced across all queries and middleware.

---

## Monorepo Workflow

### 1. Prerequisites
* **Node.js:** `>= 20.0.0`
* **pnpm:** `^10.20.0`
* **Docker / Docker Compose** (for local PostgreSQL instance)

### 2. Development Setup
```bash
# Clone and install dependencies
git clone https://github.com/FrankAsanteVanLaarhoven/LegalOS.git
cd LegalOS
pnpm install

# Start local PostgreSQL database
docker compose up -d

# Run database migrations
DATABASE_URL=postgres://legalos:legalos@localhost:5433/legalos \
  pnpm --filter @legalos/database migrate

# Bootstrap demonstration tenancy
pnpm bootstrap

# Start development server
pnpm dev
# Web application available at http://localhost:3011
```

---

## Branching & Commit Conventions

* **Branch Naming:**
  * `feat/...` — New capability, workflow, or repository features
  * `fix/...` — Defect fixes
  * `docs/...` — Documentation updates
  * `chore/...` — Tooling, dependency, and configuration updates
* **Commit Messages:** Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:
  * `feat(repositories): implement review authority gate`
  * `fix(web): prevent Turbopack IPC worker timeout on CSS build`
  * `docs(oisc): add statutory framework guide`

---

## Quality & Invariant Gates

Before submitting a Pull Request, ensure all checks pass:

```bash
# Format & Lint
pnpm format:check
pnpm lint

# Invariant & Architecture Checks
pnpm check:invariants
pnpm check:principles
pnpm check:docs
pnpm check:contracts

# Automated Tests & Smoke
pnpm test
pnpm smoke:dev
```

---

## Pull Request Checklist

- [ ] Strict TypeScript mode passes with zero errors (`pnpm typecheck`).
- [ ] No hardcoded legal advice or probability assertions.
- [ ] Any new invariant or capability includes verifiable, falsifiable observations.
- [ ] Documentation figures in `README.md` remain strictly synchronized (`pnpm check:docs`).
- [ ] No secrets, credentials, or client test data committed.
