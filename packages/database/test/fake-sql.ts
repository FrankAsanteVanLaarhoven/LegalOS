import type { PoolClientLike, PoolLike, QueryResult, SqlExecutor } from "../src/client.ts";

interface AuditRow {
  seq: number;
  at: string;
  actor: string;
  action: string;
  subject: string;
  payload: Record<string, unknown>;
  payload_hash: string;
  prev_hash: string;
  hash: string;
}

/**
 * In-memory stand-in for the audit_log table.
 *
 * Deliberately understands only the handful of statements PostgresAuditStore
 * issues — it exists to exercise the chain construction without a server, not
 * to be a SQL engine. Anything unrecognised throws rather than silently
 * returning an empty result, so a query change cannot pass unnoticed.
 */
export class FakeAuditDatabase implements SqlExecutor {
  rows: AuditRow[] = [];
  readonly statements: string[] = [];

  async query<Row = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = []
  ): Promise<QueryResult<Row>> {
    const sql = text.trim().replace(/\s+/g, " ");
    this.statements.push(sql);

    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(sql)) {
      return { rows: [], rowCount: 0 };
    }

    if (sql.startsWith("SELECT seq, hash FROM audit_log ORDER BY seq DESC LIMIT 1")) {
      const tail = this.rows.at(-1);
      const rows = tail ? [{ seq: String(tail.seq), hash: tail.hash }] : [];
      return { rows: rows as Row[], rowCount: rows.length };
    }

    if (sql.startsWith("INSERT INTO audit_log")) {
      const [seq, at, actor, action, subject, payload, payloadHash, prevHash, hash] = values;
      this.rows.push({
        seq: Number(seq),
        at: String(at),
        actor: String(actor),
        action: String(action),
        subject: String(subject),
        payload: JSON.parse(String(payload)) as Record<string, unknown>,
        payload_hash: String(payloadHash),
        prev_hash: String(prevHash),
        hash: String(hash),
      });
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith("SELECT * FROM audit_log ORDER BY seq ASC")) {
      const limit = values.length > 0 ? Number(values[0]) : this.rows.length;
      const rows = this.rows.slice(0, limit);
      return { rows: rows as Row[], rowCount: rows.length };
    }

    throw new Error(`FakeAuditDatabase received an unexpected statement: ${sql}`);
  }
}

/** Minimal pool used by the migration-runner tests. */
export class FakeMigrationPool implements PoolLike {
  readonly applied = new Map<string, string>();
  readonly executed: string[] = [];
  failOn: string | null = null;

  async query<Row = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = []
  ): Promise<QueryResult<Row>> {
    const sql = text.trim().replace(/\s+/g, " ");

    if (this.failOn && sql.includes(this.failOn)) {
      throw new Error(`simulated failure executing: ${this.failOn}`);
    }

    if (sql.startsWith("CREATE TABLE IF NOT EXISTS schema_migrations")) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.startsWith("SELECT name, checksum FROM schema_migrations")) {
      const rows = [...this.applied].map(([name, checksum]) => ({ name, checksum }));
      return { rows: rows as Row[], rowCount: rows.length };
    }
    if (sql.startsWith("INSERT INTO schema_migrations")) {
      this.applied.set(String(values[0]), String(values[1]));
      return { rows: [], rowCount: 1 };
    }
    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(sql)) {
      return { rows: [], rowCount: 0 };
    }

    this.executed.push(sql);
    return { rows: [], rowCount: 0 };
  }

  async connect(): Promise<PoolClientLike> {
    const pool = this;
    return {
      query: (text: string, values?: readonly unknown[]) => pool.query(text, values),
      release: () => {},
    } as PoolClientLike;
  }

  async end(): Promise<void> {}
}
