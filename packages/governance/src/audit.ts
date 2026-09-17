import { createHash } from "node:crypto";

/**
 * Append-only, hash-chained audit log.
 *
 * Each entry commits to its predecessor, so removing or editing any entry
 * invalidates every hash after it. This is what makes "immutable audit" a
 * checkable property rather than a claim in a marketing table.
 */

export interface AuditInput {
  /** ISO-8601. Passed in rather than read from the clock so the log is testable. */
  readonly at: string;
  readonly actor: string;
  readonly action: string;
  readonly subject: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface AuditEntry extends AuditInput {
  readonly seq: number;
  readonly payloadHash: string;
  readonly prevHash: string;
  readonly hash: string;
}

export const GENESIS_HASH = "0".repeat(64);

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Deterministic serialisation: object keys sorted at every depth, so two
 * logically identical payloads always produce the same hash.
 */
export function canonicalise(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalise).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalise(v)}`);
  return `{${entries.join(",")}}`;
}

export interface ChainVerification {
  readonly valid: boolean;
  /** Sequence number of the first entry that fails, or null when intact. */
  readonly brokenAt: number | null;
  readonly reason: string | null;
}

export class AuditChain {
  #entries: AuditEntry[] = [];

  append(input: AuditInput): AuditEntry {
    const prevHash = this.#entries.at(-1)?.hash ?? GENESIS_HASH;
    const seq = this.#entries.length;
    const payloadHash = sha256(canonicalise(input.payload));
    const hash = sha256(
      canonicalise({
        seq,
        at: input.at,
        actor: input.actor,
        action: input.action,
        subject: input.subject,
        payloadHash,
        prevHash,
      })
    );
    const entry: AuditEntry = { ...input, seq, payloadHash, prevHash, hash };
    this.#entries.push(entry);
    return entry;
  }

  entries(): readonly AuditEntry[] {
    return [...this.#entries];
  }

  get length(): number {
    return this.#entries.length;
  }

  /** Recomputes every hash and confirms the chain links. */
  verify(): ChainVerification {
    let prevHash = GENESIS_HASH;
    for (const [index, entry] of this.#entries.entries()) {
      if (entry.seq !== index) {
        return { valid: false, brokenAt: index, reason: "sequence number out of order" };
      }
      if (entry.prevHash !== prevHash) {
        return { valid: false, brokenAt: index, reason: "previous hash does not link" };
      }
      const payloadHash = sha256(canonicalise(entry.payload));
      if (payloadHash !== entry.payloadHash) {
        return { valid: false, brokenAt: index, reason: "payload has been altered" };
      }
      const expected = sha256(
        canonicalise({
          seq: entry.seq,
          at: entry.at,
          actor: entry.actor,
          action: entry.action,
          subject: entry.subject,
          payloadHash,
          prevHash,
        })
      );
      if (expected !== entry.hash) {
        return { valid: false, brokenAt: index, reason: "entry hash does not match content" };
      }
      prevHash = entry.hash;
    }
    return { valid: true, brokenAt: null, reason: null };
  }

  /** Newline-delimited JSON, suitable for handing to a regulator. */
  export(): string {
    return this.#entries.map((entry) => JSON.stringify(entry)).join("\n");
  }

  static fromExport(serialised: string): AuditChain {
    const chain = new AuditChain();
    const lines = serialised.split("\n").filter((line) => line.trim().length > 0);
    chain.#entries = lines.map((line) => JSON.parse(line) as AuditEntry);
    return chain;
  }
}
