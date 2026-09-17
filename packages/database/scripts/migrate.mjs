#!/usr/bin/env node
/**
 * Applies pending migrations to the database named by DATABASE_URL.
 *
 *   DATABASE_URL=postgres://legalos:legalos@localhost:5432/legalos pnpm --filter @legalos/database migrate
 */
import { createPool, migrate } from "../src/index.ts";

const pool = await createPool();
try {
  const applied = await migrate(pool);
  if (applied.length === 0) {
    console.log("No pending migrations.");
  } else {
    for (const name of applied) console.log(`applied ${name}`);
  }
} finally {
  await pool.end();
}
