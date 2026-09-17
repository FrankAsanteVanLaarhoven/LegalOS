import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * @legalos/integration — integration tests as evidence producers.
 *
 * The six outstanding authentication checks — revocation propagating, cache
 * invalidation, cross-device sign-out, recovery working, MFA policy, audit
 * events — cannot be settled by reading source. Until now the observer reported
 * them unavailable and named the test that would settle them, which was honest
 * but inert: someone still had to hand-write a check afterwards.
 *
 * This closes the loop. An integration test writes an evidence record; the
 * observer reads the directory. Passing a test raises the capability with no
 * status edited, and — the half that matters more — evidence that stops being
 * produced stops counting, so a change that breaks a guarantee lowers the
 * capability on its own.
 *
 * Two properties make that safe:
 *
 *  - Evidence expires. A record older than its freshness window is ignored,
 *    so a suite that silently stopped running cannot keep vouching for code it
 *    last saw months ago. Absence and staleness both read as "not demonstrated".
 *  - Evidence records the commit it was produced against. Evidence from a
 *    different commit is visible as such rather than silently inherited.
 */

export interface Evidence {
  /** The observation id this settles, e.g. `session_revocation_propagates`. */
  readonly checkId: string;
  readonly passed: boolean;
  /** ISO-8601 timestamp of the run. */
  readonly at: string;
  /** Commit the suite ran against, where known. */
  readonly commit: string | null;
  /** Test that produced it, so a reader can find what was actually asserted. */
  readonly producedBy: string;
  /** What was demonstrated, in words. */
  readonly demonstrates: string;
}

/** Evidence older than this is ignored. Thirty days. */
export const FRESHNESS_MS = 30 * 24 * 60 * 60 * 1000;

export function evidenceDirectory(repoRoot: string): string {
  return join(repoRoot, "docs/integration-evidence");
}

/** Writes one evidence record. Called by an integration test after asserting. */
export async function emitEvidence(repoRoot: string, evidence: Evidence): Promise<void> {
  const dir = evidenceDirectory(repoRoot);
  await mkdir(dir, { recursive: true });
  const name = `${evidence.checkId}.json`;
  await writeFile(join(dir, name), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

export interface EvidenceReading {
  readonly checkId: string;
  /** null when absent, stale, or from a different commit — all mean the same. */
  readonly demonstrated: boolean | null;
  readonly reason: string;
  readonly evidence: Evidence | null;
}

/**
 * Reads evidence for a check.
 *
 * Returns null rather than false when nothing is known, because "not
 * demonstrated" and "demonstrated not to work" are different states and the
 * capability layer treats them differently — one is unmeasured, the other is a
 * failure.
 */
export async function readEvidence(
  repoRoot: string,
  checkId: string,
  now: number,
  currentCommit: string | null = null
): Promise<EvidenceReading> {
  let evidence: Evidence;
  try {
    const raw = await readFile(join(evidenceDirectory(repoRoot), `${checkId}.json`), "utf8");
    evidence = JSON.parse(raw) as Evidence;
  } catch {
    return {
      checkId,
      demonstrated: null,
      reason: "no integration evidence has been produced for this check",
      evidence: null,
    };
  }

  const age = now - Date.parse(evidence.at);
  if (Number.isNaN(age) || age > FRESHNESS_MS) {
    return {
      checkId,
      demonstrated: null,
      reason: `the last evidence is older than ${Math.round(FRESHNESS_MS / 86_400_000)} days, so it no longer vouches for the current code`,
      evidence,
    };
  }

  if (currentCommit && evidence.commit && evidence.commit !== currentCommit) {
    return {
      checkId,
      demonstrated: null,
      reason: `the evidence was produced against ${evidence.commit.slice(0, 7)}, not this commit`,
      evidence,
    };
  }

  return {
    checkId,
    demonstrated: evidence.passed,
    reason: evidence.passed
      ? `demonstrated by ${evidence.producedBy}`
      : `${evidence.producedBy} ran and the guarantee did not hold`,
    evidence,
  };
}

/** Every check with evidence on disk, for the trust ledger. */
export async function allEvidence(repoRoot: string): Promise<readonly Evidence[]> {
  try {
    const files = await readdir(evidenceDirectory(repoRoot));
    const records = await Promise.all(
      files
        .filter((f) => f.endsWith(".json"))
        .map(async (f) => JSON.parse(await readFile(join(evidenceDirectory(repoRoot), f), "utf8")))
    );
    return records as Evidence[];
  } catch {
    return [];
  }
}

/** Digest of an evidence set, so a ledger entry can reference it. */
export function evidenceDigest(records: readonly Evidence[]): string {
  const canonical = [...records]
    .sort((a, b) => a.checkId.localeCompare(b.checkId))
    .map((r) => `${r.checkId}:${r.passed}:${r.at}`)
    .join("|");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
