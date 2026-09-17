import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Benchmark evidence for provider routing.
 *
 * The routing table used to be a hand-written preference order with a `basis`
 * string that said "unmeasured" — honest about itself, and still a ranking
 * nobody had established. This replaces it: a routing decision either cites a
 * benchmark report or it is not a ranking at all.
 *
 * A record is the same shape of artefact as an execution record and an evidence
 * record: it names its dataset and version, the commit it was produced at, how
 * many samples and repeats stand behind it, and when it stops counting. That
 * means a routing decision can be reproduced exactly as an execution can, which
 * keeps one evidence model across the platform rather than a second one here.
 */

export interface RoutingEvidence {
  /** Benchmark id, e.g. `BENCH-001`. */
  readonly benchmarkId: string;
  readonly capability: string;
  readonly datasetId: string;
  readonly datasetVersion: string;
  /** sha-256 of the dataset, so a silently edited dataset is detectable. */
  readonly datasetDigest: string;
  /** Commit the evaluation ran at. */
  readonly evaluationCommit: string | null;
  readonly producedAt: string;
  /** After this, the evidence stops supporting a routing decision. */
  readonly expiresAt: string;
  readonly samples: number;
  /** Independent repeats. One run is an anecdote, not a measurement. */
  readonly repeats: number;
  /** Score per provider id. Higher is better, within one capability only. */
  readonly scores: Readonly<Record<string, number>>;
  /** The environment this ran against. A change to it retires the record. */
  readonly environmentDigest?: string;
}

/**
 * What counts as the execution environment, for the purpose of retiring
 * evidence.
 *
 * Each of these changes what a model is actually asked, or which model answers.
 * A ranking measured before any of them changed describes a system that no
 * longer exists — and it reads exactly like a current one, which is why age
 * alone is the weaker half of expiry.
 */
export interface ExecutionEnvironment {
  readonly promptTemplateVersions: Readonly<Record<string, string>>;
  readonly guardrailVersion: string;
  readonly providerModels: Readonly<Record<string, string>>;
  readonly retrievalConfigVersion: string;
}

export function environmentDigest(environment: ExecutionEnvironment): string {
  const material = JSON.stringify({
    promptTemplateVersions: Object.fromEntries(
      Object.entries(environment.promptTemplateVersions).sort(([a], [b]) => (a < b ? -1 : 1))
    ),
    guardrailVersion: environment.guardrailVersion,
    providerModels: Object.fromEntries(
      Object.entries(environment.providerModels).sort(([a], [b]) => (a < b ? -1 : 1))
    ),
    retrievalConfigVersion: environment.retrievalConfigVersion,
  });
  return createHash("sha256").update(material, "utf8").digest("hex");
}

export function routingEvidenceDirectory(repoRoot: string): string {
  return join(repoRoot, "docs/benchmark-evidence");
}

/**
 * Reads every routing evidence record.
 *
 * Unreadable or malformed records are skipped rather than guessed at. A record
 * that cannot be parsed supports no routing decision, and the router's
 * behaviour with no evidence is already defined and safe.
 */
export async function readRoutingEvidence(repoRoot: string): Promise<readonly RoutingEvidence[]> {
  const dir = routingEvidenceDirectory(repoRoot);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }

  const found: RoutingEvidence[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const parsed = JSON.parse(await readFile(join(dir, name), "utf8")) as RoutingEvidence;
      if (
        typeof parsed.capability === "string" &&
        typeof parsed.expiresAt === "string" &&
        parsed.scores &&
        typeof parsed.scores === "object"
      ) {
        found.push(parsed);
      }
    } catch {
      // Not evidence.
    }
  }
  return found;
}

/** Whether a record still supports a decision, at a given moment. */
export function isCurrent(evidence: RoutingEvidence, now: number): boolean {
  const expires = Date.parse(evidence.expiresAt);
  return !Number.isNaN(expires) && expires > now;
}

/** The minimum standing behind evidence before it may rank one provider above another. */
export const MINIMUM_SAMPLES = 100;
export const MINIMUM_REPEATS = 3;

/**
 * Whether a record is strong enough to rank providers.
 *
 * A single run over a handful of samples is an anecdote. Ranking a provider on
 * one would put a number in the routing table that reads exactly like a
 * measured one.
 */
export function isAdequate(evidence: RoutingEvidence): boolean {
  return evidence.samples >= MINIMUM_SAMPLES && evidence.repeats >= MINIMUM_REPEATS;
}
