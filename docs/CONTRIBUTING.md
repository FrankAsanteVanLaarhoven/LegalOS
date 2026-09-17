# Contributing

## Branching

- `main` — protected, production-ready
- Feature branches: `feat/...`, `fix/...`, `docs/...`, `chore/...`
- Conventional Commits required

## PR checklist

Every pull request should satisfy:

- [ ] TypeScript strict mode
- [ ] ESLint clean
- [ ] Prettier formatted
- [ ] Unit tests (where applicable)
- [ ] Integration tests (where applicable)
- [ ] Accessibility checks for UI
- [ ] No secrets committed
- [ ] Dependency audit considered
- [ ] CI green
- [ ] Conventional Commit messages

## Local development

```bash
pnpm install
pnpm dev          # apps/web on :3011
pnpm build
pnpm check:videos # uniqueness of film placements
```

## Product law

- Do not present LegalOS as a solicitor
- Do not guarantee legal outcomes
- Prefer transparent, evidence-linked UX
