/**
 * @legalos/governance — audit, approvals, and provenance.
 *
 * The audit chain makes tampering detectable; the approval state machine keeps
 * legal responsibility attached to a named qualified human rather than to a
 * model output.
 */

export {
  AuditChain,
  canonicalise,
  GENESIS_HASH,
  type AuditEntry,
  type AuditInput,
  type ChainVerification,
} from "./audit.ts";

export {
  authorise,
  isReserved,
  propose,
  reject,
  RESERVED_ACTIVITIES,
  submitForReview,
  type Actor,
  type Proposal,
  type ProposalState,
  type ProvenanceRecord,
  type ReservedActivity,
  type Role,
  type TransitionFailure,
  type TransitionResult,
} from "./approvals.ts";
