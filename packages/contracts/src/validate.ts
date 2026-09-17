import { GUARANTEE_KINDS, type RepositoryContract } from "./guarantee.ts";
import { CONTRACTS } from "./registry.ts";

/**
 * Structural validation of the contract registry.
 *
 * Relational defects only — the ones invisible from inside a single
 * declaration. These fail the build, because unlike an unproven guarantee (a
 * true statement about the state of the work) a malformed one is a mistake in
 * the declarations themselves.
 *
 * The `refuses` length check is not padding. A guarantee whose refusal reads
 * "is not organisation scoped" gives a test author nothing to write, and what
 * gets written instead is a test that calls the method and asserts it returned
 * an array. That test passes forever and proves nothing, which is the specific
 * outcome this whole layer exists to prevent.
 */

export interface ContractDefect {
  readonly subject: string;
  readonly problem: string;
}

export function validateContracts(
  contracts: readonly RepositoryContract[] = CONTRACTS
): readonly ContractDefect[] {
  const defects: ContractDefect[] = [];
  const guaranteeIds = new Set<string>();
  const repositories = new Set<string>();
  const modules = new Set<string>();
  const checkIds = new Map<string, string>();

  for (const contract of contracts) {
    if (repositories.has(contract.repository)) {
      defects.push({ subject: contract.repository, problem: "duplicate repository" });
    }
    repositories.add(contract.repository);

    if (modules.has(contract.module)) {
      defects.push({
        subject: contract.repository,
        problem: `two contracts claim the same module ${contract.module}`,
      });
    }
    modules.add(contract.module);

    if (contract.rationale.trim().length < 60) {
      defects.push({ subject: contract.repository, problem: "rationale too thin to review" });
    }
    if (contract.guarantees.length === 0) {
      defects.push({ subject: contract.repository, problem: "states no guarantees" });
    }
    if (contract.tables.length === 0) {
      defects.push({ subject: contract.repository, problem: "names no tables" });
    }
    if (contract.surfaces.length === 0) {
      defects.push({
        subject: contract.repository,
        problem: "names no surface, so its blast radius is unrecorded",
      });
    }

    for (const guarantee of contract.guarantees) {
      const subject = `${contract.repository}.${guarantee.id}`;

      if (guaranteeIds.has(guarantee.id)) {
        defects.push({ subject, problem: "duplicate guarantee id" });
      }
      guaranteeIds.add(guarantee.id);

      if (!GUARANTEE_KINDS.includes(guarantee.kind)) {
        defects.push({ subject, problem: `unknown kind ${guarantee.kind}` });
      }
      if (guarantee.statement.trim().length < 20) {
        defects.push({ subject, problem: "statement too thin to review" });
      }
      if (guarantee.refuses.trim().length < 60) {
        // Long enough to name a concrete failure rather than restate the
        // guarantee with "not" in front of it.
        defects.push({
          subject,
          problem: "refuses clause does not describe a concrete failure a test could attempt",
        });
      }
      if (!guarantee.provedBy.trim()) {
        defects.push({
          subject,
          problem: "names no proving check, so it could never be honoured",
        });
      } else {
        const owner = checkIds.get(guarantee.provedBy);
        if (owner && owner !== subject) {
          // One check proving two guarantees means one of them is not really
          // being measured — whichever the test was actually written for.
          defects.push({
            subject,
            problem: `proving check ${guarantee.provedBy} is already claimed by ${owner}`,
          });
        }
        checkIds.set(guarantee.provedBy, subject);
      }
    }
  }

  return defects;
}

/**
 * Checks that every table a contract names is actually created by a migration.
 *
 * Separate because it touches the filesystem, and a build failure for the same
 * reason `validateProtectedPaths` is: a contract naming a table that does not
 * exist points the next person at a schema they will not find, and they will
 * believe the contract before they believe the database.
 */
export async function validateTables(
  repoRoot: string,
  contracts: readonly RepositoryContract[] = CONTRACTS
): Promise<readonly ContractDefect[]> {
  const { readdir, readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");

  const dir = join(repoRoot, "packages/database/migrations");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

  const created = new Set<string>();
  for (const file of files) {
    const sql = await readFile(join(dir, file), "utf8");
    for (const match of sql.matchAll(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+([a-z_]+)/gi)) {
      created.add(match[1]!.toLowerCase());
    }
  }

  const defects: ContractDefect[] = [];
  for (const contract of contracts) {
    for (const table of contract.tables) {
      if (!created.has(table.toLowerCase())) {
        defects.push({
          subject: contract.repository,
          problem: `names table ${table}, which no migration creates`,
        });
      }
    }
  }
  return defects;
}

/**
 * Checks that every invariant a contract cites exists in the ESI registry.
 *
 * Passed in rather than imported, so this package does not depend on the
 * invariant registry to state its own structure.
 */
export function validateInvariantRefs(
  knownInvariantIds: ReadonlySet<string>,
  contracts: readonly RepositoryContract[] = CONTRACTS
): readonly ContractDefect[] {
  const defects: ContractDefect[] = [];
  for (const contract of contracts) {
    for (const id of contract.invariants) {
      if (!knownInvariantIds.has(id)) {
        defects.push({
          subject: contract.repository,
          problem: `cites unknown invariant ${id}`,
        });
      }
    }
  }
  return defects;
}
