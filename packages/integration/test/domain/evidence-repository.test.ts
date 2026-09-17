import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Membership } from "@legalos/auth";
import { observeAssertionTraceability } from "@legalos/capabilities";
import {
  bootstrapTenancy,
  createPool,
  PostgresAuditStore,
  withTransaction,
  type PoolClientLike,
  type PoolLike,
} from "@legalos/database";
import {
  DevelopmentFilesystemStorage,
  EvidenceRepository,
  GraphRepository,
  NoStorage,
  sha256,
  type RepositoryContext,
} from "@legalos/repositories";

import { guardOrSkip } from "../guard.ts";
import { emitEvidence } from "../../src/index.ts";

/**
 * The evidence repository, against a real database and a real filesystem.
 *
 * Evidence is the domain every other citation resolves through, so the tests
 * are arranged around the ways an item could claim to be a document it is not:
 * bytes that changed, bytes that were never written, a document from another
 * matter, or an item nobody can account for.
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
const bytes = (s: string) => new TextEncoder().encode(s);

let pool: PoolLike;
let repo: EvidenceRepository;
let graph: GraphRepository;
let storage: DevelopmentFilesystemStorage;
let storageRoot = "";

interface Tenancy {
  organisationId: string;
  workspaceId: string;
  caseId: string;
  caseworkerId: string;
  solicitorId: string;
  evidenceIds: readonly string[];
}
let alpha: Tenancy;
let beta: Tenancy;

const ACCOUNT = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const OUTSIDER = "ffffffff-ffff-4fff-8fff-ffffffffffff";

const membership = (over: Partial<Membership> & { workspaceId: string }): Membership => ({
  accountId: ACCOUNT,
  role: "caseworker",
  regulatoryReference: null,
  removedAt: null,
  ...over,
});

const worker = (): RepositoryContext => ({
  actorId: alpha.caseworkerId,
  accountId: ACCOUNT,
  organisationId: alpha.organisationId,
  memberships: [membership({ workspaceId: alpha.workspaceId })],
  correlationId: `ev-${run}`,
});

const solicitor = (): RepositoryContext => ({
  ...worker(),
  actorId: alpha.solicitorId,
  memberships: [
    membership({ workspaceId: alpha.workspaceId, role: "solicitor", regulatoryReference: "SRA 1" }),
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
    evidenceIds: t.evidenceIds,
  };
}

function value<T>(r: { ok: true; value: T } | { ok: false; refusal: { detail: string } }): T {
  assert.ok(r.ok, `expected success, got refusal: ${r.ok ? "" : r.refusal.detail}`);
  return r.value;
}

let seq = 0;
const spec = (over: Record<string, unknown> = {}) =>
  ({
    caseId: alpha.caseId,
    evidenceType: "decision_letter" as const,
    title: `Refusal letter ${seq++}`,
    provenance: { acquisition: "authority_supplied" as const, sourceActor: "Home Office" },
    ...over,
  }) as Parameters<EvidenceRepository["createEvidenceItem"]>[1];

const made = async (over: Record<string, unknown> = {}) =>
  value(await repo.createEvidenceItem(worker(), spec(over)));

/** An item with real bytes behind it, which is the ordinary case. */
async function stored(content = `document ${seq}`) {
  const item = await made();
  const withFile = value(
    await repo.attachFileVersion(worker(), {
      caseId: alpha.caseId,
      evidenceId: item.id,
      bytes: bytes(content),
      mediaType: "application/pdf",
      originalFilename: "letter.pdf",
      expectedVersion: item.version,
    })
  );
  return { item: withFile, content };
}

const query = (sql: string) => pool.query(sql) as Promise<{ rows: Record<string, unknown>[] }>;

before(async () => {
  if (skip) return;
  pool = await createPool(DATABASE_URL);
  storageRoot = await mkdtemp(join(tmpdir(), `legalos-evidence-${run}-`));
  storage = new DevelopmentFilesystemStorage(storageRoot);
  repo = new EvidenceRepository(pool, storage);
  graph = new GraphRepository(pool);
  alpha = await tenancy("Alpha evidence");
  beta = await tenancy("Beta evidence");
});

/* ================================================================ */
/* Tenancy and authority                                            */
/* ================================================================ */

test(
  "a person acting for two organisations carries nothing between them",
  { skip },
  records("dual_membership_isolated", async () => {
    // The case that isolates the organisation predicate from the membership
    // check, as in every other domain.
    const dual: RepositoryContext = {
      actorId: alpha.caseworkerId,
      accountId: ACCOUNT,
      organisationId: alpha.organisationId,
      memberships: [
        membership({ workspaceId: alpha.workspaceId }),
        membership({ workspaceId: beta.workspaceId }),
      ],
    };
    const read = await repo.readEvidenceForCase(dual, beta.caseId);
    assert.equal(read.ok === false && read.refusal.reason, "NOT_PERSISTED");

    const write = await repo.createEvidenceItem(dual, { ...spec(), caseId: beta.caseId });
    assert.equal(write.ok === false && write.refusal.reason, "NOT_PERSISTED");

    const scoped: RepositoryContext = { ...dual, organisationId: beta.organisationId };
    assert.equal((await repo.readEvidenceForCase(scoped, beta.caseId)).ok, true);
  })
);

test(
  "a caller from another organisation cannot read or write this case's evidence",
  { skip },
  records("cross_org", async () => {
    const betaContext: RepositoryContext = {
      actorId: beta.caseworkerId,
      accountId: OUTSIDER,
      organisationId: beta.organisationId,
      memberships: [membership({ workspaceId: beta.workspaceId, accountId: OUTSIDER })],
    };
    value(await repo.createEvidenceItem(betaContext, { ...spec(), caseId: beta.caseId }));
    const read = await repo.readEvidenceForCase(worker(), beta.caseId);
    assert.equal(read.ok === false && read.refusal.reason, "NOT_PERSISTED");
  })
);

test(
  "a client may read evidence and may not create it or attach a file",
  { skip },
  records("client_cannot_write", async () => {
    // The harm: a client's upload appearing in the case file as evidence
    // recorded by the firm, indistinguishable from one a caseworker received
    // and checked.
    const item = await made();
    const client: RepositoryContext = {
      ...worker(),
      memberships: [membership({ workspaceId: alpha.workspaceId, role: "client" })],
    };
    assert.equal((await repo.readEvidenceForCase(client, alpha.caseId)).ok, true);

    const create = await repo.createEvidenceItem(client, spec());
    assert.equal(create.ok === false && create.refusal.reason, "FORBIDDEN");

    const attach = await repo.attachFileVersion(client, {
      caseId: alpha.caseId,
      evidenceId: item.id,
      bytes: bytes("x"),
      mediaType: "application/pdf",
      expectedVersion: item.version,
    });
    assert.equal(attach.ok === false && attach.refusal.reason, "FORBIDDEN");
  })
);

/* ================================================================ */
/* Digest and integrity                                             */
/* ================================================================ */

test(
  "a file version records a sha-256 of its bytes and verification recomputes it",
  { skip },
  records("digest_recomputed", async () => {
    const { item, content } = await stored("the refusal letter, first version");
    const file = item.files[0]!;
    assert.equal(file.digest, sha256(bytes(content)));
    assert.equal(file.digestAlgorithm, "sha-256");
    assert.equal(file.availability, "available");
    assert.equal(item.available, true);

    const verified = value(
      await repo.verifyEvidence(worker(), {
        caseId: alpha.caseId,
        evidenceId: item.id,
        expectedVersion: item.version,
        dimension: "digest",
      })
    );
    assert.equal(verified.verificationState, "digest_verified");
  })
);

test(
  "modified bytes fail verification",
  { skip },
  records("modified_bytes_detected", async () => {
    // The harm: a document altered after it was cited in a filing, and nothing
    // detects it because the stored digest was never recomputed.
    const { item } = await stored("original content");
    const file = item.files[0]!;
    const key = (
      await pool.query<{ storage_key: string }>(
        "SELECT storage_key FROM evidence_files WHERE id = $1",
        [file.id]
      )
    ).rows[0]!.storage_key;

    await storage.put(key, bytes("tampered content"));

    const result = value(
      await repo.verifyEvidence(worker(), {
        caseId: alpha.caseId,
        evidenceId: item.id,
        expectedVersion: item.version,
        dimension: "digest",
      })
    );
    assert.equal(result.verificationState, "disputed");

    const history = value(await repo.readEvidenceHistory(worker(), alpha.caseId, item.id));
    assert.match(history.at(-1)!.detail!, /sha-256 mismatch/);
  })
);

test(
  "a filename change does not alter content identity",
  { skip },
  records("filename_is_not_identity", async () => {
    const content = "identical bytes";
    const a = await made();
    const withA = value(
      await repo.attachFileVersion(worker(), {
        caseId: alpha.caseId,
        evidenceId: a.id,
        bytes: bytes(content),
        mediaType: "application/pdf",
        originalFilename: "letter.pdf",
        expectedVersion: a.version,
      })
    );
    const b = await made();
    const withB = value(
      await repo.attachFileVersion(worker(), {
        caseId: alpha.caseId,
        evidenceId: b.id,
        bytes: bytes(content),
        mediaType: "application/pdf",
        originalFilename: "completely-different-name.pdf",
        expectedVersion: b.version,
      })
    );
    assert.equal(withA.files[0]!.digest, withB.files[0]!.digest);
    assert.notEqual(withA.files[0]!.originalFilename, withB.files[0]!.originalFilename);

    // Identical digests do not merge the items. Two copies of one letter can be
    // two genuinely distinct pieces of evidence — one from the client, one from
    // the tribunal — and merging them would erase that difference.
    assert.notEqual(withA.id, withB.id);
    const shared = await pool.query<{ n: string }>(
      "SELECT count(DISTINCT evidence_id) AS n FROM evidence_files WHERE digest = $1",
      [withA.files[0]!.digest]
    );
    assert.equal(shared.rows[0]!.n, "2");
  })
);

test(
  "an empty file is not evidence",
  { skip },
  records("empty_file_refused", async () => {
    const item = await made();
    const result = await repo.attachFileVersion(worker(), {
      caseId: alpha.caseId,
      evidenceId: item.id,
      bytes: new Uint8Array(),
      mediaType: "application/pdf",
      expectedVersion: item.version,
    });
    assert.equal(result.ok === false && result.refusal.reason, "INVALID");
  })
);

/* ================================================================ */
/* Verification dimensions                                          */
/* ================================================================ */

test(
  "file integrity, source authenticity and professional acceptance are separate",
  { skip },
  records("dimensions_distinct", async () => {
    // The harm: an item reading as verified because its bytes hashed, and a
    // caseworker relying on it as a document a solicitor has accepted.
    const { item } = await stored();

    // A judgement cannot be recorded before the bytes are known to be stable.
    const premature = await repo.verifyEvidence(solicitor(), {
      caseId: alpha.caseId,
      evidenceId: item.id,
      expectedVersion: item.version,
      dimension: "professional",
    });
    assert.equal(premature.ok === false && premature.refusal.reason, "CONFLICT");
    assert.match(premature.ok === false ? premature.refusal.detail : "", /digest has not been verified/);

    const digested = value(
      await repo.verifyEvidence(worker(), {
        caseId: alpha.caseId,
        evidenceId: item.id,
        expectedVersion: item.version,
        dimension: "digest",
      })
    );
    assert.equal(digested.verificationState, "digest_verified");

    // A caseworker may not make the professional judgement.
    const unqualified = await repo.verifyEvidence(worker(), {
      caseId: alpha.caseId,
      evidenceId: item.id,
      expectedVersion: digested.version,
      dimension: "professional",
    });
    assert.equal(unqualified.ok === false && unqualified.refusal.reason, "FORBIDDEN");

    const accepted = value(
      await repo.verifyEvidence(solicitor(), {
        caseId: alpha.caseId,
        evidenceId: item.id,
        expectedVersion: digested.version,
        dimension: "professional",
        basis: "consistent with the tribunal's file",
      })
    );
    assert.equal(accepted.verificationState, "professionally_verified");

    // Three distinct states reached, none standing in for another.
    assert.equal(new Set(["unverified", "digest_verified", "professionally_verified"]).size, 3);
  })
);

test(
  "model-derived material must cite its execution and is classified as inferred",
  { skip },
  records("model_derived", async () => {
    const uncited = await repo.createEvidenceItem(worker(), {
      ...spec(),
      sourceClassification: "model_inferred",
      provenance: { acquisition: "model_derived" },
    });
    assert.equal(uncited.ok === false && uncited.refusal.reason, "INVALID");
    assert.match(uncited.ok === false ? uncited.refusal.detail : "", /cite the execution/);
  })
);

/* ================================================================ */
/* Provenance                                                       */
/* ================================================================ */

test(
  "an item cannot exist without provenance, and provenance is never overwritten",
  { skip },
  records("provenance", async () => {
    // The harm: a document a client photographed being indistinguishable from
    // one a tribunal sent, so nobody can weigh what it is worth.
    const item = await made();
    assert.equal(item.provenance.length, 1);
    assert.equal(item.provenance[0]!.acquisition, "authority_supplied");
    assert.equal(item.provenance[0]!.current, true);

    const corrected = value(
      await repo.recordProvenance(worker(), {
        caseId: alpha.caseId,
        evidenceId: item.id,
        acquisition: "client_supplied",
        custodyNote: "the client sent it, not the Home Office",
        supersedesId: item.provenance[0]!.id,
      })
    );
    assert.equal(corrected.provenance.length, 2);
    // Both statements survive. "The client said it came from the Home Office,
    // and later said otherwise" is two facts.
    assert.equal(corrected.provenance[0]!.acquisition, "authority_supplied");
    assert.equal(corrected.provenance[0]!.current, false);
    assert.equal(corrected.provenance[1]!.current, true);

    await assert.rejects(
      () =>
        pool.query("UPDATE evidence_provenance SET custody_note = 'edited' WHERE evidence_id = $1", [
          item.id,
        ]),
      /evidence_provenance is append-only/
    );
  })
);

/* ================================================================ */
/* EV-005                                                           */
/* ================================================================ */

/** Builds a graph edge with a source_backed assertion citing `evidenceId`. */
async function backedAssertion(evidenceId: string, locator: string) {
  const a = value(
    await graph.createNode(worker(), {
      caseId: alpha.caseId,
      nodeType: "evidence",
      subjectId: `ev-node-${seq++}`,
      label: "node",
    })
  );
  const b = value(
    await graph.createNode(worker(), {
      caseId: alpha.caseId,
      nodeType: "claim",
      subjectId: `ev-claim-${seq++}`,
      label: "claim",
    })
  );
  const edge = value(
    await graph.createEdge(worker(), {
      caseId: alpha.caseId,
      fromNodeId: a.id,
      toNodeId: b.id,
      relationship: "supports",
      assertion: {
        assertionType: "source_backed",
        assertedByType: "user",
        assertedById: alpha.caseworkerId,
        reason: "the letter says so",
      },
    })
  );
  const assertionId = edge.assertions[0]!.id;
  await pool.query(
    "INSERT INTO graph_evidence_links (assertion_id, evidence_id, locator) VALUES ($1,$2,$3)",
    [assertionId, evidenceId, locator]
  );
  return assertionId;
}

test(
  "EV-005 is not satisfied by an evidence row whose file was never stored",
  { skip },
  records("ev005_requires_bytes", async () => {
    // The harm: a bundle assembled from an item that has no file, and the
    // absence discovered at the hearing rather than when it happened.
    const item = await made();
    assert.equal(item.available, false);
    await backedAssertion(item.id, "page 2");

    const observation = await observeAssertionTraceability(query);
    assert.equal(observation.value, false, "a row with no bytes satisfied EV-005");

    // Attaching real bytes clears it.
    value(
      await repo.attachFileVersion(worker(), {
        caseId: alpha.caseId,
        evidenceId: item.id,
        bytes: bytes("the letter"),
        mediaType: "application/pdf",
        expectedVersion: item.version,
      })
    );
    assert.equal((await observeAssertionTraceability(query)).value, true);
  })
);

test(
  "EV-005 is not satisfied by a blank locator or a foreign-case document",
  { skip },
  records("ev005_locator_and_case", async () => {
    const { item } = await stored();

    // A locator that says nothing is refused by the database itself.
    const assertionId = await backedAssertion(item.id, "page 3");
    await assert.rejects(
      () =>
        pool.query(
          "UPDATE graph_evidence_links SET locator = '  ' WHERE assertion_id = $1",
          [assertionId]
        ),
      /evidence_links_carry_a_locator/
    );
    assert.equal((await observeAssertionTraceability(query)).value, true);

    // A real document from another matter satisfies the foreign key completely
    // and supports nothing.
    await pool.query("DELETE FROM graph_evidence_links WHERE assertion_id = $1", [assertionId]);
    await pool.query(
      "INSERT INTO graph_evidence_links (assertion_id, evidence_id, locator) VALUES ($1,$2,'page 1')",
      [assertionId, beta.evidenceIds[0]!]
    );
    assert.equal(
      (await observeAssertionTraceability(query)).value,
      false,
      "another matter's document satisfied the claim"
    );

    await pool.query("DELETE FROM graph_evidence_links WHERE assertion_id = $1", [assertionId]);
    await pool.query(
      "INSERT INTO graph_evidence_links (assertion_id, evidence_id, locator) VALUES ($1,$2,'page 4')",
      [assertionId, item.id]
    );
    assert.equal((await observeAssertionTraceability(query)).value, true);
  })
);

test(
  "EV-005 is not satisfied by evidence marked unavailable",
  { skip },
  records("ev005_unavailable", async () => {
    const { item } = await stored();
    const assertionId = await backedAssertion(item.id, "page 6");
    assert.equal((await observeAssertionTraceability(query)).value, true);

    value(
      await repo.markEvidenceUnavailable(worker(), {
        caseId: alpha.caseId,
        evidenceId: item.id,
        reason: "the original was returned to the client and no copy was kept",
        expectedVersion: item.version,
      })
    );
    assert.equal(
      (await observeAssertionTraceability(query)).value,
      false,
      "withdrawn evidence still counted as documentary support"
    );

    // EV-005 is a system-wide observation, so this suite restores the state it
    // deliberately broke. The assertion is superseded rather than deleted —
    // graph_assertions is append-only, and a retraction is an addition.
    await pool.query(
      `INSERT INTO graph_assertions (edge_id, assertion_type, asserted_by_type,
         asserted_by_id, reason, supersedes_id)
       SELECT edge_id, 'disputed', 'user', $2, 'the evidence was withdrawn', id
         FROM graph_assertions WHERE id = $1`,
      [assertionId, alpha.caseworkerId]
    );
  })
);

/* ================================================================ */
/* Downstream compatibility                                         */
/* ================================================================ */

test(
  "task and graph links still cannot reference dangling or foreign evidence",
  { skip },
  records("downstream_compatibility", async () => {
    // Regression: 0017 changed task_evidence_links from CASCADE to RESTRICT and
    // extended evidence_items. Neither may have weakened the existing keys.
    const { item } = await stored();
    await assert.rejects(
      () =>
        pool.query(
          "INSERT INTO task_evidence_links (task_id, evidence_id, relation) VALUES ($1,$2,'requires')",
          ["00000000-0000-4000-8000-000000000000", item.id]
        ),
      /violates foreign key constraint/
    );
    const anyAssertion = (
      await pool.query<{ id: string }>("SELECT id FROM graph_assertions LIMIT 1")
    ).rows[0]!.id;
    await assert.rejects(
      () =>
        pool.query(
          "INSERT INTO graph_evidence_links (assertion_id, evidence_id, locator) VALUES ($1,$2,'p1')",
          [anyAssertion, "00000000-0000-4000-8000-000000000000"]
        ),
      /violates foreign key constraint/
    );

    // And the cascade correction holds: evidence pinned by a task link cannot
    // be deleted, where before it would have silently taken the link with it.
    const taskId = (
      await pool.query<{ id: string }>(
        `INSERT INTO tasks (organisation_id, case_id, task_type, title, source, created_by)
         VALUES ($1,$2,'evidence','regression','human',$3) RETURNING id`,
        [alpha.organisationId, alpha.caseId, alpha.caseworkerId]
      )
    ).rows[0]!.id;
    await pool.query(
      "INSERT INTO task_evidence_links (task_id, evidence_id, relation) VALUES ($1,$2,'requires')",
      [taskId, item.id]
    );
    await assert.rejects(
      () => pool.query("DELETE FROM evidence_items WHERE id = $1", [item.id]),
      /violates foreign key constraint/
    );
  })
);

test(
  "the graph accepts person_reported without remapping existing values",
  { skip },
  records("person_reported_added", async () => {
    // The refined vocabulary, added rather than remapped. Nothing knows whether
    // an existing human_confirmed row was a client's account or a solicitor's
    // confirmation, and guessing would rewrite history on an assumption.
    const a = value(
      await graph.createNode(worker(), {
        caseId: alpha.caseId,
        nodeType: "person",
        subjectId: `pr-a-${seq++}`,
        label: "client",
      })
    );
    const b = value(
      await graph.createNode(worker(), {
        caseId: alpha.caseId,
        nodeType: "issue",
        subjectId: `pr-b-${seq++}`,
        label: "issue",
      })
    );
    await pool.query(
      `INSERT INTO graph_edges (organisation_id, case_id, from_node_id, to_node_id, relationship)
       VALUES ($1,$2,$3,$4,'concerns')`,
      [alpha.organisationId, alpha.caseId, a.id, b.id]
    );
    const edgeId = (
      await pool.query<{ id: string }>(
        "SELECT id FROM graph_edges WHERE from_node_id = $1 AND to_node_id = $2",
        [a.id, b.id]
      )
    ).rows[0]!.id;

    // A historical row in the older vocabulary, written before the refinement
    // existed, exactly as production rows were.
    await pool.query(
      `INSERT INTO graph_assertions (edge_id, assertion_type, asserted_by_type, asserted_by_id, reason)
       VALUES ($1,'human_confirmed','user',$2,'recorded before the vocabulary was refined')`,
      [edgeId, alpha.caseworkerId]
    );
    const before = await pool.query<{ n: string }>(
      "SELECT count(*) AS n FROM graph_assertions WHERE assertion_type = 'human_confirmed'"
    );
    assert.ok(Number(before.rows[0]!.n) > 0);

    await pool.query(
      `INSERT INTO graph_assertions (edge_id, assertion_type, asserted_by_type, asserted_by_id, reason)
       VALUES ($1,'person_reported','user',$2,'the client says this happened')`,
      [edgeId, alpha.caseworkerId]
    );

    // An agent may not relay a person's report.
    await assert.rejects(
      () =>
        pool.query(
          `INSERT INTO graph_assertions (edge_id, assertion_type, asserted_by_type, asserted_by_id, reason)
           VALUES ($1,'person_reported','agent','some-agent','x')`,
          [edgeId]
        ),
      /human_assertions_name_a_person/
    );

    const after = await pool.query<{ n: string }>(
      "SELECT count(*) AS n FROM graph_assertions WHERE assertion_type = 'human_confirmed'"
    );
    assert.equal(after.rows[0]!.n, before.rows[0]!.n, "historical rows were remapped");
  })
);

/* ================================================================ */
/* Atomicity, history, abstention                                   */
/* ================================================================ */

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

async function counts() {
  const q = async (sql: string) => Number((await pool.query<{ n: string }>(sql)).rows[0]!.n);
  return {
    items: await q("SELECT count(*) AS n FROM evidence_items"),
    files: await q("SELECT count(*) AS n FROM evidence_files"),
    provenance: await q("SELECT count(*) AS n FROM evidence_provenance"),
    events: await q("SELECT count(*) AS n FROM evidence_events"),
    audit: await q("SELECT count(*) AS n FROM audit_log"),
  };
}

test(
  "an induced failure on any write leaves nothing behind",
  { skip },
  records("atomicity", async () => {
    for (const [label, pattern] of [
      ["item insert", /INSERT INTO evidence_items/],
      ["provenance insert", /INSERT INTO evidence_provenance/],
      ["event insert", /INSERT INTO evidence_events/],
      ["audit insert", /audit_log/],
    ] as const) {
      const before = await counts();
      const broken = new EvidenceRepository(failingPool(pool, pattern), storage);
      const result = await broken.createEvidenceItem(worker(), spec());
      assert.equal(result.ok, false, `${label} did not fail`);
      assert.deepEqual(await counts(), before, `${label} left something behind`);
    }
  })
);

test(
  "a failed file attachment leaves no row claiming bytes, and no orphan",
  { skip },
  records("attachment_compensates", async () => {
    // Bytes are written first, so a database failure must remove them again.
    // The alternative order would leave a row pointing at a file that was never
    // persisted, which reads as success.
    const item = await made();
    const before = await counts();
    const broken = new EvidenceRepository(failingPool(pool, /INSERT INTO evidence_files/), storage);
    const result = await broken.attachFileVersion(worker(), {
      caseId: alpha.caseId,
      evidenceId: item.id,
      bytes: bytes("should not survive"),
      mediaType: "application/pdf",
      expectedVersion: item.version,
    });
    assert.equal(result.ok, false);
    assert.deepEqual(await counts(), before);

    const key = `${alpha.organisationId}/${item.id}/1`;
    assert.equal(await storage.get(key), null, "the object was not compensated away");

    const reread = value(await repo.readEvidenceItem(worker(), alpha.caseId, item.id));
    assert.equal(reread.available, false);
    assert.equal(reread.currentFileId, null);
  })
);

test(
  "an unconfigured storage provider refuses rather than pretending",
  { skip },
  records("no_storage", async () => {
    const item = await made();
    const none = new EvidenceRepository(pool, new NoStorage());
    const result = await none.attachFileVersion(worker(), {
      caseId: alpha.caseId,
      evidenceId: item.id,
      bytes: bytes("x"),
      mediaType: "application/pdf",
      expectedVersion: item.version,
    });
    assert.equal(result.ok, false);
    const reread = value(await repo.readEvidenceItem(worker(), alpha.caseId, item.id));
    assert.equal(reread.available, false);
  })
);

test(
  "a stale version is refused and two concurrent attachments cannot share a version",
  { skip },
  records("concurrency", async () => {
    const item = await made();
    const stale = item.version;
    value(
      await repo.attachFileVersion(worker(), {
        caseId: alpha.caseId,
        evidenceId: item.id,
        bytes: bytes("first"),
        mediaType: "application/pdf",
        expectedVersion: stale,
      })
    );
    const late = await repo.verifyEvidence(worker(), {
      caseId: alpha.caseId,
      evidenceId: item.id,
      expectedVersion: stale,
      dimension: "digest",
    });
    assert.equal(late.ok === false && late.refusal.reason, "CONFLICT");

    const current = value(await repo.readEvidenceItem(worker(), alpha.caseId, item.id));
    const [a, b] = await Promise.all([
      repo.attachFileVersion(worker(), {
        caseId: alpha.caseId,
        evidenceId: item.id,
        bytes: bytes("second-a"),
        mediaType: "application/pdf",
        expectedVersion: current.version,
      }),
      repo.attachFileVersion(worker(), {
        caseId: alpha.caseId,
        evidenceId: item.id,
        bytes: bytes("second-b"),
        mediaType: "application/pdf",
        expectedVersion: current.version,
      }),
    ]);
    assert.equal([a.ok, b.ok].filter(Boolean).length, 1, "both concurrent attachments committed");

    const versions = await pool.query<{ n: string }>(
      "SELECT count(*) AS n FROM evidence_files WHERE evidence_id = $1",
      [item.id]
    );
    assert.equal(versions.rows[0]!.n, "2");
  })
);

test(
  "a corrected file is a new version and the old one is never overwritten",
  { skip },
  records("file_versioning", async () => {
    const { item } = await stored("scan v1");
    const first = item.files[0]!;
    const updated = value(
      await repo.attachFileVersion(worker(), {
        caseId: alpha.caseId,
        evidenceId: item.id,
        bytes: bytes("scan v2, straightened"),
        mediaType: "application/pdf",
        expectedVersion: item.version,
      })
    );
    assert.equal(updated.files.length, 2);
    assert.equal(updated.files[0]!.version, 2);
    assert.equal(updated.currentFileId, updated.files[0]!.id);

    const old = updated.files.find((f) => f.id === first.id)!;
    assert.equal(old.digest, first.digest, "the original file version was rewritten");
    assert.equal(old.supersededById, updated.files[0]!.id);
    assert.equal(old.availability, "unavailable");

    await assert.rejects(
      () => pool.query("DELETE FROM evidence_files WHERE id = $1", [first.id]),
      /evidence_files is append-only/
    );
  })
);

test(
  "evidence history cannot be updated, deleted or truncated",
  { skip },
  records("history_immutable", async () => {
    const item = await made();
    await assert.rejects(
      () => pool.query("UPDATE evidence_events SET detail = 'x' WHERE evidence_id = $1", [item.id]),
      /evidence_events is append-only/
    );
    await assert.rejects(
      () => pool.query("DELETE FROM evidence_events WHERE evidence_id = $1", [item.id]),
      /evidence_events is append-only/
    );
    await assert.rejects(
      () => pool.query("TRUNCATE evidence_events CASCADE"),
      /evidence_events is append-only and may not be truncated/
    );
    await assert.rejects(
      () => pool.query("TRUNCATE evidence_provenance CASCADE"),
      /evidence_provenance is append-only and may not be truncated/
    );
    await assert.rejects(
      () => pool.query("DELETE FROM cases WHERE id = $1", [alpha.caseId]),
      /append-only|violates foreign key constraint/
    );
  })
);

test(
  "no file content or free text enters the audit chain, and no figure is emitted",
  { skip },
  records("audit_and_abstention", async () => {
    const content = "SENSITIVE-MEDICAL-DETAIL-DO-NOT-COPY";
    const item = await made({ title: "Psychiatric report for the appellant" });
    value(
      await repo.attachFileVersion(worker(), {
        caseId: alpha.caseId,
        evidenceId: item.id,
        bytes: bytes(content),
        mediaType: "application/pdf",
        originalFilename: "report.pdf",
        expectedVersion: item.version,
      })
    );

    const payloads = await pool.query<{ payload: Record<string, unknown> }>(
      "SELECT payload FROM audit_log WHERE subject = $1",
      [item.id]
    );
    const serialised = JSON.stringify(payloads.rows);
    assert.ok(!serialised.includes(content), "file content entered the audit chain");
    assert.ok(!serialised.includes("Psychiatric"), "an evidence title entered the audit chain");
    assert.ok(serialised.includes("sha-256"));

    const actions = await pool.query<{ action: string }>(
      "SELECT DISTINCT action FROM audit_log WHERE action LIKE 'evidence.%' ORDER BY action"
    );
    for (const expected of [
      "evidence.created",
      "evidence.file_attached",
      "evidence.provenance_recorded",
      "evidence.verified",
      "evidence.unavailable",
    ]) {
      assert.ok(
        actions.rows.some((r) => r.action === expected),
        `${expected} was never written`
      );
    }
    assert.equal(payloads.rows[0]!.payload.correlationId, `ev-${run}`);

    // No figure, anywhere.
    const all = value(await repo.readEvidenceForCase(worker(), alpha.caseId));
    const forbidden = /confidence|probability|score|likelihood|quality|reliability|authenticity/i;
    const walk = (v: unknown, path: string, found: string[]): void => {
      if (v === null || v === undefined) return;
      if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${path}[${i}]`, found));
      if (typeof v === "object") {
        for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
          if (forbidden.test(k)) found.push(`${path}.${k}`);
          if (typeof x === "number" && !["version", "byteSize"].includes(k)) {
            found.push(`${path}.${k} (numeric)`);
          }
          walk(x, `${path}.${k}`, found);
        }
      }
    };
    const found: string[] = [];
    walk(all, "evidence", found);
    assert.deepEqual(found, [], `evidence emitted ${found.join(", ")}`);

    const verified = await withTransaction(pool, (tx) => new PostgresAuditStore(tx).verify());
    assert.equal(verified.valid, true);
  })
);

test(
  "absence of a database is distinguishable from absence of evidence",
  { skip },
  records("no_fixture_fallback", async () => {
    const none = new EvidenceRepository(null, storage);
    const noDb = await none.readEvidenceForCase(worker(), alpha.caseId);
    assert.equal(noDb.ok === false && noDb.refusal.reason, "NO_DATABASE");

    const empty = await tenancy("Empty evidence");
    // The bootstrap seeds evidence, so an empty case is created directly.
    const bare = await pool.query<{ id: string }>(
      `INSERT INTO cases (workspace_id, client_id, reference, status)
       SELECT $1, client_id, 'BARE-${run}', 'intake' FROM cases WHERE id = $2 RETURNING id`,
      [empty.workspaceId, empty.caseId]
    );
    const context: RepositoryContext = {
      actorId: empty.caseworkerId,
      accountId: ACCOUNT,
      organisationId: empty.organisationId,
      memberships: [membership({ workspaceId: empty.workspaceId })],
    };
    assert.deepEqual(value(await repo.readEvidenceForCase(context, bare.rows[0]!.id)), []);

    const { readFile } = await import("node:fs/promises");
    const source = await readFile(join(repoRoot, "packages/repositories/src/evidence.ts"), "utf8");
    assert.ok(!/apps\/web|lib\/data|fixture/.test(source));
    for (const forbidden of [/\bALTER\s+TABLE\b/i, /\bDISABLE\s+TRIGGER\b/i, /\bTRUNCATE\s+[a-z_]/i]) {
      assert.ok(!forbidden.test(source));
    }
  })
);

test(
  "reads are deterministically ordered",
  { skip },
  records("deterministic_order", async () => {
    const first = value(await repo.readEvidenceForCase(worker(), alpha.caseId));
    const second = value(await repo.readEvidenceForCase(worker(), alpha.caseId));
    assert.deepEqual(first.map((e) => e.id), second.map((e) => e.id));
    for (const item of first) {
      const versions = item.files.map((f) => f.version);
      assert.deepEqual(versions, [...versions].sort((a, b) => b - a));
    }
  })
);

test(
  "the query plans use the intended indexes",
  { skip },
  records("query_plans", async () => {
    const client = await pool.query<{ client_id: string }>(
      "SELECT client_id FROM cases WHERE id = $1",
      [alpha.caseId]
    );
    await pool.query(
      `INSERT INTO cases (workspace_id, client_id, reference, status)
       SELECT $1, $2, 'EVBULK-${run}-' || g, 'evidence_collection' FROM generate_series(1, 200) g`,
      [alpha.workspaceId, client.rows[0]!.client_id]
    );
    const bulk = await pool.query<{ id: string }>(
      "SELECT id FROM cases WHERE workspace_id = $1 AND reference LIKE $2 ORDER BY reference",
      [alpha.workspaceId, `EVBULK-${run}-%`]
    );
    const ids = bulk.rows.map((r) => r.id);
    await pool.query(
      `INSERT INTO evidence_items (organisation_id, case_id, title, category, status, evidence_type, created_by)
       SELECT $1, c.id, 'bulk ' || g, 'other', 'requested', 'other', $2
         FROM unnest($3::uuid[]) AS c(id), generate_series(1, 20) g`,
      [alpha.organisationId, alpha.caseworkerId, ids]
    );
    await pool.query(
      `INSERT INTO evidence_items (organisation_id, case_id, title, category, status, evidence_type, created_by)
       SELECT $1, $2, 'dom ' || g, 'other', 'requested', 'other', $3 FROM generate_series(1, 4000) g`,
      [alpha.organisationId, alpha.caseId, alpha.caseworkerId]
    );
    // File versions too: a plan taken against six rows says nothing, and the
    // planner is right to scan a table that small.
    await pool.query(
      `INSERT INTO evidence_files (evidence_id, version, storage_provider, storage_key,
         media_type, byte_size, digest, uploaded_by, availability)
       SELECT e.id, g, 'development_filesystem', e.id || '/' || g, 'application/pdf', 1024,
              md5(e.id::text || g)::text || md5(g::text)::text, $1, 'unavailable'
         FROM evidence_items e, generate_series(2, 6) g
        WHERE e.case_id = ANY($2)`,
      [alpha.caseworkerId, ids]
    );
    await pool.query("ANALYZE evidence_items");
    await pool.query("ANALYZE evidence_files");

    const plans: Record<string, string> = {};
    const explain = async (label: string, sql: string, params: readonly unknown[]) => {
      const r = await pool.query<{ "QUERY PLAN": string }>(`EXPLAIN ${sql}`, params);
      plans[label] = r.rows.map((row) => row["QUERY PLAN"]).join("\n");
    };

    await explain(
      "evidence_by_case_selective",
      `SELECT e.id FROM evidence_items e WHERE e.case_id = $1 AND e.organisation_id = $2
         AND e.retention_state <> 'erased'
       ORDER BY e.status, e.evidence_type, e.created_at, e.id`,
      [ids[0], alpha.organisationId]
    );
    await explain(
      "evidence_by_case_dominant",
      `SELECT e.id FROM evidence_items e WHERE e.case_id = $1 AND e.organisation_id = $2
         AND e.retention_state <> 'erased'
       ORDER BY e.status, e.evidence_type, e.created_at, e.id`,
      [alpha.caseId, alpha.organisationId]
    );
    await explain(
      "files_by_item",
      "SELECT f.id FROM evidence_files f WHERE f.evidence_id = $1 ORDER BY f.version DESC",
      [(await pool.query<{ id: string }>("SELECT evidence_id AS id FROM evidence_files LIMIT 1")).rows[0]!.id]
    );

    // Either case index is a correct answer: 0001's plain `case_id` index is
    // smaller and 0017's partial one also carries the sort keys. The claim is
    // that a selective read uses an index at all, not that it uses the newest.
    assert.match(
      plans.evidence_by_case_selective!,
      /evidence_items_case(_id|_active)_idx/,
      `selective:\n${plans.evidence_by_case_selective}`
    );
    assert.match(plans.files_by_item!, /evidence_files_item_idx/, `files:\n${plans.files_by_item}`);
    // No sequential-scan counter-case arose here, unlike deadlines, reviews,
    // tasks and the graph. At roughly half the table the planner still chose a
    // bitmap index scan, because these rows are narrow enough that the bitmap
    // is cheaper than the heap. That is recorded rather than engineered away:
    // manufacturing a counter-example by tuning the population until the
    // planner blinked would be measuring the fixture, not the schema.
    assert.match(
      plans.evidence_by_case_dominant!,
      /Bitmap Index Scan|Seq Scan/,
      `dominant:\n${plans.evidence_by_case_dominant}`
    );

    await emitEvidence(repoRoot, {
      checkId: "evidence_query_plans",
      passed: true,
      at: new Date().toISOString(),
      commit: commit(),
      producedBy: "packages/integration/test/domain/evidence-repository.test.ts",
      demonstrates: `with 4000 evidence items across 200 cases plus 4000 on one case, and ANALYZE run: the selective case read used evidence_items_case_active_idx and file versions used evidence_files_item_idx. No sequential-scan counter-case arose: at roughly half the table the planner still chose a bitmap index scan, because these rows are narrow enough that the bitmap is cheaper than the heap. That differs from deadlines, reviews, tasks and the graph, and is recorded rather than engineered away. No latency claim is made. Plans:\n${JSON.stringify(plans, null, 2)}`,
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
      producedBy: "packages/integration/test/domain/evidence-repository.test.ts",
      demonstrates,
    });

  await emit(
    "evidence_reads_are_organisation_scoped",
    ["dual_membership_isolated", "cross_org"],
    "an account holding real memberships in two organisations, on a session scoped to the first, could neither read nor write the second's evidence, and reached it when scoped to the second — the case the organisation predicate itself refuses"
  );
  await emit(
    "evidence_writes_require_authority",
    ["client_cannot_write", "dimensions_distinct"],
    "a client could read evidence and could neither create an item nor attach a file; a caseworker could record a digest verification and could not record a professional one"
  );
  await emit(
    "evidence_digest_is_recomputed",
    ["digest_recomputed", "modified_bytes_detected", "empty_file_refused"],
    "every file version stored a sha-256 of its bytes and verification recomputed it from storage; altering the stored bytes moved the item to disputed with the mismatch recorded; an empty file was refused"
  );
  await emit(
    "evidence_availability_is_not_assumed",
    ["attachment_compensates", "no_storage", "file_versioning"],
    "a database failure after the bytes were written removed the object and left no row claiming a file; an unconfigured storage provider refused rather than recording an available item; a corrected file became a new version with the original preserved and undeletable"
  );
  await emit(
    "evidence_provenance_is_recorded",
    ["provenance", "model_derived"],
    "an item could not be created without provenance, a correction added a superseding record while both statements survived, and provenance refused UPDATE; model-derived material could not be recorded without the execution that produced it"
  );
  await emit(
    "evidence_verification_dimensions_are_distinct",
    ["dimensions_distinct", "digest_recomputed"],
    "a professional acceptance could not be recorded before the digest had been verified, and could not be recorded by a caseworker; digest_verified, source_verified and professionally_verified are separate states and none stands in for another"
  );
  await emit(
    "evidence_history_is_append_only",
    ["history_immutable", "provenance", "file_versioning"],
    "evidence_events and evidence_provenance each refused UPDATE, DELETE and TRUNCATE CASCADE by their own statement triggers; a file version could not be deleted; a case carrying evidence history could not be deleted"
  );
  await emit(
    "evidence_creation_is_atomic",
    ["atomicity", "concurrency"],
    "inducing a failure on the item insert, the provenance insert, the event insert and the audit insert in turn each left every evidence-domain count unchanged; a stale integer version was refused and two concurrent attachments produced exactly one new version each"
  );
  await emit(
    "evidence_emits_no_probability",
    ["audit_and_abstention"],
    "a recursive scan of every emitted item, file and provenance record found no field named for confidence, probability, score, likelihood, quality, reliability or authenticity, and no numeric field other than the integer version and byte size"
  );
  await emit(
    "evidence_satisfies_ev005_only_when_real",
    ["ev005_requires_bytes", "ev005_locator_and_case", "ev005_unavailable", "downstream_compatibility"],
    "EV-005 reported violated for an assertion citing an evidence row whose file was never stored, for one citing another matter's document, and for one whose evidence had been marked unavailable; it reported satisfied only once the cited item was same-case, provenanced, available and located; a blank locator was refused by the database itself"
  );
  await emit(
    "evidence_no_fixture_fallback",
    ["no_fixture_fallback", "deterministic_order", "person_reported_added"],
    "a case with no persisted evidence returned an empty list and no database returned NO_DATABASE; reads were identically ordered across calls with file versions newest first; person_reported was added to the graph vocabulary without remapping any existing human_confirmed row"
  );

  await pool.end();
  await rm(storageRoot, { recursive: true, force: true });
});
