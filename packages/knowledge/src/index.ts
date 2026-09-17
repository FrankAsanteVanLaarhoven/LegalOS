/**
 * @legalos/knowledge — machine-readable legal sources.
 *
 * Law is represented as data with provenance, not as prose baked into prompts.
 * The registry is fail-closed by default: an unverified or unknown source
 * cannot back a user-facing legal conclusion.
 */

export type {
  LegalSource,
  Proposition,
  SourceKind,
  SourceLookupFailure,
  SourceResolution,
  VerificationStatus,
} from "./types.ts";
export { SourceRegistry, type RegistryOptions } from "./registry.ts";
export { UK_SOURCES } from "./sources.uk.ts";

import { SourceRegistry } from "./registry.ts";
import { UK_SOURCES } from "./sources.uk.ts";

/** Strict registry seeded with the UK catalogue. Use this in request paths. */
export function createUkRegistry(strict = true): SourceRegistry {
  return new SourceRegistry(UK_SOURCES, { strict });
}
