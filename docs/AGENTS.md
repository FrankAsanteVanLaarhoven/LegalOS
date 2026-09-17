# AI Agents

LegalOS uses a **supervisor + specialists** model. Not a single free-form chatbot.

## Topology

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

## Contract for every agent

| Requirement        | Description                              |
| ------------------ | ---------------------------------------- |
| Tools              | Explicit tool list only                  |
| Responsibilities   | Bounded domain                           |
| Structured outputs | Zod/JSON schema                          |
| Confidence         | 0–1 with rationale                       |
| Sources            | Citations where applicable               |
| Missing evidence   | Explicit gaps                            |
| Audit              | Agent id, model, timestamps, inputs hash |
| Human gate         | Flag when reserved or high-risk          |

## Guardrails

- Never claim to be a solicitor
- Never guarantee outcomes
- Explain: what I know → evidence → law → confidence → alternatives → next actions
- Escalate detention, trafficking safety, crisis indicators

## Implementation

- Specs: `packages/agents`
- Runtime (demo): `apps/web` API routes + SpaceXAI
- Production target: Temporal workflows + tool sandbox
