import { hashToken, revokeSession, type Session } from "@legalos/auth";

/**
 * Session storage.
 *
 * Backed by the `sessions` table when DATABASE_URL is configured, and by an
 * in-memory map otherwise. The distinction is reported rather than hidden:
 * without a database, sessions are lost on restart and not shared between
 * instances, so a person behind more than one process would be signed out at
 * random. `sessionStoreIsDurable()` answers which one is in use, and the
 * capability layer reads it rather than assuming.
 */
const memory = new Map<string, Session>();

export function sessionStoreIsDurable(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

async function withStore<T>(
  onDatabase: (store: import("@legalos/database").PostgresSessionStore) => Promise<T>,
  inMemory: () => T
): Promise<T> {
  if (!sessionStoreIsDurable()) return inMemory();

  try {
    const { createPool, PostgresSessionStore, withTransaction } = await import("@legalos/database");
    const pool = await createPool();
    try {
      return await withTransaction(pool, (tx) => onDatabase(new PostgresSessionStore(tx)));
    } finally {
      await pool.end();
    }
  } catch (error) {
    // A session lookup that cannot reach the database must not silently fall
    // back to a different store — that would sign someone in against an empty
    // map. Surfacing the error lets the handler refuse.
    console.error("[sessions] database unavailable", error);
    throw error;
  }
}

export async function putSession(session: Session): Promise<void> {
  await withStore(
    (store) => store.put(session),
    () => {
      memory.set(session.tokenHash, session);
      if (session.previousHash) memory.set(session.previousHash, session);
    }
  );
}

export async function findByToken(token: string): Promise<Session | null> {
  const tokenHash = hashToken(token);
  return withStore(
    (store) => store.findByTokenHash(tokenHash),
    () => memory.get(tokenHash) ?? null
  );
}

/**
 * Revokes a session and every token that resolves to it.
 *
 * Used when a rotated-out token is presented: two parties hold tokens for one
 * session, and the safe response is to end it rather than serve whichever one
 * arrived.
 */
export async function revoke(session: Session, now: string, reason: string): Promise<Session> {
  const revoked = revokeSession(session, now, reason);
  await withStore(
    (store) => store.revoke(session.id, now, reason),
    () => {
      memory.set(revoked.tokenHash, revoked);
      if (revoked.previousHash) memory.set(revoked.previousHash, revoked);
    }
  );
  return revoked;
}
