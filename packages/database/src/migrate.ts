import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { PoolLike } from "./client.ts";
import { withTransaction } from "./client.ts";

/**
 * Migration runner.
 *
 * Each file runs once, inside a transaction, in filename order, and its
 * checksum is recorded. Editing an already-applied migration is an error rather
 * than a silent no-op — otherwise the schema in a deployed database and the
 * schema in the repository drift apart with nothing to detect it.
 */

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

export interface AppliedMigration {
  readonly name: string;
  readonly checksum: string;
}

async function ensureMigrationsTable(pool: PoolLike): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text PRIMARY KEY,
      checksum   char(64) NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

export async function readMigrations(
  directory: string = MIGRATIONS_DIR
): Promise<{ name: string; sql: string; checksum: string }[]> {
  const files = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  return Promise.all(
    files.map(async (name) => {
      const sql = await readFile(join(directory, name), "utf8");
      return { name, sql, checksum: createHash("sha256").update(sql, "utf8").digest("hex") };
    })
  );
}

export async function migrate(
  pool: PoolLike,
  directory: string = MIGRATIONS_DIR
): Promise<string[]> {
  await ensureMigrationsTable(pool);

  const applied = await pool.query<AppliedMigration>(
    "SELECT name, checksum FROM schema_migrations"
  );
  const appliedByName = new Map(applied.rows.map((row) => [row.name, row.checksum]));

  const migrations = await readMigrations(directory);
  const run: string[] = [];

  for (const migration of migrations) {
    const previousChecksum = appliedByName.get(migration.name);
    if (previousChecksum !== undefined) {
      if (previousChecksum !== migration.checksum) {
        throw new Error(
          `migration ${migration.name} has changed since it was applied ` +
            `(recorded ${previousChecksum.slice(0, 12)}…, found ${migration.checksum.slice(0, 12)}…). ` +
            "Add a new migration instead of editing an applied one."
        );
      }
      continue;
    }

    await withTransaction(pool, async (tx) => {
      await tx.query(migration.sql);
      await tx.query("INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)", [
        migration.name,
        migration.checksum,
      ]);
    });
    run.push(migration.name);
  }

  return run;
}
