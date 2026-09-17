# Architecture decision records

Decisions with consequences that outlive the person who made them, recorded with
the reasoning and the alternatives rather than only the outcome.

A record is **Proposed** until someone with the authority to commit accepts it.
That distinction matters here: several of these decisions commit money, a vendor
relationship or a jurisdiction, and none of those is an engineering call.

| ADR                                     | Decision          | Status   |
| --------------------------------------- | ----------------- | -------- |
| [ADR-001](ADR-001-deployment-target.md) | Deployment target | Proposed |

## Writing one

State the options honestly, including the one you are not recommending and why
somebody reasonable might choose it. Record what the decision rules out, not
only what it enables. Where the decision makes assumptions about the running
system, declare them in `packages/readiness` so the readiness checks verify the
implemented state against the intended one — an ADR nobody checks drifts, and
then describes a system that stopped existing.

Assumptions that cannot be checked from inside the application are recorded as
unverifiable, with how they are verified instead. A weak check is worse than
none: it reads as confirmation.
