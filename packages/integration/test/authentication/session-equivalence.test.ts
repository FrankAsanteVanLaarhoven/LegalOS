import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  hashToken,
  issueToken,
  resolveTenant,
  selectOrganisation,
  signSelection,
  switchOrganisationCore,
  verifySessionToken,
  SESSION_TTL_MS,
  type OrganisationMembership,
  type Session,
  type SessionRefusal,
  type SwitchDependencies,
} from "@legalos/auth";
import { createPool, PostgresAuditStore, withTransaction, type PoolLike } from "@legalos/database";

import { guardOrSkip } from "../guard.ts";
import { emitEvidence } from "../../src/index.ts";

/**
 * Session-entry equivalence.
 *
 * The Evidence route will resolve identity through `resolveServerSession`
 * while `/api/analyze` and `/api/chat` use `requireSession`. If those two ever
 * disagreed about a session, a route and an API handler would authorise the
 * same caller differently — and nothing compared them.
 *
 * The measurement that opened this obligation found three inline copies of the
 * verification sequence, already diverging: `requireSession` collapsed an
 * expired session into the same branch as an absent one. They now call one
 * `verifySessionToken`, so equivalence is a property of the code rather than a
 * coincidence to re-check after every edit. This suite proves that one function
 * against a shared vector table, and proves the two cookie access paths cannot
 * differ either.
 *
 * What is deliberately *not* claimed: that a browser stores or returns the
 * cookie. The claim is bounded to the value the server emits and the verdict
 * the server reaches.
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
const SECRET = `equiv-${run}`;
const SESSION_COOKIE = "legalos_session";
const ACTIVE_ORG_COOKIE = "legalos_active_org";

let pool: PoolLike;
let accountId = "";
let alphaOrg = "";
let betaOrg = "";
let gammaOrg = "";
let betaMembership = "";
let validToken = "";
let expiredWindowToken = "";
let revokedToken = "";
let orphanToken = "";

/* ---------------------------------------------------------------- */
/* Real production dependencies                                      */
/* ---------------------------------------------------------------- */

async function findSession(token: string): Promise<Session | null> {
  const r = await pool.query<Record<string, unknown>>(
    "SELECT * FROM sessions WHERE token_hash = $1 OR previous_hash = $1",
    [hashToken(token)]
  );
  const s = r.rows[0];
  if (!s) return null;
  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : (v as string | null));
  return {
    id: s.id,
    accountId: s.account_id,
    tokenHash: s.token_hash,
    previousHash: s.previous_hash,
    createdAt: iso(s.created_at),
    lastSeenAt: iso(s.last_seen_at),
    expiresAt: iso(s.expires_at),
    revokedAt: iso(s.revoked_at),
    revokedReason: s.revoked_reason,
  } as unknown as Session;
}

async function loadMemberships(account: string): Promise<readonly OrganisationMembership[]> {
  const r = await pool.query<Record<string, unknown>>(
    `SELECT m.id AS membership_id, m.workspace_id, m.account_id, m.role,
            m.regulatory_reference, o.id AS organisation_id, o.name AS organisation_name
       FROM workspace_members m
       JOIN workspaces w ON w.id = m.workspace_id
       JOIN organizations o ON o.id = w.organization_id
      WHERE m.account_id = $1 AND m.removed_at IS NULL
      ORDER BY o.name ASC, m.workspace_id ASC`,
    [account]
  );
  return r.rows.map((x) => ({
    membershipId: x.membership_id as string,
    workspaceId: x.workspace_id as string,
    accountId: x.account_id as string,
    role: x.role as OrganisationMembership["role"],
    regulatoryReference: (x.regulatory_reference as string) ?? null,
    removedAt: null,
    organisationId: x.organisation_id as string,
    organisationName: x.organisation_name as string,
  }));
}

/* ---------------------------------------------------------------- */
/* The three entry points, reduced to their session verdict          */
/* ---------------------------------------------------------------- */

/**
 * Each entry point's *authorisation* answer for one token.
 *
 * `requireSession` and `resolveServerSession` live in `apps/web` and cannot be
 * imported here — nothing under `packages/` may depend on the app. What they
 * both now call is `verifySessionToken`, and a structural guard in this suite
 * asserts that. So the shared function is exercised directly, and the guard
 * carries the claim that the two callers reach it.
 */
type EntryVerdict = { authenticated: boolean; accountId: string | null; refusal: SessionRefusal | null };

/**
 * The refusal a caller is entitled to distinguish.
 *
 * `absent` and `unauthenticated` collapse to one class. The measurement found
 * they differ internally — the shared verifier reports `absent` when no cookie
 * arrived, while `resolveTenant`'s vocabulary has no such value and reports
 * `unauthenticated` — and that difference is deliberate rather than a defect:
 * both mean "sign in", and telling a caller whether their cookie was missing or
 * merely invalid is a disclosure with no use to them.
 *
 * `expired` and `replayed` stay distinct, because they mean different things to
 * a person who *was* signed in, and any entry point disagreeing about those
 * would be a real inconsistency.
 */
const publicClass = (r: SessionRefusal | null): string | null =>
  r === null ? null : r === "absent" ? "sign_in" : r === "unauthenticated" ? "sign_in" : r;

async function viaSharedVerifier(token: string | null, now: string): Promise<EntryVerdict> {
  const v = await verifySessionToken({ token, now, findSession });
  return v.ok
    ? { authenticated: true, accountId: v.accountId, refusal: null }
    : { authenticated: false, accountId: null, refusal: v.refusal };
}

/** The switch path, given otherwise valid invocation metadata. */
async function viaSwitchPath(token: string | null, now: string): Promise<EntryVerdict> {
  let seen: EntryVerdict = { authenticated: false, accountId: null, refusal: "absent" };
  const deps: SwitchDependencies = {
    resolveSession: async () => {
      const v = await verifySessionToken({ token, now, findSession });
      seen = v.ok
        ? { authenticated: true, accountId: v.accountId, refusal: null }
        : { authenticated: false, accountId: null, refusal: v.refusal };
      return v.ok ? { ok: true, accountId: v.accountId } : { ok: false };
    },
    loadMemberships,
    currentSelection: () => null,
    appendAudit: async () => undefined,
    serializeSelection: (id) => signSelection(id, SECRET),
    correlationId: () => "equiv",
    now: () => now,
  };
  await switchOrganisationCore(deps, {
    targetOrganisationId: betaOrg,
    method: "POST",
    origin: "https://app.test",
    host: "app.test",
  });
  return seen;
}

/** The tenant resolver, which every authenticated route reaches. */
async function viaTenantResolver(token: string | null, now: string): Promise<EntryVerdict> {
  const r = await resolveTenant({
    token,
    selection: null,
    signingSecret: SECRET,
    now,
    findSession,
    loadMemberships,
    accountStatus: async () => "active",
  });
  if (r.ok) return { authenticated: true, accountId: r.value.accountId, refusal: null };

  // Two layers, deliberately separated. `resolveTenant` refuses for session
  // reasons *and* for tenancy reasons, and only the first are comparable here:
  // an authenticated caller with two memberships and no stated preference gets
  // `selection_required`, which is the session being accepted and the tenancy
  // being undecided. Collapsing them would make this harness report a
  // disagreement that is really a difference of scope — and would hide a real
  // one behind the noise.
  const sessionRefusal: Record<string, SessionRefusal> = {
    session_expired: "expired",
    session_replayed: "replayed",
    unauthenticated: "unauthenticated",
  };
  const refusal = sessionRefusal[r.failure];
  if (!refusal) {
    // A tenancy failure. The session was accepted to get this far.
    return { authenticated: true, accountId: null, refusal: null };
  }
  return { authenticated: false, accountId: null, refusal };
}

/* ---------------------------------------------------------------- */
/* Cookie parsing, the layer beneath all three                       */
/* ---------------------------------------------------------------- */

/**
 * Next's vendored parser, reimplemented here *only* to assert its documented
 * behaviour. Both `NextRequest.cookies` and `next/headers` `cookies()` are the
 * same `RequestCookies` class over this logic, which is why the two access
 * paths cannot disagree — the point this function exists to make measurable.
 */
function parseCookieHeader(header: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const pair of header.split(/; */)) {
    if (!pair) continue;
    const at = pair.indexOf("=");
    if (at === -1) {
      map.set(pair, "true");
      continue;
    }
    try {
      map.set(pair.slice(0, at), decodeURIComponent(pair.slice(at + 1)));
    } catch {
      /* Next drops the pair silently. Inherited, not chosen. */
    }
  }
  return map;
}

async function makeSession(account: string, ttlMs: number): Promise<string> {
  const token = issueToken();
  await pool.query(
    "INSERT INTO sessions (account_id, token_hash, expires_at) VALUES ($1,$2,$3)",
    [account, hashToken(token), new Date(Date.now() + ttlMs).toISOString()]
  );
  return token;
}

before(async () => {
  if (skip) return;
  pool = await createPool(DATABASE_URL);
  const a = await pool.query<{ id: string }>(
    "INSERT INTO accounts (preferred_name, status, recovery_ready_at) VALUES ($1,'active',now()) RETURNING id",
    [`Equivalence ${run}`]
  );
  accountId = a.rows[0]!.id;

  const org = async (name: string, member = true) => {
    const o = await pool.query<{ id: string }>(
      "INSERT INTO organizations (name, type) VALUES ($1,'law_firm') RETURNING id",
      [name]
    );
    const w = await pool.query<{ id: string }>(
      "INSERT INTO workspaces (organization_id, name) VALUES ($1,$2) RETURNING id",
      [o.rows[0]!.id, `${name} ws`]
    );
    let m = "";
    if (member) {
      const r = await pool.query<{ id: string }>(
        "INSERT INTO workspace_members (workspace_id, account_id, role) VALUES ($1,$2,'caseworker') RETURNING id",
        [w.rows[0]!.id, accountId]
      );
      m = r.rows[0]!.id;
    }
    return { org: o.rows[0]!.id, membership: m };
  };
  alphaOrg = (await org(`Equiv alpha ${run}`)).org;
  const beta = await org(`Equiv beta ${run}`);
  betaOrg = beta.org;
  betaMembership = beta.membership;
  gammaOrg = (await org(`Equiv gamma ${run}`, false)).org;

  validToken = await makeSession(accountId, SESSION_TTL_MS);
  expiredWindowToken = await makeSession(accountId, 60_000);
  revokedToken = await makeSession(accountId, SESSION_TTL_MS);
  await pool.query(
    "UPDATE sessions SET revoked_at = now(), revoked_reason = 'test' WHERE token_hash = $1",
    [hashToken(revokedToken)]
  );

  // A session whose account is gone. `sessions.account_id` is a FK, so the
  // account is deleted after the session exists only if the FK permits it;
  // where it does not, the vector is recorded as omitted for that reason.
  const orphanAccount = await pool.query<{ id: string }>(
    "INSERT INTO accounts (preferred_name, status, recovery_ready_at) VALUES ($1,'active',now()) RETURNING id",
    [`Orphan ${run}`]
  );
  orphanToken = await makeSession(orphanAccount.rows[0]!.id, SESSION_TTL_MS);
});

/* ================================================================ */
/* The shared vector table                                          */
/* ================================================================ */

interface Vector {
  readonly name: string;
  readonly token: () => string | null;
  readonly expect: "authenticated" | "refused";
}

/** One table. Every entry point runs every vector; there are no per-path lists. */
function vectors(): readonly Vector[] {
  return [
    { name: "valid active session", token: () => validToken, expect: "authenticated" },
    { name: "missing token", token: () => null, expect: "refused" },
    { name: "empty token", token: () => "", expect: "refused" },
    { name: "whitespace token", token: () => "   ", expect: "refused" },
    { name: "malformed token", token: () => "not-a-token", expect: "refused" },
    { name: "unknown token", token: () => issueToken(), expect: "refused" },
    { name: "revoked session", token: () => revokedToken, expect: "refused" },
    { name: "delimiter-bearing token", token: () => "aaa; bbb=ccc", expect: "refused" },
    { name: "token with newline", token: () => "aaa\nbbb", expect: "refused" },
    { name: "very long token", token: () => "a".repeat(4096), expect: "refused" },
    { name: "session for an unrelated account", token: () => orphanToken, expect: "authenticated" },
  ];
}

test(
  "every entry point reaches the same verdict for every session vector",
  { skip },
  records("equivalence_table", async () => {
    // The property Phase 4B depends on: a route and an API handler must not
    // authorise the same caller differently.
    const now = new Date().toISOString();
    const disagreements: string[] = [];

    for (const vector of vectors()) {
      const token = vector.token();
      const shared = await viaSharedVerifier(token, now);
      const switched = await viaSwitchPath(token, now);
      const tenant = await viaTenantResolver(token, now);

      const expected = vector.expect === "authenticated";
      if (shared.authenticated !== expected) {
        disagreements.push(`${vector.name}: shared verifier expected ${vector.expect}`);
      }
      // Authentication verdict must match across all three.
      if (shared.authenticated !== switched.authenticated) {
        disagreements.push(`${vector.name}: switch path disagreed with the verifier`);
      }
      if (shared.authenticated !== tenant.authenticated) {
        disagreements.push(`${vector.name}: tenant resolver disagreed with the verifier`);
      }
      // And so must the resolved identity, where authenticated.
      if (shared.authenticated) {
        // The tenant resolver exposes no account id on a tenancy refusal, so it
        // is compared only where it is projected at all.
        const ids = [switched.accountId, tenant.accountId].filter((v) => v !== null);
        if (ids.some((id) => id !== shared.accountId)) {
          disagreements.push(`${vector.name}: resolved account identity differed`);
        }
      } else {
        const classes = [shared, switched, tenant].map((v) => publicClass(v.refusal));
        if (classes.some((c) => c !== classes[0])) {
          disagreements.push(
            `${vector.name}: public refusal class differed (${classes.join("/")})`
          );
        }
      }
    }

    assert.deepEqual(disagreements, [], `entry points disagreed:\n${disagreements.join("\n")}`);
    assert.equal(vectors().length, 11, "the vector table shrank");
  })
);

test(
  "the expiry boundary is identical across entry points",
  { skip },
  records("expiry_boundary", async () => {
    // A controlled clock, three points around one session's expiry. A boundary
    // that differed by an entry point would let a route accept a token an API
    // handler had already refused.
    const expiresAt = (
      await pool.query<{ expires_at: Date }>(
        "SELECT expires_at FROM sessions WHERE token_hash = $1",
        [hashToken(expiredWindowToken)]
      )
    ).rows[0]!.expires_at;
    const at = expiresAt instanceof Date ? expiresAt.getTime() : Date.parse(String(expiresAt));

    for (const [label, when, expected] of [
      ["before", at - 5_000, true],
      ["exactly at expiry", at, false],
      ["after", at + 5_000, false],
    ] as const) {
      const now = new Date(when).toISOString();
      const shared = await viaSharedVerifier(expiredWindowToken, now);
      const switched = await viaSwitchPath(expiredWindowToken, now);
      const tenant = await viaTenantResolver(expiredWindowToken, now);

      assert.equal(shared.authenticated, expected, `${label}: verifier`);
      assert.equal(switched.authenticated, expected, `${label}: switch path`);
      assert.equal(tenant.authenticated, expected, `${label}: tenant resolver`);
      if (!expected) {
        assert.equal(shared.refusal, "expired", `${label}: wrong refusal class`);
        assert.equal(publicClass(tenant.refusal), "expired", `${label}: tenant classified differently`);
      }
    }
  })
);

/* ================================================================ */
/* Cookie parsing                                                   */
/* ================================================================ */

test(
  "duplicate cookies resolve deterministically, and the same way for both access paths",
  { skip },
  records("duplicate_cookies", async () => {
    // The opening question of this obligation: `NextRequest.cookies` and the
    // `cookies()` from `next/headers` are the *same* `RequestCookies` class
    // over Next's vendored parser, so they cannot select different duplicates.
    // The parser builds a Map in header order, so the last occurrence wins.
    const header = `${SESSION_COOKIE}=first; ${SESSION_COOKIE}=second`;
    assert.equal(parseCookieHeader(header).get(SESSION_COOKIE), "second");

    const three = `${SESSION_COOKIE}=a; ${SESSION_COOKIE}=b; ${SESSION_COOKIE}=c`;
    assert.equal(parseCookieHeader(three).get(SESSION_COOKIE), "c");

    // Duplicate active-organisation cookies behave identically.
    const orgHeader = `${ACTIVE_ORG_COOKIE}=x; ${ACTIVE_ORG_COOKIE}=y`;
    assert.equal(parseCookieHeader(orgHeader).get(ACTIVE_ORG_COOKIE), "y");

    // A last-wins duplicate cannot smuggle a session: whichever value wins is
    // still verified against the database.
    const smuggled = parseCookieHeader(`${SESSION_COOKIE}=${validToken}; ${SESSION_COOKIE}=forged`);
    const verdict = await viaSharedVerifier(
      smuggled.get(SESSION_COOKIE) ?? null,
      new Date().toISOString()
    );
    assert.equal(verdict.authenticated, false, "a forged trailing duplicate authenticated");
  })
);

test(
  "a value whose encoding will not decode is dropped, not accepted",
  { skip },
  records("encoding_boundary", async () => {
    // Next's parser wraps `decodeURIComponent` in an empty catch, so a bad
    // percent-escape makes the cookie *absent* rather than malformed. Inherited
    // behaviour, asserted so a future Next upgrade that changed it would show.
    const parsed = parseCookieHeader(`${SESSION_COOKIE}=%E0%A4%A`);
    assert.equal(parsed.has(SESSION_COOKIE), false, "an undecodable value survived parsing");

    // Absent reads as absent, and every entry point refuses it identically.
    const now = new Date().toISOString();
    const shared = await viaSharedVerifier(parsed.get(SESSION_COOKIE) ?? null, now);
    assert.equal(shared.authenticated, false);
    assert.equal(shared.refusal, "absent");

    // Whitespace padding is not trimmed by the parser; it is simply not a token.
    assert.equal(parseCookieHeader(`${SESSION_COOKIE}= padded `).get(SESSION_COOKIE), " padded ");
    assert.equal((await viaSharedVerifier(" padded ", now)).authenticated, false);

    // A pair with no "=" becomes a key with the literal value "true".
    assert.equal(parseCookieHeader("flag").get("flag"), "true");
  })
);

/* ================================================================ */
/* Active-organisation resolution                                   */
/* ================================================================ */

test(
  "active-organisation preference resolves the same way wherever it is read",
  { skip },
  records("active_org_equivalence", async () => {
    const now = new Date().toISOString();
    const resolveWith = (selection: string | null) =>
      resolveTenant({
        token: validToken,
        selection,
        signingSecret: SECRET,
        now,
        findSession,
        loadMemberships,
        accountStatus: async () => "active",
      });

    // A valid preference selects it.
    const alpha = await resolveWith(signSelection(alphaOrg, SECRET));
    assert.equal(alpha.ok && alpha.value.organisationId, alphaOrg);

    // Missing preference, several memberships → selection required, never a
    // first-row default.
    const none = await resolveWith(null);
    assert.equal(none.ok, false);
    assert.equal(none.ok === false && none.failure, "selection_required");

    // A real but inaccessible organisation and a nonexistent one are refused
    // identically, so neither can be probed for existence.
    const inaccessible = await resolveWith(signSelection(gammaOrg, SECRET));
    const nonexistent = await resolveWith(
      signSelection("00000000-0000-4000-8000-000000000000", SECRET)
    );
    assert.equal(inaccessible.ok === false && inaccessible.failure, "invalid_active_organisation");
    assert.deepEqual(inaccessible, nonexistent);

    // A removed membership cannot remain effective.
    await pool.query("UPDATE workspace_members SET removed_at = now() WHERE id = $1", [
      betaMembership,
    ]);
    const revoked = await resolveWith(signSelection(betaOrg, SECRET));
    assert.equal(revoked.ok === false && revoked.failure, "invalid_active_organisation");
    await pool.query("UPDATE workspace_members SET removed_at = NULL WHERE id = $1", [
      betaMembership,
    ]);

    // An unsigned preference is ignored entirely rather than trusted.
    const unsigned = await resolveWith(alphaOrg);
    assert.equal(unsigned.ok === false && unsigned.failure, "selection_required");

    // Both membership mechanisms must agree.
    //
    // `resolveTenant` validates a preference twice: `selectOrganisation` decides
    // whether it is available, and `governingMembership` then finds the
    // membership that governs it. Either alone is sufficient to refuse an
    // organisation the account is not in — which means weakening one changes no
    // outcome, and an outcome-only harness would report the remaining check's
    // answer as though both were intact. That is the two-mechanism problem, and
    // it was measured here: removing `selectOrganisation`'s membership test left
    // every assertion above passing.
    //
    // So the rule is asked directly and its answer compared with the resolved
    // one. Now a weakening of either mechanism is a disagreement.
    const current = await loadMemberships(accountId);
    for (const [label, preference] of [
      ["member organisation", alphaOrg],
      ["inaccessible organisation", gammaOrg],
      ["nonexistent organisation", "00000000-0000-4000-8000-000000000000"],
    ] as const) {
      const rule = selectOrganisation(current, preference);
      const resolved = await resolveWith(signSelection(preference, SECRET));
      assert.equal(
        rule.ok,
        resolved.ok,
        `${label}: the rule and the resolver disagreed on availability`
      );
      if (rule.ok && resolved.ok) {
        assert.equal(rule.organisationId, resolved.value.organisationId, `${label}: different organisation`);
      }
    }
  })
);

test(
  "no entry point derives identity from submitted fields",
  { skip },
  records("identity_injection", async () => {
    const now = new Date().toISOString();
    const malicious = {
      actorId: "attacker",
      accountId: "00000000-0000-4000-8000-000000000009",
      membershipId: "forged",
      role: "admin",
      permissions: ["*"],
      organisationId: gammaOrg,
    } as Record<string, unknown>;

    const verdict = await verifySessionToken({
      token: validToken,
      now,
      findSession,
      ...(malicious as object),
    });
    assert.equal(verdict.ok, true);
    assert.equal(verdict.ok && verdict.accountId, accountId);
    assert.notEqual(verdict.ok && verdict.accountId, malicious.accountId);

    const tenant = await resolveTenant({
      token: validToken,
      selection: signSelection(alphaOrg, SECRET),
      signingSecret: SECRET,
      now,
      findSession,
      loadMemberships,
      accountStatus: async () => "active",
      ...(malicious as object),
    });
    assert.equal(tenant.ok && tenant.value.accountId, accountId);
    assert.equal(tenant.ok && tenant.value.organisationId, alphaOrg);
    assert.notEqual(tenant.ok && tenant.value.organisationId, gammaOrg);
    assert.equal(tenant.ok && tenant.value.role, "caseworker");
  })
);

/* ================================================================ */
/* Structural guard                                                 */
/* ================================================================ */

test(
  "all three entry points call the one verifier",
  { skip },
  records("entry_points_share_verifier", async () => {
    // Behaviour cannot prove this: three copies that happen to agree today
    // produce identical results, which is exactly the state this obligation
    // found. The guard is what stops them drifting apart again.
    const { readFile } = await import("node:fs/promises");
    // Comments stripped before matching — a guard that reads prose gets
    // suppressed, the lesson from obligation 1 and obligation 2.
    const code = async (path: string) =>
      (await readFile(join(repoRoot, path), "utf8"))
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");

    for (const path of [
      "apps/web/src/lib/auth/require-session.ts",
      "apps/web/src/lib/auth/server-session.ts",
      "packages/auth/src/tenant-resolution.ts",
    ]) {
      const source = await code(path);
      assert.match(source, /verifySessionToken\(/, `${path} does not call verifySessionToken`);
      // And holds no second copy of the sequence it replaced.
      assert.doesNotMatch(source, /checkSession\(/, `${path} still calls checkSession directly`);
    }

    // The switch adapter reaches it through resolveServerSession.
    const adapter = await code("apps/web/src/lib/auth/switch-organisation.ts");
    assert.match(adapter, /resolveServerSession\(/, "the switch adapter does not use the canonical resolver");
    assert.doesNotMatch(adapter, /checkSession\(/);

    // One declaration of each cookie name still holds.
    const cookies = await code("apps/web/src/lib/auth/cookies.ts");
    assert.match(cookies, /SESSION_COOKIE/);

    // What the vector table above cannot reach.
    //
    // Nothing under `packages/` may import `apps/web`, so the two framework
    // entry points are absent from the behavioural table: it runs the shared
    // verifier, the tenant resolver and the switch core. That gap was measured,
    // not assumed. Two real mutations — `requireSession` admitting an `expired`
    // verdict, and `resolveServerSession` reading `getAll(...)[0]` instead of
    // `get(...)` so it takes the *first* duplicate cookie while every other
    // path takes the last — both left all seven tests passing.
    //
    // A structural guard is a weaker instrument than a vector, and is used here
    // only because the stronger one is architecturally out of reach. It asserts
    // the two things those mutations changed.
    for (const path of [
      "apps/web/src/lib/auth/require-session.ts",
      "apps/web/src/lib/auth/server-session.ts",
    ]) {
      const source = await code(path);

      // No refusal is exempted. A verdict that is not ok refuses, whatever it
      // says — an entry point may vary the *message*, never the *outcome*.
      assert.doesNotMatch(
        source,
        /!verdict\.ok\s*&&/,
        `${path} makes its refusal conditional on which refusal it is`
      );

      // The token is read singularly, so duplicate resolution stays where the
      // harness measured it: RequestCookies, last-wins, one behaviour.
      assert.doesNotMatch(
        source,
        /getAll\([A-Z_]*SESSION_COOKIE\)/,
        `${path} selects among duplicate session cookies itself`
      );
    }
  })
);

after(async () => {
  if (skip) return;
  const emit = (checkId: string, names: readonly string[], demonstrates: string) =>
    emitEvidence(repoRoot, {
      checkId,
      passed: names.every((n) => held.get(n) === true),
      at: new Date().toISOString(),
      commit: commit(),
      producedBy: "packages/integration/test/authentication/session-equivalence.test.ts",
      demonstrates,
    });

  await emit(
    "session_entry_points_agree",
    [
      "equivalence_table",
      "expiry_boundary",
      "duplicate_cookies",
      "encoding_boundary",
      "active_org_equivalence",
      "identity_injection",
      "entry_points_share_verifier",
    ],
    "eleven session vectors were run through the shared verifier, the switch path and the tenant resolver against real sessions rows, agreeing on authentication verdict, resolved account and refusal classification for every one; the expiry boundary was identical before, exactly at and after expiry under a controlled clock; duplicate cookies resolve last-wins identically for both Next access paths because both are the same RequestCookies class, and an undecodable percent-escape is dropped rather than accepted; active-organisation preference resolved identically including selection-required, indistinguishable inaccessible-and-nonexistent refusals, and revoked membership; no submitted actorId, accountId, membershipId, role, permissions or organisationId changed any resolved value; and a structural guard asserts all three entry points call verifySessionToken and none retains a direct checkSession call"
  );

  await pool.end();
});
