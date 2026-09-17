import type { Account, Membership } from "@legalos/auth";

/**
 * Account lookup and creation.
 *
 * Requires a database. Unlike sessions, there is no in-memory fallback: an
 * account that exists only in one process's memory cannot be recovered, cannot
 * carry a membership, and would let the same person sign in twice as two
 * different people depending on which instance answered. Refusing is the only
 * honest option when there is nowhere to put it.
 */
export function accountStoreIsAvailable(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export type ContactChannel = "email" | "phone";

/** Classifies a contact string. Anything with an @ is treated as an address. */
export function channelOf(contact: string): ContactChannel {
  return contact.includes("@") ? "email" : "phone";
}

export interface ResolvedAccount {
  readonly account: Account;
  readonly memberships: readonly Membership[];
  readonly created: boolean;
}

/**
 * Finds the account behind a verified contact, creating one on first sign-in.
 *
 * A new account is created `pending_recovery` — the schema refuses `active`
 * without a recovery timestamp, so an account cannot come into existence
 * already usable.
 */
export async function resolveAccount(
  contact: string,
  verifiedAt: string
): Promise<ResolvedAccount> {
  if (!accountStoreIsAvailable()) {
    throw new Error("no database configured: accounts cannot be created or looked up");
  }

  const { createPool, PostgresAccountStore, withTransaction } = await import("@legalos/database");
  const pool = await createPool();

  try {
    return await withTransaction(pool, async (tx) => {
      const store = new PostgresAccountStore(tx);
      const channel = channelOf(contact);

      const existing = await store.findByContact(channel, contact);
      if (existing) {
        return {
          account: existing,
          memberships: await store.memberships(existing.id),
          created: false,
        };
      }

      const account = await store.create({
        id: crypto.randomUUID(),
        // The contact is used as a placeholder display name until the person
        // chooses one. It is never treated as a legal name.
        preferredName: contact,
        channel,
        contact,
        verifiedAt,
      });

      return { account, memberships: [], created: true };
    });
  } finally {
    await pool.end();
  }
}

/** Marks an account active once recovery has been established. */
export async function markAccountActive(accountId: string, at: string): Promise<void> {
  const { createPool, PostgresAccountStore, withTransaction } = await import("@legalos/database");
  const pool = await createPool();
  try {
    await withTransaction(pool, (tx) => new PostgresAccountStore(tx).markActive(accountId, at));
  } finally {
    await pool.end();
  }
}
