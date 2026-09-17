import { defineContract } from "../guarantee.ts";

/**
 * The session and active-tenant contract.
 *
 * Registered before the proving tests, so the checks are named by what must be
 * true rather than by what turned out to be convenient to assert.
 *
 * This boundary is upstream of every other contract in the registry. Five
 * repositories refuse everything outside `context.organisationId`, and each of
 * them proves that refusal thoroughly — against a value this layer supplies. An
 * error here does not produce a broken page. It produces a correct page about
 * the wrong organisation's client, with every downstream guarantee reporting
 * honoured throughout.
 */
export const SESSION_CONTRACT = defineContract({
  repository: "SessionAndActiveTenant",
  module: "packages/auth/src/active-tenant.ts",
  rationale:
    "Every repository guarantee in this registry is conditional on the organisation id it is given. If this layer hands over the wrong one, or one the account no longer belongs to, every downstream check passes while operating in a tenancy the caller has no right to — and the audit trail records it as legitimate work.",
  tables: ["workspace_members", "workspaces", "organizations", "audit_log"],
  surfaces: ["Evidence", "Overview", "Timeline", "Tasks", "Deadlines", "Lawyer review"],
  invariants: ["INV-001", "INV-002", "INV-004"],
  guarantees: [
    {
      id: "ST-G1",
      statement: "Only a currently valid session yields an authenticated identity.",
      kind: "permission",
      refuses:
        "a modified or expired session produces an authenticated actor context, so a signed-out or tampered caller operates as a real user",
      provedBy: "session_authenticity_verified",
    },
    {
      id: "ST-G2",
      statement:
        "An organisation becomes active only against a current membership read from the database.",
      kind: "permission",
      refuses:
        "a selected organisation becomes active even though the account has no current membership in it, because the cookie was treated as authority rather than preference",
      provedBy: "active_tenant_requires_membership",
    },
    {
      id: "ST-G3",
      statement: "A dual-membership account acts in exactly the organisation its session selected.",
      kind: "scoping",
      refuses:
        "a dual-membership account scoped to alpha receives beta as its active tenant after opening a beta resource, so every repository correctly scopes to a tenancy the session never chose",
      provedBy: "dual_membership_isolated_at_session",
    },
    {
      id: "ST-G4",
      statement: "Selection is deterministic and independent of row order.",
      kind: "integrity",
      refuses:
        "changing membership row order changes the selected active organisation, so a solicitor acting for two firms works in whichever tenancy happened to be created first",
      provedBy: "active_tenant_selection_deterministic",
    },
    {
      id: "ST-G5",
      statement: "Membership state is revalidated on every request.",
      kind: "permission",
      refuses:
        "a revoked membership continues to produce a RepositoryContext on the next request, so somebody removed from a firm keeps working in it because their browser held the cookie",
      provedBy: "membership_freshness_per_request",
    },
    {
      id: "ST-G6",
      statement: "No URL segment or resource identifier can change the active tenant.",
      kind: "scoping",
      refuses:
        "a foreign resource identifier changes the active tenant without an explicit switch, handing the tenancy boundary to whatever identifier a caller can guess or be sent",
      provedBy: "resource_id_does_not_select_tenant",
    },
    {
      id: "ST-G7",
      statement: "Switching requires a current membership of the target.",
      kind: "permission",
      refuses:
        "an authenticated account switches to an organisation in which it has no current membership, which is tenancy escalation by a single form submission",
      provedBy: "switch_requires_membership_production",
    },
    {
      id: "ST-G8",
      statement: "The active organisation changes only after its audit entry is committed.",
      kind: "integrity",
      refuses:
        "the active organisation changes even though the required audit write failed, so a security-context transition happened with no record that it did",
      provedBy: "switch_audited_before_effect_production",
    },
    {
      id: "ST-G9",
      statement: "No part of a repository context is derived from client input.",
      kind: "provenance",
      refuses:
        "a client-submitted actorId, accountId, role or organisationId becomes part of RepositoryContext, so a caller names the tenancy and the actor their own writes are attributed to",
      provedBy: "context_provenance_is_server_only",
    },
    {
      id: "ST-G10",
      statement: "Request-scoped caching never crosses accounts or requests.",
      kind: "scoping",
      refuses:
        "one account or request receives another account's cached memberships, so a shared cache turns a per-request optimisation into a cross-tenant read",
      provedBy: "request_cache_is_isolated",
    },
    {
      id: "ST-G11",
      statement: "Switching requires a same-origin POST.",
      kind: "permission",
      refuses:
        "a cross-origin or GET request changes the active organisation, so a link in an email moves a solicitor's session into another firm's tenancy",
      provedBy: "switch_resists_cross_site_requests_production",
    },
    {
      id: "ST-G12",
      statement: "Refusals do not reveal whether an inaccessible organisation exists.",
      kind: "abstention",
      refuses:
        "switch responses distinguish a nonexistent organisation from one the account is not a member of, so identifiers can be walked to map organisations that exist",
      provedBy: "switch_refusals_do_not_enumerate_production",
    },
    {
      id: "ST-G13",
      statement:
        "Repository context is constructed only by the canonical factory, enforced by a build gate.",
      kind: "integrity",
      refuses:
        "an authenticated route manually constructs or supplies repository context outside the canonical server-side factory and the identity architecture gate still passes, so the tenant boundary becomes a convention a future route can forget",
      provedBy: "identity_architecture_gate_holds",
    },
    {
      id: "ST-G14",
      statement:
        "Every way of entering the application reaches the same authorisation decision for the same session state.",
      kind: "integrity",
      refuses:
        "one entry point admits a session another refuses — an expired token accepted by a page but rejected by an action, or two access paths disagreeing about which duplicate cookie is the session — so the effective authorisation rule becomes whichever route the caller happened to use",
      provedBy: "session_entry_points_agree",
    },
    {
      id: "ST-G15",
      statement:
        "The organisation cookie the server emits is restrictive, carries no authority, and is emitted only after a switch is recorded.",
      kind: "integrity",
      refuses:
        "the emitted Set-Cookie is readable by scripts, sent cross-site, unbounded in lifetime, carries an account id or role, or appears at all after a refusal or a failed audit, so the cookie becomes something a client can read, forge or acquire without the switch having happened",
      provedBy: "active_org_cookie_observed",
    },
  ],
});
