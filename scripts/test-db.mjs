/**
 * Creates the test database, from nothing, every run.
 *
 * Recreation rather than truncation, because the append-only tables now refuse
 * to be truncated and should. A suite that resets by emptying the audit log is
 * exercising a system without the property it exists to demonstrate; a suite
 * that gets a fresh database is exercising one that has it.
 *
 *   pnpm test:db:setup    drop, create, migrate
 *   pnpm test:db:drop     remove it
 *
 * The name ends in _test, which is what assertTestDatabase checks. Identity
 * rather than location: a connection string carries its database name wherever
 * it is used, and a hostname says nothing about what is on the other end.
 */
import { databaseNameOf, isTestDatabase } from "../packages/database/src/index.ts";

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.error("TEST_DATABASE_URL is not set. There is no default, deliberately.");
  process.exit(1);
}
if (!isTestDatabase(url)) {
  console.error(
    `Refusing to manage "${databaseNameOf(url)}": a test database's name ends in _test.`
  );
  process.exit(1);
}

const name = databaseNameOf(url);
// Connect to the maintenance database to create or drop the target.
const adminUrl = url.replace(new RegExp(`/${name}(\\?|$)`), "/postgres$1");

const { createPool } = await import("../packages/database/src/index.ts");
const admin = await createPool(adminUrl);
const action = process.argv[2] ?? "setup";

try {
  await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  if (action === "drop") {
    console.log(`dropped ${name}`);
  } else {
    await admin.query(`CREATE DATABASE "${name}"`);
    console.log(`created ${name}`);
  }
} finally {
  await admin.end();
}

if (action === "setup") {
  const { migrate } = await import("../packages/database/src/index.ts");
  const pool = await createPool(url);
  try {
    const applied = await migrate(pool, new URL("../packages/database/migrations", import.meta.url).pathname);
    console.log(`migrated ${name}: ${applied.length} migration(s)`);
  } finally {
    await pool.end();
  }
}
