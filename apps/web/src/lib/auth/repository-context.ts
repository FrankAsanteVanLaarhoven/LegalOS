import "server-only";

import { randomUUID } from "node:crypto";
import { cache } from "react";

import type { RepositoryContext } from "@legalos/repositories";

import { resolveTenantContext, type Resolved, type SessionFailure } from "./server-session";

/**
 * The one supported way a route obtains a repository context.
 *
 * Every field here is derived server-side from a verified session and current
 * memberships. None of it is accepted from the client — not `actorId`, not
 * `organisationId`, not the correlation id. A route that builds a context by
 * hand, or reads either identifier out of a form payload, is a
 * `pnpm check:principles` failure rather than something a reviewer has to spot.
 *
 * `actorId` and `accountId` are separate on purpose, because the schema keeps
 * them separate: `accountId` is an `accounts` row and `actorId` is a `users`
 * row. `/api/analyze` and `/api/chat` currently pass an account id where an
 * actor id is meant, which no constraint catches because
 * `ai_executions.actor_id` is untyped text. That is recorded as a known defect
 * rather than fixed here — it is execution-layer work, not this phase.
 */

export type ContextFailure = SessionFailure;

/**
 * The correlation id for this request.
 *
 * Generated server-side and never read from a browser header: a caller who
 * chooses their own correlation id can stitch their writes into somebody
 * else's request in the audit trail, or split their own to make a sequence
 * unreadable. Request-cached, so several writes in one logical request share
 * one value — which is the entire point of having it.
 */
export const requestCorrelationId = cache((): string => `req-${randomUUID()}`);

/**
 * Builds the context, or explains why it cannot.
 *
 * `memberships` is passed through because `membershipFor` resolves against the
 * case's *workspace*, which the repository discovers and the caller does not
 * know in advance. Trimming it here would mean the repositories could no longer
 * prove the boundary they currently prove.
 */
export async function createRepositoryContext(): Promise<Resolved<RepositoryContext>> {
  const tenant = await resolveTenantContext();
  if (!tenant.ok) return tenant;

  // The `users` row for this account in the active organisation. Distinct from
  // the account, and the value domain rows are attributed to.
  const actorId = await resolveActorId(tenant.value.accountId, tenant.value.organisationId);
  if (!actorId) {
    return {
      ok: false,
      failure: "no_active_organisation",
      detail: "this account has no user record in the active organisation",
    };
  }

  return {
    ok: true,
    value: {
      actorId,
      accountId: tenant.value.accountId,
      organisationId: tenant.value.organisationId,
      memberships: tenant.value.memberships,
      correlationId: requestCorrelationId(),
    },
  };
}

/**
 * Resolves the `users` row for an account within one organisation.
 *
 * Scoped to the organisation deliberately. One person acting for two firms has
 * a user row in each, and attributing a write to the wrong one would put the
 * wrong name against a case in a different tenancy.
 */
const resolveActorId = cache(
  async (accountId: string, organisationId: string): Promise<string | null> => {
    if (!process.env.DATABASE_URL) return null;
    const { createPool } = await import("@legalos/database");
    const pool = await createPool();
    try {
      const found = await pool.query<{ id: string }>(
        `SELECT u.id FROM users u
           JOIN workspaces w ON w.id = u.workspace_id
           JOIN workspace_members m ON m.workspace_id = w.id AND m.account_id = $1
          WHERE w.organization_id = $2 AND m.removed_at IS NULL
          ORDER BY u.created_at ASC, u.id ASC LIMIT 1`,
        [accountId, organisationId]
      );
      return found.rows[0]?.id ?? null;
    } finally {
      await pool.end();
    }
  }
);

/** The client-safe projection. The context itself never crosses to the browser. */
export interface ClientSession {
  readonly organisationId: string;
  readonly organisationName: string;
  readonly role: string;
  readonly switchable: readonly { id: string; name: string }[];
}

export async function clientSession(): Promise<ClientSession | null> {
  const tenant = await resolveTenantContext();
  if (!tenant.ok) return null;
  const { switchableOrganisations } = await import("./server-session");
  return {
    organisationId: tenant.value.organisationId,
    organisationName: tenant.value.organisationName,
    role: tenant.value.role,
    switchable: switchableOrganisations(tenant.value.memberships),
  };
}
