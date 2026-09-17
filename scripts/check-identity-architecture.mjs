#!/usr/bin/env node
/**
 * Identity and tenant-boundary architecture.
 *
 * Syntax-aware, using the TypeScript compiler API rather than a text scan.
 * The distinction matters here more than usual: the thing being enforced is
 * *where a value came from*, and a regex that matched the word `organisationId`
 * would fire on a comment and miss an object literal spread from a form.
 *
 * What this enforces, exactly — and the ADR says the same, because a checker
 * whose documentation overstates it is worse than no checker:
 *
 *   It rejects a defined set of call and construction patterns in
 *   `apps/web/src`. It is not information-flow analysis. A determined
 *   indirection — assigning a form value to a variable, passing it through a
 *   helper, then into a context — is not tracked.
 *
 * It catches the mistakes that actually happen: assembling a context by hand,
 * reading an identity field straight off a payload, parsing a cookie a second
 * time, or importing a server identity module into a client component.
 */
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
// The scan root is overridable so the committed fixtures can be checked by the
// same code that gates the real tree. A self-test against a re-implementation
// would prove the re-implementation.
const rootArg = process.argv.find((a) => a.startsWith("--root="));
const appRoot = rootArg ? join(repoRoot, rootArg.slice("--root=".length)) : join(repoRoot, "apps/web/src");
const quiet = process.argv.includes("--quiet");

/**
 * The canonical modules, named explicitly.
 *
 * An allow-list rather than a filename heuristic. "Any file with `session` in
 * its name may parse cookies" is how a second verifier gets written and passes.
 */
const CANONICAL = {
  cookieNames: "lib/auth/cookies.ts",
  sessionVerifier: "lib/auth/require-session.ts",
  serverSession: "lib/auth/server-session.ts",
  contextFactory: "lib/auth/repository-context.ts",
  switchAction: "lib/auth/switch-organisation.ts",
  sessionStore: "lib/auth/session-store.ts",
};
const CANONICAL_FILES = new Set(Object.values(CANONICAL));

/** Sources a caller controls. Anything from here is suspect as identity. */
/**
 * Sources a caller controls.
 *
 * `query` was here in the first draft and fired on `query.accountId` inside the
 * case and audit repositories, where `query` is a typed parameter the caller
 * already had to construct legitimately. A rule that cries wolf on correct code
 * gets suppressed, and a suppressed rule enforces nothing.
 */
const CLIENT_SOURCES =
  /^(formData|form|body|payload|searchParams|input|request|req)$/;

const IDENTITY_FIELDS = new Set([
  "actorId",
  "accountId",
  "organisationId",
  "organizationId",
  "membershipId",
  "role",
  "permissions",
]);

const violations = [];
function report(rule, node, file, message) {
  const { line, character } = ts.getLineAndCharacterOfPosition(
    node.getSourceFile(),
    node.getStart()
  );
  violations.push({ rule, file, line: line + 1, column: character + 1, message });
}

async function sources(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await sources(path)));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(path);
  }
  return out;
}

/** Walks a node's ancestors looking for an enclosing call to `name`. */
function isInsideCallTo(node, name) {
  for (let n = node.parent; n; n = n.parent) {
    if (ts.isCallExpression(n) && n.expression.getText().endsWith(name)) return true;
  }
  return false;
}

function analyse(sourceFile, rel) {
  const text = sourceFile.getFullText();
  const isClientComponent = /^\s*["']use client["']/m.test(text);
  const isCanonical = CANONICAL_FILES.has(rel);
  const isTestOrFixture = /(^|\/)(test|tests|__fixtures__)\//.test(rel);

  const visit = (node) => {
    /* ST-A7 — server-only identity modules in a client component. */
    // A type-only import is erased before the bundle exists, so it carries no
    // server code. Flagging it would push authors towards duplicating the
    // client-safe projection type, which is worse than importing it.
    if (isClientComponent && ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) {
      const spec = node.moduleSpecifier.getText().replace(/["']/g, "");
      if (
        /lib\/auth\/(server-session|repository-context|switch-organisation|session-store|require-session)/.test(
          spec
        ) ||
        /@legalos\/database/.test(spec)
      ) {
        report(
          "ST-A7",
          node,
          rel,
          `a client component imports ${spec}; server identity must not reach the browser bundle`
        );
      }
    }

    /* ST-A4 — a second session-cookie name. */
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText() === "SESSION_COOKIE" &&
      node.initializer &&
      ts.isStringLiteral(node.initializer) &&
      rel !== CANONICAL.cookieNames
    ) {
      report("ST-A4", node, rel, "SESSION_COOKIE is declared outside lib/auth/cookies.ts");
    }
    if (
      ts.isStringLiteral(node) &&
      /^legalos_(session|active_org)$/.test(node.text) &&
      rel !== CANONICAL.cookieNames &&
      rel !== CANONICAL.serverSession
    ) {
      report("ST-A4", node, rel, `the cookie name "${node.text}" is hard-coded here`);
    }

    /* ST-A5 — parsing the active-organisation cookie elsewhere. */
    if (
      ts.isIdentifier(node) &&
      /^(ACTIVE_ORG_COOKIE|verifySelection|signSelection)$/.test(node.text) &&
      !isCanonical &&
      !isTestOrFixture
    ) {
      report(
        "ST-A5",
        node,
        rel,
        `${node.text} is used outside the canonical tenant resolver; the active-organisation cookie is parsed in one place`
      );
    }

    /* ST-A6 — route-local membership loading. */
    if (ts.isStringLiteralLike(node) && /\bworkspace_members\b/.test(node.text) && !isCanonical) {
      report(
        "ST-A6",
        node,
        rel,
        "workspace_members is queried outside the canonical membership loader; authorisation must not be reconstructed per route"
      );
    }

    /* ST-A1 — a hand-built repository context. */
    // The full shape, not two fields of it. `actorId` + `organisationId` alone
    // also describes the execution-runner context that /api/analyze and
    // /api/chat build, which is a different object with a different defect
    // (recorded separately: they pass an account id where an actor id belongs).
    const contextShape = (n) =>
      ts.isObjectLiteralExpression(n) &&
      ["actorId", "accountId", "organisationId"].every((f) =>
        n.properties.some((p) => p.name && p.name.getText() === f)
      );

    if (
      (ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) &&
      /RepositoryContext/.test(node.type.getText()) &&
      !isCanonical &&
      !isTestOrFixture
    ) {
      report(
        "ST-A1",
        node,
        rel,
        "a value is asserted to RepositoryContext outside the canonical factory"
      );
    }
    if (contextShape(node) && !isCanonical && !isTestOrFixture) {
      report(
        "ST-A1",
        node,
        rel,
        "a repository context is assembled by hand; use requireRepositoryContext()"
      );
    }

    /* ST-A8 — an alternative context factory. */
    if (
      (ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) &&
      node.name &&
      /^(create|build|resolve|make|get)(Repository|Tenant|Authenticated)Context$/.test(
        node.name.getText()
      ) &&
      !isCanonical
    ) {
      report(
        "ST-A8",
        node,
        rel,
        `${node.name.getText()} is a second context factory; there is one canonical path`
      );
    }

    /* ST-A2 — an identity field read straight off a client-controlled value. */
    if (
      ts.isPropertyAccessExpression(node) &&
      IDENTITY_FIELDS.has(node.name.getText()) &&
      ts.isIdentifier(node.expression) &&
      CLIENT_SOURCES.test(node.expression.getText()) &&
      !isCanonical &&
      !isTestOrFixture
    ) {
      report(
        "ST-A2",
        node,
        rel,
        `${node.getText()} takes a security identity from client-controlled input`
      );
    }
    if (
      ts.isCallExpression(node) &&
      /\.(get)$/.test(node.expression.getText()) &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0]) &&
      IDENTITY_FIELDS.has(node.arguments[0].text) &&
      !isCanonical &&
      !isTestOrFixture
    ) {
      report(
        "ST-A2",
        node,
        rel,
        `${node.arguments[0].text} is read from a client-controlled collection and used as identity`
      );
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sourceFile, visit);
}

const files = await sources(appRoot);
for (const file of files) {
  const rel = relative(appRoot, file);
  const text = await readFile(file, "utf8");
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  analyse(sourceFile, rel);
}

const RULES = {
  "ST-A1": "repository context assembled outside the canonical factory",
  "ST-A2": "security identity derived from client-controlled input",
  "ST-A4": "session cookie name declared or parsed outside lib/auth/cookies.ts",
  "ST-A5": "active-organisation cookie parsed outside the canonical resolver",
  "ST-A6": "workspace_members queried outside the canonical membership loader",
  "ST-A7": "server identity module imported by a client component",
  "ST-A8": "an alternative repository/tenant context factory",
};

if (!quiet) console.log("\nIdentity and tenant-boundary architecture\n");
if (!quiet) console.log(`  ${files.length} source file(s) under ${rootArg ? rootArg.slice(7) : "apps/web/src"}, parsed as TypeScript\n`);
if (quiet) {
  // Machine-readable, for the fixture suite to assert rule, file and line.
  console.log(JSON.stringify(violations));
} else {
  for (const [id, description] of Object.entries(RULES)) {
    const hits = violations.filter((v) => v.rule === id);
    console.log(`  ${hits.length === 0 ? "OK  " : "FAIL"}  ${id}  ${description}`);
    for (const v of hits) console.log(`          ${v.file}:${v.line}:${v.column} — ${v.message}`);
  }
}

if (!quiet) {
  console.log(
    "\n  Enforces defined construction and call patterns. This is not information-flow\n" +
      "  analysis: a value passed through an intermediate helper is not tracked."
  );
}

if (violations.length > 0) {
  if (!quiet) console.error(`\n${violations.length} identity-architecture violation(s).`);
  process.exit(1);
}
