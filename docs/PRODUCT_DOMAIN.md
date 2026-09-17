# Product domain and platform structure

Forward-looking. Nothing here is built, and this document does not describe
current capability — `/trust` and `pnpm trust:ledger` do that, from measurement.
This records the intended shape so it survives between sessions.

## Positioning

LegalOS is a UK Migration & Integration public services platform: helping people
navigate immigration, protection, settlement and integration through workflows
whose claims are backed by evidence, with regulated decisions left to regulated
humans.

The emphasis is the whole journey rather than question answering — arrival,
identity, status, accommodation, healthcare, education, employment, financial
inclusion, legal support, settlement, citizenship.

## Platform and products

```
LegalOS Platform            trust, evidence, verification, governance, privacy
└── Migration & Integration first product
    Employment & Sponsorship
    Housing & Community Services
    Family & Life Events
    Citizenship & Settlement
```

The split matters technically as well as commercially: everything in
`packages/` is domain-neutral by construction. Nothing in the verification,
policy, governance, capability or privacy layers knows about immigration. A
second product should need no changes to any of them, and if it does, the
boundary was drawn wrongly.

## The conversational layer

Named **LegalOS Companion**. One interface the person speaks to, orchestrating
specialist agents behind it — they should never need to know which agent
answered, or that there were several.

Two constraints on it:

- The Companion does not reason about law. It converses, gathers, explains and
  delegates; substantive answers come from specialists and pass the verification
  gate like anything else. A conversational layer that answers directly is a
  path around every control in this repository.
- The name is not translated. It stays identical in every locale so a person
  switching language still recognises what they are talking to.

Trademark availability is unverified — that is a search, not an engineering
judgement, and should be done before the name appears in any public material.

## Agent departments

The current agent model is a known defect: three registries disagree (12, 16 and
8 agents), and `docs/ARCHITECTURE.md` documents the one nothing uses.

The fix is not a fourth registry. It is that a department owns a **capability**,
and capabilities are already observable — so an agent's status becomes derived
rather than declared, exactly as the workspace badges now are.

```
Department          owns capability          observable today
Migration           rule_engine              yes
Evidence            evidence_ingestion       yes
Translation         evidence_ingestion       yes
Representation      representation           yes
Research            research_retrieval       yes
Compliance          audit                    yes
Notification        workflow_engine          yes
```

One manifest, consumed by routing, UI, health and docs. `AGENT_CAPABILITY` in
`packages/capabilities` is the seed of it.

## Evaluation

The research contribution is stronger at system level than at answer level.
Answer-level benchmarks are crowded and easy to game; the following are not, and
each is measurable from state the platform already records:

- missed deadlines, against deadlines detected
- time from evidence request to evidence received
- bundle completeness at the point of professional review
- edits required by a professional after review, as a document-quality proxy
- user comprehension, tested rather than assumed
- administrative effort per case, for supporting organisations

These belong in `@legalos/bench` as a second suite alongside the safety
envelope. They cannot be added yet: they need real cases, and therefore
authentication, tenancy and a verified corpus first. Recording them here rather
than stubbing them keeps the benchmark honest about what it currently scores.

## Professional network — constraints decided before building

The engagement model is a referral and engagement network integrated into the
case, not a marketplace. Three constraints follow, recorded now because each is
easier to design in than to retrofit.

**The engagement fee conflicts with the recommendation.** If the platform earns
when a user engages a professional, then the component saying "your case would
benefit from review" has a financial interest in saying it, to people who cannot
evaluate the claim. Same structure as a fabricated confidence score, with the
incentive outside the code rather than inside it. Mitigations, all required
together: disclose the interest at the point of recommendation; make the
recommendation's basis auditable like any other observation; and keep
engagement revenue out of the decision of _whether_ review is suggested,
allowing it to affect only _who_ appears once the user has decided.

**Verification is an observation, not a badge.** IAA, SRA and BSB registers are
public. A professional's regulated status carries a retrieval date and a
checksum like any other verified source, and an unchecked registration displays
as unverified. The carousel currently shows fabricated profiles labelled
"Illustrative — not a real adviser"; that is the correct starting state and a
real network replaces it with verified records rather than removing the label.

**Match, never rank by outcome.** Practice area, language, jurisdiction,
availability and consultation format are objective and explainable. Client
satisfaction is not safe on immigration matters: it will track whether someone
won, which tracks case strength rather than adviser quality, reintroducing
outcome ranking indirectly. Response time and completed reviews are operational
and acceptable. Every match must be able to state why it was made.

---

## Regulatory position, unresolved

Two questions gate large parts of the above and are not engineering questions:

1. Whether the platform may produce regulated immigration documents for another
   person (IAA registration or a solicitor). `REGULATED_DOCUMENT_TYPES` blocks
   rendering; it does not answer this.
2. Whether an entitlements engine — telling someone in Home Office
   accommodation what they may do — is regulated advice. This is the
   highest-risk item proposed so far, higher than drafting, and it also depends
   on a verified corpus that does not yet exist.

Both should be answered before the corresponding work starts, not after.

## Sequence

Authentication, tenancy, ingestion and a verified corpus come first. Every
domain feature above assumes a real user, a real case and law that has actually
been checked. None of those exist yet.
