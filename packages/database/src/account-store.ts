import type { Account, Membership } from "@legalos/auth";

import type { SqlExecutor } from "./client.ts";

/**
 * Accounts, contacts and workspace membership.
 *
 * Replaces an account id derived from the contact string, which meant a session
 * pointed at nothing: no account record, no membership, and therefore no
 * tenancy. Permissions could not have been enforced against it because there
 * was nothing to enforce them on.
 *
 * Contacts live in their own table with a unique constraint on
 * (channel, value), so the same address cannot silently attach to two accounts
 * — which is how one person's evidence ends up reachable from another's
 * sign-in.
 */

interface AccountRow {
  id: string;
  preferred_name: string;
  status: Account["status"];
  recovery_ready_at: Date | string | null;
}

interface MembershipRow {
  workspace_id: string;
  account_id: string;
  role: Membership["role"];
  regulatory_reference: string | null;
  removed_at: Date | string | null;
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function toAccount(row: AccountRow): Account {
  return {
    id: row.id,
    preferredName: row.preferred_name,
    status: row.status,
    recoveryReadyAt: iso(row.recovery_ready_at),
  };
}

export type ContactChannel = "email" | "phone";

export class PostgresAccountStore {
  readonly #sql: SqlExecutor;

  constructor(sql: SqlExecutor) {
    this.#sql = sql;
  }

  /** Finds the account a verified contact belongs to, or null. */
  async findByContact(channel: ContactChannel, value: string): Promise<Account | null> {
    const result = await this.#sql.query<AccountRow>(
      `SELECT a.* FROM accounts a
         JOIN account_contacts c ON c.account_id = a.id
        WHERE c.channel = $1 AND c.value = $2
        LIMIT 1`,
      [channel, value]
    );
    const row = result.rows[0];
    return row ? toAccount(row) : null;
  }

  /**
   * Creates an account with its first contact.
   *
   * Both rows or neither: an account with no contact cannot be signed into and
   * cannot be recovered, so a half-written pair is worse than a failure the
   * caller can retry. The caller must supply a transaction.
   */
  async create(input: {
    id: string;
    preferredName: string;
    channel: ContactChannel;
    contact: string;
    verifiedAt: string;
  }): Promise<Account> {
    await this.#sql.query(
      "INSERT INTO accounts (id, preferred_name, status) VALUES ($1, $2, 'pending_recovery')",
      [input.id, input.preferredName]
    );
    await this.#sql.query(
      `INSERT INTO account_contacts (account_id, channel, value, verified_at)
       VALUES ($1, $2, $3, $4)`,
      [input.id, input.channel, input.contact, input.verifiedAt]
    );
    return {
      id: input.id,
      preferredName: input.preferredName,
      status: "pending_recovery",
      recoveryReadyAt: null,
    };
  }

  /**
   * Marks an account active once recovery is adequate.
   *
   * The schema refuses an active account without recovery_ready_at, so this
   * cannot be used to activate something that has no way back in even if a
   * caller tried.
   */
  async markActive(accountId: string, at: string): Promise<void> {
    await this.#sql.query(
      "UPDATE accounts SET status = 'active', recovery_ready_at = $2 WHERE id = $1",
      [accountId, at]
    );
  }

  /** Active memberships, which is where role and tenancy actually live. */
  async memberships(accountId: string): Promise<Membership[]> {
    const result = await this.#sql.query<MembershipRow>(
      `SELECT workspace_id, account_id, role, regulatory_reference, removed_at
         FROM workspace_members
        WHERE account_id = $1 AND removed_at IS NULL`,
      [accountId]
    );
    return result.rows.map((row) => ({
      workspaceId: row.workspace_id,
      accountId: row.account_id,
      role: row.role,
      regulatoryReference: row.regulatory_reference,
      removedAt: iso(row.removed_at),
    }));
  }
}
