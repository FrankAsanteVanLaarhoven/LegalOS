/**
 * The boundary between a test database and every other database.
 *
 * The suites read `DATABASE_URL` — the application's own variable — and guarded
 * themselves with a check that the host was localhost. Localhost is not a
 * test/production distinction: a production database reached through an SSH
 * tunnel is on localhost, and so is a production stack running under compose.
 * The guard permitted destroying any database that happened to be nearby, which
 * is the most likely way somebody reaches a real one from a laptop.
 *
 * Identity is a better invariant than location. A database is a test database
 * because of what it is called, which travels with the connection string
 * wherever it is used, rather than because of where it happens to be answering.
 */

/** Test databases are named for what they are. */
const TEST_DATABASE_SUFFIX = "_test";

export function databaseNameOf(connectionString: string): string {
  try {
    // Swapped to http so the URL parser accepts it; only the path is read.
    const url = new URL(connectionString.replace(/^postgres(ql)?:/, "http:"));
    return decodeURIComponent(url.pathname.replace(/^\//, ""));
  } catch {
    return "";
  }
}

export function isTestDatabase(connectionString: string): boolean {
  return databaseNameOf(connectionString).endsWith(TEST_DATABASE_SUFFIX);
}

/**
 * Refuses to proceed unless the connection names a test database.
 *
 * Called by every suite that writes, so the property is stated once rather than
 * left to each test author to remember. The failure is loud and names the
 * database, because a silent skip would look exactly like a suite that had run.
 */
export function assertTestDatabase(connectionString: string | undefined): string {
  if (!connectionString) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Destructive suites do not fall back to DATABASE_URL: " +
        "sharing one variable with the application is how a live execution record was destroyed."
    );
  }

  const name = databaseNameOf(connectionString);
  if (!isTestDatabase(connectionString)) {
    throw new Error(
      `Refusing to run destructive tests against "${name || "an unnamed database"}": ` +
        `a test database's name ends in ${TEST_DATABASE_SUFFIX}. ` +
        "Rename the database rather than relaxing this check."
    );
  }
  return connectionString;
}

/**
 * The inverse, for the application.
 *
 * A deployment pointed at a test database is as wrong as a test pointed at a
 * production one, and it fails in a quieter way: everything works, and the
 * records are written somewhere that will be dropped.
 */
export function refuseTestDatabaseInProduction(
  connectionString: string,
  environment = process.env.NODE_ENV
): void {
  if (environment === "production" && isTestDatabase(connectionString)) {
    throw new Error(
      `DATABASE_URL names the test database "${databaseNameOf(connectionString)}" and NODE_ENV is production. ` +
        "Refusing to start: records written there are expected to be destroyed."
    );
  }
}
