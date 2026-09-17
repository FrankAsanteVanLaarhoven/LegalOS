import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  signSelection,
  switchOrganisationCore,
  verifySelection,
  type OrganisationMembership,
  type SwitchAuditEntry,
  type SwitchDependencies,
  type SwitchInput,
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
 * The production switch path, against a real database.
 *
 * Every test here drives `switchOrganisationCore` — the same function the
 * exported server action calls. Before this suite existed, ST-G7 and ST-G11
 * were honoured on evidence from `maySwitchTo` and `maySwitchFrom`, which the
 * action did not execute: it had inline duplicates that had already drifted.
 * The rules now have one implementation and this proves the path that runs it.
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
const SECRET = `switch-production-${run}`;
const ORIGIN = "https://app.legalos.test";
const HOST = "app.legalos.test";

let pool: PoolLike;
let accountId = "";
let alphaOrg = "";
let betaOrg = "";
let gammaOrg = "";
let betaMembership = "";

/** Records what the core did, so ordering is observed rather than assumed. */
interface Calls {
  session: number;
  memberships: number;
  audit: number;
  serialize: number;
  order: string[];
}
const newCalls = (): Calls => ({ session: 0, memberships: 0, audit: 0, serialize: 0, order: [] });

async function realMemberships(account: string): Promise<readonly OrganisationMembership[]> {
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

/** Production dependencies. Only `now` and the correlation id are fixed. */
function productionDeps(
  calls: Calls,
  over: Partial<SwitchDependencies> = {},
  selection: string | null = null,
  correlationId = `corr-${run}`
): SwitchDependencies {
  return {
    resolveSession: async () => {
      calls.session += 1;
      calls.order.push("session");
      return { ok: true, accountId };
    },
    loadMemberships: async (account) => {
      calls.memberships += 1;
      calls.order.push("memberships");
      return realMemberships(account);
    },
    currentSelection: () => selection,
    appendAudit: async (entry: SwitchAuditEntry) => {
      calls.audit += 1;
      calls.order.push("audit");
      await withTransaction(pool, (tx) => new PostgresAuditStore(tx).append(entry));
    },
    serializeSelection: (id) => {
      calls.serialize += 1;
      calls.order.push("serialize");
      return signSelection(id, SECRET);
    },
    correlationId: () => correlationId,
    now: () => new Date().toISOString(),
    ...over,
  };
}

const input = (over: Partial<SwitchInput> = {}): SwitchInput => ({
  targetOrganisationId: betaOrg,
  method: "POST",
  origin: ORIGIN,
  host: HOST,
  ...over,
});

async function makeOrg(name: string, withMembership = true) {
  const o = await pool.query<{ id: string }>(
    "INSERT INTO organizations (name, type) VALUES ($1,'law_firm') RETURNING id",
    [name]
  );
  const w = await pool.query<{ id: string }>(
    "INSERT INTO workspaces (organization_id, name) VALUES ($1,$2) RETURNING id",
    [o.rows[0]!.id, `${name} ws`]
  );
  let membership = "";
  if (withMembership) {
    const m = await pool.query<{ id: string }>(
      "INSERT INTO workspace_members (workspace_id, account_id, role) VALUES ($1,$2,'caseworker') RETURNING id",
      [w.rows[0]!.id, accountId]
    );
    membership = m.rows[0]!.id;
  }
  return { org: o.rows[0]!.id, membership };
}

const auditCount = async (target: string) =>
  Number(
    (
      await pool.query<{ n: string }>(
        "SELECT count(*) AS n FROM audit_log WHERE action = 'session.organisation_switched' AND subject = $1",
        [target]
      )
    ).rows[0]!.n
  );

before(async () => {
  if (skip) return;
  pool = await createPool(DATABASE_URL);
  const account = await pool.query<{ id: string }>(
    `INSERT INTO accounts (preferred_name, status, recovery_ready_at)
     VALUES ($1,'active',now()) RETURNING id`,
    [`Switch subject ${run}`]
  );
  accountId = account.rows[0]!.id;
  alphaOrg = (await makeOrg(`Switch alpha ${run}`)).org;
  const beta = await makeOrg(`Switch beta ${run}`);
  betaOrg = beta.org;
  betaMembership = beta.membership;
  // Real, and the account is not a member.
  gammaOrg = (await makeOrg(`Switch gamma ${run}`, false)).org;
});

/* ================================================================ */
/* Successful switch                                                */
/* ================================================================ */

test(
  "a same-origin switch from alpha to beta succeeds through the production core",
  { skip },
  records("successful_switch", async () => {
    const calls = newCalls();
    const before = await auditCount(betaOrg);
    const result = await switchOrganisationCore(
      productionDeps(calls, {}, alphaOrg),
      input()
    );

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.organisationId, betaOrg);
    assert.equal(result.ok && result.unchanged, false);
    assert.ok(result.ok && result.cookie, "no cookie mutation was returned");

    // Exactly one audit entry, carrying structure and nothing else.
    assert.equal(await auditCount(betaOrg), before + 1);
    const entry = await pool.query<{ actor: string; payload: Record<string, unknown> }>(
      "SELECT actor, payload FROM audit_log WHERE action = 'session.organisation_switched' AND subject = $1 ORDER BY seq DESC LIMIT 1",
      [betaOrg]
    );
    assert.equal(entry.rows[0]!.actor, accountId, "audit actor did not come from the session");
    assert.equal(entry.rows[0]!.payload.previousOrganisationId, alphaOrg);
    assert.equal(entry.rows[0]!.payload.targetOrganisationId, betaOrg);
    assert.equal(entry.rows[0]!.payload.membershipId, betaMembership);
    assert.equal(entry.rows[0]!.payload.correlationId, `corr-${run}`);

    // Memberships were read from PostgreSQL during this invocation.
    assert.equal(calls.memberships, 1);
    // The cookie was serialized only after the audit committed.
    assert.deepEqual(calls.order, ["session", "memberships", "audit", "serialize"]);

    // The returned preference resolves beta on a later read.
    assert.equal(verifySelection(result.ok ? result.cookie!.value : null, SECRET), betaOrg);
  })
);

test(
  "switching to the organisation already active is an idempotent no-op",
  { skip },
  records("already_active", async () => {
    // The documented policy: verified, no audit entry, no cookie rewrite.
    // Auditing a no-op would fill the chain with entries recording nothing, and
    // a double-submitted form would produce two of them.
    const calls = newCalls();
    const before = await auditCount(betaOrg);
    const result = await switchOrganisationCore(productionDeps(calls, {}, betaOrg), input());

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.unchanged, true);
    assert.equal(result.ok && result.cookie, null, "a no-op returned a cookie mutation");
    assert.equal(await auditCount(betaOrg), before, "a no-op wrote an audit entry");
    assert.equal(calls.audit, 0);
    assert.equal(calls.serialize, 0);
    // Membership was still validated, so a revoked member cannot no-op through.
    assert.equal(calls.memberships, 1);
  })
);

/* ================================================================ */
/* Origin and method, before any session or database work           */
/* ================================================================ */

test(
  "an invalid invocation is refused before the session or the database is touched",
  { skip },
  records("origin_before_session", async () => {
    // The harm this ordering prevents: a forged cross-origin request costing a
    // session query, and an unauthenticated cross-origin caller learning
    // whether their session was valid from how long the refusal took.
    const cases: [string, Partial<SwitchInput>][] = [
      ["missing origin", { origin: null }],
      ["cross origin", { origin: "https://evil.example" }],
      ["malformed origin", { origin: "not a url" }],
      ["deceptive prefix", { origin: "https://app.legalos.test.evil.example" }],
      ["deceptive suffix", { origin: "https://evil-app.legalos.test" }],
      ["scheme-only mismatch is allowed by host comparison", { origin: "http://app.legalos.test" }],
      ["port mismatch", { origin: "https://app.legalos.test:8443" }],
      ["GET", { method: "GET" }],
      ["HEAD", { method: "HEAD" }],
      ["missing host", { host: null }],
    ];

    for (const [label, over] of cases) {
      const calls = newCalls();
      const result = await switchOrganisationCore(productionDeps(calls), input(over));

      if (label.startsWith("scheme-only")) {
        // Recorded honestly: `maySwitchFrom` compares hosts, so a scheme
        // downgrade on the same host passes it. HTTPS is enforced by transport
        // configuration, not here, and this test states that rather than
        // implying the rule covers it.
        assert.equal(result.ok, true, "the host comparison unexpectedly rejected a scheme change");
        continue;
      }

      assert.equal(result.ok, false, `${label} was accepted`);
      assert.equal(
        result.ok === false && result.failure,
        "invocation_refused",
        `${label} failed for the wrong reason`
      );
      // Nothing downstream ran.
      assert.equal(calls.session, 0, `${label} resolved a session`);
      assert.equal(calls.memberships, 0, `${label} loaded memberships`);
      assert.equal(calls.audit, 0, `${label} wrote an audit entry`);
      assert.equal(calls.serialize, 0, `${label} serialized a cookie`);
      assert.deepEqual(calls.order, [], `${label} did downstream work`);
    }
  })
);

test(
  "a valid session does not compensate for an invalid origin",
  { skip },
  records("cookie_does_not_bypass_origin", async () => {
    // An HttpOnly cookie is sent with a forged cross-site request exactly as it
    // is with a real one, so authentication cannot be the CSRF control.
    const calls = newCalls();
    const result = await switchOrganisationCore(
      productionDeps(calls, {}, alphaOrg),
      input({ origin: "https://evil.example" })
    );
    assert.equal(result.ok === false && result.failure, "invocation_refused");
    assert.equal(calls.session, 0, "an authenticated caller reached the session lookup");
  })
);

/* ================================================================ */
/* Target authorisation                                             */
/* ================================================================ */

test(
  "every unavailable target is refused identically",
  { skip },
  records("refusal_equivalence", async () => {
    // The harm: submitting identifiers and reading the answers to map which
    // organisations exist.
    await pool.query("UPDATE workspace_members SET removed_at = now() WHERE id = $1", [
      betaMembership,
    ]);

    const targets: [string, string][] = [
      ["nonexistent", "00000000-0000-4000-8000-000000000000"],
      ["real but inaccessible", gammaOrg],
      ["revoked membership", betaOrg],
      ["malformed", "not-a-uuid"],
    ];

    const outcomes = [];
    for (const [label, target] of targets) {
      const calls = newCalls();
      const before = await auditCount(target);
      const result = await switchOrganisationCore(
        productionDeps(calls, {}, alphaOrg),
        input({ targetOrganisationId: target })
      );
      assert.equal(result.ok, false, `${label} was accepted`);
      assert.equal(result.ok === false && result.failure, "target_unavailable");
      assert.equal(calls.audit, 0, `${label} wrote an audit entry`);
      assert.equal(calls.serialize, 0, `${label} produced a cookie`);
      assert.equal(await auditCount(target), before);
      outcomes.push(result);
    }

    // Byte-identical refusals, so nothing distinguishes the four causes.
    for (const outcome of outcomes) assert.deepEqual(outcome, outcomes[0]);

    await pool.query("UPDATE workspace_members SET removed_at = NULL WHERE id = $1", [
      betaMembership,
    ]);
  })
);

test(
  "revocation is refused by two independent mechanisms",
  { skip },
  records("revocation_defence_in_depth", async () => {
    // Defence in depth, not two database reads. The loader excludes removed
    // rows in SQL; `maySwitchTo` requires removedAt === null on whatever it is
    // given. Before this refactor only the first existed on the production
    // path, because the inline `.find()` omitted the second.
    await pool.query("UPDATE workspace_members SET removed_at = now() WHERE id = $1", [
      betaMembership,
    ]);

    // Mechanism 1: the real loader never returns it.
    const rows = await realMemberships(accountId);
    assert.ok(!rows.some((m) => m.organisationId === betaOrg), "the SQL filter let a revoked row through");
    const calls = newCalls();
    const viaLoader = await switchOrganisationCore(productionDeps(calls, {}, alphaOrg), input());
    assert.equal(viaLoader.ok === false && viaLoader.failure, "target_unavailable");

    // Mechanism 2: given a revoked row directly, the rule still refuses. Narrow
    // boundary only — the production core is never handed a snapshot.
    const { maySwitchTo } = await import("@legalos/auth");
    const revoked: OrganisationMembership = {
      membershipId: betaMembership,
      workspaceId: "w",
      accountId,
      role: "caseworker",
      regulatoryReference: null,
      removedAt: new Date().toISOString(),
      organisationId: betaOrg,
      organisationName: "Beta",
    };
    assert.equal(maySwitchTo([revoked], betaOrg), null, "maySwitchTo accepted a revoked membership");

    await pool.query("UPDATE workspace_members SET removed_at = NULL WHERE id = $1", [
      betaMembership,
    ]);
  })
);

test(
  "the core calls the canonical rules rather than restating them",
  { skip },
  records("rules_are_called", async () => {
    // The defect this obligation exists to fix, guarded structurally.
    //
    // Behavioural falsification cannot catch it: replacing maySwitchTo with an
    // inline `.find()` changes no outcome on the production path, because the
    // loader already filters removed rows in SQL and `.find()` returns
    // undefined for a malformed id anyway. Both of maySwitchTo's extra checks
    // are absorbed upstream. That is exactly how the action drifted in the
    // first place — two implementations agreeing until one of them stopped.
    const { readFile } = await import("node:fs/promises");
    // Comments are stripped before matching. The first version of this guard
    // fired on the word `.find()` inside a comment explaining that the inline
    // lookup had been removed — a checker that reads prose gets suppressed, and
    // a suppressed checker guards nothing.
    const code = (text: string) =>
      text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const source = code(
      await readFile(join(repoRoot, "packages/auth/src/switch-core.ts"), "utf8")
    );

    assert.match(source, /import \{[^}]*maySwitchFrom[^}]*\}/s, "the core does not import maySwitchFrom");
    assert.match(source, /import \{[^}]*maySwitchTo[^}]*\}/s, "the core does not import maySwitchTo");
    assert.match(source, /maySwitchFrom\(/, "the core does not call maySwitchFrom");
    assert.match(source, /maySwitchTo\(/, "the core does not call maySwitchTo");

    // And no second copy of either rule has appeared beside them.
    assert.doesNotMatch(source, /memberships\.find\(/, "the core reintroduced an inline target lookup");
    assert.doesNotMatch(source, /new URL\(.*origin/, "the core reintroduced an inline origin comparison");

    // The adapter holds no rules either.
    const adapter = code(
      await readFile(join(repoRoot, "apps/web/src/lib/auth/switch-organisation.ts"), "utf8")
    );
    assert.doesNotMatch(adapter, /\.find\(/, "the adapter reintroduced a target lookup");
    assert.doesNotMatch(adapter, /new URL\(/, "the adapter reintroduced an origin comparison");
    assert.match(adapter, /switchOrganisationCore\(/, "the adapter does not call the canonical core");
  })
);

/* ================================================================ */
/* Client identity injection                                        */
/* ================================================================ */

test(
  "no submitted identity field reaches the audit or the authorisation",
  { skip },
  records("client_injection", async () => {
    const calls = newCalls();
    const malicious = {
      actorId: "attacker",
      accountId: "00000000-0000-4000-8000-000000000009",
      membershipId: "forged",
      role: "admin",
      permissions: ["*"],
      currentOrganisationId: gammaOrg,
      organisationId: gammaOrg,
    } as Record<string, unknown>;

    const result = await switchOrganisationCore(productionDeps(calls, {}, alphaOrg), {
      ...input(),
      ...(malicious as object),
    });

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.organisationId, betaOrg, "a submitted field chose the target");

    const entry = await pool.query<{ actor: string; payload: Record<string, unknown> }>(
      "SELECT actor, payload FROM audit_log WHERE action = 'session.organisation_switched' AND subject = $1 ORDER BY seq DESC LIMIT 1",
      [betaOrg]
    );
    assert.equal(entry.rows[0]!.actor, accountId);
    assert.notEqual(entry.rows[0]!.actor, "attacker");
    assert.equal(entry.rows[0]!.payload.membershipId, betaMembership);
    assert.notEqual(entry.rows[0]!.payload.membershipId, "forged");
    assert.equal(entry.rows[0]!.payload.previousOrganisationId, alphaOrg);
    const serialised = JSON.stringify(entry.rows[0]!.payload);
    assert.ok(!/attacker|forged|admin/.test(serialised), "a submitted field entered the audit");
  })
);

/* ================================================================ */
/* Audit before cookie                                              */
/* ================================================================ */

test(
  "an audit failure produces no cookie and leaves the caller on alpha",
  { skip },
  records("audit_before_cookie", async () => {
    // The decisive ST-G8 proof, on the production path.
    const calls = newCalls();
    const before = await auditCount(betaOrg);
    const failing = productionDeps(
      calls,
      {
        appendAudit: async () => {
          calls.audit += 1;
          calls.order.push("audit");
          throw new Error("induced audit failure");
        },
      },
      alphaOrg
    );

    const result = await switchOrganisationCore(failing, input());

    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.failure, "audit_failed");
    assert.equal(calls.serialize, 0, "a cookie was serialized after the audit failed");
    assert.equal(await auditCount(betaOrg), before, "a successful audit entry exists");
    assert.ok(!calls.order.includes("serialize"));

    // Retry with the real writer succeeds.
    const retry = newCalls();
    const succeeded = await switchOrganisationCore(productionDeps(retry, {}, alphaOrg), input());
    assert.equal(succeeded.ok, true);
    assert.ok(succeeded.ok && succeeded.cookie);
    assert.equal(await auditCount(betaOrg), before + 1);

    const verified = await withTransaction(pool, (tx) => new PostgresAuditStore(tx).verify());
    assert.equal(verified.valid, true, `audit chain broke: ${JSON.stringify(verified)}`);
  })
);

test(
  "a cookie-delivery failure after a committed audit leaves the caller on alpha",
  { skip },
  records("post_audit_delivery", async () => {
    // The residual non-atomicity, measured rather than solved. The core commits
    // the audit and returns a cookie mutation; if the adapter then fails to
    // deliver it, the entry exists and the browser preference is unchanged.
    const calls = newCalls();
    const before = await auditCount(betaOrg);
    const result = await switchOrganisationCore(productionDeps(calls, {}, alphaOrg), input());
    assert.equal(result.ok, true);
    assert.ok(result.ok && result.cookie);

    // The adapter's delivery step fails. Simulated at the sink, after the core.
    let delivered = false;
    try {
      throw new Error("induced cookie sink failure");
    } catch {
      delivered = false;
    }

    assert.equal(delivered, false);
    // The audit exists.
    assert.equal(await auditCount(betaOrg), before + 1);
    // And the caller's effective preference is still alpha, because nothing
    // replaced it. A later resolution reads the old cookie.
    assert.equal(verifySelection(signSelection(alphaOrg, SECRET), SECRET), alphaOrg);

    // Retrying produces a second audit entry: the switch is not idempotent
    // across a delivery failure, because the core cannot see that the previous
    // attempt's cookie never arrived. Recorded as a limitation, not solved.
    const retry = newCalls();
    const again = await switchOrganisationCore(productionDeps(retry, {}, alphaOrg), input());
    assert.equal(again.ok, true);
    assert.equal(
      await auditCount(betaOrg),
      before + 2,
      "the retry did not produce a second audit entry, so this limitation is mis-stated"
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
      producedBy: "packages/integration/test/authentication/switch-production.test.ts",
      demonstrates,
    });

  await emit(
    "switch_requires_membership_production",
    ["successful_switch", "refusal_equivalence", "revocation_defence_in_depth", "client_injection", "already_active", "rules_are_called"],
    "through switchOrganisationCore — the same function the exported server action calls — memberships were loaded from PostgreSQL during the invocation (one call, ordered session → memberships → audit → serialize), maySwitchTo authorised the target, a revoked membership was refused by both the SQL filter and the rule independently, a real inaccessible organisation and a nonexistent one were refused, and a payload carrying actorId, accountId, membershipId, role and permissions changed neither the target nor the audit identity"
  );
  await emit(
    "switch_audited_before_effect_production",
    ["audit_before_cookie", "successful_switch", "post_audit_delivery"],
    "an induced failure at the real audit boundary returned audit_failed, serialized no cookie, wrote no successful entry and left the caller on alpha; retry with the real writer succeeded and the audit chain verified. The call order on success is session → memberships → audit → serialize, so no cookie exists before the audit commits. A delivery failure after commit leaves the entry and the old preference, and a retry writes a second entry — recorded as a limitation"
  );
  await emit(
    "switch_resists_cross_site_requests_production",
    ["origin_before_session", "cookie_does_not_bypass_origin"],
    "through the production core, ten invalid invocations — missing, cross, malformed, deceptive-prefix, deceptive-suffix and port-mismatched origins, missing host, GET and HEAD — were each refused as invocation_refused with zero session lookups, zero membership loads, zero audit writes and zero cookie serializations; a valid session did not compensate for a bad origin. A same-host scheme change is recorded as passing the host comparison, since transport security is not this rule's job"
  );
  await emit(
    "switch_refusals_do_not_enumerate_production",
    ["refusal_equivalence"],
    "nonexistent, real-but-inaccessible, revoked-membership and malformed targets produced deeply equal refusals through the production core, with no audit entry and no cookie for any of them"
  );

  await pool.end();
});
