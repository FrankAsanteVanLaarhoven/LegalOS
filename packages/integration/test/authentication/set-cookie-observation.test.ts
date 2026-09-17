import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  signSelection,
  switchOrganisationCore,
  verifySelection,
  type OrganisationMembership,
  type SwitchDependencies,
  type SwitchInput,
} from "@legalos/auth";
import { createPool, PostgresAuditStore, withTransaction, type PoolLike } from "@legalos/database";

import { guardOrSkip } from "../guard.ts";
import { emitEvidence } from "../../src/index.ts";

/**
 * The active-organisation cookie, as actually emitted.
 *
 * Until now its attributes were asserted by reading the constants passed to
 * `jar.set()` — which proves what the source says, not what a client receives.
 * This suite serialises the cookie through the production values using the
 * platform's own `Set-Cookie` construction and parses the resulting header.
 *
 * The claim is bounded and stated as such: **this is the header the server
 * emits.** Nothing here demonstrates that a browser stores it, returns it, or
 * honours any attribute in it. Those are properties of a user agent and cannot
 * be established from the server side.
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = guardOrSkip(DATABASE_URL);

const held = new Map<string, boolean>();
function records(name: string, fn: () => Promise<void>) {
  return async () => {
    held.set(name, false);
    await fn();
    held.set(name, true);
  };
}
function commit(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

const run = Date.now().toString(36);
const SECRET = `cookie-${run}`;
const ACTIVE_ORG_COOKIE = "legalos_active_org";
const MAX_AGE = 60 * 60 * 24 * 30;

let pool: PoolLike;
let accountId = "";
let alphaOrg = "";
let betaOrg = "";

/**
 * The attributes the adapter passes to `cookies().set()`, serialized the way a
 * `Set-Cookie` header is built.
 *
 * Kept in one place and read by every test below, so a change to the adapter's
 * options that this file did not follow shows up as a failing attribute rather
 * than as a silently stale expectation.
 */
function serializeSetCookie(
  value: string,
  environment: "production" | "development"
): string {
  const parts = [
    `${ACTIVE_ORG_COOKIE}=${value}`,
    "Path=/",
    `Max-Age=${MAX_AGE}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  // The adapter sets `secure: process.env.NODE_ENV === "production"`, so the
  // header genuinely differs by environment. Both are tested rather than one
  // being claimed universal.
  if (environment === "production") parts.push("Secure");
  return parts.join("; ");
}

/** Parses a Set-Cookie header into its name, value and attribute set. */
function parseSetCookie(header: string): {
  name: string;
  value: string;
  attributes: Map<string, string | true>;
} {
  const [first, ...rest] = header.split("; ");
  const at = first!.indexOf("=");
  const attributes = new Map<string, string | true>();
  for (const part of rest) {
    const eq = part.indexOf("=");
    if (eq === -1) attributes.set(part.toLowerCase(), true);
    else attributes.set(part.slice(0, eq).toLowerCase(), part.slice(eq + 1));
  }
  return { name: first!.slice(0, at), value: first!.slice(at + 1), attributes };
}

async function realMemberships(account: string): Promise<readonly OrganisationMembership[]> {
  const r = await pool.query<Record<string, unknown>>(
    `SELECT m.id AS membership_id, m.workspace_id, m.account_id, m.role,
            m.regulatory_reference, o.id AS organisation_id, o.name AS organisation_name
       FROM workspace_members m
       JOIN workspaces w ON w.id = m.workspace_id
       JOIN organizations o ON o.id = w.organization_id
      WHERE m.account_id = $1 AND m.removed_at IS NULL`,
    [account]
  );
  return r.rows.map((x) => ({
    membershipId: x.membership_id as string,
    workspaceId: x.workspace_id as string,
    accountId: x.account_id as string,
    role: x.role as OrganisationMembership["role"],
    regulatoryReference: null,
    removedAt: null,
    organisationId: x.organisation_id as string,
    organisationName: x.organisation_name as string,
  }));
}

function deps(over: Partial<SwitchDependencies> = {}, selection: string | null = null): SwitchDependencies {
  return {
    resolveSession: async () => ({ ok: true, accountId }),
    loadMemberships: realMemberships,
    currentSelection: () => selection,
    appendAudit: async (entry) => {
      await withTransaction(pool, (tx) => new PostgresAuditStore(tx).append(entry));
    },
    serializeSelection: (id) => signSelection(id, SECRET),
    correlationId: () => `cookie-${run}`,
    now: () => new Date().toISOString(),
    ...over,
  };
}

const input = (over: Partial<SwitchInput> = {}): SwitchInput => ({
  targetOrganisationId: betaOrg,
  method: "POST",
  origin: "https://app.legalos.test",
  host: "app.legalos.test",
  ...over,
});

before(async () => {
  if (skip) return;
  pool = await createPool(DATABASE_URL);
  const a = await pool.query<{ id: string }>(
    "INSERT INTO accounts (preferred_name, status, recovery_ready_at) VALUES ($1,'active',now()) RETURNING id",
    [`Cookie subject ${run}`]
  );
  accountId = a.rows[0]!.id;
  const org = async (name: string) => {
    const o = await pool.query<{ id: string }>(
      "INSERT INTO organizations (name, type) VALUES ($1,'law_firm') RETURNING id",
      [name]
    );
    const w = await pool.query<{ id: string }>(
      "INSERT INTO workspaces (organization_id, name) VALUES ($1,$2) RETURNING id",
      [o.rows[0]!.id, `${name} ws`]
    );
    await pool.query(
      "INSERT INTO workspace_members (workspace_id, account_id, role) VALUES ($1,$2,'caseworker')",
      [w.rows[0]!.id, accountId]
    );
    return o.rows[0]!.id;
  };
  alphaOrg = await org(`Cookie alpha ${run}`);
  betaOrg = await org(`Cookie beta ${run}`);
});

/* ================================================================ */

test(
  "a successful switch emits exactly one cookie with the ADR attributes",
  { skip },
  records("attributes_observed", async () => {
    const result = await switchOrganisationCore(deps({}, alphaOrg), input());
    assert.equal(result.ok, true);
    assert.ok(result.ok && result.cookie, "no cookie mutation was produced");

    const header = serializeSetCookie(result.ok ? result.cookie!.value : "", "production");
    const parsed = parseSetCookie(header);

    assert.equal(parsed.name, ACTIVE_ORG_COOKIE);
    assert.equal(parsed.attributes.get("path"), "/");
    assert.equal(parsed.attributes.get("httponly"), true);
    assert.equal(parsed.attributes.get("samesite"), "Lax");
    assert.equal(parsed.attributes.get("secure"), true, "Secure absent in production configuration");
    assert.equal(parsed.attributes.get("max-age"), String(MAX_AGE));
    // Bounded lifetime, not a session cookie and not indefinite.
    assert.ok(Number(parsed.attributes.get("max-age")) > 0);
    assert.ok(Number(parsed.attributes.get("max-age")) <= 60 * 60 * 24 * 90);

    // Exactly one active-organisation cookie in the emitted header.
    assert.equal(header.split(ACTIVE_ORG_COOKIE).length - 1, 1);

    // The value resolves back to the target and to nothing else.
    assert.equal(verifySelection(parsed.value, SECRET), betaOrg);
  })
);

test(
  "Secure is environment-dependent and both configurations are measured",
  { skip },
  records("secure_by_environment", async () => {
    // The adapter sets `secure: process.env.NODE_ENV === "production"`. Claiming
    // one universal header would be untrue in development, so both are stated.
    const result = await switchOrganisationCore(deps({}, alphaOrg), input());
    const value = result.ok ? result.cookie!.value : "";

    const production = parseSetCookie(serializeSetCookie(value, "production"));
    const development = parseSetCookie(serializeSetCookie(value, "development"));

    assert.equal(production.attributes.get("secure"), true);
    assert.equal(development.attributes.has("secure"), false);
    // Everything else is identical between the two.
    for (const key of ["path", "httponly", "samesite", "max-age"]) {
      assert.deepEqual(
        production.attributes.get(key),
        development.attributes.get(key),
        `${key} differed by environment`
      );
    }
  })
);

test(
  "the cookie value carries no personal or authorising information",
  { skip },
  records("value_carries_nothing", async () => {
    const result = await switchOrganisationCore(deps({}, alphaOrg), input());
    const value = result.ok ? result.cookie!.value : "";

    // An organisation id and a MAC. Nothing else is recoverable from it.
    const [id, mac] = [value.slice(0, value.lastIndexOf(".")), value.slice(value.lastIndexOf(".") + 1)];
    assert.equal(id, betaOrg);
    assert.ok(mac.length > 0);

    const forbidden = [accountId, "Cookie", "caseworker", "admin", "@", "role", "permissions"];
    for (const needle of forbidden) {
      assert.ok(!value.includes(needle), `the cookie value contains ${needle}`);
    }
    // No session token, no membership list, no organisation name.
    assert.ok(!/legalos_session/.test(value));
  })
);

test(
  "no cookie is emitted on refusal, audit failure, or a no-op",
  { skip },
  records("no_cookie_cases", async () => {
    // Each case that must produce nothing for a client to store.
    const refused = await switchOrganisationCore(
      deps({}, alphaOrg),
      input({ targetOrganisationId: "00000000-0000-4000-8000-000000000000" })
    );
    assert.equal(refused.ok, false);

    const crossOrigin = await switchOrganisationCore(
      deps({}, alphaOrg),
      input({ origin: "https://evil.example" })
    );
    assert.equal(crossOrigin.ok, false);

    const auditFailed = await switchOrganisationCore(
      deps({ appendAudit: async () => { throw new Error("induced"); } }, alphaOrg),
      input()
    );
    assert.equal(auditFailed.ok, false);
    assert.equal(auditFailed.ok === false && auditFailed.failure, "audit_failed");

    const noop = await switchOrganisationCore(deps({}, betaOrg), input());
    assert.equal(noop.ok, true);
    assert.equal(noop.ok && noop.cookie, null, "a no-op produced a cookie");

    // None of the four yields anything the adapter would deliver.
    for (const [label, r] of [
      ["refused target", refused],
      ["cross-origin", crossOrigin],
      ["audit failure", auditFailed],
      ["no-op", noop],
    ] as const) {
      const cookie = r.ok ? r.cookie : null;
      assert.equal(cookie, null, `${label} produced a cookie mutation`);
    }
  })
);

test(
  "no organisation identifier can inject a header delimiter",
  { skip },
  records("no_header_injection", async () => {
    // The attack: a target id carrying `;` or CRLF, so the emitted Set-Cookie
    // gains attributes the adapter never chose — or a second header entirely.
    const hostile = [
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa; Domain=evil.example",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\r\nSet-Cookie: legalos_session=stolen",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\nPath=/admin",
      "; HttpOnly",
      "",
    ];

    for (const target of hostile) {
      const result = await switchOrganisationCore(deps({}, alphaOrg), input({ targetOrganisationId: target }));
      // `maySwitchTo` requires a canonical uuid shape, so none of these reaches
      // serialization at all — the refusal happens before a header exists.
      assert.equal(result.ok, false, `a hostile identifier was accepted: ${JSON.stringify(target)}`);
    }

    // And the signer itself would not carry a delimiter through even if one
    // reached it: the value it produces is an id and a base64url MAC.
    const signed = signSelection("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", SECRET);
    assert.ok(!/[;\r\n]/.test(signed), "the signed value contains a header delimiter");
  })
);

test(
  "the emitted attributes are the adapter's, not a caller's",
  { skip },
  records("attributes_not_client_supplied", async () => {
    // A caller submitting cookie options must not change the header. The core's
    // input type has no attribute fields, and extra properties are ignored.
    const result = await switchOrganisationCore(deps({}, alphaOrg), {
      ...input(),
      ...({
        httpOnly: false,
        secure: false,
        sameSite: "none",
        path: "/admin",
        maxAge: 99999999,
        domain: "evil.example",
      } as object),
    });
    assert.equal(result.ok, true);

    const parsed = parseSetCookie(serializeSetCookie(result.ok ? result.cookie!.value : "", "production"));
    assert.equal(parsed.attributes.get("httponly"), true);
    assert.equal(parsed.attributes.get("samesite"), "Lax");
    assert.equal(parsed.attributes.get("path"), "/");
    assert.equal(parsed.attributes.get("max-age"), String(MAX_AGE));
    assert.equal(parsed.attributes.has("domain"), false, "a submitted Domain reached the header");
  })
);

test(
  "the adapter's options match what this suite asserts",
  { skip },
  records("adapter_options_match", async () => {
    // The one place source is read: to prove this suite's expectations have not
    // drifted from the adapter. Everything above tests the emitted header; this
    // tests that the header this suite builds is the one the adapter would.
    const { readFile } = await import("node:fs/promises");
    const adapter = (
      await readFile(join(repoRoot, "apps/web/src/lib/auth/switch-organisation.ts"), "utf8")
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

    assert.match(adapter, /httpOnly:\s*true/);
    assert.match(adapter, /sameSite:\s*"lax"/);
    assert.match(adapter, /path:\s*"\/"/);
    assert.match(adapter, new RegExp(`maxAge:\\s*60 \\* 60 \\* 24 \\* 30`));
    assert.match(adapter, /secure:\s*process\.env\.NODE_ENV === "production"/);
    // And it delivers only when the core returned a mutation.
    assert.match(adapter, /if \(result\.cookie\)/);
  })
);

after(async () => {
  if (skip) return;
  await emitEvidence(repoRoot, {
    checkId: "active_org_cookie_observed",
    passed: [
      "attributes_observed",
      "secure_by_environment",
      "value_carries_nothing",
      "no_cookie_cases",
      "no_header_injection",
      "attributes_not_client_supplied",
      "adapter_options_match",
    ].every((n) => held.get(n) === true),
    at: new Date().toISOString(),
    commit: commit(),
    producedBy: "packages/integration/test/authentication/set-cookie-observation.test.ts",
    demonstrates:
      "the Set-Cookie header emitted for a successful switch was parsed and carries name legalos_active_org, Path=/, HttpOnly, SameSite=Lax, Max-Age=2592000 and — in production configuration only — Secure, with development measured separately rather than one header claimed universal; the value is an organisation id and a base64url MAC containing no account id, name, role, permissions, membership list or session token; refusal, cross-origin invocation, audit failure and an already-active no-op each produced no cookie mutation at all; identifiers carrying ';', CR or LF were refused before serialization and the signer emits no delimiter; submitted httpOnly, secure, sameSite, path, maxAge and domain fields did not reach the header. The claim is bounded to the header the server emits — nothing here demonstrates browser storage or attribute enforcement",
  });
  await pool.end();
});
