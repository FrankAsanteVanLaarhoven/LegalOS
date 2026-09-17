/**
 * Operational bootstrap.
 *
 *   DATABASE_URL=... pnpm bootstrap
 *
 * Creates a whole tenancy rather than a row, and is idempotent by natural key:
 * running it twice reports the tenancy already exists rather than duplicating
 * it. Everything it creates is marked as demonstration data, because a
 * demonstration case that reads as a real matter is how somebody acts on an
 * invented deadline.
 */
import {
  bootstrapTenancy,
  createPool,
  PostgresAuditStore,
  withTransaction,
} from "../packages/database/src/index.ts";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. There is no default.");
  process.exit(1);
}

const pool = await createPool();
try {
  const result = await withTransaction(pool, (tx) =>
    bootstrapTenancy(
      tx,
      {
        organisationName: "Demonstration tenancy",
        workspaceName: "Demonstration workspace",
        caseReference: process.env.BOOTSTRAP_CASE_REFERENCE ?? "DEMO-0001",
        at: new Date().toISOString(),
        operator: process.env.USER ? `operator:${process.env.USER}` : "operator:bootstrap",
      },
      new PostgresAuditStore(tx)
    )
  );

  console.log(`\n${result.created ? "Created" : "Found existing"} tenancy\n`);
  console.log(`  organisation   ${result.organisationId}`);
  console.log(`  workspace      ${result.workspaceId}`);
  console.log(`  administrator  ${result.administratorId}`);
  console.log(`  caseworker     ${result.caseworkerId}`);
  console.log(`  client         ${result.clientId}`);
  console.log(`  case           ${result.caseId}  (${result.caseReference})`);
  console.log(`  evidence       ${result.evidenceIds.length} items`);
  console.log(`  timeline       ${result.timelineIds.length} events`);
  console.log("\n  Marked as demonstration data. Not a real matter.\n");
} finally {
  await pool.end();
}
