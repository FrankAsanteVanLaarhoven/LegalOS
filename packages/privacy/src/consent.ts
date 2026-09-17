/**
 * Consent, recorded as events rather than as current state.
 *
 * A boolean "camera: allowed" answers what is true now and nothing about how it
 * came to be true. For a platform holding trafficking and asylum material, the
 * questions that matter are historical: when was this granted, what was it
 * scoped to, when was it withdrawn, and was anything accessed after withdrawal.
 * Only an append-only log answers those.
 *
 * Withdrawal is therefore a new event, never a mutation, and the log is the
 * evidence a user can point at.
 */

export type Permission =
  | "camera"
  | "microphone"
  | "voice_recording"
  | "email_sync"
  | "cloud_storage"
  | "messaging_import"
  | "calendar"
  | "share_with_professional"
  | "ai_memory";

export type ConsentEventKind = "granted" | "withdrawn" | "expired";

export interface ConsentEvent {
  readonly permission: Permission;
  readonly kind: ConsentEventKind;
  /** ISO-8601, supplied by the caller. */
  readonly at: string;
  /** Exactly what was permitted, in the user's terms. */
  readonly scope: string;
  /** Who the permission was granted to, for sharing permissions. */
  readonly grantedTo: string | null;
  /** When the grant lapses on its own, if it does. */
  readonly expiresAt: string | null;
}

export class ConsentLedger {
  readonly #events: ConsentEvent[] = [];

  record(event: ConsentEvent): void {
    if (event.kind === "granted" && event.scope.trim() === "") {
      // "Granted access" with no stated scope is not consent, it is a checkbox.
      throw new Error(`consent for ${event.permission} was granted with no stated scope`);
    }
    this.#events.push(event);
  }

  events(): readonly ConsentEvent[] {
    return [...this.#events];
  }

  /**
   * Whether a permission is active at a given moment.
   *
   * Fails closed: no record means not granted, and an expiry in the past means
   * not granted, without anyone having to run a sweep.
   */
  isActive(permission: Permission, at: string): boolean {
    const moment = Date.parse(at);
    let active = false;

    for (const event of this.#events) {
      if (event.permission !== permission) continue;
      if (Date.parse(event.at) > moment) continue;

      if (event.kind === "granted") {
        active = !(event.expiresAt !== null && Date.parse(event.expiresAt) <= moment);
      } else {
        active = false;
      }
    }

    return active;
  }

  /** Everything currently active, for a privacy centre to display. */
  activePermissions(at: string): readonly Permission[] {
    const permissions = new Set(this.#events.map((e) => e.permission));
    return [...permissions].filter((permission) => this.isActive(permission, at));
  }

  /** The full history for one permission, newest last. */
  history(permission: Permission): readonly ConsentEvent[] {
    return this.#events.filter((event) => event.permission === permission);
  }
}

/**
 * Checks whether an access was permitted when it happened.
 *
 * The point of retaining the consent log through erasure: this question can be
 * answered after the fact, including by the user, and including about accesses
 * that should not have occurred.
 */
export function accessWasPermitted(
  ledger: ConsentLedger,
  access: { permission: Permission; at: string }
): boolean {
  return ledger.isActive(access.permission, access.at);
}
