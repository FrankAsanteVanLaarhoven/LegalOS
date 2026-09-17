/**
 * Database access.
 *
 * Everything downstream depends on the narrow `SqlExecutor` interface rather
 * than on `pg` directly, so repositories can be exercised without a live
 * server and a transaction can be passed anywhere a connection is accepted.
 */

import { refuseTestDatabaseInProduction } from "./test-guard.ts";

export interface QueryResult<Row> {
  readonly rows: Row[];
  readonly rowCount: number;
}

export interface SqlExecutor {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[]
  ): Promise<QueryResult<Row>>;
}

export interface PoolLike extends SqlExecutor {
  connect(): Promise<PoolClientLike>;
  end(): Promise<void>;
}

export interface PoolClientLike extends SqlExecutor {
  release(): void;
}

/**
 * Reads the connection string from the environment.
 *
 * Throws rather than defaulting to localhost: a silent fallback is how a
 * production process ends up quietly writing to, or reading nothing from, a
 * database nobody intended.
 */
export function requireDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.DATABASE_URL;
  if (!url || url.trim() === "") {
    throw new Error(
      "DATABASE_URL is not set. Set it to a PostgreSQL connection string; there is no default."
    );
  }
  // A deployment pointed at a test database fails quietly: everything works,
  // and the records land somewhere expected to be destroyed.
  refuseTestDatabaseInProduction(url, env.NODE_ENV);
  return url;
}

/**
 * Creates a connection pool. `pg` is imported dynamically so that importing this
 * package for its types — as apps/web does — never requires the driver to be
 * loadable in the browser bundle.
 */
export async function createPool(connectionString?: string): Promise<PoolLike> {
  const { Pool } = await import("pg");
  const pool = new Pool({
    connectionString: connectionString ?? requireDatabaseUrl(),
    // A stuck connection should surface as an error, not hold a request open.
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    max: 10,
  });
  return pool as unknown as PoolLike;
}

/** Runs `fn` inside a transaction, rolling back on any thrown error. */
export async function withTransaction<T>(
  pool: PoolLike,
  fn: (tx: SqlExecutor) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {
      /* the original error is more useful than a rollback failure */
    });
    throw error;
  } finally {
    client.release();
  }
}
