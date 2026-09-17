import { assertTestDatabase } from "@legalos/database";

/**
 * The one place a destructive suite decides whether it may run.
 *
 * Stated once rather than left to each test author. Absence of
 * TEST_DATABASE_URL skips; a connection naming anything other than a test
 * database throws rather than skipping, because a silent skip on a production
 * connection string looks exactly like a suite that ran and passed.
 */
export function guardOrSkip(connectionString: string | undefined): string | false {
  if (!connectionString) return "TEST_DATABASE_URL is not set";
  assertTestDatabase(connectionString);
  return false;
}
