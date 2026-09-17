import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import {
  signSelection,
  switchOrganisationCore,
  type OrganisationMembership,
  type SwitchDependencies,
} from "@legalos/auth";
import { createPool, type PoolLike } from "@legalos/database";

import { guardOrSkip } from "../guard.ts";

/**
 * The membership-read seam, proved before it is pointed at anything.
 *
 * Obligation 2 has to establish that `switchOrganisation` reads memberships
 * *at switch time* rather than from a snapshot taken earlier. The obvious test
 * — revoke a membership and check the switch is refused — does not establish
 * that, and the reason is a finding from Phase 4A′: mutating
 * `selectOrganisation` to drop its membership check produced no failure at all,
 * because `governingMembership` refused the same request independently. A
 * property enforced twice cannot be attributed to either mechanism by observing
 * the outcome.
 *
 * So the seam observes the read boundary itself: how many times the loader was
 * called, in what order relative to the revocation, and whether the rows it
 * returned reflect a change made moments before.
 *
 * The instrument now drives the **real** `switchOrganisationCore`. A faulty
 * snapshot-reusing stand-in is retained in two tests, not as production code
 * but to prove the instrument can still tell the two apart: an instrument only
 * ever run against correct code is indistinguishable from one that cannot
 * detect the fault.
 */
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = guardOrSkip(DATABASE_URL);

const run = Date.now().toString(36);
let pool: PoolLike;
let accountId = "";
let alphaOrg = "";
let betaOrg = "";
let betaMembership = "";

/** What the seam observed during one invocation. */
interface ReadTrace {
  /** How many times the real loader was entered. */
  calls: number;
  /** Rows returned by the last delegated read. */
  lastResult: readonly OrganisationMembership[];
  /** Ordering marks, so "before" and "after" are not inferred from timing. */
  sequence: string[];
}

/**
 * Wraps the real PostgreSQL loader.
 *
 * `beforeRead` runs immediately before the delegated query, which is what makes
 * the revocation land *between* the invocation starting and the read
 * happening. A core that read earlier, or cached, cannot see it.
 */
function instrumentedLoader(
  real: (accountId: string) => Promise<readonly OrganisationMembership[]>,
  trace: ReadTrace,
  beforeRead?: () => Promise<void>
) {
  return async (account: string): Promise<readonly OrganisationMembership[]> => {
    trace.calls += 1;
    trace.sequence.push("read:start");
    if (beforeRead) {
      await beforeRead();
      trace.sequence.push("revoked");
    }
    const rows = await real(account);
    trace.sequence.push("read:end");
    trace.lastResult = rows;
    return rows;
  };
}

/** The real loader, querying PostgreSQL. Never replaced — only wrapped. */
async function realLoader(account: string): Promise<readonly OrganisationMembership[]> {
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

/* ---------------------------------------------------------------- */
/* Two stand-in cores, so the seam is shown to discriminate          */
/* ---------------------------------------------------------------- */

/** The production core, wired with the instrumented loader. */
function freshReadingCore(
  loadMemberships: (a: string) => Promise<readonly OrganisationMembership[]>,
  account: string,
  targetId: string
): Promise<{ ok: boolean }> {
  const deps: SwitchDependencies = {
    resolveSession: async () => ({ ok: true, accountId: account }),
    loadMemberships,
    currentSelection: () => null,
    appendAudit: async () => undefined,
    serializeSelection: (id) => signSelection(id, "seam-secret"),
    correlationId: () => "seam",
    now: () => new Date().toISOString(),
  };
  return switchOrganisationCore(deps, {
    targetOrganisationId: targetId,
    method: "POST",
    origin: "https://app.test",
    host: "app.test",
  }).then((r) => ({ ok: r.ok }));
}

/** Faulty: given a snapshot, never reads. The fault obligation 2 must exclude. */
async function snapshotReusingCore(
  _loadMemberships: (a: string) => Promise<readonly OrganisationMembership[]>,
  _account: string,
  targetId: string,
  snapshot: readonly OrganisationMembership[]
): Promise<{ ok: boolean }> {
  return { ok: snapshot.some((m) => m.organisationId === targetId) };
}

const newTrace = (): ReadTrace => ({ calls: 0, lastResult: [], sequence: [] });

async function restoreBeta() {
  await pool.query("UPDATE workspace_members SET removed_at = NULL WHERE id = $1", [
    betaMembership,
  ]);
}

before(async () => {
  if (skip) return;
  pool = await createPool(DATABASE_URL);

  const account = await pool.query<{ id: string }>(
    `INSERT INTO accounts (preferred_name, status, recovery_ready_at)
     VALUES ($1,'active',now()) RETURNING id`,
    [`Seam subject ${run}`]
  );
  accountId = account.rows[0]!.id;

  const make = async (name: string) => {
    const o = await pool.query<{ id: string }>(
      "INSERT INTO organizations (name, type) VALUES ($1,'law_firm') RETURNING id",
      [name]
    );
    const w = await pool.query<{ id: string }>(
      "INSERT INTO workspaces (organization_id, name) VALUES ($1,$2) RETURNING id",
      [o.rows[0]!.id, `${name} workspace`]
    );
    const m = await pool.query<{ id: string }>(
      "INSERT INTO workspace_members (workspace_id, account_id, role) VALUES ($1,$2,'caseworker') RETURNING id",
      [w.rows[0]!.id, accountId]
    );
    return { org: o.rows[0]!.id, membership: m.rows[0]!.id };
  };
  alphaOrg = (await make(`Seam alpha ${run}`)).org;
  const beta = await make(`Seam beta ${run}`);
  betaOrg = beta.org;
  betaMembership = beta.membership;
});

/* ================================================================ */

test(
  "the seam observes that a read happened, not merely that the outcome was right",
  { skip },
  async () => {
    const trace = newTrace();
    const loader = instrumentedLoader(realLoader, trace);
    const result = await freshReadingCore(loader, accountId, betaOrg);

    assert.equal(result.ok, true);
    assert.equal(trace.calls, 1, "the loader was not called exactly once");
    assert.deepEqual(trace.sequence, ["read:start", "read:end"]);
    assert.ok(trace.lastResult.some((m) => m.organisationId === betaOrg));
  }
);

test(
  "a revocation landing between invocation and read is visible in the returned rows",
  { skip },
  async () => {
    // This is the property the reload proof needs. The revocation happens after
    // the invocation begins and immediately before the delegated query, so only
    // a core that reads at switch time can see it.
    const trace = newTrace();
    const loader = instrumentedLoader(realLoader, trace, async () => {
      await pool.query("UPDATE workspace_members SET removed_at = now() WHERE id = $1", [
        betaMembership,
      ]);
    });

    const result = await freshReadingCore(loader, accountId, betaOrg);

    assert.equal(result.ok, false, "a fresh read did not see the revocation");
    assert.equal(trace.calls, 1);
    assert.deepEqual(trace.sequence, ["read:start", "revoked", "read:end"]);
    assert.ok(
      !trace.lastResult.some((m) => m.organisationId === betaOrg),
      "the delegated query returned a revoked membership"
    );
    // Alpha is untouched, so the read returned real rows rather than nothing.
    assert.ok(trace.lastResult.some((m) => m.organisationId === alphaOrg));

    await restoreBeta();
  }
);

test(
  "the seam fails a core that reuses a snapshot instead of reading",
  { skip },
  async () => {
    // The discriminating case. Without this the instrument would report green
    // against a core that never touches the database — which is precisely the
    // fault obligation 2 exists to exclude, and precisely what the outcome-only
    // version of this test cannot see.
    const snapshot = await realLoader(accountId);
    assert.ok(snapshot.some((m) => m.organisationId === betaOrg));

    const trace = newTrace();
    const loader = instrumentedLoader(realLoader, trace, async () => {
      await pool.query("UPDATE workspace_members SET removed_at = now() WHERE id = $1", [
        betaMembership,
      ]);
    });

    const result = await snapshotReusingCore(loader, accountId, betaOrg, snapshot);

    // The snapshot still contains beta, so the faulty core permits the switch.
    assert.equal(result.ok, true);
    // And the seam catches it on the read boundary, not on the outcome.
    assert.equal(trace.calls, 0, "the seam did not notice the loader was never called");
    assert.deepEqual(trace.sequence, []);

    // Stated as the assertion obligation 2 will make against the real core.
    const wouldFailTheReloadProof = trace.calls === 0;
    assert.equal(wouldFailTheReloadProof, true);

    await restoreBeta();
  }
);

test(
  "an outcome-only assertion cannot tell the two cores apart",
  { skip },
  async () => {
    // Why the seam is necessary, demonstrated rather than argued. Against a
    // target the account never had, both cores refuse — the correct one because
    // it read, the faulty one because its snapshot never contained it. Any test
    // asserting only "the switch was refused" passes for both.
    const foreign = "00000000-0000-4000-8000-000000000000";
    const snapshot = await realLoader(accountId);

    const traceA = newTrace();
    const fresh = await freshReadingCore(
      instrumentedLoader(realLoader, traceA),
      accountId,
      foreign
    );
    const traceB = newTrace();
    const stale = await snapshotReusingCore(
      instrumentedLoader(realLoader, traceB),
      accountId,
      foreign,
      snapshot
    );

    assert.equal(fresh.ok, false);
    assert.equal(stale.ok, false);
    assert.deepEqual(fresh, stale, "the outcomes differ, so this demonstration is wrong");

    // Identical outcomes; different read behaviour. Only the seam separates them.
    assert.notEqual(traceA.calls, traceB.calls);
    assert.equal(traceA.calls, 1);
    assert.equal(traceB.calls, 0);
  }
);

after(async () => {
  if (skip) return;
  await restoreBeta();
  await pool.end();
});
