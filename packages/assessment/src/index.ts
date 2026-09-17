import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * Research-engineering assessment.
 *
 * A reproducible way to ask what a software platform can *evidence* about
 * itself, applicable to any repository rather than to this one. Nothing here
 * imports LegalOS: every probe looks for artefacts a project might plausibly
 * have, and reports their absence as absence rather than as failure.
 *
 * Three decisions shape it, and each is a constraint on what it may claim.
 *
 * **No overall score.** A weighted total invites a platform to raise one
 * dimension to compensate for another, and the dimensions are not commensurable
 * — provenance and documentation do not trade off. The output is a scorecard,
 * and a reader who wants a single number has to choose which dimension they
 * care about, which is the honest position anyway.
 *
 * **Absence is not failure.** `no_evidence` is distinct from `not_met`. A
 * repository with no deployment evidence may have no deployments; one with a
 * broken audit chain has a defect. Collapsing the two would make every young
 * project look negligent and every incomplete probe look conclusive.
 *
 * **The obvious threat is named rather than managed.** This was written by the
 * author of one of the systems it assesses, and the dimensions are ones that
 * system was built around. That is a real bias and it cannot be engineered
 * away; what can be done is to state it, publish the probes so anyone can
 * disagree with them, and include dimensions where the authoring system scores
 * badly. If LegalOS scored well on all eight, the instrument would be worthless.
 */

export type CriterionState = "met" | "not_met" | "no_evidence";

export interface Criterion {
  readonly id: string;
  readonly dimension: Dimension;
  readonly question: string;
  /** What would satisfy it, in terms another project could act on. */
  readonly satisfiedBy: string;
}

export type Dimension =
  | "provenance"
  | "auditability"
  | "governance"
  | "reproducibility"
  | "falsifiability"
  | "operational_readiness"
  | "documentation"
  | "benchmarking";

export const DIMENSIONS: readonly Dimension[] = [
  "provenance",
  "auditability",
  "governance",
  "reproducibility",
  "falsifiability",
  "operational_readiness",
  "documentation",
  "benchmarking",
];

export interface CriterionResult {
  readonly criterion: Criterion;
  readonly state: CriterionState;
  /** The artefact found, or what was looked for and not found. */
  readonly evidence: string;
}

export interface DimensionResult {
  readonly dimension: Dimension;
  readonly met: number;
  readonly notMet: number;
  readonly noEvidence: number;
  readonly criteria: readonly CriterionResult[];
}

/* ------------------------------------------------------------------ */
/* Probes                                                              */
/* ------------------------------------------------------------------ */

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function countFiles(dir: string, suffix = ".json"): Promise<number> {
  try {
    return (await readdir(dir)).filter((f) => f.endsWith(suffix)).length;
  } catch {
    return -1;
  }
}

/** Searches source for a pattern, bounded so this stays cheap on any repo. */
async function sourceMatches(root: string, pattern: RegExp, limit = 4_000): Promise<number> {
  let seen = 0;
  let matched = 0;

  const walk = async (dir: string): Promise<void> => {
    if (seen >= limit) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (seen >= limit) return;
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".next")
        continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else if (/\.(ts|tsx|js|mjs|sql|py|go|rs)$/.test(entry.name)) {
        seen += 1;
        try {
          if (pattern.test(await readFile(path, "utf8"))) matched += 1;
        } catch {
          // Unreadable file; not evidence either way.
        }
      }
    }
  };

  await walk(root);
  return matched;
}

interface Probe {
  readonly criterion: Criterion;
  run(root: string): Promise<{ state: CriterionState; evidence: string }>;
}

const criterion = (
  id: string,
  dimension: Dimension,
  question: string,
  satisfiedBy: string
): Criterion => ({ id, dimension, question, satisfiedBy });

function fileProbe(c: Criterion, candidates: readonly string[], what: string): Probe {
  return {
    criterion: c,
    async run(root) {
      for (const candidate of candidates) {
        if (await exists(join(root, candidate))) {
          return { state: "met", evidence: candidate };
        }
      }
      return { state: "no_evidence", evidence: `no ${what} found` };
    },
  };
}

function patternProbe(c: Criterion, pattern: RegExp, what: string): Probe {
  return {
    criterion: c,
    async run(root) {
      const matches = await sourceMatches(root, pattern);
      return matches > 0
        ? { state: "met", evidence: `${matches} file(s) matching ${what}` }
        : { state: "no_evidence", evidence: `no source matching ${what}` };
    },
  };
}

export const PROBES: readonly Probe[] = [
  // ---- Provenance ----
  patternProbe(
    criterion(
      "PRV-1",
      "provenance",
      "Is the model request recorded before the call is made?",
      "An execution record written prior to invoking a provider, so failures and timeouts are recorded too"
    ),
    /before the provider is (called|reachable)|record.*before.*provider/i,
    "a record-before-call ordering"
  ),
  patternProbe(
    criterion(
      "PRV-2",
      "provenance",
      "Is retrieval captured as a snapshot rather than reconstructed?",
      "A stored snapshot of what was retrieved, hashed and referenced by the execution"
    ),
    /retrieval_snapshot|retrievalSnapshot/,
    "a retrieval snapshot"
  ),
  patternProbe(
    criterion(
      "PRV-3",
      "provenance",
      "Is the model that answered distinguished from the one requested?",
      "Separate requested and resolved model identifiers on the record"
    ),
    /resolved_model|resolvedModel/,
    "a resolved-model field"
  ),

  // ---- Auditability ----
  patternProbe(
    criterion(
      "AUD-1",
      "auditability",
      "Is the audit record append-only at the storage layer?",
      "A database constraint or trigger refusing update and delete, not application discipline"
    ),
    /append[- ]only/i,
    "an append-only constraint"
  ),
  patternProbe(
    criterion(
      "AUD-2",
      "auditability",
      "Is the audit record verified by recomputation?",
      "A verify step recomputing hashes from content rather than comparing stored values"
    ),
    /prev_hash|previousHash|hash chain|hash-linked/i,
    "a hash chain"
  ),
  patternProbe(
    criterion(
      "AUD-3",
      "auditability",
      "Can personal data be erased without invalidating the record?",
      "Tombstoning that removes content while preserving what verification depends on"
    ),
    /tombstone/i,
    "a tombstone mechanism"
  ),

  // ---- Governance ----
  fileProbe(
    criterion(
      "GOV-1",
      "governance",
      "Are system properties declared somewhere a reader can enumerate them?",
      "A registry of invariants, properties or guarantees, separate from the code implementing them"
    ),
    ["docs/INVARIANTS.md", "INVARIANTS.md", "docs/invariants", "docs/properties.md"],
    "an invariant or property registry"
  ),
  patternProbe(
    criterion(
      "GOV-2",
      "governance",
      "Is capability or maturity status derived rather than declared?",
      "Status computed from measurements at read time, with no field an author can raise"
    ),
    /derived from (measurement|observation)|observ(ation|ed).*rather than declar/i,
    "derived status"
  ),
  patternProbe(
    criterion(
      "GOV-3",
      "governance",
      "Does an unmeasurable check fail closed?",
      "An explicit unavailable or not-measurable state that does not read as a pass"
    ),
    /fail(s)? closed|not_measurable|unavailable\(/,
    "a fail-closed unmeasurable state"
  ),

  // ---- Reproducibility ----
  patternProbe(
    criterion(
      "REP-1",
      "reproducibility",
      "Can an execution's inputs be reconstructed from stored artefacts?",
      "A replay path resolving prompt, retrieval and configuration from versioned records"
    ),
    /\breplay\b/i,
    "a replay path"
  ),
  patternProbe(
    criterion(
      "REP-2",
      "reproducibility",
      "Are prompt and configuration versions recorded per execution?",
      "Template version, guardrail version and model version stored with the call"
    ),
    /prompt_template_version|promptTemplateVersion|guardrail_version|guardrailVersion/,
    "versioned prompt or guardrail identifiers"
  ),
  patternProbe(
    criterion(
      "REP-3",
      "reproducibility",
      "Is the limit of reproducibility stated?",
      "An explicit statement of what cannot be reproduced, such as model non-determinism"
    ),
    /not re-?run the model|non-?deterministic|does not re-?run/i,
    "a stated reproducibility limit"
  ),

  // ---- Falsifiability ----
  fileProbe(
    criterion(
      "FAL-1",
      "falsifiability",
      "Is there a record of checks demonstrated capable of failing?",
      "Mutation records naming what was broken and what the check then reported"
    ),
    ["docs/falsification", "docs/mutations", "mutation-records"],
    "falsification records"
  ),
  {
    criterion: criterion(
      "FAL-2",
      "falsifiability",
      "Do falsification records cover a meaningful share of checks?",
      "More than a token number of observations demonstrated capable of reporting false"
    ),
    async run(root) {
      const count = await countFiles(join(root, "docs/falsification"));
      if (count < 0) return { state: "no_evidence", evidence: "no falsification directory" };
      if (count === 0) return { state: "not_met", evidence: "directory present but empty" };
      return {
        state: count >= 5 ? "met" : "not_met",
        evidence: `${count} record(s); 5 is the threshold for more than a token`,
      };
    },
  },
  patternProbe(
    criterion(
      "FAL-3",
      "falsifiability",
      "Does evidence expire or become superseded?",
      "A freshness window or environment binding, so stale evidence stops counting"
    ),
    /FRESHNESS|expiresAt|expires_at|superseded/i,
    "an evidence expiry"
  ),

  // ---- Operational readiness ----
  fileProbe(
    criterion(
      "OPS-1",
      "operational_readiness",
      "Are deployment prerequisites measured rather than listed?",
      "A runnable check reporting which prerequisites are satisfied"
    ),
    ["scripts/check-readiness.mjs", "scripts/readiness.mjs", "scripts/check-readiness.ts"],
    "a readiness check"
  ),
  patternProbe(
    criterion(
      "OPS-2",
      "operational_readiness",
      "Is there a health endpoint reporting dependency state?",
      "An endpoint distinguishing degraded from down, without disclosing versions"
    ),
    /health/i,
    "a health endpoint"
  ),
  {
    criterion: criterion(
      "OPS-3",
      "operational_readiness",
      "Has the platform actually been deployed?",
      "Release evidence recording a deployment that happened"
    ),
    async run(root) {
      const count = await countFiles(join(root, "docs/release-evidence"));
      return count > 0
        ? { state: "met", evidence: `${count} release record(s)` }
        : {
            state: "no_evidence",
            evidence: "no release evidence; the platform may never have been deployed",
          };
    },
  },

  // ---- Documentation ----
  fileProbe(
    criterion(
      "DOC-1",
      "documentation",
      "Are architecture decisions recorded with alternatives?",
      "ADRs stating what was rejected and why, not only what was chosen"
    ),
    ["docs/adr", "docs/decisions", "adr"],
    "architecture decision records"
  ),
  fileProbe(
    criterion(
      "DOC-2",
      "documentation",
      "Is there an operator-facing deployment document?",
      "A runbook naming what an operator must supply and who owns it"
    ),
    ["docs/OPERATOR_RUNBOOK.md", "docs/RUNBOOK.md", "RUNBOOK.md", "docs/operations.md"],
    "an operator runbook"
  ),
  patternProbe(
    criterion(
      "DOC-3",
      "documentation",
      "Are documented figures checked against the system?",
      "A gate recomputing stated numbers and failing on drift"
    ),
    /check-docs|documentation (figures|drift)/i,
    "a documentation drift check"
  ),

  // ---- Benchmarking ----
  {
    criterion: criterion(
      "BEN-1",
      "benchmarking",
      "Is there a versioned evaluation dataset with ground truth?",
      "A dataset with a manifest, digest and recorded reviewer approval"
    ),
    async run(root) {
      const count = await countFiles(join(root, "datasets"), "");
      return count > 0
        ? { state: "met", evidence: `${count} dataset(s)` }
        : { state: "no_evidence", evidence: "no dataset directory" };
    },
  },
  patternProbe(
    criterion(
      "BEN-2",
      "benchmarking",
      "Is dataset integrity verified rather than assumed?",
      "A digest over sample content, recomputed rather than read from a manifest"
    ),
    /digestSamples|dataset.*digest|verifyDataset/i,
    "dataset digest verification"
  ),
  {
    criterion: criterion(
      "BEN-3",
      "benchmarking",
      "Have benchmark results been produced?",
      "Evidence records carrying scores, sample counts and repeats"
    ),
    async run(root) {
      const count = await countFiles(join(root, "docs/benchmark-evidence"));
      return count > 0
        ? { state: "met", evidence: `${count} benchmark record(s)` }
        : { state: "no_evidence", evidence: "no benchmark evidence; nothing has been evaluated" };
    },
  },
];

export async function assess(root: string): Promise<readonly DimensionResult[]> {
  const results: CriterionResult[] = [];
  for (const probe of PROBES) {
    const outcome = await probe.run(root);
    results.push({ criterion: probe.criterion, ...outcome });
  }

  return DIMENSIONS.map((dimension) => {
    const criteria = results.filter((r) => r.criterion.dimension === dimension);
    return {
      dimension,
      met: criteria.filter((c) => c.state === "met").length,
      notMet: criteria.filter((c) => c.state === "not_met").length,
      noEvidence: criteria.filter((c) => c.state === "no_evidence").length,
      criteria,
    };
  });
}
