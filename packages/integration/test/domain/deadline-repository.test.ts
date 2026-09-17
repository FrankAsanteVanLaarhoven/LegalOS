import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Membership } from "@legalos/auth";
import {
  bootstrapTenancy,
  createPool,
  withTransaction,
  type PoolClientLike,
  type PoolLike,
} from "@legalos/database";
import { DeadlineRepository, type RepositoryContext } from "@legalos/repositories";

import { guardOrSkip } from "../guard.ts";
import { emitEvidence } from "../../src/index.ts";

/**
 * The deadline repository, against a real database, tried the way an attacker
 * and a tired caseworker would try it.
 *
 * Every test here attempts the concrete failure a guarantee names. None of them
 * asserts that an array came back. Two tenancies exist throughout, because a
 * scoping guarantee tested inside one organisation is not tested at all — the
 * query would pass with the tenancy predicate deleted.
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

let pool: PoolLike;
let repo: DeadlineRepository;

/** Two tenancies. `alpha` is the caller's; `beta` is the one they must never reach. */
interface Tenancy {
  organisationId: string;
  workspaceId: string;
  caseId: string;
  caseworkerId: string;
  solicitorId: string;
  evidenceId: string;
}
let alpha: Tenancy;
let beta: Tenancy;

const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const OUTSIDER = "22222222-2222-4222-8222-222222222222";

const membership = (over: Partial<Membership> & { workspaceId: string }): Membership => ({
  accountId: ACCOUNT,
  role: "caseworker",
  regulatoryReference: null,
  removedAt: null,
  ...over,
});

/** A caseworker in alpha, which is the ordinary caller throughout. */
const caseworker = (): RepositoryContext => ({
  actorId: alpha.caseworkerId,
  accountId: ACCOUNT,
  organisationId: alpha.organisationId,
  memberships: [membership({ workspaceId: alpha.workspaceId })],
  correlationId: `req-${run}`,
});

const solicitor = (): RepositoryContext => ({
  actorId: alpha.solicitorId,
  accountId: ACCOUNT,
  organisationId: alpha.organisationId,
  memberships: [
    membership({
      workspaceId: alpha.workspaceId,
      role: "solicitor",
      regulatoryReference: "SRA 654321",
    }),
  ],
});

async function tenancy(name: string): Promise<Tenancy> {
  const t = await withTransaction(pool, (tx) =>
    bootstrapTenancy(tx, {
      organisationName: `${name} ${run}`,
      workspaceName: `${name} workspace`,
      caseReference: `${name.toUpperCase()}-${run}`,
      at: "2026-07-27T12:00:00.000Z",
      operator: "test",
    })
  );
  return {
    organisationId: t.organisationId,
    workspaceId: t.workspaceId,
    caseId: t.caseId,
    caseworkerId: t.caseworkerId,
    solicitorId: t.administratorId,
    evidenceId: t.evidenceIds[0]!,
  };
}

const statutory = (over: Record<string, unknown> = {}) =>
  ({
    caseId: alpha.caseId,
    deadlineType: "appeal",
    deadlineAt: "2026-09-01T16:00:00.000Z",
    classification: "statutory" as const,
    sourceType: "document" as const,
    sourceLocator: "rule 19(2), paragraph 4",
    certaintyState: "exact" as const,
    ...over,
  }) as Parameters<DeadlineRepository["createDeadline"]>[1];

/** Unwraps a result, failing the test with the refusal rather than a type error. */
function value<T>(result: { ok: true; value: T } | { ok: false; refusal: { detail: string } }): T {
  assert.ok(result.ok, `expected success, got refusal: ${result.ok ? "" : result.refusal.detail}`);
  return result.value;
}

before(async () => {
  if (skip) return;
  pool = await createPool(DATABASE_URL);
  repo = new DeadlineRepository(pool);
  alpha = await tenancy("Alpha deadlines");
  beta = await tenancy("Beta deadlines");
});

/* ================================================================ */
/* Tenancy                                                          */
/* ================================================================ */

test(
  "a caller from one organisation cannot read another's deadlines with a valid case id",
  { skip },
  records("cross_org_read", async () => {
    // Beta's case is real and has a deadline. Alpha holds its identifier —
    // which is all an identifier is, a number somebody can guess or be told.
    const betaContext: RepositoryContext = {
      actorId: beta.caseworkerId,
      accountId: OUTSIDER,
      organisationId: beta.organisationId,
      memberships: [membership({ workspaceId: beta.workspaceId, accountId: OUTSIDER })],
    };
    value(await repo.createDeadline(betaContext, statutory({ caseId: beta.caseId })));

    const result = await repo.readDeadlinesForCase(caseworker(), beta.caseId);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.refusal.reason, "NOT_PERSISTED");
  })
);

test(
  "a foreign case and a case that does not exist are indistinguishable",
  { skip },
  records("no_enumeration", async () => {
    // The disclosure this prevents: an attacker walking identifiers and
    // recording which ones answer differently learns another organisation's
    // caseload without reading a single case.
    const foreign = await repo.readDeadlinesForCase(caseworker(), beta.caseId);
    const absent = await repo.readDeadlinesForCase(
      caseworker(),
      "00000000-0000-4000-8000-000000000000"
    );
    assert.equal(foreign.ok, false);
    assert.equal(absent.ok, false);
    assert.deepEqual(
      foreign.ok === false && foreign.refusal,
      absent.ok === false && absent.refusal
    );
  })
);

test(
  "claiming another organisation's id does not confirm that a case exists there",
  { skip },
  records("claimed_org_no_disclosure", async () => {
    // The context's organisationId is a claim. A caller who supplies beta's id
    // while holding no membership in beta must not get a different answer from
    // one who supplies it for a case that does not exist.
    const liar: RepositoryContext = {
      actorId: alpha.caseworkerId,
      accountId: ACCOUNT,
      organisationId: beta.organisationId,
      memberships: [membership({ workspaceId: alpha.workspaceId })],
    };
    const real = await repo.readDeadlinesForCase(liar, beta.caseId);
    const invented = await repo.readDeadlinesForCase(
      liar,
      "00000000-0000-4000-8000-000000000001"
    );
    assert.equal(real.ok === false && real.refusal.reason, "NOT_PERSISTED");
    assert.deepEqual(real.ok === false && real.refusal, invented.ok === false && invented.refusal);
  })
);

test(
  "a person acting for two organisations carries nothing between them",
  { skip },
  records("dual_membership_isolated", async () => {
    // The case that isolates the organisation predicate from the membership
    // check, and the reason it exists.
    //
    // One account, legitimately a member of a workspace in each organisation —
    // a solicitor doing work for two firms, which is ordinary. Their session is
    // scoped to alpha. They pass beta's case id. The membership check alone
    // would let this through, because they really are a member of beta's
    // workspace; only the comparison of the case's organisation against the one
    // the session is scoped to refuses it.
    //
    // This test was written after deleting that comparison and finding the
    // suite still green: every other cross-tenancy test here is satisfied by
    // the membership check, so the organisation predicate was carrying no
    // measured weight at all.
    const dual: RepositoryContext = {
      actorId: alpha.caseworkerId,
      accountId: ACCOUNT,
      organisationId: alpha.organisationId,
      memberships: [
        membership({ workspaceId: alpha.workspaceId }),
        membership({ workspaceId: beta.workspaceId }),
      ],
    };

    const result = await repo.readDeadlinesForCase(dual, beta.caseId);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.refusal.reason, "NOT_PERSISTED");

    // Writing is refused on the same grounds, not merely reading.
    const write = await repo.createDeadline(dual, statutory({ caseId: beta.caseId }));
    assert.equal(write.ok === false && write.refusal.reason, "NOT_PERSISTED");

    // And the same account, with a session scoped to beta, can reach it — so
    // the refusal above is about the session's scope, not about the account.
    const scopedToBeta: RepositoryContext = { ...dual, organisationId: beta.organisationId };
    assert.equal((await repo.readDeadlinesForCase(scopedToBeta, beta.caseId)).ok, true);
  })
);

test(
  "an actor with no membership of the case's workspace cannot read it",
  { skip },
  records("no_membership_read", async () => {
    const stranger: RepositoryContext = { ...caseworker(), memberships: [] };
    const result = await repo.readDeadlinesForCase(stranger, alpha.caseId);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.refusal.reason, "NOT_PERSISTED");
  })
);

test(
  "a colleague elsewhere in the same organisation is refused, not hidden from",
  { skip },
  records("same_org_forbidden", async () => {
    // Within one organisation the existence of a case is not a secret, and
    // "you are not on this case" is the useful answer.
    const other = await withTransaction(pool, (tx) =>
      tx.query<{ id: string }>(
        "INSERT INTO workspaces (organization_id, name) VALUES ($1,$2) RETURNING id",
        [alpha.organisationId, `Another team ${run}`]
      )
    );
    const colleague: RepositoryContext = {
      ...caseworker(),
      memberships: [membership({ workspaceId: other.rows[0]!.id })],
    };
    const result = await repo.readDeadlinesForCase(colleague, alpha.caseId);
    assert.equal(result.ok === false && result.refusal.reason, "FORBIDDEN");
  })
);

test(
  "a client may read deadlines and may not create one",
  { skip },
  records("client_cannot_write", async () => {
    // A date a client typed, rendered beside one from a tribunal direction, is
    // exactly what the classification column exists to prevent — so it should
    // not be creatable.
    const client: RepositoryContext = {
      ...caseworker(),
      memberships: [membership({ workspaceId: alpha.workspaceId, role: "client" })],
    };
    assert.equal((await repo.readDeadlinesForCase(client, alpha.caseId)).ok, true);

    const write = await repo.createDeadline(client, statutory());
    assert.equal(write.ok, false);
    assert.equal(write.ok === false && write.refusal.reason, "FORBIDDEN");
  })
);

test(
  "a caseworker cannot record a professional confirmation",
  { skip },
  records("caseworker_cannot_confirm", async () => {
    const created = value(await repo.createDeadline(caseworker(), statutory()));
    const result = await repo.recordDeadlineVerification(caseworker(), {
      caseId: alpha.caseId,
      deadlineId: created.id,
      state: "professional_confirmed",
      basis: "looks right to me",
      expectedUpdatedAt: created.updatedAt,
    });
    assert.equal(result.ok === false && result.refusal.reason, "FORBIDDEN");
    assert.match(
      result.ok === false ? result.refusal.detail : "",
      /regulated role with a registration/
    );
  })
);

test(
  "the upcoming view never crosses an organisation boundary",
  { skip },
  records("upcoming_scoped", async () => {
    const upcoming = value(await repo.readUpcomingDeadlines(caseworker()));
    assert.ok(upcoming.length > 0, "alpha should have open deadlines by now");
    for (const deadline of upcoming) {
      assert.equal(deadline.organisationId, alpha.organisationId);
      assert.notEqual(deadline.caseId, beta.caseId);
    }
  })
);

/* ================================================================ */
/* Provenance and authority                                         */
/* ================================================================ */

test(
  "a deadline whose source reference resolves to nothing is not authoritative",
  { skip },
  records("dangling_source", async () => {
    // ADR-003 as data. `source_id` is untyped text with no foreign key, so this
    // row satisfies every database constraint. A locator pointing at a document
    // that is not there is worse than no locator: it looks checked.
    const created = value(
      await repo.createDeadline(
        caseworker(),
        statutory({ sourceId: "99999999-9999-4999-8999-999999999999" })
      )
    );
    const matched = value(
      await repo.recordDeadlineVerification(caseworker(), {
        caseId: alpha.caseId,
        deadlineId: created.id,
        state: "source_matched",
        basis: "checked against the letter",
        expectedUpdatedAt: created.updatedAt,
      })
    );
    assert.equal(matched.sourceResolution, "dangling");
    assert.equal(matched.authoritative, false);
    assert.match(matched.authorityWithheldBecause!, /does not resolve/);
  })
);

test(
  "the same deadline with a source that exists is authoritative",
  { skip },
  records("resolved_source", async () => {
    // The other half. Without this the previous test is satisfied by a rule
    // that withholds authority from everything.
    const created = value(
      await repo.createDeadline(caseworker(), statutory({ sourceId: alpha.evidenceId }))
    );
    const matched = value(
      await repo.recordDeadlineVerification(caseworker(), {
        caseId: alpha.caseId,
        deadlineId: created.id,
        state: "source_matched",
        basis: "checked against the letter",
        expectedUpdatedAt: created.updatedAt,
      })
    );
    assert.equal(matched.sourceResolution, "resolved");
    assert.equal(matched.authoritative, true);
    assert.equal(matched.authorityWithheldBecause, null);
  })
);

test(
  "a binding deadline cannot be created without a source at all",
  { skip },
  records("provenance_required", async () => {
    const result = await repo.createDeadline(
      caseworker(),
      statutory({ sourceType: "unknown", sourceLocator: null })
    );
    assert.equal(result.ok === false && result.refusal.reason, "INVALID");
    assert.match(result.ok === false ? result.refusal.detail : "", /where it came from/);
  })
);

test(
  "a freshly created deadline is never authoritative",
  { skip },
  records("creation_not_authoritative", async () => {
    // Verification is a separate act by a separate person. If creating a
    // deadline could set it, a caseworker could record a professional
    // confirmation no professional made.
    const created = value(await repo.createDeadline(caseworker(), statutory()));
    assert.equal(created.verificationState, "unverified");
    assert.equal(created.authoritative, false);
    assert.match(created.authorityWithheldBecause!, /matched this date to the source/);
  })
);

test(
  "every returned deadline carries its full provenance",
  { skip },
  records("states_emitted", async () => {
    const all = value(await repo.readDeadlinesForCase(caseworker(), alpha.caseId));
    assert.ok(all.length > 0);
    for (const d of all) {
      for (const field of [
        "id",
        "caseId",
        "classification",
        "deadlineAt",
        "timezone",
        "status",
        "certaintyState",
        "verificationState",
        "sourceType",
        "sourceResolution",
        "recordedBy",
        "recordedAt",
        "createdAt",
      ] as const) {
        assert.ok(
          d[field] !== undefined && d[field] !== null,
          `${field} missing from a returned deadline`
        );
      }
      // The derived judgement and its reason travel together, always.
      assert.equal(typeof d.authoritative, "boolean");
      assert.equal(d.authoritative, d.authorityWithheldBecause === null);
      assert.ok("sourceId" in d && "sourceLocator" in d);
      assert.ok("verifiedBy" in d && "verifiedAt" in d);
      assert.ok("supersedesId" in d && "supersededById" in d);
    }
  })
);

test(
  "no deadline field is a probability, confidence or score under any name",
  { skip },
  records("no_probability", async () => {
    // Checked on the emitted objects rather than on the schema, because the
    // place a figure would appear is a derived field somebody added to be
    // helpful — which the schema would never see.
    const all = value(await repo.readDeadlinesForCase(caseworker(), alpha.caseId));
    assert.ok(all.length > 0);
    const forbidden = /confidence|probability|score|likelihood|certainty_pct|percent|reliability/i;
    for (const d of all) {
      for (const [key, v] of Object.entries(d)) {
        assert.ok(!forbidden.test(key), `${key} names a figure this platform does not emit`);
        // `certaintyState` is a state, not a number, and must stay one.
        if (key === "certaintyState") assert.equal(typeof v, "string");
        assert.notEqual(typeof v, "number");
      }
    }
  })
);

/* ================================================================ */
/* Supersession and filtering                                       */
/* ================================================================ */

test(
  "superseding preserves the original date and excludes it from the open view",
  { skip },
  records("supersession", async () => {
    const original = value(
      await repo.createDeadline(
        caseworker(),
        statutory({ deadlineType: "directions", deadlineAt: "2026-08-01T16:00:00.000Z" })
      )
    );

    const { original: closed, replacement } = value(
      await repo.supersedeDeadline(caseworker(), {
        caseId: alpha.caseId,
        deadlineId: original.id,
        reason: "tribunal extended the direction by four weeks",
        replacement: {
          deadlineType: "directions",
          deadlineAt: "2026-08-29T16:00:00.000Z",
          classification: "tribunal_directed",
          sourceType: "direction",
          sourceLocator: "direction 7",
          certaintyState: "exact",
        },
      })
    );

    // The original keeps its date. A correction that edited it would erase what
    // was believed on the day of the filing.
    assert.equal(closed.deadlineAt, original.deadlineAt);
    assert.equal(closed.status, "superseded");
    assert.equal(closed.supersededById, replacement.id);
    assert.equal(replacement.supersedesId, original.id);

    const open = value(await repo.readOpenDeadlinesForCase(caseworker(), alpha.caseId));
    assert.ok(!open.some((d) => d.id === original.id), "a superseded deadline is still open");
    assert.ok(open.some((d) => d.id === replacement.id));

    // And it remains readable through the history view.
    const all = value(await repo.readDeadlinesForCase(caseworker(), alpha.caseId));
    const found = all.find((d) => d.id === original.id);
    assert.ok(found, "the superseded deadline vanished from the history read");
    assert.equal(found.deadlineAt, original.deadlineAt);
    assert.equal(found.sourceLocator, original.sourceLocator);
  })
);

test(
  "a professionally confirmed deadline can be superseded, and keeps its verifier",
  { skip },
  records("supersede_confirmed", async () => {
    // Found by the development smoke test, not by this suite: every
    // supersession test here started from an unverified deadline, so the case
    // that actually happens — a tribunal extending a direction a solicitor had
    // already checked — was never tried. It failed outright.
    //
    // Setting the original's verification_state to 'superseded' while
    // verified_by was populated violated verification_names_a_verifier, and the
    // only way to satisfy that constraint would have been to null the verifier
    // — erasing which solicitor confirmed the original date.
    const created = value(
      await repo.createDeadline(caseworker(), statutory({ sourceId: alpha.evidenceId }))
    );
    const confirmed = value(
      await repo.recordDeadlineVerification(solicitor(), {
        caseId: alpha.caseId,
        deadlineId: created.id,
        state: "professional_confirmed",
        basis: "checked against the direction",
        expectedUpdatedAt: created.updatedAt,
      })
    );
    assert.equal(confirmed.authoritative, true);

    const { original } = value(
      await repo.supersedeDeadline(caseworker(), {
        caseId: alpha.caseId,
        deadlineId: created.id,
        reason: "tribunal extended the direction",
        replacement: {
          deadlineType: "appeal",
          deadlineAt: "2026-12-01T16:00:00.000Z",
          classification: "tribunal_directed",
          sourceType: "direction",
          sourceLocator: "direction 12",
          certaintyState: "exact",
        },
      })
    );

    assert.equal(original.status, "superseded");
    // The confirmation survives. Who checked the original is still answerable.
    assert.equal(original.verificationState, "professional_confirmed");
    assert.equal(original.verifiedBy, alpha.solicitorId);
    assert.ok(original.verifiedAt);
    // And it is no longer authoritative, on the strength of its status alone.
    assert.equal(original.authoritative, false);
    assert.match(original.authorityWithheldBecause!, /replaced by a later one/);
  })
);

test(
  "a deadline cannot be superseded twice",
  { skip },
  records("double_supersession", async () => {
    const original = value(await repo.createDeadline(caseworker(), statutory()));
    const replacement = {
      deadlineType: "appeal",
      deadlineAt: "2026-10-01T16:00:00.000Z",
      classification: "statutory" as const,
      sourceType: "direction" as const,
      sourceLocator: "direction 9",
      certaintyState: "exact" as const,
    };
    value(
      await repo.supersedeDeadline(caseworker(), {
        caseId: alpha.caseId,
        deadlineId: original.id,
        reason: "first extension",
        replacement,
      })
    );
    const second = await repo.supersedeDeadline(caseworker(), {
      caseId: alpha.caseId,
      deadlineId: original.id,
      reason: "second extension",
      replacement,
    });
    assert.equal(second.ok === false && second.refusal.reason, "CONFLICT");
  })
);

test(
  "ordering is deterministic when dates are equal",
  { skip },
  records("deterministic_order", async () => {
    // Inserted in one statement so `created_at` is identical too. Through the
    // repository each call is its own transaction and `created_at` breaks the
    // tie first, which never exercises the third key — and the third key is the
    // one that stops a rendered list shuffling between loads for no reason a
    // reader can see.
    const at = "2027-01-15T09:00:00.000Z";
    await pool.query(
      `INSERT INTO deadlines (organisation_id, case_id, deadline_type, deadline_at,
         classification, source_type, source_locator, recorded_by, certainty_state, status)
       SELECT $1, $2, 'tie-' || g, $3::timestamptz, 'statutory', 'document', 'p' || g, $4, 'exact', 'open'
         FROM generate_series(1, 5) g`,
      [alpha.organisationId, alpha.caseId, at, alpha.caseworkerId]
    );

    const first = value(await repo.readOpenDeadlinesForCase(caseworker(), alpha.caseId));
    const second = value(await repo.readOpenDeadlinesForCase(caseworker(), alpha.caseId));
    assert.deepEqual(
      first.map((d) => d.id),
      second.map((d) => d.id)
    );

    const tied = first.filter((d) => d.deadlineAt === at);
    assert.equal(tied.length, 5);
    // All five share an instant and a creation time, so only the id separates
    // them, and it must separate them the same way every time.
    assert.equal(new Set(tied.map((d) => d.createdAt)).size, 1);
    assert.deepEqual(
      tied.map((d) => d.id),
      [...tied.map((d) => d.id)].sort()
    );
  })
);

/* ================================================================ */
/* Concurrency                                                      */
/* ================================================================ */

test(
  "a stale verification is refused rather than applied",
  { skip },
  records("stale_write", async () => {
    // Two people verifying the same date from two screens is not a rare case;
    // it is what happens when a deadline matters.
    const created = value(await repo.createDeadline(caseworker(), statutory()));
    const stale = created.updatedAt;

    value(
      await repo.recordDeadlineVerification(caseworker(), {
        caseId: alpha.caseId,
        deadlineId: created.id,
        state: "source_matched",
        basis: "first reader matched it against the letter",
        expectedUpdatedAt: stale,
      })
    );

    const second = await repo.recordDeadlineVerification(solicitor(), {
      caseId: alpha.caseId,
      deadlineId: created.id,
      state: "disputed",
      basis: "second reader thinks the letter says something else",
      expectedUpdatedAt: stale,
    });

    assert.equal(second.ok === false && second.refusal.reason, "CONFLICT");

    // And the first write is intact — not silently replaced.
    const all = value(await repo.readDeadlinesForCase(caseworker(), alpha.caseId));
    assert.equal(all.find((d) => d.id === created.id)?.verificationState, "source_matched");
  })
);

test(
  "a solicitor's confirmation records who confirmed it and under what registration",
  { skip },
  records("professional_confirmation", async () => {
    const created = value(
      await repo.createDeadline(caseworker(), statutory({ sourceId: alpha.evidenceId }))
    );
    const confirmed = value(
      await repo.recordDeadlineVerification(solicitor(), {
        caseId: alpha.caseId,
        deadlineId: created.id,
        state: "professional_confirmed",
        basis: "checked against rule 19(2) and the refusal letter",
        expectedUpdatedAt: created.updatedAt,
      })
    );
    assert.equal(confirmed.verificationState, "professional_confirmed");
    assert.equal(confirmed.verifiedBy, alpha.solicitorId);
    assert.ok(confirmed.verifiedAt);
    assert.equal(confirmed.authoritative, true);

    const audit = await pool.query<{ payload: Record<string, unknown> }>(
      "SELECT payload FROM audit_log WHERE subject = $1 AND action = 'deadline.verified' ORDER BY seq DESC LIMIT 1",
      [created.id]
    );
    assert.equal(audit.rows[0]!.payload.regulatoryReference, "SRA 654321");
    assert.equal(audit.rows[0]!.payload.role, "solicitor");
  })
);

/* ================================================================ */
/* Atomicity                                                        */
/* ================================================================ */

/** A pool whose client throws on any statement matching `pattern`. */
function failingPool(real: PoolLike, pattern: RegExp): PoolLike {
  return {
    query: real.query.bind(real),
    end: real.end.bind(real),
    async connect(): Promise<PoolClientLike> {
      const client = await real.connect();
      return {
        query: (text: string, values?: readonly unknown[]) => {
          if (pattern.test(text)) {
            return Promise.reject(new Error(`induced failure on ${pattern.source}`));
          }
          return client.query(text, values);
        },
        release: client.release.bind(client),
      } as PoolClientLike;
    },
  } as PoolLike;
}

async function countDeadlines(): Promise<number> {
  const r = await pool.query<{ n: string }>(
    "SELECT count(*) AS n FROM deadlines WHERE case_id = $1",
    [alpha.caseId]
  );
  return Number(r.rows[0]!.n);
}

test(
  "a failure writing the event rolls the deadline back",
  { skip },
  records("rollback_on_event_failure", async () => {
    // A deadline with no event is a date nobody can attribute. Worse than the
    // write having failed, because it looks like success.
    const before = await countDeadlines();
    const broken = new DeadlineRepository(failingPool(pool, /INSERT INTO deadline_events/));
    const result = await broken.createDeadline(caseworker(), statutory());

    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.refusal.reason, "UNREACHABLE");
    assert.equal(await countDeadlines(), before, "the deadline survived a failed event write");
  })
);

test(
  "a failure writing the audit entry rolls back both the deadline and its event",
  { skip },
  records("rollback_on_audit_failure", async () => {
    // A change to a case file that left no independent trace is the one this
    // platform's central claim depends on not happening.
    const before = await countDeadlines();
    const events = await pool.query<{ n: string }>("SELECT count(*) AS n FROM deadline_events");
    const broken = new DeadlineRepository(failingPool(pool, /audit_log/));
    const result = await broken.createDeadline(caseworker(), statutory());

    assert.equal(result.ok, false);
    assert.equal(await countDeadlines(), before);
    const after = await pool.query<{ n: string }>("SELECT count(*) AS n FROM deadline_events");
    assert.equal(after.rows[0]!.n, events.rows[0]!.n, "an orphan event survived");
  })
);

test(
  "a successful creation writes the deadline, its event and its audit entry together",
  { skip },
  records("atomic_creation", async () => {
    const created = value(
      await repo.createDeadline(caseworker(), statutory({ detail: "read from the refusal letter" }))
    );

    const events = value(
      await repo.readDeadlineEvents(caseworker(), alpha.caseId, created.id)
    );
    assert.equal(events.length, 1);
    assert.equal(events[0]!.event, "recorded");
    assert.equal(events[0]!.actorId, alpha.caseworkerId);
    assert.equal(events[0]!.detail, "read from the refusal letter");

    const audit = await pool.query<{ actor: string; payload: Record<string, unknown> }>(
      "SELECT actor, payload FROM audit_log WHERE subject = $1 AND action = 'deadline.created'",
      [created.id]
    );
    assert.equal(audit.rows.length, 1);
    assert.equal(audit.rows[0]!.actor, alpha.caseworkerId);
    assert.equal(audit.rows[0]!.payload.correlationId, `req-${run}`);
  })
);

test(
  "supersession writes both events and its audit entry, or none of them",
  { skip },
  records("supersession_is_evented", async () => {
    const original = value(await repo.createDeadline(caseworker(), statutory()));
    const before = await countDeadlines();

    const broken = new DeadlineRepository(failingPool(pool, /audit_log/));
    const failed = await broken.supersedeDeadline(caseworker(), {
      caseId: alpha.caseId,
      deadlineId: original.id,
      reason: "should roll back",
      replacement: {
        deadlineType: "appeal",
        deadlineAt: "2026-11-01T16:00:00.000Z",
        classification: "statutory",
        sourceType: "direction",
        sourceLocator: "direction 11",
        certaintyState: "exact",
      },
    });
    assert.equal(failed.ok, false);
    assert.equal(await countDeadlines(), before, "the replacement survived a failed audit write");

    // The original is untouched by the rolled-back attempt.
    const all = value(await repo.readDeadlinesForCase(caseworker(), alpha.caseId));
    assert.equal(all.find((d) => d.id === original.id)?.status, "open");
  })
);

/* ================================================================ */
/* Immutable history                                                */
/* ================================================================ */

test(
  "recorded history cannot be updated, deleted or truncated",
  { skip },
  records("history_immutable", async () => {
    const created = value(await repo.createDeadline(caseworker(), statutory()));

    await assert.rejects(
      () =>
        pool.query("UPDATE deadline_events SET detail = 'edited' WHERE deadline_id = $1", [
          created.id,
        ]),
      /deadline_events is append-only/
    );
    await assert.rejects(
      () => pool.query("DELETE FROM deadline_events WHERE deadline_id = $1", [created.id]),
      /deadline_events is append-only/
    );
    await assert.rejects(() => pool.query("TRUNCATE deadline_events"), /may not be truncated/);

    // And the deadline itself is pinned by its history.
    await assert.rejects(
      () => pool.query("DELETE FROM deadlines WHERE id = $1", [created.id]),
      /violates foreign key constraint/
    );
  })
);

test(
  "a case carrying deadline history cannot be deleted",
  { skip },
  records("case_pinned_by_history", async () => {
    await assert.rejects(
      () => pool.query("DELETE FROM cases WHERE id = $1", [alpha.caseId]),
      /append-only|violates foreign key constraint/
    );
    const still = await pool.query<{ n: string }>("SELECT count(*) AS n FROM cases WHERE id = $1", [
      alpha.caseId,
    ]);
    assert.equal(still.rows[0]!.n, "1");
  })
);

test(
  "the repository never attempts to disable a protection",
  { skip },
  records("no_protection_bypass", async () => {
    // Static, because the dangerous version of this code is the one written
    // later by somebody working around a failing test.
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(
      join(repoRoot, "packages/repositories/src/deadline.ts"),
      "utf8"
    );
    // Matched as statements rather than as words. The first version looked for
    // /TRUNCATE/i and was tripped by the word "truncates" in a comment about
    // millisecond precision — a checker that fires on prose gets weakened by
    // the next person, and a weakened checker is worse than none.
    for (const forbidden of [
      /\bALTER\s+TABLE\b/i,
      /\bDISABLE\s+TRIGGER\b/i,
      /\bDROP\s+TRIGGER\b/i,
      /\bTRUNCATE\s+[a-z_]/i,
      /\bDELETE\s+FROM\s+deadline_events\b/i,
      /\bUPDATE\s+deadline_events\b/i,
      /session_replication_role/i,
    ]) {
      assert.ok(!forbidden.test(source), `the repository contains ${forbidden.source}`);
    }
  })
);

/* ================================================================ */
/* Availability                                                     */
/* ================================================================ */

test(
  "absence of a database is distinguishable from absence of a case",
  { skip },
  records("unavailability_distinguished", async () => {
    // An unreachable store rendering as an empty list is how a case with three
    // imminent deadlines reads as a case with none.
    const none = new DeadlineRepository(null);
    const noDb = await none.readDeadlinesForCase(caseworker(), alpha.caseId);
    assert.equal(noDb.ok === false && noDb.refusal.reason, "NO_DATABASE");

    const missing = await repo.readDeadlinesForCase(
      caseworker(),
      "00000000-0000-4000-8000-000000000002"
    );
    assert.equal(missing.ok === false && missing.refusal.reason, "NOT_PERSISTED");

    const broken = new DeadlineRepository(failingPool(pool, /INSERT INTO deadlines/));
    const unreachable = await broken.createDeadline(caseworker(), statutory());
    assert.equal(unreachable.ok === false && unreachable.refusal.reason, "UNREACHABLE");

    const client: RepositoryContext = {
      ...caseworker(),
      memberships: [membership({ workspaceId: alpha.workspaceId, role: "client" })],
    };
    const forbidden = await repo.createDeadline(client, statutory());
    assert.equal(forbidden.ok === false && forbidden.refusal.reason, "FORBIDDEN");

    // Four distinct reasons, none collapsible into "no results".
    assert.equal(new Set(["NO_DATABASE", "NOT_PERSISTED", "UNREACHABLE", "FORBIDDEN"]).size, 4);
  })
);

test(
  "a case with no persisted deadlines returns an empty list, not a fixture",
  { skip },
  records("no_fixture_fallback", async () => {
    const empty = await tenancy("Empty deadlines");
    const context: RepositoryContext = {
      actorId: empty.caseworkerId,
      accountId: ACCOUNT,
      organisationId: empty.organisationId,
      memberships: [membership({ workspaceId: empty.workspaceId })],
    };
    const result = value(await repo.readDeadlinesForCase(context, empty.caseId));
    assert.deepEqual(result, []);

    // Nothing in the package can reach a fixture: it depends on two packages,
    // neither of which is the app.
    const { readFile } = await import("node:fs/promises");
    const manifest = JSON.parse(
      await readFile(join(repoRoot, "packages/repositories/package.json"), "utf8")
    ) as { dependencies: Record<string, string> };
    assert.deepEqual(Object.keys(manifest.dependencies).sort(), [
      "@legalos/auth",
      "@legalos/database",
    ]);
    const source = await readFile(join(repoRoot, "packages/repositories/src/deadline.ts"), "utf8");
    assert.ok(!/apps\/web|lib\/data|fixture/.test(source));
  })
);

/* ================================================================ */
/* Query plans                                                      */
/* ================================================================ */

test(
  "the open-deadline and upcoming queries are eligible for their partial indexes",
  { skip },
  records("query_plans", async () => {
    // A representative population, then ANALYZE. "Representative" is doing real
    // work here: the first version of this test put 4000 deadlines on a single
    // case, the planner correctly chose a sequential scan because 38% of the
    // table matched, and the test failed. That was the test being wrong about
    // what a caseload looks like — a real organisation has many cases with a
    // handful of live dates each, which is the shape a partial index is for.
    //
    // No timing claim is made anywhere here. Only which access path was chosen.
    const client = await pool.query<{ client_id: string }>(
      "SELECT client_id FROM cases WHERE id = $1",
      [alpha.caseId]
    );
    await pool.query(
      `INSERT INTO cases (workspace_id, client_id, reference, status)
       SELECT $1, $2, 'BULK-${run}-' || g, 'evidence_collection' FROM generate_series(1, 200) g`,
      [alpha.workspaceId, client.rows[0]!.client_id]
    );
    const bulkCases = await pool.query<{ id: string }>(
      "SELECT id FROM cases WHERE workspace_id = $1 AND reference LIKE $2 ORDER BY reference",
      [alpha.workspaceId, `BULK-${run}-%`]
    );
    await pool.query(
      `INSERT INTO deadlines (organisation_id, case_id, deadline_type, deadline_at,
         classification, source_type, source_locator, recorded_by, certainty_state, status)
       SELECT $1, c.id, 'bulk', now() + (g || ' days')::interval, 'statutory', 'document',
              'p' || g, $2, 'exact',
              CASE WHEN g % 4 = 0 THEN 'met' ELSE 'open' END
         FROM unnest($3::uuid[]) AS c(id), generate_series(1, 20) g`,
      [alpha.organisationId, alpha.caseworkerId, bulkCases.rows.map((r) => r.id)]
    );
    // And a second population on one case, so the counter-case below is
    // genuinely a counter-case rather than a label on the same plan.
    await pool.query(
      `INSERT INTO deadlines (organisation_id, case_id, deadline_type, deadline_at,
         classification, source_type, source_locator, recorded_by, certainty_state, status)
       SELECT $1, $2, 'dominant', now() + (g || ' days')::interval, 'statutory', 'document',
              'p' || g, $3, 'exact', 'open'
         FROM generate_series(1, 4000) g`,
      [alpha.organisationId, alpha.caseId, alpha.caseworkerId]
    );
    await pool.query("ANALYZE deadlines");
    await pool.query("ANALYZE cases");

    const selectiveCase = bulkCases.rows[0]!.id;

    const plans: Record<string, string> = {};
    const explain = async (label: string, sql: string, params: readonly unknown[]) => {
      const r = await pool.query<{ "QUERY PLAN": string }>(`EXPLAIN ${sql}`, params);
      plans[label] = r.rows.map((row) => row["QUERY PLAN"]).join("\n");
    };

    await explain(
      "open_by_case",
      `SELECT d.id FROM deadlines d
        WHERE d.case_id = $1 AND d.organisation_id = $2 AND d.status = 'open'
        ORDER BY d.deadline_at ASC, d.created_at ASC, d.id ASC`,
      [selectiveCase, alpha.organisationId]
    );
    // The counter-case, kept because it is the honest half: one case holding a
    // large share of the table is read by sequential scan, and that is the
    // planner being right rather than the index being unused.
    await explain(
      "open_by_case_dominant",
      `SELECT d.id FROM deadlines d
        WHERE d.case_id = $1 AND d.organisation_id = $2 AND d.status = 'open'
        ORDER BY d.deadline_at ASC, d.created_at ASC, d.id ASC`,
      [alpha.caseId, alpha.organisationId]
    );
    await explain(
      "upcoming_by_org",
      `SELECT d.id FROM deadlines d JOIN cases c ON c.id = d.case_id
        WHERE d.organisation_id = $1 AND c.workspace_id = ANY($2) AND d.status = 'open'
        ORDER BY d.deadline_at ASC, d.created_at ASC, d.id ASC LIMIT 50`,
      [alpha.organisationId, [alpha.workspaceId]]
    );

    // The partial indexes from migration 0010 are the intended path for both.
    assert.match(
      plans.open_by_case!,
      /deadlines_case_open_idx/,
      `open-by-case did not use its index:\n${plans.open_by_case}`
    );
    assert.match(
      plans.upcoming_by_org!,
      /deadlines_org_open_idx/,
      `upcoming-by-org did not use its index:\n${plans.upcoming_by_org}`
    );
    // The counter-case, asserted rather than described: when one case holds
    // roughly half the table, reading it through the index would cost more than
    // reading the table, and the planner declines it. An index is eligible, not
    // obligatory, and a test that forced it would be measuring nothing.
    assert.doesNotMatch(
      plans.open_by_case_dominant!,
      /deadlines_case_open_idx/,
      `the dominant-case read used the index, so this is no longer a counter-case:\n${plans.open_by_case_dominant}`
    );

    await emitEvidence(repoRoot, {
      checkId: "deadline_query_plans",
      passed: true,
      at: new Date().toISOString(),
      commit: commit(),
      producedBy: "packages/integration/test/domain/deadline-repository.test.ts",
      demonstrates: `with 4000 deadlines spread across 200 cases in one organisation and ANALYZE run, the planner chose deadlines_case_open_idx for a selective open-by-case read and deadlines_org_open_idx for the organisation-wide upcoming read. The counter-case is recorded too: a single case holding roughly a third of the table is read by sequential scan, which is the planner being correct rather than the index being unused. No timing claim is made. Plans:\n${JSON.stringify(plans, null, 2)}`,
    });
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
      producedBy: "packages/integration/test/domain/deadline-repository.test.ts",
      demonstrates,
    });

  await emit(
    "deadline_reads_are_organisation_scoped",
    [
      "cross_org_read",
      "no_enumeration",
      "claimed_org_no_disclosure",
      "dual_membership_isolated",
      "upcoming_scoped",
    ],
    "a caseworker in one organisation, holding a valid case id belonging to another, received the same refusal as for a case that does not exist; a caller supplying the other organisation's id without a membership in it learned nothing either; and an account holding a real membership in both organisations, on a session scoped to the first, could not read or write the second's case — which is the only one of these the organisation predicate itself refuses, the rest being caught by the membership check"
  );
  await emit(
    "deadline_permission_resolved_after_case",
    ["no_membership_read", "same_org_forbidden", "client_cannot_write", "caseworker_cannot_confirm"],
    "permission was resolved against the workspace the case actually belongs to: a member of another team in the same organisation was refused, a client could read but not create, and a caseworker could not record a professional confirmation"
  );
  await emit(
    "deadline_provenance_or_omission",
    ["dangling_source", "resolved_source", "provenance_required"],
    "a binding deadline could not be created without a source; a deadline whose source id resolved to no stored row was returned as not authoritative with that reason, while the same deadline citing a real evidence item was authoritative"
  );
  await emit(
    "deadline_states_always_emitted",
    ["states_emitted", "creation_not_authoritative"],
    "every returned deadline carried classification, verification state, certainty state, source type, source resolution and recorded-by, and a freshly created deadline was never authoritative"
  );
  await emit(
    "deadline_superseded_excluded",
    ["supersession", "supersede_confirmed", "double_supersession", "deterministic_order"],
    "a superseded deadline kept its original date, left the open view, remained readable in the history view, and could not be superseded twice; superseding a professionally confirmed deadline preserved its verifier and withheld authority on status alone; equal dates and equal creation times ordered deterministically by id"
  );
  await emit(
    "deadline_unavailability_distinguished",
    ["unavailability_distinguished"],
    "no database, no such case, an unreachable store and a refusal produced four distinct outcomes, none of which is an empty list"
  );
  await emit(
    "deadline_no_fixture_fallback",
    ["no_fixture_fallback"],
    "a case with no persisted deadlines returned an empty list; the package depends only on @legalos/auth and @legalos/database and contains no reference to the app or any fixture module"
  );
  await emit(
    "deadline_changes_are_evented",
    [
      "atomic_creation",
      "rollback_on_event_failure",
      "rollback_on_audit_failure",
      "supersession_is_evented",
      "history_immutable",
      "case_pinned_by_history",
      "no_protection_bypass",
      "stale_write",
      "professional_confirmation",
    ],
    "creation wrote deadline, event and audit entry in one transaction; inducing a failure on the event write and again on the audit write left no deadline behind; recorded history refused UPDATE, DELETE and TRUNCATE; a stale verification was refused rather than applied"
  );
  await emit(
    "deadline_emits_no_probability",
    ["no_probability"],
    "no field on any returned deadline was numeric or named for a confidence, probability, score, likelihood, percentage or reliability figure"
  );

  await pool.end();
});
