import { createHash } from "node:crypto";

/**
 * Erasure, reconciled with an immutable audit chain.
 *
 * These two requirements are in direct tension and both are real:
 *
 *   - A person may ask for their data to be erased, and for this cohort that
 *     request is often urgent and safety-related rather than administrative.
 *   - The audit log is hash-chained and append-only by database trigger, which
 *     is what makes "immutable audit" a checkable property rather than a claim.
 *
 * Deleting an audit row breaks every hash after it and destroys the property.
 * Refusing erasure because of the audit log makes the audit log a reason to
 * keep someone's data against their wishes. Neither is acceptable.
 *
 * The resolution is a tombstone. The audit entry keeps its position, its
 * timestamp, its actor and — critically — its `payloadHash`, so the chain still
 * verifies end to end. What it loses is the payload itself. Afterwards the
 * record proves that something happened, and that the content has not been
 * altered since, while no longer containing the content.
 *
 * What this cannot do, stated plainly rather than buried: a tombstone does not
 * remove the hash. If a payload were guessable, the hash would still confirm a
 * guess. That is a real limitation of any append-only design, and it belongs in
 * the privacy notice rather than in a footnote here.
 */

export type DataClass =
  | "case_content"
  | "evidence_bytes"
  | "ocr_text"
  | "translation"
  | "ai_conversation"
  | "ai_memory"
  | "embeddings"
  | "voice_recording"
  | "audit_entry"
  | "consent_record";

export type ErasureAction =
  /** Deleted outright. */
  | "erased"
  /** Content removed, structural record kept so the chain still verifies. */
  | "tombstoned"
  /** Kept, with a stated legal basis. */
  | "retained";

export interface RetentionRule {
  readonly dataClass: DataClass;
  readonly action: ErasureAction;
  /**
   * Why, in words a user can read. Required for anything not erased —
   * "we keep this" without a reason is the thing a privacy centre exists to
   * prevent.
   */
  readonly reason: string;
  /** How long retention lasts, when it is time-limited. */
  readonly retainedUntil: string | null;
}

/**
 * Default policy.
 *
 * Everything a person supplied or the system derived from it is erased. Only
 * the structural audit record and the consent record survive, and both survive
 * as tombstones or as evidence of the user's own decisions.
 */
export const DEFAULT_RETENTION: readonly RetentionRule[] = [
  {
    dataClass: "case_content",
    action: "erased",
    reason: "Supplied by you; removed on request.",
    retainedUntil: null,
  },
  {
    dataClass: "evidence_bytes",
    action: "erased",
    reason: "Your documents; removed on request.",
    retainedUntil: null,
  },
  {
    dataClass: "ocr_text",
    action: "erased",
    reason: "Derived from your documents; removed with them.",
    retainedUntil: null,
  },
  {
    dataClass: "translation",
    action: "erased",
    reason: "Derived from your documents; removed with them.",
    retainedUntil: null,
  },
  {
    dataClass: "ai_conversation",
    action: "erased",
    reason: "Your conversations; removed on request.",
    retainedUntil: null,
  },
  {
    dataClass: "ai_memory",
    action: "erased",
    reason: "Removed on request; nothing is carried into future sessions.",
    retainedUntil: null,
  },
  {
    dataClass: "embeddings",
    action: "erased",
    reason:
      "Vector representations are derived from your text and are removed with it. They are not a separate copy that survives.",
    retainedUntil: null,
  },
  {
    dataClass: "voice_recording",
    action: "erased",
    reason: "Your recordings; removed on request.",
    retainedUntil: null,
  },
  {
    dataClass: "audit_entry",
    action: "tombstoned",
    reason:
      "The record that an action happened is kept so the audit trail still verifies, but its contents are removed. What remains shows that something occurred and that it has not been altered — not what it said.",
    retainedUntil: null,
  },
  {
    dataClass: "consent_record",
    action: "retained",
    reason:
      "Kept as evidence of the permissions you gave and withdrew, including this erasure request. Removing it would destroy the proof that you asked.",
    retainedUntil: null,
  },
];

export interface ErasureRequest {
  readonly subjectId: string;
  /** ISO-8601, supplied by the caller so the outcome is deterministic. */
  readonly requestedAt: string;
  /** Limit erasure to specific classes; omit to cover everything. */
  readonly dataClasses?: readonly DataClass[];
}

export interface ErasureOutcome {
  readonly subjectId: string;
  readonly requestedAt: string;
  readonly actions: readonly RetentionRule[];
  /** Classes fully removed. */
  readonly erased: readonly DataClass[];
  /** Classes reduced to a structural record. */
  readonly tombstoned: readonly DataClass[];
  /** Classes kept, each with a stated reason. */
  readonly retained: readonly DataClass[];
  /**
   * What a user is told about the limits, rather than a promise the system
   * cannot keep.
   */
  readonly limitations: readonly string[];
}

export function planErasure(
  request: ErasureRequest,
  policy: readonly RetentionRule[] = DEFAULT_RETENTION
): ErasureOutcome {
  const scope = request.dataClasses;
  const actions = scope ? policy.filter((rule) => scope.includes(rule.dataClass)) : [...policy];

  for (const rule of actions) {
    if (rule.action !== "erased" && rule.reason.trim() === "") {
      throw new Error(`retention rule for ${rule.dataClass} keeps data without stating why`);
    }
  }

  return {
    subjectId: request.subjectId,
    requestedAt: request.requestedAt,
    actions,
    erased: actions.filter((r) => r.action === "erased").map((r) => r.dataClass),
    tombstoned: actions.filter((r) => r.action === "tombstoned").map((r) => r.dataClass),
    retained: actions.filter((r) => r.action === "retained").map((r) => r.dataClass),
    limitations: [
      "A tombstoned audit entry keeps the fingerprint of what it contained. The content is gone and cannot be read from it, but if someone already knew what it said, the fingerprint would confirm it.",
      "Backups made before this request may persist until they expire on their normal schedule.",
      "Anything you have already exported or shared is outside this system and cannot be recalled by it.",
    ],
  };
}

/* ------------------------------------------------------------------ */
/* Tombstoning an audit entry                                          */
/* ------------------------------------------------------------------ */

export interface TombstonedEntry {
  readonly seq: number;
  readonly at: string;
  readonly actor: string;
  readonly action: string;
  readonly subject: string;
  /** Preserved so the chain still verifies. */
  readonly payloadHash: string;
  readonly prevHash: string;
  readonly hash: string;
  readonly tombstoned: true;
  readonly tombstonedAt: string;
}

/**
 * Replaces an entry's payload while preserving every field the chain hashes.
 *
 * The entry hash is computed over the payload *hash*, not the payload, so the
 * chain verifies exactly as before. This is the property that lets erasure and
 * immutability coexist.
 */
export function tombstoneEntry(
  entry: {
    seq: number;
    at: string;
    actor: string;
    action: string;
    subject: string;
    payloadHash: string;
    prevHash: string;
    hash: string;
  },
  tombstonedAt: string
): TombstonedEntry {
  return { ...entry, tombstoned: true, tombstonedAt };
}

/** Confirms a tombstone kept everything the chain depends on. */
export function tombstonePreservesChain(
  before: { payloadHash: string; prevHash: string; hash: string; seq: number },
  after: TombstonedEntry
): boolean {
  return (
    after.seq === before.seq &&
    after.payloadHash === before.payloadHash &&
    after.prevHash === before.prevHash &&
    after.hash === before.hash
  );
}

/** Hash of a payload, for checking that a tombstone's fingerprint is genuine. */
export function payloadFingerprint(payload: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(payload) ?? "null", "utf8")
    .digest("hex");
}
