/**
 * The deployment profile.
 *
 * ADR-001 records an intended deployment shape. Left as prose it drifts — the
 * deployment ends up on a colocated database, or an unencrypted connection, and
 * the document goes on describing a system that stopped existing. This declares
 * the assumptions so the readiness checks can verify them against the live
 * environment.
 *
 * `unverifiable` is the important field. Three of the ADR's assumptions cannot
 * be established from inside the application, and they are recorded as
 * unverifiable rather than given a check that would pass without asking
 * anything. A green tick against "backups enabled" that only confirmed a config
 * flag would be read as "backups work", and the first time anyone needed that to
 * be true would be the worst moment to discover the difference.
 */

export interface DeploymentProfile {
  /** The ADR this profile implements, so the two cannot drift apart silently. */
  readonly adr: string;
  readonly target: "vps" | "managed_containers" | "kubernetes" | "hybrid";
  /** Expected region, for human comparison. Not machine-checkable from here. */
  readonly expectedRegion: string;
  readonly requiresEncryptedDatabase: boolean;
  /** Whether the database is expected to be separate from the app host. */
  readonly requiresManagedDatabase: boolean;
  readonly healthEndpoint: string;
  /**
   * Assumptions this profile makes that the application cannot check, each with
   * the reason and how it is verified instead.
   */
  readonly unverifiable: readonly { readonly assumption: string; readonly verifiedBy: string }[];
}

export const DEPLOYMENT_PROFILE: DeploymentProfile = {
  adr: "ADR-001",
  // Recommended rather than decided. The profile records the recommendation so
  // that when a target is chosen, the checks either confirm it or say plainly
  // that the deployment is not the one the ADR describes.
  target: "managed_containers",
  expectedRegion: "UK or EEA, pinned",
  requiresEncryptedDatabase: true,
  requiresManagedDatabase: true,
  healthEndpoint: "/api/health",
  unverifiable: [
    {
      assumption: "The database physically resides in the expected region",
      verifiedBy: "procurement and the provider console; the application cannot establish this",
    },
    {
      assumption: "Managed backups are enabled and restorable",
      verifiedBy: "a restore exercise; a config flag is not evidence that a restore works",
    },
    {
      assumption: "Deployments replace instances rather than mutating them",
      verifiedBy: "the platform's deployment model; not observable from within an instance",
    },
  ],
};
