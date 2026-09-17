import { test } from "node:test";
import assert from "node:assert/strict";

import {
  addRecord,
  assessRecovery,
  isPermitted,
  variantGroups,
  variantsOf,
  type CaseIdentity,
  type IdentityRecord,
  type PlatformIdentity,
} from "../src/index.ts";

/* ---------------- platform identity asks for the minimum ---------------- */

test("an account can be opened without a legal name", () => {
  const identity: PlatformIdentity = {
    userId: "u1",
    preferredName: "S",
    contact: { channel: "email", value: "s@example.invalid" },
    contactVerified: true,
  };
  assert.equal(identity.preferredName, "S");
  assert.equal(Object.hasOwn(identity, "legalName"), false);
});

test("either email or phone is enough", () => {
  for (const channel of ["email", "phone"] as const) {
    const identity: PlatformIdentity = {
      userId: "u1",
      preferredName: "S",
      contact: { channel, value: "x" },
      contactVerified: false,
    };
    assert.equal(identity.contact.channel, channel);
  }
});

/* ---------------- recovery must not hang on one number ---------------- */

test("a single factor is inadequate", () => {
  const result = assessRecovery([
    { factor: "sms_code", enrolledAt: "2026-07-26", boundTo: "+447700900000" },
  ]);
  assert.equal(result.adequate, false);
  assert.ok(result.problems.includes("SINGLE_FACTOR"));
});

test("factors all bound to the same number are flagged", () => {
  const result = assessRecovery([
    { factor: "sms_code", enrolledAt: "2026-07-26", boundTo: "+447700900000" },
    { factor: "whatsapp_code", enrolledAt: "2026-07-26", boundTo: "+447700900000" },
  ]);
  assert.equal(result.adequate, false);
  assert.ok(result.problems.includes("RECOVERY_DEPENDS_ON_ONE_NUMBER"));
  assert.ok(result.advice.some((a) => /nobody can restore this account/.test(a)));
});

test("an offline route makes recovery adequate", () => {
  const result = assessRecovery([
    { factor: "passkey", enrolledAt: "2026-07-26", boundTo: null },
    { factor: "recovery_codes", enrolledAt: "2026-07-26", boundTo: null },
  ]);
  assert.equal(result.adequate, true);
  assert.deepEqual(result.problems, []);
});

test("message-only factors leave no offline route", () => {
  const result = assessRecovery([
    { factor: "sms_code", enrolledAt: "2026-07-26", boundTo: "+447700900000" },
    { factor: "email_code", enrolledAt: "2026-07-26", boundTo: "s@example.invalid" },
  ]);
  assert.ok(result.problems.includes("NO_OFFLINE_RECOVERY"));
});

/* ---------------- case identity is plural ---------------- */

const record = (over: Partial<IdentityRecord>): IdentityRecord => ({
  id: "r1",
  field: "name",
  value: "Sabinah Mamood",
  source: "passport",
  evidenceId: "doc-passport",
  validFrom: null,
  validTo: null,
  explanation: null,
  ...over,
});

const identity: CaseIdentity = {
  caseId: "c1",
  records: [
    record({ id: "r1", value: "Sabinah Mamood", source: "passport" }),
    record({ id: "r2", value: "Sabina Mahmood", source: "birth_certificate" }),
    record({ id: "r3", field: "date_of_birth", value: "1998-05-14", source: "passport" }),
    record({
      id: "r4",
      field: "date_of_birth",
      value: "1999-05-14",
      source: "birth_certificate",
      explanation: "The registration was made a year after I was born.",
    }),
  ],
};

test("differing spellings are both kept, in the order first seen", () => {
  assert.deepEqual(variantsOf(identity, "name"), ["Sabinah Mamood", "Sabina Mahmood"]);
});

test("nothing is marked canonical or correct", () => {
  for (const r of identity.records) {
    assert.equal(Object.hasOwn(r, "canonical"), false);
    assert.equal(Object.hasOwn(r, "confidence"), false);
    assert.equal(Object.hasOwn(r, "correct"), false);
  }
});

test("variant groups report the sources, not an error", () => {
  const groups = variantGroups(identity);
  assert.equal(groups.length, 2);
  const dob = groups.find((g) => g.field === "date_of_birth");
  assert.equal(dob?.values.length, 2);
  assert.equal(dob?.explained, true, "one record carries the person's explanation");
  const name = groups.find((g) => g.field === "name");
  assert.equal(name?.explained, false);
});

test("a field with one value is not a variant group", () => {
  const single: CaseIdentity = { caseId: "c1", records: [record({ id: "r1" })] };
  assert.deepEqual(variantGroups(single), []);
});

test("adding a record never overwrites or deduplicates", () => {
  const next = addRecord(identity, record({ id: "r5", value: "Sabinah Mamood" }));
  assert.equal(next.records.length, 5);
  assert.equal(next.records.filter((r) => r.value === "Sabinah Mamood").length, 2);
  assert.throws(() => addRecord(next, record({ id: "r5" })), /duplicate identity record id/);
});

/* ---------------- assurance rises only when needed ---------------- */

test("reading legal information needs no account", () => {
  assert.equal(isPermitted("read_public_legal_information", "visitor"), true);
  assert.equal(isPermitted("ask_general_question", "visitor"), true);
});

test("identity documents are not required to use the platform", () => {
  assert.equal(isPermitted("upload_evidence", "verified_account"), true);
  assert.equal(isPermitted("open_case", "verified_account"), true);
});

test("actions affecting other people need more", () => {
  assert.equal(isPermitted("invite_team_member", "verified_account"), false);
  assert.equal(isPermitted("invite_team_member", "multi_factor"), true);
  assert.equal(isPermitted("transfer_case_to_professional", "multi_factor"), false);
});

test("an unknown action is refused at every level", () => {
  assert.equal(isPermitted("delete_everything", "organisation_verified"), false);
});
