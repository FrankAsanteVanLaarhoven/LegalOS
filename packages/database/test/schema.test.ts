import { test } from "node:test";
import assert from "node:assert/strict";

import { migrate, readMigrations } from "../src/migrate.ts";
import { FakeMigrationPool } from "./fake-sql.ts";

const migrations = await readMigrations();
const schema = migrations.map((m) => m.sql).join("\n");

/**
 * Statements only. Assertions about what the schema *does* must not be
 * satisfied — or defeated — by prose in a comment describing it.
 */
const statements = schema
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

test("migrations are ordered and non-empty", () => {
  assert.ok(migrations.length >= 2);
  const names = migrations.map((m) => m.name);
  assert.deepEqual(names, [...names].sort());
  for (const migration of migrations) {
    assert.ok(migration.sql.trim().length > 0, migration.name);
    assert.match(migration.checksum, /^[0-9a-f]{64}$/);
  }
});

test("the audit log is append-only in the database, not by convention", () => {
  assert.match(schema, /CREATE TRIGGER audit_log_no_update\s+BEFORE UPDATE ON audit_log/);
  assert.match(schema, /CREATE TRIGGER audit_log_no_delete\s+BEFORE DELETE ON audit_log/);
  assert.match(schema, /audit_log is append-only/);
});

test("a source cannot claim to be verified without provenance", () => {
  assert.match(schema, /CONSTRAINT verified_sources_carry_provenance/);
  assert.match(
    schema,
    /verification_status <> 'verified'\s*OR \(retrieved_at IS NOT NULL AND checksum IS NOT NULL AND version IS NOT NULL\)/
  );
});

test("AI output cannot be stored without a verification verdict", () => {
  const aiOutputs = schema.slice(schema.indexOf("CREATE TABLE ai_outputs"));
  assert.match(
    aiOutputs,
    /verdict\s+text NOT NULL CHECK \(verdict IN \('pass', 'flag', 'block'\)\)/
  );
  assert.match(aiOutputs, /CONSTRAINT released_output_has_no_findings/);
});

test("an authorised or rejected proposal must name a human", () => {
  assert.match(schema, /CONSTRAINT authorised_proposals_name_a_human/);
  assert.match(schema, /CONSTRAINT rejected_proposals_name_a_human/);
});

test("no stored completeness score exists to drift from the evidence rows", () => {
  assert.equal(/completeness_score/.test(statements), false);
});

test("timeline provenance is an enum of sources, with no confidence column", () => {
  const timeline = statements.slice(
    statements.indexOf("CREATE TABLE timeline_events"),
    statements.indexOf("CREATE INDEX timeline_events_case_id_idx")
  );
  assert.match(timeline, /source\s+text NOT NULL CHECK/);
  assert.equal(/confidence/.test(timeline), false);
});

test("retrieval chunks cannot be orphaned from a registered source", () => {
  assert.match(schema, /source_id\s+text NOT NULL REFERENCES legal_sources\(id\)/);
  assert.match(schema, /embedding\s+vector\(1536\)/);
});

test("every case-scoped table cascades from cases", () => {
  for (const table of ["timeline_events", "evidence_items", "proposals"]) {
    const start = schema.indexOf(`CREATE TABLE ${table}`);
    assert.notEqual(start, -1, table);
    const body = schema.slice(start, schema.indexOf(");", start));
    assert.match(body, /REFERENCES cases\(id\) ON DELETE CASCADE/, table);
  }
});

test("the runner applies pending migrations once", async () => {
  const pool = new FakeMigrationPool();
  const firstRun = await migrate(pool);
  assert.deepEqual(
    firstRun,
    migrations.map((m) => m.name)
  );

  const secondRun = await migrate(pool);
  assert.deepEqual(secondRun, [], "already-applied migrations must not run again");
});

test("editing an applied migration is an error, not a silent no-op", async () => {
  const pool = new FakeMigrationPool();
  await migrate(pool);
  pool.applied.set(migrations[0]!.name, "f".repeat(64));
  await assert.rejects(() => migrate(pool), /has changed since it was applied/);
});

test("a failing migration is not recorded as applied", async () => {
  const pool = new FakeMigrationPool();
  pool.failOn = "CREATE TABLE organizations";
  await assert.rejects(() => migrate(pool), /simulated failure/);
  assert.equal(pool.applied.size, 0);
});
