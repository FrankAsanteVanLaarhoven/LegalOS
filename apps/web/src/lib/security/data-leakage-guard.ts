import { redact, inspectConfidentiality } from "@legalos/fiduciary";

/**
 * Data Leakage Guard & PII Sanitization.
 *
 * Implements Invariant INV-001 (Tenant Isolation) & INV-006 (Secrets Never Exposed).
 *
 * Provides fail-closed boundaries that sanitize:
 * 1. Error messages and unhandled exceptions (scrubbing stack traces, credentials, internal file paths).
 * 2. Case content and chat responses before client transmission or public caching.
 * 3. Tenant isolation checks ensuring that no actor can read or mutate another actor's legal file.
 */

const SECRET_PATTERNS = [
  /xai-[a-zA-Z0-9_-]{20,}/g,
  /sk-[a-zA-Z0-9_-]{20,}/g,
  /Bearer\s+[A-Za-z0-9_.-]{20,}/gi,
  /postgres(?:ql)?:\/\/[^\s"']+/gi,
  /(?:password|secret|key|token)["':\s]+["']?([A-Za-z0-9_.-]{8,})["']?/gi,
  /\/(?:Users|home|var|tmp|etc)\/[^\s"']+/gi,
];

// Additional pattern guards that improve on strict word boundaries
const PHONE_PATTERN = /(?:^|\s)(?:\+44\s?7\d{3}|\(?07\d{3}\)?)\s?\d{3}\s?\d{3}\b/g;

/**
 * Sanitizes any raw string by replacing detected PII identifiers and secret patterns.
 */
export function sanitizeOutgoingText(text: string): string {
  if (!text) return "";

  // 1. Redact direct UK identifiers using the fiduciary detector
  let sanitized = redact(text);

  // 2. Extra phone safeguard (handling leading +)
  PHONE_PATTERN.lastIndex = 0;
  sanitized = sanitized.replace(PHONE_PATTERN, (match) => {
    const prefix = match.startsWith(" ") ? " " : "";
    return `${prefix}[redacted: UK phone number]`;
  });

  // 3. Scrub secrets, connection strings, and system paths
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    sanitized = sanitized.replace(pattern, "[redacted: credential/internal-path]");
  }

  return sanitized;
}

export interface SafeErrorPayload {
  readonly error: string;
  readonly code: string;
  readonly incidentRef?: string;
}

/**
 * Transforms an arbitrary error into a sanitized JSON response safe for client consumption.
 * Ensures stack traces and environment secrets are never returned in production responses.
 */
export function formatSafeError(
  error: unknown,
  fallbackMessage = "An unexpected error occurred. Please try again or contact support.",
  code = "INTERNAL_ERROR"
): SafeErrorPayload {
  const incidentRef = `INC-${Date.now().toString(36).toUpperCase()}`;

  if (error instanceof Error) {
    // Log complete internal error securely on the server console
    console.error(`[SecurityIncident:${incidentRef}]`, error.message, error.stack);

    // Filter message for known safe client errors vs raw database/runtime errors
    const isClientSafe =
      error.message.includes("Sign in to continue") ||
      error.message.includes("limit") ||
      error.message.includes("required") ||
      error.message.includes("Invalid request");

    const message = isClientSafe ? sanitizeOutgoingText(error.message) : fallbackMessage;

    return {
      error: message,
      code,
      incidentRef,
    };
  }

  console.error(`[SecurityIncident:${incidentRef}] Unknown non-Error thrown:`, error);
  return {
    error: fallbackMessage,
    code,
    incidentRef,
  };
}

/**
 * Enforces Tenant and Case Isolation (Anti-IDOR).
 *
 * Verifies that the requested resource subject belongs to or is authorized for the
 * authenticated account.
 */
export function verifyTenantIsolation(
  resourceOwnerId: string | null | undefined,
  authenticatedAccountId: string
): { readonly allowed: boolean; readonly reason?: string } {
  if (!resourceOwnerId) {
    // Scaffold or unassigned public case files
    return { allowed: true };
  }

  if (resourceOwnerId !== authenticatedAccountId) {
    console.warn(
      `[TenantIsolationBreach] Account ${authenticatedAccountId} attempted to access resource owned by ${resourceOwnerId}`
    );
    return {
      allowed: false,
      reason: "Access denied. You do not have permission to view this legal matter.",
    };
  }

  return { allowed: true };
}

/**
 * Inspects a payload to verify it contains no unredacted direct identifiers.
 */
export function isPayloadClean(text: string): boolean {
  const check = inspectConfidentiality(text);
  return check.safeToSendExternally;
}
