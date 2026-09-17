"use server";

import { cookies, headers } from "next/headers";

import { switchOrganisationCore, type SwitchResult } from "@legalos/auth";
import { PostgresAuditStore, createPool, withTransaction } from "@legalos/database";

import { requestCorrelationId } from "./repository-context";
import {
  ACTIVE_ORG_COOKIE,
  loadMemberships,
  resolveServerSession,
  signSelection,
  verifySelection,
} from "./server-session";

/**
 * The framework adapter for organisation switching.
 *
 * All rules live in `switchOrganisationCore`. This file reads `headers()` and
 * `cookies()`, wires the production implementations, and delivers the cookie
 * the core returns. It contains no authorisation logic of its own — the inline
 * origin comparison and target `.find()` that used to live here were duplicates
 * of `maySwitchFrom` and `maySwitchTo`, which the contracts already cited and
 * this action never called.
 *
 * **Method.** Next.js 16.2.12 dispatches server actions on POST only: every
 * branch of `getServerActionRequestMetadata` in
 * `next/dist/server/lib/server-action-request-meta.js` tests
 * `req.method === 'POST'`, and `headers()` exposes no method to read back. So
 * the adapter states that guarantee to the core, which checks it anyway. No
 * caller-supplied method reaches `maySwitchFrom`.
 */

export type SwitchOutcome =
  | { readonly ok: true; readonly organisationId: string; readonly unchanged: boolean }
  | { readonly ok: false; readonly reason: string };

/** The method the framework guarantees. Stated here, verified in the core. */
const SERVER_ACTION_METHOD = "POST";

export async function switchOrganisation(targetId: string): Promise<SwitchOutcome> {
  const head = await headers();
  const jar = await cookies();

  const result: SwitchResult = await switchOrganisationCore(
    {
      resolveSession: async () => {
        const session = await resolveServerSession();
        return session.ok ? { ok: true, accountId: session.value.accountId } : { ok: false };
      },
      loadMemberships,
      currentSelection: () => verifySelection(jar.get(ACTIVE_ORG_COOKIE)?.value ?? null),
      appendAudit: async (entry) => {
        if (!process.env.DATABASE_URL) throw new Error("no audit store is configured");
        const pool = await createPool();
        try {
          await withTransaction(pool, (tx) => new PostgresAuditStore(tx).append(entry));
        } finally {
          await pool.end();
        }
      },
      serializeSelection: signSelection,
      correlationId: requestCorrelationId,
      now: () => new Date().toISOString(),
    },
    {
      targetOrganisationId: targetId,
      method: SERVER_ACTION_METHOD,
      origin: head.get("origin"),
      host: head.get("host"),
    }
  );

  if (!result.ok) return { ok: false, reason: result.reason };

  // Delivered only because the core returned it, which it does only after the
  // audit entry committed.
  if (result.cookie) {
    jar.set(ACTIVE_ORG_COOKIE, result.cookie.value, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  }

  return { ok: true, organisationId: result.organisationId, unchanged: result.unchanged };
}
