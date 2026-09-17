/**
 * Cookie names, declared once.
 *
 * `SESSION_COOKIE` was previously a literal in both `middleware.ts` and
 * `require-session.ts`. Two copies of a security-relevant name is one rename
 * away from an edge check that guards a cookie nothing reads.
 */
export const SESSION_COOKIE = "legalos_session";
