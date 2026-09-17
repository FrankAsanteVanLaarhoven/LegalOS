/**
 * @legalos/privacy — erasure and consent.
 *
 * Two things this package exists to get right, because both are places where a
 * platform holding asylum and trafficking material can quietly fail its users:
 *
 *  - Erasure that coexists with an append-only audit chain, via tombstones that
 *    remove content while preserving the hashes the chain verifies against —
 *    and that states, in the outcome itself, what erasure cannot reach.
 *  - Consent recorded as events rather than as a current-state boolean, so
 *    "when was this granted, and was anything accessed after I withdrew it"
 *    has an answer.
 */

export {
  DEFAULT_RETENTION,
  payloadFingerprint,
  planErasure,
  tombstoneEntry,
  tombstonePreservesChain,
  type DataClass,
  type ErasureAction,
  type ErasureOutcome,
  type ErasureRequest,
  type RetentionRule,
  type TombstonedEntry,
} from "./erasure.ts";

export {
  accessWasPermitted,
  ConsentLedger,
  type ConsentEvent,
  type ConsentEventKind,
  type Permission,
} from "./consent.ts";
