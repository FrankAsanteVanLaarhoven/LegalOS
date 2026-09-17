import { test } from "node:test";
import assert from "node:assert/strict";

import {
  activate,
  canRemoveFactor,
  checkSession,
  hashToken,
  issueToken,
  mayAuthoriseReserved,
  membershipFor,
  revokeSession,
  rotateSession,
  tokenMatches,
  type Account,
  type Membership,
  type Session,
} from "../src/index.ts";

const ACCOUNT: Account = {
  id: "a1",
  preferredName: "S",
  status: "pending_recovery",
  recoveryReadyAt: null,
};

const PASSKEY = { factor: "passkey", enrolledAt: "2026-07-26", boundTo: null } as const;
const CODES = { factor: "recovery_codes", enrolledAt: "2026-07-26", boundTo: null } as const;
const SMS = { factor: "sms_code", enrolledAt: "2026-07-26", boundTo: "+447700900000" } as const;
const WHATSAPP = {
  factor: "whatsapp_code",
  enrolledAt: "2026-07-26",
  boundTo: "+447700900000",
} as const;

const AT = "2026-07-26T10:00:00.000Z";

/* ---------------- recovery gates activation ---------------- */

test("an account with one factor cannot be activated", () => {
  const result = activate({ account: ACCOUNT, contactVerified: true, factors: [PASSKEY], at: AT });
  assert.equal(result.ok, false);
  assert.equal(result.failure, "RECOVERY_INADEQUATE");
  assert.equal(result.account.status, "pending_recovery");
  assert.ok(result.advice.length > 0);
});

test("factors all bound to one number cannot be activated", () => {
  const result = activate({
    account: ACCOUNT,
    contactVerified: true,
    factors: [SMS, WHATSAPP],
    at: AT,
  });
  assert.equal(result.ok, false);
  assert.equal(result.failure, "RECOVERY_INADEQUATE");
  assert.ok(result.advice.some((a) => /nobody can restore this account/.test(a)));
});

test("an offline route activates the account", () => {
  const result = activate({
    account: ACCOUNT,
    contactVerified: true,
    factors: [PASSKEY, CODES],
    at: AT,
  });
  assert.equal(result.ok, true);
  assert.equal(result.account.status, "active");
  assert.equal(result.account.recoveryReadyAt, AT);
});

test("an unverified contact blocks activation before recovery is considered", () => {
  const result = activate({
    account: ACCOUNT,
    contactVerified: false,
    factors: [PASSKEY, CODES],
    at: AT,
  });
  assert.equal(result.failure, "CONTACT_UNVERIFIED");
});

test("a closed account is never reactivated", () => {
  const result = activate({
    account: { ...ACCOUNT, status: "closed" },
    contactVerified: true,
    factors: [PASSKEY, CODES],
    at: AT,
  });
  assert.equal(result.failure, "ACCOUNT_CLOSED");
});

test("removing a factor that would strand the account is refused", () => {
  const check = canRemoveFactor([PASSKEY, CODES], "recovery_codes");
  assert.equal(check.permitted, false);
  assert.ok((check.because ?? "").length > 10);
});

test("removing a redundant factor is permitted", () => {
  const check = canRemoveFactor([PASSKEY, CODES, SMS], "sms_code");
  assert.equal(check.permitted, true);
});

test("removing a factor that is not enrolled is a no-op", () => {
  assert.equal(canRemoveFactor([PASSKEY, CODES], "whatsapp_code").permitted, true);
});

/* ---------------- sessions ---------------- */

function session(over: Partial<Session> = {}): Session {
  const token = "seed-token";
  return {
    id: "s1",
    accountId: "a1",
    tokenHash: hashToken(token),
    previousHash: null,
    deviceLabel: "iPhone",
    createdAt: AT,
    lastSeenAt: AT,
    expiresAt: "2026-07-26T22:00:00.000Z",
    revokedAt: null,
    revokedReason: null,
    ...over,
  };
}

test("only the hash is stored, never the token", () => {
  const token = issueToken();
  const hash = hashToken(token);
  assert.notEqual(hash, token);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(tokenMatches(token, hash), true);
  assert.equal(tokenMatches("wrong", hash), false);
});

test("a valid token passes", () => {
  assert.equal(checkSession(session(), "seed-token", AT).valid, true);
});

test("an absent session is unknown, not permitted", () => {
  const check = checkSession(null, "anything", AT);
  assert.equal(check.valid, false);
  assert.equal(check.rejection, "UNKNOWN");
});

test("an expired session is rejected", () => {
  const check = checkSession(session(), "seed-token", "2026-07-27T00:00:00.000Z");
  assert.equal(check.rejection, "EXPIRED");
});

test("a revoked session is rejected even before expiry", () => {
  const check = checkSession(session({ revokedAt: AT }), "seed-token", AT);
  assert.equal(check.rejection, "REVOKED");
});

test("rotation issues a new token and remembers the old hash", () => {
  const original = session();
  const { session: rotated, token } = rotateSession(original, AT);
  assert.notEqual(rotated.tokenHash, original.tokenHash);
  assert.equal(rotated.previousHash, original.tokenHash);
  assert.equal(checkSession(rotated, token, AT).valid, true);
});

test("presenting a rotated-out token is reported as replay, not merely invalid", () => {
  const { session: rotated } = rotateSession(session(), AT);
  const check = checkSession(rotated, "seed-token", AT);
  assert.equal(check.valid, false);
  assert.equal(check.rejection, "REPLAYED");
  assert.equal(check.suspectedReplay, true);
});

test("revocation records why, for device management", () => {
  const revoked = revokeSession(session(), AT, "signed out from another device");
  assert.equal(revoked.revokedAt, AT);
  assert.match(revoked.revokedReason ?? "", /another device/);
});

/* ---------------- membership ---------------- */

const MEMBERSHIPS: Membership[] = [
  {
    workspaceId: "ws-1",
    accountId: "a1",
    role: "solicitor",
    regulatoryReference: "SRA-123456",
    removedAt: null,
  },
  {
    workspaceId: "ws-2",
    accountId: "a1",
    role: "client",
    regulatoryReference: null,
    removedAt: null,
  },
  {
    workspaceId: "ws-3",
    accountId: "a1",
    role: "admin",
    regulatoryReference: null,
    removedAt: "2026-07-01",
  },
];

test("permissions do not carry between workspaces", () => {
  assert.equal(membershipFor(MEMBERSHIPS, "a1", "ws-1")?.role, "solicitor");
  assert.equal(membershipFor(MEMBERSHIPS, "a1", "ws-2")?.role, "client");
});

test("a removed membership grants nothing", () => {
  assert.equal(membershipFor(MEMBERSHIPS, "a1", "ws-3"), null);
});

test("a non-member gets null rather than a default role", () => {
  assert.equal(membershipFor(MEMBERSHIPS, "a2", "ws-1"), null);
  assert.equal(membershipFor(MEMBERSHIPS, "a1", "ws-9"), null);
});

test("only a solicitor with a regulatory reference may authorise reserved work", () => {
  assert.equal(mayAuthoriseReserved(membershipFor(MEMBERSHIPS, "a1", "ws-1")), true);
  assert.equal(mayAuthoriseReserved(membershipFor(MEMBERSHIPS, "a1", "ws-2")), false);
  assert.equal(mayAuthoriseReserved(null), false);
  assert.equal(mayAuthoriseReserved({ ...MEMBERSHIPS[0]!, regulatoryReference: "  " }), false);
});
