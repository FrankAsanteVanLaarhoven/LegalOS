import test from "node:test";
import assert from "node:assert/strict";

import {
  sanitizeOutgoingText,
  formatSafeError,
  verifyTenantIsolation,
  isPayloadClean,
} from "../src/lib/security/data-leakage-guard.ts";
import { SafeMemoryCache } from "../src/lib/cache/safe-cache.ts";

test("data leakage guard redacts UK personal identifiers from text", () => {
  const input =
    "Client John Doe (HO Ref: A1234567, NI: QQ 12 34 56 A, Postcode: SW1A 1AA, Email: john@example.com, Phone: +44 7123 456 789) attended interview.";
  const sanitized = sanitizeOutgoingText(input);

  assert.doesNotMatch(sanitized, /A1234567/);
  assert.doesNotMatch(sanitized, /QQ 12 34 56 A/);
  assert.doesNotMatch(sanitized, /SW1A 1AA/);
  assert.doesNotMatch(sanitized, /john@example\.com/);
  assert.doesNotMatch(sanitized, /\+44 7123 456 789/);
  assert.match(sanitized, /\[redacted: Home Office reference\]/);
  assert.match(sanitized, /\[redacted: National Insurance number\]/);
});

test("data leakage guard scrubs API secrets and connection strings", () => {
  const input =
    "Error with xai-1234567890abcdef123456 and postgres://user:secret123@db.internal:5432/legalos in /Users/favl/repo/src.ts";
  const sanitized = sanitizeOutgoingText(input);

  assert.doesNotMatch(sanitized, /xai-1234567890abcdef123456/);
  assert.doesNotMatch(sanitized, /postgres:\/\//);
  assert.doesNotMatch(sanitized, /\/Users\/favl/);
  assert.match(sanitized, /\[redacted: credential\/internal-path\]/);
});

test("formatSafeError hides internal stack traces from client", () => {
  const rawError = new Error(
    "FATAL: Database connection timeout at /Users/favl/code/db.ts:45 with password 'secretPass'"
  );
  const safe = formatSafeError(rawError);

  assert.equal(
    safe.error,
    "An unexpected error occurred. Please try again or contact support."
  );
  assert.equal(safe.code, "INTERNAL_ERROR");
  assert.match(safe.incidentRef!, /^INC-/);
});

test("verifyTenantIsolation blocks cross-tenant access", () => {
  const allowed = verifyTenantIsolation("account-123", "account-123");
  assert.equal(allowed.allowed, true);

  const blocked = verifyTenantIsolation("account-target", "account-attacker");
  assert.equal(blocked.allowed, false);
  assert.match(blocked.reason!, /Access denied/);
});

test("SafeMemoryCache refuses to store sensitive keys or values with PII", () => {
  const cache = new SafeMemoryCache("test-cache");

  // 1. Refuses sensitive key
  const storedSensitiveKey = cache.set("user-session-123", "public text", 60000);
  assert.equal(storedSensitiveKey, false);
  assert.equal(cache.get("user-session-123"), null);

  // 2. Refuses value containing PII
  const storedPii = cache.set(
    "statute-cache-key",
    "Applicant HO Ref: A9876543 details",
    60000
  );
  assert.equal(storedPii, false);
  assert.equal(cache.get("statute-cache-key"), null);

  // 3. Allows clean, non-sensitive public reference
  const storedClean = cache.set(
    "statute-section-84",
    "Immigration and Asylum Act 1999 Part V Section 84",
    60000
  );
  assert.equal(storedClean, true);
  assert.equal(
    cache.get("statute-section-84"),
    "Immigration and Asylum Act 1999 Part V Section 84"
  );
});
