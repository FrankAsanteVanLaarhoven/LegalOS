/**
 * @legalos/representation — preparation, not prospects.
 *
 * Three concerns, each built so the unsafe version is not reachable:
 *
 *  - Readiness describes the state of the file and emits no aggregate score,
 *    because any single figure across evidence, deadlines and review reads as a
 *    likelihood of winning however it is labelled.
 *  - Drafts are lists of backed assertions, not prose. An unbacked fact or an
 *    unsourced legal proposition blocks rendering entirely, since a document
 *    that is mostly sound is the one that survives review.
 *  - Practice covers procedure. Demeanour is never scored, and the function
 *    that would do it throws with the reason.
 */

export {
  assessReadiness,
  missingEvidence,
  type CaseFacts,
  type ItemState,
  type ReadinessArea,
  type ReadinessItem,
  type ReadinessReport,
} from "./readiness.ts";

export {
  isRegulatedDocument,
  REGULATED_DOCUMENT_TYPES,
  requiresProfessionalReview,
  reviewDraft,
  type AssertionKind,
  type Backing,
  type Draft,
  type DraftAssertion,
  type DraftFinding,
  type DraftProblem,
  type DraftReview,
} from "./drafting.ts";

export {
  PRACTICE_TOPICS,
  scoreDemeanour,
  summariseSession,
  type PracticeQuestion,
  type PracticeRole,
  type PracticeSession,
  type SessionSummary,
} from "./practice.ts";
