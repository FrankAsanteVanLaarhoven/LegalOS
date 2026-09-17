import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { createPlatformRegistry, evidenceRank, implementationRank } from "@legalos/capabilities";
import {
  evaluateAll,
  readFalsifications,
  selfObservations,
  withSelfObservations,
  type Falsification,
  type InvariantResult,
} from "@legalos/invariants";

import { currentObservations, platformStatus, repoRoot } from "./capabilities";

/**
 * Research artefacts, read from the repository at request time.
 *
 * Almost no platform exposes this, and the reason it belongs here is the
 * reason the rest of the architecture exists: a system asking to be trusted
 * should let a reader inspect the record of what it got wrong, not only the
 * record of what it does. The falsification list below is a catalogue of
 * checks that were once broken on purpose to prove they could fail.
 *
 * Everything is read rather than stored: the claims register, the falsification
 * records and the decision records are files in this repository, and a page
 * that cached them would be showing the state of a moment that has passed.
 */

export interface Claim {
  readonly claim: string;
  readonly type: "engineering" | "scientific" | "operational";
  readonly evidence: string;
  readonly supported: boolean;
}

export interface DecisionRecord {
  readonly id: string;
  readonly title: string;
  readonly status: string;
}

export interface ResearchArtefacts {
  readonly invariants: readonly InvariantResult[];
  readonly claims: readonly Claim[];
  readonly falsifications: readonly Falsification[];
  readonly decisions: readonly DecisionRecord[];
  /** Verification debt per capability: stated properties minus demonstrated. */
  readonly debt: readonly { capability: string; stated: number; satisfied: number }[];
}

async function readClaims(): Promise<readonly Claim[]> {
  const types = new Set(["engineering", "scientific", "operational"]);
  try {
    const text = await readFile(join(repoRoot, "docs/CLAIMS.md"), "utf8");
    const claims: Claim[] = [];
    for (const line of text.split("\n")) {
      const cells = line.split("|").map((cell) => cell.trim());
      if (cells.length < 6) continue;
      const [, claim, type, evidence, status] = cells;
      if (!type || !types.has(type)) continue;
      claims.push({
        claim: claim ?? "",
        type: type as Claim["type"],
        evidence: evidence ?? "",
        supported: status === "supported",
      });
    }
    return claims;
  } catch {
    return [];
  }
}

async function readDecisions(): Promise<readonly DecisionRecord[]> {
  try {
    const dir = join(repoRoot, "docs/adr");
    const names = (await readdir(dir)).filter((n) => n.endsWith(".md") && n !== "README.md");
    const records: DecisionRecord[] = [];
    for (const name of names.sort()) {
      const text = await readFile(join(dir, name), "utf8");
      const title = text.match(/^#\s+(.+)$/m)?.[1] ?? name;
      // Status is deliberately read from the document rather than inferred: an
      // ADR is Proposed until somebody with the authority accepts it, and
      // guessing would put an acceptance in the record that nobody made.
      const status = text.match(/\*\*Status:\*\*\s*([^\n—]+)/)?.[1]?.trim() ?? "unknown";
      records.push({ id: name.replace(/\.md$/, ""), title, status });
    }
    return records;
  } catch {
    return [];
  }
}

export async function researchArtefacts(): Promise<ResearchArtefacts> {
  const falsifications = await readFalsifications(repoRoot);
  const observations = await currentObservations();
  const capabilities = await platformStatus();
  const derived = selfObservations({ observations, falsifications, capabilities });
  const invariants = evaluateAll({
    observations: withSelfObservations(observations, derived),
    falsifications,
  });

  const byCapability = [...new Set(invariants.map((i) => i.capability))].sort();

  return {
    invariants,
    claims: await readClaims(),
    falsifications: [...falsifications.values()].sort((a, b) =>
      a.observationId.localeCompare(b.observationId)
    ),
    decisions: await readDecisions(),
    debt: byCapability.map((capability) => {
      const mine = invariants.filter((i) => i.capability === capability);
      return {
        capability,
        stated: mine.length,
        satisfied: mine.filter((i) => i.status === "satisfied").length,
      };
    }),
  };
}

/** Capability levels, so the research view can show what the ledger reports. */
export async function capabilityLevels(): Promise<
  readonly { id: string; implementation: string; evidence: string }[]
> {
  return createPlatformRegistry()
    .all(await currentObservations())
    .map((status) => ({
      id: status.id,
      implementation: status.implementation,
      evidence: status.evidence,
    }))
    .sort(
      (a, b) =>
        implementationRank(b.implementation as never) -
          implementationRank(a.implementation as never) ||
        evidenceRank(b.evidence as never) - evidenceRank(a.evidence as never)
    );
}
