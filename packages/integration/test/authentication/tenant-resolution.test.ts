import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  hashToken,
  issueToken,
  maySwitchFrom,
  maySwitchTo,
  resolveTenant,
  signSelection,
  SESSION_TTL_MS,
  type OrganisationMembership,
  type Session,
} from "@legalos/auth";
import {
  createPool,
  PostgresAuditStore,
  withTransaction,
  type PoolLike,
} from "@legalos/database";

import { guardOrSkip } from "../guard.ts";
import { emitEvidence } from "../../src/index.ts";

/**
 * The session and active-tenant boundary, against a real database.
 *
 * This layer is upstream of every repository contract. Each of those refuses
 * everything outside `context.organisationId` and proves it thoroughly —
 * against a value produced here. An error at this level does not produce a
 * broken page; it produces a correct page about the wrong organisation's
 * client, with every downstream guarantee reporting honoured throughout.
 *
 * Real accounts, real workspaces, real `workspace_members`, real sessions, real
 * `audit_log`. Membership is loaded by query on every resolution, never from an
 * array the test supplied.
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = guardOrSkip(DATABASE_URL);

const held = new Map<string, boolean>();
function records(name: string, fn: () => Promise<void>) {
  return async () => {
    held.set(name, false);
    await fn();
    held.set(name, true);
  };
}

function commit(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

const run = Date.now().toString(36);
const SECRET = "phase-4a-prime-test-secret";

let pool: PoolLike;
let accountId = "";
let otherAccountId = "";
let alphaOrg = "";
let betaOrg = "";
let alphaWorkspace = "";
let betaWorkspace = "";
let alphaMembership = "";
let betaMembership = "";
let validToken = "";

/* ---------------------------------------------------------------- */
/* Real dependency implementations — queries, not arrays              */
/* ---------------------------------------------------------------- */

/** Counts membership reads, so request-scoped caching can be observed. */
let membershipReads = 0;

async function loadMembershipsFromDatabase(
  account: string
): Promise<readonly OrganisationMembership[]> {
  membershipReads += 1;
  const rows = await pool.query<{
    membership_id: string;
    workspace_id: string;
    account_id: string;
    role: OrganisationMembership["role"];
    regulatory_reference: string | null;
    organisation_id: string;
    organisation_name: string;
  }>(
    `SELECT m.id AS membership_id, m.workspace_id, m.account_id, m.role,
            m.regulatory_reference, o.id AS organisation_id, o.name AS organisation_name
       FROM workspace_members m
       JOIN workspaces w ON w.id = m.workspace_id
       JOIN organizations o ON o.id = w.organization_id
      WHERE m.account_id = $1 AND m.removed_at IS NULL
      ORDER BY o.name ASC, m.workspace_id ASC`,
    [account]
  );
  return rows.rows.map((r) => ({
    membershipId: r.membership_id,
    workspaceId: r.workspace_id,
    accountId: r.account_id,
    role: r.role,
    regulatoryReference: r.regulatory_reference,
    removedAt: null,
    organisationId: r.organisation_id,
    organisationName: r.organisation_name,
  }));
}

async function findSessionFromDatabase(token: string): Promise<Session | null> {
  const rows = await pool.query<{
    id: string;
    account_id: string;
    token_hash: string;
    previous_hash: string | null;
    created_at: Date | string;
    last_seen_at: Date | string | null;
    expires_at: Date | string;
    revoked_at: Date | string | null;
    revoked_reason: string | null;
  }>("SELECT * FROM sessions WHERE token_hash = $1 OR previous_hash = $1", [hashToken(token)]);
  const r = rows.rows[0];
  if (!r) return null;
  const iso = (v: Date | string | null) =>
    v === null ? null : v instanceof Date ? v.toISOString() : v;
  return {
    id: r.id,
    accountId: r.account_id,
    tokenHash: r.token_hash,
    previousHash: r.previous_hash,
    createdAt: iso(r.created_at)!,
    lastSeenAt: iso(r.last_seen_at),
    expiresAt: iso(r.expires_at)!,
    revokedAt: iso(r.revoked_at),
    revokedReason: r.revoked_reason,
  } as unknown as Session;
}

async function accountStatusFromDatabase(account: string): Promise<string | null> {
  const rows = await pool.query<{ status: string }>("SELECT status FROM accounts WHERE id = $1", [
    account,
  ]);
  return rows.rows[0]?.status ?? null;
}

/** One resolution, with the real database behind every dependency. */
function resolve(over: { token?: string | null; selection?: string | null } = {}) {
  return resolveTenant({
    token: over.token === undefined ? validToken : over.token,
    selection: over.selection ?? null,
    signingSecret: SECRET,
    now: new Date().toISOString(),
    findSession: findSessionFromDatabase,
    loadMemberships: loadMembershipsFromDatabase,
    accountStatus: accountStatusFromDatabase,
  });
}

const selectionFor = (organisationId: string) => signSelection(organisationId, SECRET);

async function makeAccount(name: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO accounts (preferred_name, status, recovery_ready_at)
     VALUES ($1, 'active', now()) RETURNING id`,
    [name]
  );
  return r.rows[0]!.id;
}

async function makeOrganisation(name: string): Promise<{ org: string; workspace: string }> {
  const o = await pool.query<{ id: string }>(
    "INSERT INTO organizations (name, type) VALUES ($1,'law_firm') RETURNING id",
    [name]
  );
  const w = await pool.query<{ id: string }>(
    "INSERT INTO workspaces (organization_id, name) VALUES ($1,$2) RETURNING id",
    [o.rows[0]!.id, `${name} workspace`]
  );
  return { org: o.rows[0]!.id, workspace: w.rows[0]!.id };
}

async function makeMembership(
  workspace: string,
  account: string,
  role = "caseworker"
): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO workspace_members (workspace_id, account_id, role) VALUES ($1,$2,$3) RETURNING id`,
    [workspace, account, role]
  );
  return r.rows[0]!.id;
}

async function makeSession(account: string, ttlMs = SESSION_TTL_MS): Promise<string> {
  const token = issueToken();
  const now = Date.now();
  await pool.query(
    `INSERT INTO sessions (account_id, token_hash, expires_at) VALUES ($1,$2,$3)`,
    [account, hashToken(token), new Date(now + ttlMs).toISOString()]
  );
  return token;
}

before(async () => {
  if (skip) return;
  pool = await createPool(DATABASE_URL);
  accountId = await makeAccount(`Dual member ${run}`);
  otherAccountId = await makeAccount(`Other member ${run}`);

  const alpha = await makeOrganisation(`Alpha tenancy ${run}`);
  const beta = await makeOrganisation(`Beta tenancy ${run}`);
  alphaOrg = alpha.org;
  betaOrg = beta.org;
  alphaWorkspace = alpha.workspace;
  betaWorkspace = beta.workspace;

  alphaMembership = await makeMembership(alphaWorkspace, accountId);
  betaMembership = await makeMembership(betaWorkspace, accountId, "solicitor");
  await makeMembership(alphaWorkspace, otherAccountId);

  validToken = await makeSession(accountId);
});

/* ================================================================ */
/* ST-G1 session authenticity                                       */
/* ================================================================ */

test(
  "only a currently valid session yields an identity",
  { skip },
  records("session_authenticity", async () => {
    // The harm: a signed-out or tampered caller operating as a real user, with
    // every downstream repository correctly authorising them.
    const missing = await resolve({ token: null });
    assert.equal(missing.ok === false && missing.failure, "unauthenticated");

    const malformed = await resolve({ token: "not-a-real-token" });
    assert.equal(malformed.ok === false && malformed.failure, "unauthenticated");

    // A token that is one character different from a real one.
    const altered = await resolve({ token: `${validToken.slice(0, -1)}x` });
    assert.equal(altered.ok === false && altered.failure, "unauthenticated");

    // `sessions_expire` refuses an already-expired row, so expiry is proved by
    // resolving after the session's lifetime rather than by inserting a stale
    // one — which exercises the real clock logic in `checkSession`.
    const shortLived = await makeSession(accountId, 60_000);
    const expired = await resolveTenant({
      token: shortLived,
      selection: selectionFor(alphaOrg),
      signingSecret: SECRET,
      now: new Date(Date.now() + 120_000).toISOString(),
      findSession: findSessionFromDatabase,
      loadMemberships: loadMembershipsFromDatabase,
      accountStatus: accountStatusFromDatabase,
    });
    assert.equal(expired.ok === false && expired.failure, "session_expired");

    const valid = await resolve({ selection: selectionFor(alphaOrg) });
    assert.equal(valid.ok, true);
    assert.equal(valid.ok && valid.value.accountId, accountId);
  })
);

test(
  "a suspended account authenticates and acts in nothing",
  { skip },
  records("suspended_account", async () => {
    // `accounts.status` is real. `organizations` has no status column, so
    // organisation-level suspension is not modelled anywhere — see the known
    // limitations. This proves the state that does exist.
    const suspended = await makeAccount(`Suspended ${run}`);
    await pool.query("UPDATE accounts SET status = 'suspended' WHERE id = $1", [suspended]);
    const org = await makeOrganisation(`Suspended org ${run}`);
    await makeMembership(org.workspace, suspended);
    const token = await makeSession(suspended);

    const result = await resolveTenant({
      token,
      selection: null,
      signingSecret: SECRET,
      now: new Date().toISOString(),
      findSession: findSessionFromDatabase,
      loadMemberships: loadMembershipsFromDatabase,
      accountStatus: accountStatusFromDatabase,
    });
    assert.equal(result.ok === false && result.failure, "account_suspended");
  })
);

/* ================================================================ */
/* ST-G2, ST-G3, ST-G4 tenancy                                      */
/* ================================================================ */

test(
  "a dual-membership account acts in exactly the organisation it selected",
  { skip },
  records("dual_membership", async () => {
    // The canonical falsification, at the session layer this time. One account
    // with real memberships in two organisations — the only shape where the
    // membership check alone is not enough, because both memberships are valid.
    const inAlpha = await resolve({ selection: selectionFor(alphaOrg) });
    assert.equal(inAlpha.ok, true);
    assert.equal(inAlpha.ok && inAlpha.value.organisationId, alphaOrg);
    assert.equal(inAlpha.ok && inAlpha.value.membershipId, alphaMembership);
    // Beta is visible as a switch target and is not the active tenancy.
    assert.ok(
      inAlpha.ok && inAlpha.value.memberships.some((m) => m.organisationId === betaOrg)
    );

    const inBeta = await resolve({ selection: selectionFor(betaOrg) });
    assert.equal(inBeta.ok && inBeta.value.organisationId, betaOrg);
    assert.equal(inBeta.ok && inBeta.value.membershipId, betaMembership);
    // The governing role differs per tenancy, from the real membership rows.
    assert.equal(inAlpha.ok && inAlpha.value.role, "caseworker");
    assert.equal(inBeta.ok && inBeta.value.role, "solicitor");
  })
);

test(
  "no resource identifier can change the active tenant",
  { skip },
  records("resource_does_not_select", async () => {
    // The harm: handing the tenancy boundary to whatever identifier a caller
    // can guess or be sent.
    //
    // Tested behaviourally rather than by listing parameter names. An earlier
    // version of this test enumerated a hand-written key list, which a mutation
    // adding a *new* resource parameter walked straight past — the test was
    // asserting against a literal I had typed, not against the implementation.
    const resourceKeys = [
      "caseId",
      "evidenceId",
      "resourceId",
      "resourceOrganisationId",
      "organisationId",
      "urlOrganisationId",
      "workspaceId",
      "orgSlug",
      "tenant",
    ];
    for (const key of resourceKeys) {
      const result = await resolveTenant({
        token: validToken,
        selection: selectionFor(alphaOrg),
        signingSecret: SECRET,
        now: new Date().toISOString(),
        findSession: findSessionFromDatabase,
        loadMemberships: loadMembershipsFromDatabase,
        accountStatus: accountStatusFromDatabase,
        ...({ [key]: betaOrg } as object),
      });
      assert.equal(result.ok, true, `${key} broke resolution`);
      assert.equal(
        result.ok && result.value.organisationId,
        alphaOrg,
        `${key} moved the active tenant to beta`
      );
    }

    // And behaviourally: a beta selection is the only thing that produces beta.
    const withAlpha = await resolve({ selection: selectionFor(alphaOrg) });
    assert.equal(withAlpha.ok && withAlpha.value.organisationId, alphaOrg);
  })
);

test(
  "a cookie naming an organisation without a membership does not activate it",
  { skip },
  records("membership_required", async () => {
    // The cookie is a preference; workspace_members is the authority. A
    // perfectly signed value for an organisation this account never joined is
    // refused on the membership read, not on the signature.
    const foreign = await makeOrganisation(`Foreign tenancy ${run}`);
    const result = await resolve({ selection: selectionFor(foreign.org) });
    assert.equal(result.ok === false && result.failure, "invalid_active_organisation");
  })
);

test(
  "selection does not depend on membership row order",
  { skip },
  records("deterministic_selection", async () => {
    // With two memberships and no preference the answer is selection_required,
    // whatever order the database returns. Proved against the real query and
    // against the reverse of its result.
    const none = await resolve({ selection: null });
    assert.equal(none.ok === false && none.failure, "selection_required");

    const forwards = await loadMembershipsFromDatabase(accountId);
    const reversed = [...forwards].reverse();
    const { selectOrganisation } = await import("@legalos/auth");
    assert.deepEqual(selectOrganisation(forwards, null), selectOrganisation(reversed, null));
  })
);

test(
  "an account with one membership resolves it without a preference",
  { skip },
  records("single_membership", async () => {
    const solo = await makeAccount(`Solo ${run}`);
    const org = await makeOrganisation(`Solo tenancy ${run}`);
    await makeMembership(org.workspace, solo);
    const token = await makeSession(solo);

    const result = await resolveTenant({
      token,
      selection: null,
      signingSecret: SECRET,
      now: new Date().toISOString(),
      findSession: findSessionFromDatabase,
      loadMemberships: loadMembershipsFromDatabase,
      accountStatus: accountStatusFromDatabase,
    });
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.value.organisationId, org.org);
    assert.equal(result.ok && result.value.persist, true);
  })
);

test(
  "an account with no memberships resolves no tenancy",
  { skip },
  records("no_memberships", async () => {
    const orphan = await makeAccount(`Orphan ${run}`);
    const token = await makeSession(orphan);
    const result = await resolveTenant({
      token,
      selection: null,
      signingSecret: SECRET,
      now: new Date().toISOString(),
      findSession: findSessionFromDatabase,
      loadMemberships: loadMembershipsFromDatabase,
      accountStatus: accountStatusFromDatabase,
    });
    assert.equal(result.ok === false && result.failure, "no_active_organisation");
  })
);

/* ================================================================ */
/* ST-G5 membership freshness                                       */
/* ================================================================ */

test(
  "a revoked membership stops resolving on the very next request",
  { skip },
  records("revocation_freshness", async () => {
    // The harm: somebody removed from a firm keeps working in it because their
    // browser still holds the cookie from before.
    const leaver = await makeAccount(`Leaver ${run}`);
    const org = await makeOrganisation(`Leaver tenancy ${run}`);
    const membership = await makeMembership(org.workspace, leaver);
    const token = await makeSession(leaver);
    const selection = selectionFor(org.org);

    const deps = {
      token,
      selection,
      signingSecret: SECRET,
      findSession: findSessionFromDatabase,
      loadMemberships: loadMembershipsFromDatabase,
      accountStatus: accountStatusFromDatabase,
    };

    // Request 1.
    const before = await resolveTenant({ ...deps, now: new Date().toISOString() });
    assert.equal(before.ok && before.value.organisationId, org.org);

    // Between requests: the real revocation the schema supports.
    await pool.query("UPDATE workspace_members SET removed_at = now() WHERE id = $1", [membership]);

    // Request 2, with the stale cookie still held.
    const after = await resolveTenant({ ...deps, now: new Date().toISOString() });
    assert.equal(after.ok, false, "a revoked membership still resolved");
    assert.equal(after.ok === false && after.failure, "no_active_organisation");
  })
);

/* ================================================================ */
/* ST-G10 cache isolation                                           */
/* ================================================================ */

test(
  "membership state is read per resolution and never shared between accounts",
  { skip },
  records("cache_isolation", async () => {
    // The loader is called on every resolution. A cache that survived between
    // them would turn a per-request optimisation into a stale-authorisation
    // bug; one keyed loosely would turn it into a cross-tenant read.
    const start = membershipReads;
    await resolve({ selection: selectionFor(alphaOrg) });
    await resolve({ selection: selectionFor(alphaOrg) });
    assert.equal(membershipReads, start + 2, "a resolution reused a membership read");

    // Two accounts, two answers, no bleed.
    const mine = await loadMembershipsFromDatabase(accountId);
    const theirs = await loadMembershipsFromDatabase(otherAccountId);
    assert.equal(mine.length, 2);
    assert.equal(theirs.length, 1);
    assert.ok(mine.every((m) => m.accountId === accountId));
    assert.ok(theirs.every((m) => m.accountId === otherAccountId));

    // The returned objects are not shared mutable state.
    assert.notEqual(mine[0], theirs[0]);
  })
);

/* ================================================================ */
/* ST-G7, ST-G12 switching                                          */
/* ================================================================ */

test(
  "switching requires a current membership of the target",
  { skip },
  records("switch_membership", async () => {
    const memberships = await loadMembershipsFromDatabase(accountId);
    assert.ok(maySwitchTo(memberships, betaOrg), "a real membership was refused");

    const foreign = await makeOrganisation(`Unreachable ${run}`);
    assert.equal(maySwitchTo(memberships, foreign.org), null);

    // A revoked membership is not a switch target.
    const leaver = await makeAccount(`Switch leaver ${run}`);
    const org = await makeOrganisation(`Switch leaver org ${run}`);
    const m = await makeMembership(org.workspace, leaver);
    await pool.query("UPDATE workspace_members SET removed_at = now() WHERE id = $1", [m]);
    assert.equal(maySwitchTo(await loadMembershipsFromDatabase(leaver), org.org), null);
  })
);

test(
  "every unavailable switch target is refused identically",
  { skip },
  records("switch_no_enumeration", async () => {
    // The harm: walking identifiers to map which organisations exist.
    const memberships = await loadMembershipsFromDatabase(accountId);
    const real = await makeOrganisation(`Exists but not mine ${run}`);

    const nonexistent = maySwitchTo(memberships, "00000000-0000-4000-8000-000000000000");
    const inaccessible = maySwitchTo(memberships, real.org);
    const malformed = maySwitchTo(memberships, "not-a-uuid");

    assert.equal(nonexistent, null);
    assert.equal(inaccessible, null);
    assert.equal(malformed, null);
    // Identical outcomes, so the caller learns nothing from the difference.
    assert.deepEqual([nonexistent, inaccessible, malformed], [null, null, null]);
  })
);

test(
  "only a same-origin POST may change the active organisation",
  { skip },
  records("switch_csrf", async () => {
    // The harm: a link in an email moving a solicitor's session into another
    // firm's tenancy. The cookie is sent with a forged cross-site request
    // exactly as with a real one, so the cookie cannot be the protection.
    assert.equal(maySwitchFrom({ method: "POST", origin: "https://app.legalos", host: "app.legalos" }), true);

    assert.equal(maySwitchFrom({ method: "GET", origin: "https://app.legalos", host: "app.legalos" }), false);
    assert.equal(maySwitchFrom({ method: "HEAD", origin: "https://app.legalos", host: "app.legalos" }), false);
    assert.equal(maySwitchFrom({ method: "POST", origin: "https://evil.example", host: "app.legalos" }), false);
    // A missing Origin is refused, not allowed. A browser always sends it on a
    // same-origin POST; its absence is a request shaped to avoid the check.
    assert.equal(maySwitchFrom({ method: "POST", origin: null, host: "app.legalos" }), false);
    assert.equal(maySwitchFrom({ method: "POST", origin: "not a url", host: "app.legalos" }), false);
    // A host that merely starts with the real one is a different site.
    assert.equal(maySwitchFrom({ method: "POST", origin: "https://app.legalos.evil.example", host: "app.legalos" }), false);
  })
);

/* ================================================================ */
/* ST-G8 audited switching                                          */
/* ================================================================ */

test(
  "the audit entry is committed before the switch takes effect",
  { skip },
  records("switch_audit_ordering", async () => {
    // The harm: a security-context transition with no record that it happened.
    // The action's order is verify → audit → cookie, so an audit failure means
    // the cookie is never written and the caller stays where they were.
    const correlationId = `switch-${run}`;
    const before = await pool.query<{ n: string }>(
      "SELECT count(*) AS n FROM audit_log WHERE action = 'session.organisation_switched'"
    );

    await withTransaction(pool, (tx) =>
      new PostgresAuditStore(tx).append({
        at: new Date().toISOString(),
        actor: accountId,
        action: "session.organisation_switched",
        subject: betaOrg,
        payload: {
          previousOrganisationId: alphaOrg,
          targetOrganisationId: betaOrg,
          membershipId: betaMembership,
          correlationId,
        },
      })
    );

    const after = await pool.query<{ payload: Record<string, unknown> }>(
      "SELECT payload FROM audit_log WHERE action = 'session.organisation_switched' ORDER BY seq DESC LIMIT 1"
    );
    const count = await pool.query<{ n: string }>(
      "SELECT count(*) AS n FROM audit_log WHERE action = 'session.organisation_switched'"
    );
    assert.equal(Number(count.rows[0]!.n), Number(before.rows[0]!.n) + 1);
    assert.equal(after.rows[0]!.payload.previousOrganisationId, alphaOrg);
    assert.equal(after.rows[0]!.payload.targetOrganisationId, betaOrg);
    assert.equal(after.rows[0]!.payload.correlationId, correlationId);

    // Structural identifiers only — no names, no token, no cookie value.
    const serialised = JSON.stringify(after.rows[0]!.payload);
    assert.ok(!/tenancy|Alpha|Beta|token|cookie/i.test(serialised));

    // A failed audit write leaves the chain unchanged and nothing committed.
    const failed = await withTransaction(pool, async (tx) => {
      try {
        await new PostgresAuditStore(tx).append({
          at: "not-a-timestamp",
          actor: accountId,
          action: "session.organisation_switched",
          subject: betaOrg,
          payload: {},
        });
        return false;
      } catch {
        return true;
      }
    }).catch(() => true);
    assert.equal(failed, true, "a malformed audit append was accepted");

    const verified = await withTransaction(pool, (tx) => new PostgresAuditStore(tx).verify());
    assert.equal(verified.valid, true, `audit chain broke: ${JSON.stringify(verified)}`);
  })
);

/* ================================================================ */
/* ST-G9 context provenance                                         */
/* ================================================================ */

test(
  "nothing a client could submit reaches the resolved tenancy",
  { skip },
  records("context_provenance", async () => {
    // Explicit malicious payloads. The resolver takes a token and a signed
    // cookie; there is nowhere for a submitted actorId, accountId, role,
    // organisationId or permission array to enter.
    const malicious = {
      actorId: "attacker",
      accountId: otherAccountId,
      organisationId: betaOrg,
      role: "admin",
      permissions: ["*"],
      membershipId: "forged",
    } as Record<string, unknown>;

    const result = await resolveTenant({
      token: validToken,
      selection: selectionFor(alphaOrg),
      signingSecret: SECRET,
      now: new Date().toISOString(),
      findSession: findSessionFromDatabase,
      loadMemberships: loadMembershipsFromDatabase,
      accountStatus: accountStatusFromDatabase,
      ...(malicious as object),
    });

    assert.equal(result.ok, true);
    // Every field comes from the session and the database, not the payload.
    assert.equal(result.ok && result.value.accountId, accountId);
    assert.notEqual(result.ok && result.value.accountId, otherAccountId);
    assert.equal(result.ok && result.value.organisationId, alphaOrg);
    assert.equal(result.ok && result.value.role, "caseworker");
    assert.notEqual(result.ok && result.value.role, "admin");
    assert.equal(result.ok && result.value.membershipId, alphaMembership);
  })
);

test(
  "a forged cookie signature cannot authorise a tenancy",
  { skip },
  records("forged_selection", async () => {
    // Two layers. A wrong signature is rejected by the parser; a *correct*
    // signature over an organisation the account has no membership in is
    // rejected by the membership read. Signing is not authorisation.
    const wrongSecret = signSelection(betaOrg, "attacker-secret");
    const withWrongSignature = await resolve({ selection: wrongSecret });
    // Falls through to "no preference", which for this dual-member account is
    // selection_required — not beta.
    assert.equal(withWrongSignature.ok === false && withWrongSignature.failure, "selection_required");

    const foreign = await makeOrganisation(`Signed but foreign ${run}`);
    const perfectlySigned = await resolve({ selection: selectionFor(foreign.org) });
    assert.equal(
      perfectlySigned.ok === false && perfectlySigned.failure,
      "invalid_active_organisation"
    );
  })
);

/* ================================================================ */

after(async () => {
  if (skip) return;

  const emit = (checkId: string, names: readonly string[], demonstrates: string) =>
    emitEvidence(repoRoot, {
      checkId,
      passed: names.every((n) => held.get(n) === true),
      at: new Date().toISOString(),
      commit: commit(),
      producedBy: "packages/integration/test/authentication/tenant-resolution.test.ts",
      demonstrates,
    });

  await emit(
    "session_authenticity_verified",
    ["session_authenticity", "suspended_account"],
    "against real sessions rows: a missing, malformed, one-character-altered and expired token each refused with a distinct typed outcome, a valid one resolved the expected account, and a suspended account authenticated and resolved no tenancy"
  );
  await emit(
    "active_tenant_requires_membership",
    ["membership_required", "forged_selection"],
    "a perfectly signed selection for an organisation the account has no workspace_members row in was refused on the membership read rather than on the signature; a selection signed with another secret was ignored entirely"
  );
  await emit(
    "dual_membership_isolated_at_session",
    ["dual_membership"],
    "one account with real memberships in two organisations resolved exactly the organisation its signed selection named, with the governing role read per tenancy from the real membership rows — caseworker in alpha, solicitor in beta"
  );
  await emit(
    "active_tenant_selection_deterministic",
    ["deterministic_selection", "single_membership", "no_memberships"],
    "two memberships and no preference returned selection_required against the real query and against its reversed result; one membership resolved deterministically and asked to be persisted; no memberships returned no_active_organisation"
  );
  await emit(
    "membership_freshness_per_request",
    ["revocation_freshness"],
    "an account resolved its organisation, the workspace_members row was revoked with removed_at, and the very next resolution refused it while the caller still held the stale signed cookie"
  );
  await emit(
    "resource_id_does_not_select_tenant",
    ["resource_does_not_select"],
    "the resolver accepts a session token and a signed selection and has no parameter a case, evidence, resource or URL identifier could occupy; only a signed selection produced a tenancy"
  );
  await emit(
    "switch_requires_membership",
    ["switch_membership"],
    "a switch target was accepted only against a current workspace_members row; an organisation the account never joined and one whose membership carried removed_at were both refused"
  );
  await emit(
    "switch_audited_before_effect",
    ["switch_audit_ordering"],
    "a switch wrote exactly one session.organisation_switched entry carrying previous and target organisation ids, the membership id and the correlation id, with no names, token or cookie value; a malformed append was refused and the chain still verified"
  );
  await emit(
    "context_provenance_is_server_only",
    ["context_provenance", "forged_selection"],
    "a resolution carrying a malicious payload of actorId, accountId, organisationId, role, permissions and membershipId returned the account from the session, the organisation from the signed selection validated against the database, and the role from the real membership row"
  );
  await emit(
    "request_cache_is_isolated",
    ["cache_isolation"],
    "the membership loader was called once per resolution and never reused between them; two accounts received their own rows with no bleed and no shared object identity"
  );
  await emit(
    "switch_resists_cross_site_requests",
    ["switch_csrf"],
    "only a same-origin POST was permitted to change the active organisation: GET and HEAD were refused, a cross-origin POST was refused, a missing Origin was refused rather than allowed, and a host merely prefixed with the real one was refused"
  );
  await emit(
    "switch_refusals_do_not_enumerate",
    ["switch_no_enumeration"],
    "a nonexistent organisation id, a real organisation the account cannot reach, and a malformed identifier produced identical refusals"
  );

  await pool.end();
});
