/**
 * Development smoke.
 *
 * Starts the real Next.js development server, drives real HTTP requests through
 * it, and shuts it down. Its purpose is the one thing no unit or integration
 * test in this repository can do: observe behaviour on the `apps/web` side of
 * the dependency boundary.
 *
 * Obligation 3 recorded a limitation — nothing under `packages/` may import
 * `apps/web`, so `requireSession` and `resolveServerSession` were covered by a
 * structural guard reading source text rather than by behavioural vectors. This
 * attacks that limitation. It does not erase it: a smoke observes one
 * configuration once, while the guard holds on every commit.
 *
 * Contract: docs/DEVELOPMENT_SMOKE.md
 * Evidence: docs/smoke-evidence/development-smoke.json
 * Gate:     pnpm check:smoke
 *
 * Exit codes: 0 every mandatory case passed and cleanup succeeded.
 *             1 a mandatory case failed, or cleanup failed.
 *             2 preflight refused to start (nothing was launched).
 */

import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/* ---------------------------------------------------------------- */
/* Bounds. Every wait in this file is finite.                        */
/* ---------------------------------------------------------------- */

const STARTUP_TIMEOUT_MS = 120_000;
const READINESS_INTERVAL_MS = 250;
const REQUEST_TIMEOUT_MS = 15_000;
const SIGKILL_GRACE_MS = 5_000;

const RUN = randomUUID().slice(0, 8);
const SMOKE_TAG = `smoke-${RUN}`;
const PID_FILE = join(repoRoot, ".smoke-dev.pid");
const SMOKE_DIST_DIR = ".next-smoke";
const EVIDENCE_DIR = join(repoRoot, "docs", "smoke-evidence");
const EVIDENCE_FILE = join(EVIDENCE_DIR, "development-smoke.json");

/** Injected failures, for the falsification records. Never set in normal runs. */
const INJECT = process.env.SMOKE_INJECT ?? "";

/* ---------------------------------------------------------------- */
/* Case recording                                                    */
/* ---------------------------------------------------------------- */

const cases = [];
let serverLog = [];

/**
 * Records one observation.
 *
 * `mandatory` cases decide the exit code. A non-mandatory case is still
 * recorded — the delivery-provider observation is real evidence even though its
 * absence is the expected state rather than a failure.
 */
function record(name, passed, detail, mandatory = true) {
  cases.push({ name, passed, mandatory, detail });
  const mark = passed ? "ok  " : mandatory ? "FAIL" : "note";
  process.stdout.write(`  ${mark}  ${name}${passed ? "" : ` — ${detail}`}\n`);
  return passed;
}

/** Never let a token or a full cookie reach a log or the evidence file. */
const redact = (value) =>
  value === null || value === undefined
    ? null
    : `sha256:${createHash("sha256").update(String(value)).digest("hex").slice(0, 16)}`;

const digest = (value) =>
  value === null || value === undefined
    ? null
    : createHash("sha256").update(String(value)).digest("hex").slice(0, 16);

/* ---------------------------------------------------------------- */
/* Preflight                                                         */
/* ---------------------------------------------------------------- */

class PreflightError extends Error {}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function preflight() {
  const checks = [];
  const ok = (name, detail = "") => checks.push({ name, passed: true, detail });

  // Runtime.
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 22) {
    throw new PreflightError(`Node 22+ is required for native TypeScript; found ${process.versions.node}`);
  }
  ok("runtime", `node ${process.versions.node}`);

  // Dependencies.
  if (!existsSync(join(repoRoot, "node_modules"))) {
    throw new PreflightError("node_modules is absent — run `pnpm install` first");
  }
  if (!existsSync(join(repoRoot, "apps/web/node_modules"))) {
    throw new PreflightError("apps/web/node_modules is absent — run `pnpm install` first");
  }
  ok("dependencies");

  // Database identity, decided by the canonical guard rather than a local rule.
  //
  // The smoke writes accounts, organisations, memberships and sessions and then
  // deletes them. Pointing that at a development database somebody is using, or
  // at anything deployed, is the failure this refuses to allow. `TEST_DATABASE_URL`
  // is reused deliberately: it already names a database whose name ends in the
  // required suffix, and adding a second variable would add a second thing to
  // get wrong.
  const databaseUrl = process.env.SMOKE_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
  const { assertTestDatabase } = await import("../packages/database/src/index.ts");
  if (INJECT === "unsafe-database") {
    // Falsification: point the smoke at a database the guard must refuse.
    assertTestDatabase("postgres://legalos:legalos@localhost:5433/legalos_production");
  }
  assertTestDatabase(databaseUrl);
  ok("database identity", redactUrl(databaseUrl));

  // Reachability and schema.
  const { createPool } = await import("../packages/database/src/index.ts");
  let pool;
  try {
    pool = await createPool(databaseUrl);
  } catch (error) {
    throw new PreflightError(`the smoke database is not reachable: ${error.message}`);
  }
  try {
    const tables = await pool.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('accounts','sessions','workspaces','workspace_members','organizations','audit_log')`
    );
    const found = tables.rows.map((r) => r.table_name).sort();
    const required = ["accounts", "audit_log", "organizations", "sessions", "workspace_members", "workspaces"];
    const missing = required.filter((t) => !found.includes(t));
    if (missing.length) {
      throw new PreflightError(
        `schema incomplete, missing ${missing.join(", ")} — run \`pnpm test:db:setup\` first`
      );
    }
    ok("schema", `${found.length} required tables present`);
  } finally {
    await pool.end();
  }

  // No production credential is required, and none is used. The smoke sets its
  // own SESSION_SIGNING_KEY so it never depends on a deployed secret, and never
  // reads one that happens to be in the environment.
  ok("no production credential required");

  // A stale runner would leave a server holding the port and a PID file nobody
  // owns. Refuse rather than adopt it.
  if (existsSync(PID_FILE)) {
    const stale = (await readFile(PID_FILE, "utf8")).trim();
    throw new PreflightError(
      `a previous smoke left ${PID_FILE} (pid ${stale}). Confirm the process is gone and delete the file.`
    );
  }
  ok("no stale smoke server");

  // An ephemeral port, so a developer's own `pnpm dev` on 3011 is untouched and
  // two smokes can run at once.
  const port = INJECT === "port-taken" ? 1 : await freePort();
  ok("port", String(port));

  return { databaseUrl, port, checks };
}

const redactUrl = (url) => {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}:${u.port}/${u.pathname.replace(/^\//, "")}`;
  } catch {
    return "unparseable";
  }
};

/* ---------------------------------------------------------------- */
/* Seeding — option B, through canonical persistence                 */
/* ---------------------------------------------------------------- */

/**
 * Why the existing dev-session route is not used to authenticate.
 *
 * `/api/auth/dev-session` is a real development-only facility and it is smoked
 * as one. But it creates its account at `pending_recovery`, and the schema
 * constraint `active_accounts_can_be_recovered` forbids promoting an account to
 * `active` without a recovery factor. A non-active account cannot resolve a
 * tenancy, and it has no membership to resolve one into. So it can prove that a
 * session is issued and accepted, and it cannot prove anything about tenancy,
 * organisation switching, or the two entry points agreeing on an organisation.
 *
 * Rather than weaken that route or that constraint, the smoke seeds its own
 * state through the same canonical functions the application uses, and then
 * makes the application consume it over real HTTP.
 */
async function seed(databaseUrl, signingKey) {
  const { createPool } = await import("../packages/database/src/index.ts");
  const { hashToken, issueToken, SESSION_TTL_MS, signSelection } = await import("../packages/auth/src/index.ts");
  const pool = await createPool(databaseUrl);

  const org = async (name) => {
    const o = await pool.query(
      "INSERT INTO organizations (name, type) VALUES ($1,'law_firm') RETURNING id",
      [name]
    );
    const w = await pool.query(
      "INSERT INTO workspaces (organization_id, name) VALUES ($1,$2) RETURNING id",
      [o.rows[0].id, `${name} workspace`]
    );
    return { organisationId: o.rows[0].id, workspaceId: w.rows[0].id };
  };

  // An account that can actually act: active, with a recovery factor, because
  // the schema requires one for active status.
  const account = await pool.query(
    `INSERT INTO accounts (preferred_name, status, recovery_ready_at)
     VALUES ($1, 'active', now()) RETURNING id`,
    [`${SMOKE_TAG} subject`]
  );
  const accountId = account.rows[0].id;

  const alpha = await org(`${SMOKE_TAG} alpha`);
  const beta = await org(`${SMOKE_TAG} beta`);
  const gamma = await org(`${SMOKE_TAG} gamma`); // exists, never joined

  const member = async (workspaceId) => {
    const m = await pool.query(
      "INSERT INTO workspace_members (workspace_id, account_id, role) VALUES ($1,$2,'caseworker') RETURNING id",
      [workspaceId, accountId]
    );
    return m.rows[0].id;
  };
  const alphaMembership = await member(alpha.workspaceId);
  const betaMembership = await member(beta.workspaceId);

  // Sessions, written through the canonical token functions so the application
  // verifies them exactly as it would any other.
  const now = Date.now();

  /**
   * `sessions_expire` is `expires_at > created_at` — a relative constraint, not
   * an absolute one. So an already-expired session is perfectly legal as long as
   * it was created earlier still, which is exactly what a real expired session
   * looks like. Backdating `created_at` is therefore the honest construction,
   * not a way around the schema.
   */
  const makeSession = async (createdAt, expiresAt) => {
    const token = issueToken();
    await pool.query(
      `INSERT INTO sessions (id, account_id, token_hash, previous_hash, device_label,
                             created_at, last_seen_at, expires_at, revoked_at, revoked_reason)
       VALUES ($1,$2,$3,NULL,$4,$5,$6,$7,NULL,NULL)`,
      [randomUUID(), accountId, hashToken(token), SMOKE_TAG, createdAt, createdAt, expiresAt]
    );
    return token;
  };

  const iso = (ms) => new Date(ms).toISOString();
  const validToken = await makeSession(iso(now), iso(now + SESSION_TTL_MS));
  const expiredToken = await makeSession(iso(now - 7_200_000), iso(now - 3_600_000));

  await pool.end();

  return {
    accountId,
    alpha: alpha.organisationId,
    beta: beta.organisationId,
    gamma: gamma.organisationId,
    alphaMembership,
    betaMembership,
    validToken,
    expiredToken,
    // Signed with the same key the server is given, through the real signer.
    alphaCookie: signSelection(alpha.organisationId, signingKey),
    betaCookie: signSelection(beta.organisationId, signingKey),
    gammaCookie: signSelection(gamma.organisationId, signingKey),
    missingCookie: signSelection("00000000-0000-4000-8000-000000000000", signingKey),
  };
}

/**
 * Removes exactly what this run created, by tag, and nothing else.
 *
 * Every seeded row carries `SMOKE_TAG`, which contains a per-run uuid. A
 * concurrent smoke, a developer's data and any pre-existing fixture are all
 * invisible to these deletes.
 */
async function cleanupData(databaseUrl) {
  const { createPool } = await import("../packages/database/src/index.ts");
  const pool = await createPool(databaseUrl);
  const removed = {};
  try {
    const accounts = await pool.query("SELECT id FROM accounts WHERE preferred_name LIKE $1", [
      `${SMOKE_TAG}%`,
    ]);
    const ids = accounts.rows.map((r) => r.id);

    removed.sessions = (await pool.query("DELETE FROM sessions WHERE device_label = $1", [SMOKE_TAG]))
      .rowCount;
    if (ids.length) {
      removed.memberships = (
        await pool.query("DELETE FROM workspace_members WHERE account_id = ANY($1::uuid[])", [ids])
      ).rowCount;
    }

    // Audit rows are deliberately not removed.
    //
    // `audit_log` carries a BEFORE DELETE trigger that raises — the append-only
    // property is enforced by the database precisely so application code cannot
    // opt out, and a cleanup routine is application code. Attempting the delete
    // would abort cleanup and leave everything else behind, which is how the
    // first version of this runner failed.
    //
    // Isolation rather than deletion: the smoke runs only against a database
    // whose name the canonical guard accepts as a test database, and every row
    // it writes carries a per-run tag. Any audit entries it produces are counted
    // and reported instead.
    removed.auditRetained = ids.length
      ? (await pool.query("SELECT count(*)::int AS n FROM audit_log WHERE actor = ANY($1::text[])", [ids]))
          .rows[0].n
      : 0;
    removed.workspaces = (
      await pool.query(
        "DELETE FROM workspaces WHERE organization_id IN (SELECT id FROM organizations WHERE name LIKE $1)",
        [`${SMOKE_TAG}%`]
      )
    ).rowCount;
    removed.organisations = (
      await pool.query("DELETE FROM organizations WHERE name LIKE $1", [`${SMOKE_TAG}%`])
    ).rowCount;
    removed.accounts = (
      await pool.query("DELETE FROM accounts WHERE preferred_name LIKE $1", [`${SMOKE_TAG}%`])
    ).rowCount;

    const leftover = await pool.query(
      "SELECT count(*)::int AS n FROM accounts WHERE preferred_name LIKE $1",
      [`${SMOKE_TAG}%`]
    );
    return { ok: leftover.rows[0].n === 0, removed, leftover: leftover.rows[0].n };
  } finally {
    await pool.end();
  }
}

/* ---------------------------------------------------------------- */
/* Server lifecycle                                                  */
/* ---------------------------------------------------------------- */

let child = null;

async function startServer({ databaseUrl, port, signingKey }) {
  const started = Date.now();

  child = spawn(
    "pnpm",
    ["--filter", "@legalos/web", "exec", "next", "dev", "--port", String(port), "--hostname", "127.0.0.1"],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        NODE_ENV: "development",
        DATABASE_URL: databaseUrl,
        SESSION_SIGNING_KEY: signingKey,
        // Never let a real provider be contacted from a smoke.
        AI_GATEWAY_URL: "",
        AI_GATEWAY_API_KEY: "",
        NEXT_TELEMETRY_DISABLED: "1",
        // Its own build directory, so the smoke never contends with a `pnpm dev`
        // a developer already has running.
        //
        // Fixed, not per-run. Next rewrites apps/web/tsconfig.json on every dev
        // start to add an `include` entry for its build directory — and that
        // file is tracked, so a per-run directory appended two lines to it every
        // single time. Fifteen runs had already added thirty. One stable name
        // adds them once.
        //
        // The cost is that two smokes cannot run at once: the second meets
        // Next's own lock and fails at startup with the first server's pid,
        // which is a clear failure rather than a silent one.
        NEXT_DIST_DIR: SMOKE_DIST_DIR,
      },
      stdio: ["ignore", "pipe", "pipe"],
      // Its own process group.
      //
      // `pnpm exec next dev` is three processes deep — pnpm, next, next-server —
      // so signalling the direct child leaves the grandchild running until it
      // notices its parent is gone. It recreated its own build directory on the
      // way out, after cleanup had already removed it. Killing the group ends
      // the whole tree at once, which is also what "no orphan processes" means.
      detached: true,
    }
  );

  await writeFile(PID_FILE, String(child.pid), "utf8");

  const capture = (stream, label) => {
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      for (const line of chunk.split("\n")) {
        if (line.trim()) serverLog.push(`[${label}] ${line.trim()}`);
      }
      if (serverLog.length > 400) serverLog = serverLog.slice(-400);
    });
  };
  capture(child.stdout, "out");
  capture(child.stderr, "err");

  // Readiness by polling a real route, not by sleeping. A fixed sleep passes on
  // a slow machine only by luck, and fails on a slower one.
  const deadline = Date.now() + (INJECT === "never-ready" ? 5_000 : STARTUP_TIMEOUT_MS);
  const base = `http://127.0.0.1:${port}`;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`the development server exited during startup with code ${child.exitCode}`);
    }
    try {
      // Falsification: readiness can never be observed, however healthy the
      // server is. Shortening the deadline alone was not a real test — the
      // server starts in about a second, so it beat the injected deadline and
      // the run passed.
      if (INJECT === "never-ready") throw new Error("readiness probe suppressed");
      const response = await fetch(`${base}/api/health`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.ok || response.status === 401 || response.status === 503) {
        return { base, startupMs: Date.now() - started, pid: child.pid };
      }
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, READINESS_INTERVAL_MS));
  }
  throw new Error(`the development server did not become ready within ${STARTUP_TIMEOUT_MS}ms`);
}

/**
 * Terminates the server and proves it is gone.
 *
 * SIGTERM first so Next can close its own handles, then a bounded escalation to
 * SIGKILL. The return value is a measurement, not an intention: `alive` is read
 * back after the escalation, because a runner that reports success while
 * leaving a server holding a port is one of the failures this obligation must
 * make visible.
 */
async function stopServer() {
  if (!child || child.exitCode !== null) {
    await rm(PID_FILE, { force: true });
    return { requested: false, signal: null, alive: false, exitCode: child?.exitCode ?? null };
  }
  const pid = child.pid;

  if (INJECT === "leak-process") {
    // Falsification: the runner declines to terminate the server.
    //
    // The child's stdio is piped, so an un-killed child keeps the runner's own
    // event loop alive and the first attempt at this simply hung — which is a
    // finding in itself, and not the one being tested. Detaching the streams
    // and unref-ing lets the runner finish, report `alive: true`, and exit
    // non-zero, leaving the server running exactly as the failure being
    // modelled would.
    child.stdout?.removeAllListeners();
    child.stderr?.removeAllListeners();
    child.stdout?.destroy();
    child.stderr?.destroy();
    child.unref();
    return { requested: false, signal: null, alive: groupIsAlive(pid), exitCode: null, injected: "leak-process" };
  }

  signalGroup(pid, "SIGTERM");
  let signal = "SIGTERM";

  // Wait for the *group*, not for the direct child.
  //
  // The direct child is pnpm; next-server is its grandchild. `child.once("exit")`
  // fires while the grandchild is still shutting down, so reading liveness at
  // that moment reported a live group and, separately, let the dying grandchild
  // recreate the build directory after cleanup had removed it. Polling the group
  // on a bounded deadline is the honest question: is the tree gone yet.
  if (!(await groupGone(pid, SIGKILL_GRACE_MS))) {
    signalGroup(pid, "SIGKILL");
    signal = "SIGKILL";
    await groupGone(pid, SIGKILL_GRACE_MS);
  }

  await rm(PID_FILE, { force: true });
  return { requested: true, signal, alive: groupIsAlive(pid), exitCode: child.exitCode };
}

/** Signals the whole process group, falling back to the child alone. */
function signalGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      child?.kill(signal);
    } catch {
      // Already gone.
    }
  }
}

/** Polls until the whole group is gone, or the deadline passes. */
async function groupGone(pid, withinMs) {
  const deadline = Date.now() + withinMs;
  while (Date.now() < deadline) {
    if (!groupIsAlive(pid)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return !groupIsAlive(pid);
}

/** True if the process, or any of its group, is still running. */
function groupIsAlive(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------------- */
/* HTTP                                                              */
/* ---------------------------------------------------------------- */

/**
 * One request, with the raw Cookie header set verbatim.
 *
 * `cookie` is a string rather than a map on purpose: obligation 3 established
 * that duplicate cookies resolve last-wins, and proving the framework agrees
 * requires sending a header a cookie map cannot express.
 */
async function request(base, path, { method = "GET", cookie, headers = {}, body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    redirect: "manual",
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Not JSON — HTML pages and redirects.
  }
  return {
    status: response.status,
    headers: response.headers,
    text,
    json,
    setCookie: response.headers.getSetCookie?.() ?? [],
  };
}

/** Nothing in a refusal may leak internals. */
function looksSafe(text) {
  const forbidden = [
    /at Object\.<anonymous>/,
    /\/home\//,
    /node_modules/,
    /SELECT .* FROM/i,
    /postgres:\/\//,
    /password/i,
    /SESSION_SIGNING_KEY/,
    /\bstack\b/i,
  ];
  return !forbidden.some((p) => p.test(text));
}

/* ---------------------------------------------------------------- */
/* The cases                                                         */
/* ---------------------------------------------------------------- */

const SESSION_COOKIE = "legalos_session";
const ACTIVE_ORG_COOKIE = "legalos_active_org";

async function runCases(base, fixture) {
  const valid = `${SESSION_COOKIE}=${fixture.validToken}`;
  const observations = {};

  /* -- unauthenticated ------------------------------------------ */

  const health = await request(base, "/api/health");
  record("server reachable", health.status < 500, `GET /api/health → ${health.status}`);

  const root = await request(base, "/");
  record("public route serves", root.status === 200, `GET / → ${root.status}`);

  const noSession = await request(base, "/api/analyze", { method: "POST", body: { caseId: "x" } });
  record(
    "authenticated API refuses with no session",
    noSession.status === 401,
    `POST /api/analyze → ${noSession.status}`
  );
  record(
    "refusal exposes nothing internal",
    looksSafe(noSession.text),
    "the refusal body contained an internal detail"
  );
  record(
    "API refusal is JSON",
    (noSession.headers.get("content-type") ?? "").includes("application/json"),
    `content-type ${noSession.headers.get("content-type")}`
  );

  // A cookie too short to be plausible is refused at the edge; a well-formed one
  // that names no session is refused at the route. Two layers, two different
  // bodies, and the smoke observes both rather than assuming one.
  const malformed = await request(base, "/api/analyze", {
    method: "POST",
    cookie: `${SESSION_COOKIE}=short`,
    body: { caseId: "x" },
  });
  record(
    "malformed session cookie refused",
    malformed.status === 401,
    `POST /api/analyze (malformed) → ${malformed.status}`
  );
  observations.malformedRefusedBy = malformed.json?.code === "UNAUTHENTICATED" ? "middleware" : "route";

  const unknown = await request(base, "/api/analyze", {
    method: "POST",
    cookie: `${SESSION_COOKIE}=${"z".repeat(43)}`,
    body: { caseId: "x" },
  });
  record(
    "unknown session refused",
    unknown.status === 401,
    `POST /api/analyze (unknown) → ${unknown.status}`
  );
  record("unknown-session refusal exposes nothing internal", looksSafe(unknown.text), "leak");

  // Which layer actually refused.
  //
  // The middleware answers a *missing* cookie itself, so "no session is
  // refused" proves the edge check and says nothing about the route behind it —
  // a mutation making the route accept a missing session left every case here
  // passing. The two-mechanism problem, and the fix is the same as obligation
  // 3's: ask the question that only one mechanism can answer.
  //
  // A well-formed cookie naming no session passes the middleware's shape test,
  // so the refusal below must come from the route. The middleware's refusal
  // carries `code: "UNAUTHENTICATED"`; the route's does not.
  record(
    "an unknown session is refused by the route, not only by the edge",
    unknown.status === 401 && unknown.json?.code === undefined,
    `code=${JSON.stringify(unknown.json?.code)} — a middleware refusal, so the route was never reached`
  );
  observations.refusalLayers = {
    missingCookie: noSession.json?.code === "UNAUTHENTICATED" ? "middleware" : "route",
    malformedCookie: malformed.json?.code === "UNAUTHENTICATED" ? "middleware" : "route",
    unknownSession: unknown.json?.code === "UNAUTHENTICATED" ? "middleware" : "route",
  };

  const workspace = await request(base, "/workspace");
  record(
    "protected page redirects when unauthenticated",
    workspace.status === 307 || workspace.status === 302,
    `GET /workspace → ${workspace.status}`
  );
  observations.workspaceRedirect = workspace.headers.get("location");

  /* -- authenticated session-entry equivalence ------------------- */

  const identity = await request(base, "/api/dev/identity", { cookie: valid });
  const ok = identity.status === 200 && identity.json?.ok === true;
  record("valid session authenticates over HTTP", ok, `GET /api/dev/identity → ${identity.status}`);

  if (ok) {
    const api = identity.json.requireSession;
    const rsc = identity.json.resolveServerSession;
    record(
      "both entry points authenticate the same session",
      api.authenticated === true && rsc.authenticated === true,
      `requireSession=${api.authenticated} resolveServerSession=${rsc.authenticated}`
    );
    record(
      "both entry points resolve the same account",
      api.accountId !== null && api.accountId === rsc.accountId,
      `${api.accountId} vs ${rsc.accountId}`
    );
    observations.entryPoints = { requireSession: api, resolveServerSession: rsc };
  } else {
    record("both entry points authenticate the same session", false, "identity route did not respond");
    record("both entry points resolve the same account", false, "identity route did not respond");
  }

  // The API route that really exists, not only the diagnostic one. An
  // authenticated caller gets past authentication and fails on the body, which
  // is a different status from the 401 an unauthenticated caller gets — that
  // difference is the proof.
  const analyze = await request(base, "/api/analyze", {
    method: "POST",
    cookie: valid,
    body: { nonsense: true },
  });
  record(
    "a real API route authenticates the session",
    analyze.status !== 401,
    `POST /api/analyze (valid session) → ${analyze.status}, expected anything but 401`
  );
  observations.analyzeAuthenticated = analyze.status;

  /* -- identity injection ---------------------------------------- */

  const injected = await request(base, "/api/dev/identity", {
    cookie: valid,
    headers: {
      "x-account-id": "00000000-0000-4000-8000-000000000001",
      "x-actor-id": "00000000-0000-4000-8000-000000000002",
      "x-organisation-id": fixture.gamma,
      "x-role": "owner",
    },
  });
  record(
    "submitted identity headers do not alter the result",
    injected.status === 200 &&
      injected.json?.requireSession?.accountId === identity.json?.requireSession?.accountId &&
      injected.json?.resolveServerSession?.organisationId ===
        identity.json?.resolveServerSession?.organisationId,
    "a submitted header changed the resolved identity"
  );

  /* -- duplicate cookies ----------------------------------------- */

  // Obligation 3 measured last-wins at the parser. Whether the framework agrees
  // is a separate question, and this is the request that answers it.
  const duplicateSession = await request(base, "/api/dev/identity", {
    cookie: `${SESSION_COOKIE}=${"z".repeat(43)}; ${SESSION_COOKIE}=${fixture.validToken}`,
  });
  const lastWinsSession = duplicateSession.status === 200;
  record(
    "duplicate session cookies resolve last-wins at runtime",
    lastWinsSession,
    `unknown-then-valid → ${duplicateSession.status}, expected 200 if last wins`
  );
  // And both entry points must pick the *same* duplicate. Status alone cannot
  // show this: `requireSession` taking the last while `resolveServerSession`
  // takes the first still answers 200, with the two disagreeing about who is
  // calling. That is the exact split obligation 3's structural guard was left
  // standing in for, and here it is observable.
  record(
    "both entry points select the same duplicate cookie",
    duplicateSession.json?.resolveServerSession?.authenticated === true &&
      duplicateSession.json?.resolveServerSession?.accountId ===
        duplicateSession.json?.requireSession?.accountId,
    `requireSession=${duplicateSession.json?.requireSession?.accountId} ` +
      `resolveServerSession=${duplicateSession.json?.resolveServerSession?.accountId}`
  );

  const duplicateReversed = await request(base, "/api/dev/identity", {
    cookie: `${SESSION_COOKIE}=${fixture.validToken}; ${SESSION_COOKIE}=${"z".repeat(43)}`,
  });
  record(
    "duplicate session cookies are order-dependent in the documented direction",
    duplicateReversed.status === 401,
    `valid-then-unknown → ${duplicateReversed.status}, expected 401 if last wins`
  );

  const duplicateOrg = await request(base, "/api/dev/identity", {
    cookie: `${valid}; ${ACTIVE_ORG_COOKIE}=${fixture.alphaCookie}; ${ACTIVE_ORG_COOKIE}=${fixture.betaCookie}`,
  });
  const betaDigest = digest(fixture.beta);
  record(
    "duplicate active-organisation cookies resolve last-wins at runtime",
    duplicateOrg.status === 200 && duplicateOrg.json?.resolveServerSession?.organisationId === betaDigest,
    `alpha-then-beta resolved ${duplicateOrg.json?.resolveServerSession?.organisationId}, expected beta ${betaDigest}`
  );

  observations.duplicateCookies = {
    rawHeaderForm: `${SESSION_COOKIE}=<a>; ${SESSION_COOKIE}=<b>`,
    sessionUnknownThenValid: duplicateSession.status,
    sessionValidThenUnknown: duplicateReversed.status,
    organisationAlphaThenBeta: duplicateOrg.json?.resolveServerSession?.organisationId ?? null,
    effectiveOrganisationIsLast: duplicateOrg.json?.resolveServerSession?.organisationId === betaDigest,
    frameworkAgreesWithHarness: lastWinsSession && duplicateReversed.status === 401,
  };

  /* -- expiry ---------------------------------------------------- */

  const expired = await request(base, "/api/dev/identity", {
    cookie: `${SESSION_COOKIE}=${fixture.expiredToken}`,
  });
  record("expired session refused at runtime", expired.status === 401, `→ ${expired.status}`);
  observations.expiry = {
    valid: identity.status,
    expired: expired.status,
    note:
      "the live smoke observes valid versus expired only; the exact-at-expiry boundary is proved " +
      "under a controlled clock in packages/integration/test/authentication/session-equivalence.test.ts",
  };

  /* -- active organisation --------------------------------------- */

  const noPreference = await request(base, "/api/dev/identity", { cookie: valid });
  record(
    "no preference with two memberships requires a selection",
    noPreference.json?.resolveServerSession?.authenticated === true &&
      noPreference.json?.resolveServerSession?.tenancy === "selection_required",
    `tenancy=${noPreference.json?.resolveServerSession?.tenancy}, expected selection_required`
  );

  const betaPreference = await request(base, "/api/dev/identity", {
    cookie: `${valid}; ${ACTIVE_ORG_COOKIE}=${fixture.betaCookie}`,
  });
  record(
    "a valid preference resolves that organisation",
    betaPreference.json?.resolveServerSession?.organisationId === betaDigest,
    `resolved ${betaPreference.json?.resolveServerSession?.organisationId}`
  );

  const inaccessible = await request(base, "/api/dev/identity", {
    cookie: `${valid}; ${ACTIVE_ORG_COOKIE}=${fixture.gammaCookie}`,
  });
  const nonexistent = await request(base, "/api/dev/identity", {
    cookie: `${valid}; ${ACTIVE_ORG_COOKIE}=${fixture.missingCookie}`,
  });
  record(
    "inaccessible and nonexistent organisations are refused identically",
    inaccessible.json?.resolveServerSession?.tenancy ===
      nonexistent.json?.resolveServerSession?.tenancy &&
      inaccessible.json?.resolveServerSession?.tenancy === "invalid_active_organisation",
    `${inaccessible.json?.resolveServerSession?.tenancy} vs ${nonexistent.json?.resolveServerSession?.tenancy}`
  );

  const unsigned = await request(base, "/api/dev/identity", {
    cookie: `${valid}; ${ACTIVE_ORG_COOKIE}=${fixture.beta}`,
  });
  record(
    "an unsigned preference is ignored",
    unsigned.json?.resolveServerSession?.tenancy === "selection_required",
    `tenancy=${unsigned.json?.resolveServerSession?.tenancy}`
  );

  observations.activeOrganisation = {
    membershipCount: betaPreference.json?.resolveServerSession?.membershipCount ?? null,
    noPreference: noPreference.json?.resolveServerSession?.tenancy ?? null,
    validPreference: betaPreference.json?.resolveServerSession?.organisationId ?? null,
    inaccessible: inaccessible.json?.resolveServerSession?.tenancy ?? null,
    nonexistent: nonexistent.json?.resolveServerSession?.tenancy ?? null,
    unsigned: unsigned.json?.resolveServerSession?.tenancy ?? null,
  };

  /* -- revoked membership ---------------------------------------- */

  const { createPool } = await import("../packages/database/src/index.ts");
  const pool = await createPool(process.env.SMOKE_DATABASE_URL ?? process.env.TEST_DATABASE_URL);
  try {
    await pool.query("UPDATE workspace_members SET removed_at = now() WHERE id = $1", [
      fixture.betaMembership,
    ]);
    const revoked = await request(base, "/api/dev/identity", {
      cookie: `${valid}; ${ACTIVE_ORG_COOKIE}=${fixture.betaCookie}`,
    });
    record(
      "a revoked membership stops being effective on the next request",
      revoked.json?.resolveServerSession?.tenancy === "invalid_active_organisation",
      `tenancy=${revoked.json?.resolveServerSession?.tenancy}`
    );
    observations.activeOrganisation.revoked = revoked.json?.resolveServerSession?.tenancy ?? null;
    await pool.query("UPDATE workspace_members SET removed_at = NULL WHERE id = $1", [
      fixture.betaMembership,
    ]);
  } finally {
    await pool.end();
  }

  /* -- delivery provider ----------------------------------------- */

  const signIn = await request(base, "/api/auth/start", {
    method: "POST",
    body: { contact: `${SMOKE_TAG}@example.test` },
  });
  // The documented development behaviour is not 503. `/api/auth/start` returns
  // 503 only when `NODE_ENV === "production"` and no provider is configured; in
  // development it answers with the code it would have delivered, so a developer
  // can sign in without a provider. Both are bounded refusals-to-deliver rather
  // than failures, and the smoke records which one it actually saw rather than
  // asserting the production one it cannot reach from here.
  const bounded = [200, 400, 501, 503].includes(signIn.status);
  record(
    "sign-in without a delivery provider responds safely and boundedly",
    bounded && looksSafe(signIn.text),
    `POST /api/auth/start → ${signIn.status}`
  );
  record(
    "sign-in issues no session cookie",
    !signIn.setCookie.some((c) => c.startsWith(`${SESSION_COOKIE}=`)),
    "sign-in initiation set a session cookie"
  );
  observations.deliveryProvider = {
    status: signIn.status,
    delivered: signIn.json?.delivered ?? null,
    developmentCodeReturned: signIn.json?.developmentCode !== undefined,
    productionBehaviour: "503, keyed off NODE_ENV in the route; unreachable from a development smoke",
    bodyIsSafe: looksSafe(signIn.text),
    setNoSessionCookie: !signIn.setCookie.some((c) => c.startsWith(`${SESSION_COOKIE}=`)),
    createdNothing: null,
  };

  // It must not have quietly created a challenge or a session.
  const pool2 = await createPool(process.env.SMOKE_DATABASE_URL ?? process.env.TEST_DATABASE_URL);
  try {
    const challenges = await pool2.query(
      "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = 'auth_challenges'"
    );
    if (challenges.rows[0].n > 0) {
      const created = await pool2.query(
        "SELECT count(*)::int AS n FROM auth_challenges WHERE contact LIKE $1",
        [`${SMOKE_TAG}%`]
      );
      observations.deliveryProvider.createdNothing = created.rows[0].n === 0;
      record(
        "no challenge is created without a delivery provider",
        created.rows[0].n === 0,
        `${created.rows[0].n} challenge row(s) were created`
      );
    } else {
      observations.deliveryProvider.createdNothing = true;
      record("no challenge table exists to write to", true, "", false);
    }
  } finally {
    await pool2.end();
  }

  /* -- dev-session route is development-only --------------------- */

  const devSession = await request(base, "/api/auth/dev-session", { method: "POST" });
  record(
    "the development session route issues a session in development",
    devSession.status === 200,
    `POST /api/auth/dev-session → ${devSession.status}`
  );
  const devCookie = devSession.setCookie.find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  record(
    "the development session route sets an HttpOnly session cookie",
    Boolean(devCookie) && /HttpOnly/i.test(devCookie ?? ""),
    `Set-Cookie ${devCookie ? "present" : "absent"}`
  );

  /* -- switch path ----------------------------------------------- */

  // The organisation-switch adapter is a Next.js server action. No component in
  // this repository renders it, and invoking one over HTTP means reproducing the
  // Next-Action protocol and a build-time action id — private framework detail
  // the brief rules out inventing a route for. So the live smoke proves the
  // downstream half: that a signed active-organisation cookie, the exact value
  // the adapter emits, is honoured by the next real HTTP request. The switch
  // adapter itself remains proved by obligations 2 and 3.
  const downstream = await request(base, "/api/dev/identity", {
    cookie: `${valid}; ${ACTIVE_ORG_COOKIE}=${fixture.betaCookie}`,
  });
  record(
    "a cookie of the form the switch adapter emits is honoured by the next request",
    downstream.json?.resolveServerSession?.organisationId === betaDigest,
    `resolved ${downstream.json?.resolveServerSession?.organisationId}`
  );
  observations.switchPath = {
    liveInvocation: false,
    reason:
      "no component renders the switch server action, and invoking one requires the Next-Action " +
      "protocol and a build-time action id. The live smoke proves the downstream cookie effect; " +
      "the adapter itself is proved by switch-production.test.ts and set-cookie-observation.test.ts",
    downstreamEffective: downstream.json?.resolveServerSession?.organisationId === betaDigest,
  };

  /* -- response headers ------------------------------------------ */

  observations.headers = {
    identityCacheControl: identity.headers.get("cache-control"),
    identityContentType: identity.headers.get("content-type"),
    refusalContentType: noSession.headers.get("content-type"),
    workspaceLocation: workspace.headers.get("location"),
    setCookieOnRefusal: noSession.setCookie.length,
  };
  record(
    "a refusal sets no cookie",
    noSession.setCookie.length === 0,
    `${noSession.setCookie.length} Set-Cookie header(s) on a refusal`
  );

  /* -- audit ------------------------------------------------------ */

  const pool3 = await createPool(process.env.SMOKE_DATABASE_URL ?? process.env.TEST_DATABASE_URL);
  try {
    const audits = await pool3.query(
      "SELECT count(*)::int AS n FROM audit_log WHERE actor = $1 AND action = 'session.organisation_switched'",
      [fixture.accountId]
    );
    record(
      "no switch audit was written by refused requests",
      audits.rows[0].n === 0,
      `${audits.rows[0].n} switch audit row(s) exist, expected 0 since no switch was invoked`
    );
    observations.audit = { switchEntries: audits.rows[0].n };

    const session = await pool3.query(
      "SELECT count(*)::int AS n FROM sessions WHERE device_label = $1",
      [SMOKE_TAG]
    );
    record("the seeded sessions exist in the database", session.rows[0].n === 2, `${session.rows[0].n} rows`);

    const memberships = await pool3.query(
      "SELECT count(*)::int AS n FROM workspace_members WHERE account_id = $1 AND removed_at IS NULL",
      [fixture.accountId]
    );
    record("the seeded memberships exist", memberships.rows[0].n === 2, `${memberships.rows[0].n} rows`);
  } finally {
    await pool3.end();
  }

  return observations;
}

/* ---------------------------------------------------------------- */
/* Main                                                              */
/* ---------------------------------------------------------------- */

async function commit() {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoRoot });
    return stdout.trim();
  } catch {
    return null;
  }
}

async function main() {
  const startedAt = Date.now();
  process.stdout.write("\nDevelopment smoke\n\n");

  let context;
  try {
    context = await preflight();
    process.stdout.write(`  preflight passed — port ${context.port}\n\n`);
  } catch (error) {
    process.stderr.write(`\n  preflight refused: ${error.message}\n\n`);
    process.exitCode = 2;
    return;
  }

  const signingKey = `smoke-${RUN}`;
  let observations = {};
  let server = null;
  let cleanup = { ok: false, removed: {}, leftover: null };
  let termination = { requested: false, signal: null, alive: null, exitCode: null };
  let failure = null;
  let fixture = null;

  try {
    fixture = await seed(context.databaseUrl, signingKey);
    server = await startServer({ ...context, signingKey });
    process.stdout.write(`  server ready in ${server.startupMs}ms (pid ${server.pid})\n\n`);
    observations = await runCases(server.base, fixture);
  } catch (error) {
    failure = error.message;
    record("smoke completed without an unhandled error", false, error.message);
  } finally {
    termination = await stopServer();
    // Unconditionally, not `if (fixture)`. Seeding creates an account and two
    // organisations before it creates a session, so a seed that throws halfway
    // has already written rows — and the first version of this runner left them
    // behind, because it only cleaned up when seeding had returned. The deletes
    // are scoped to this run's tag, so running them after a failed seed, or
    // after no seed at all, removes exactly what exists and nothing else.
    try {
      cleanup = await cleanupData(context.databaseUrl);
    } catch (error) {
      cleanup = { ok: false, removed: {}, leftover: null, error: error.message };
    }
  }

  record(
    "the server process terminated",
    termination.alive === false,
    `alive=${termination.alive} after ${termination.signal ?? "no signal"}`
  );
  record("smoke data was removed", cleanup.ok === true, `leftover=${cleanup.leftover}`);

  const mandatory = cases.filter((c) => c.mandatory);
  const failed = mandatory.filter((c) => !c.passed);
  const verdict = failed.length === 0 ? "passed" : "failed";

  await mkdir(EVIDENCE_DIR, { recursive: true });
  await writeFile(
    EVIDENCE_FILE,
    JSON.stringify(
      {
        checkId: "development_smoke",
        verdict,
        at: new Date().toISOString(),
        commit: await commit(),
        durationMs: Date.now() - startedAt,
        environment: {
          mode: "development",
          node: process.versions.node,
          database: redactUrl(context.databaseUrl),
          signingKey: redact(signingKey),
        },
        server: {
          command: `next dev --port ${context.port} --hostname 127.0.0.1`,
          port: context.port,
          pid: server?.pid ?? null,
          startupMs: server?.startupMs ?? null,
        },
        preflight: context.checks,
        routesExercised: [
          "/",
          "/api/health",
          "/api/analyze",
          "/api/dev/identity",
          "/api/auth/start",
          "/api/auth/dev-session",
          "/workspace",
        ],
        sessionSeeding: {
          strategy: "canonical-persistence",
          why:
            "the existing /api/auth/dev-session route creates a pending_recovery account with no " +
            "membership, and the schema constraint active_accounts_can_be_recovered forbids " +
            "promoting it, so it cannot resolve a tenancy",
          tokensIssuedBy: "@legalos/auth issueToken/hashToken",
          cookieSignedBy: "@legalos/auth signSelection",
        },
        caseCount: cases.length,
        mandatoryCount: mandatory.length,
        failedCount: failed.length,
        cases,
        observations,
        cleanup,
        termination,
        falsifications: ["development_smoke_fails_closed"],
        error: failure,
        serverLog: verdict === "failed" ? serverLog.slice(-120) : [],
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  process.stdout.write(
    `\n  ${mandatory.length - failed.length}/${mandatory.length} mandatory case(s) passed` +
      `, ${cases.length} recorded, ${Date.now() - startedAt}ms\n` +
      `  evidence: docs/smoke-evidence/development-smoke.json\n\n`
  );

  // The isolated build directory goes last. Removing it immediately after the
  // server is signalled loses a race with the dying process, which recreates
  // its own directory on the way out and leaves an empty husk behind.
  await rm(join(repoRoot, "apps/web", SMOKE_DIST_DIR), { recursive: true, force: true });

  process.exitCode = verdict === "passed" && cleanup.ok && termination.alive === false ? 0 : 1;
}

// Cleanup must also happen when the runner is interrupted, or a killed smoke
// leaves a development server holding a port and rows in the database.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    process.stdout.write(`\n  interrupted — terminating server\n`);
    await stopServer();
    process.exit(130);
  });
}

await main();
