import { CATEGORIES, SEVERITIES, EVIDENCE_KINDS, type Invariant } from "./invariant.ts";
import { INVARIANTS } from "./registry.ts";

/**
 * Structural validation of the registry.
 *
 * These are defects in the declarations themselves — a duplicate id, a
 * dependency on something that does not exist, a cycle, an invariant that no
 * evidence is permitted to raise. They are relational, so none is visible from
 * inside a single declaration, and all of them fail the build.
 *
 * Deliberately NOT here: whether an observation exists for each invariant. That
 * is reported as `no_observer` and counted, not treated as a build failure. A
 * registry that cannot express a property nobody has instrumented is a registry
 * that will be edited to hide them — the pressure to make CI green would be
 * relieved by deleting the invariant, which is the worst available outcome.
 */

export interface RegistryDefect {
  readonly invariantId: string;
  readonly problem: string;
}

export function validateRegistry(
  registry: readonly Invariant[] = INVARIANTS
): readonly RegistryDefect[] {
  const defects: RegistryDefect[] = [];
  const seen = new Set<string>();
  const ids = new Set(registry.map((i) => i.id));

  for (const inv of registry) {
    if (seen.has(inv.id)) defects.push({ invariantId: inv.id, problem: "duplicate id" });
    seen.add(inv.id);

    if (inv.observations.length === 0) {
      // The whole point of GV-000: a property with nothing to measure cannot be
      // stated in a way that could ever be satisfied.
      defects.push({ invariantId: inv.id, problem: "names no observation" });
    }
    if (new Set(inv.observations).size !== inv.observations.length) {
      defects.push({ invariantId: inv.id, problem: "names the same observation twice" });
    }
    if (!CATEGORIES.includes(inv.category)) {
      defects.push({ invariantId: inv.id, problem: `unknown category ${inv.category}` });
    }
    if (!SEVERITIES.includes(inv.severity)) {
      defects.push({ invariantId: inv.id, problem: `unknown severity ${inv.severity}` });
    }
    if (inv.rationale.trim().length < 40) {
      // A rationale short enough to be a restatement of the title explains
      // nothing to the person reviewing why this matters.
      defects.push({ invariantId: inv.id, problem: "rationale too thin to review" });
    }
    if (inv.evidenceKinds.length === 0) {
      defects.push({ invariantId: inv.id, problem: "declares no evidence kinds" });
    }
    if (inv.protects.length === 0) {
      defects.push({ invariantId: inv.id, problem: "names no code it protects" });
    }
    if (!inv.evidenceKinds.some((kind) => EVIDENCE_KINDS[kind]?.raises)) {
      // Every declared kind can only lower it, so no amount of passing evidence
      // could ever satisfy it. Almost always means `security` was listed alone.
      defects.push({
        invariantId: inv.id,
        problem: "no declared evidence kind may raise it, so it can never be satisfied",
      });
    }
    for (const dep of inv.dependsOn) {
      if (!ids.has(dep)) {
        defects.push({ invariantId: inv.id, problem: `depends on unknown invariant ${dep}` });
      }
    }
  }

  for (const cycle of findCycles(registry)) {
    defects.push({
      invariantId: cycle[0] ?? "?",
      problem: `dependency cycle: ${cycle.join(" -> ")}`,
    });
  }

  return defects;
}

/** Depth-first search for dependency cycles, which would not terminate. */
function findCycles(registry: readonly Invariant[]): readonly (readonly string[])[] {
  const byId = new Map(registry.map((i) => [i.id, i] as const));
  const cycles: string[][] = [];
  const state = new Map<string, "visiting" | "done">();

  const walk = (id: string, path: string[]): void => {
    if (state.get(id) === "done") return;
    if (state.get(id) === "visiting") {
      cycles.push([...path.slice(path.indexOf(id)), id]);
      return;
    }
    state.set(id, "visiting");
    for (const dep of byId.get(id)?.dependsOn ?? []) walk(dep, [...path, id]);
    state.set(id, "done");
  };

  for (const inv of registry) walk(inv.id, []);
  return cycles;
}

/**
 * Checks that every path an invariant claims to protect exists.
 *
 * Separate from `validateRegistry` because it touches the filesystem, and kept
 * a build failure because a traceability list that has gone stale is worse than
 * none: it is followed, and it sends the next person to a directory that was
 * renamed two milestones ago.
 */
export async function validateProtectedPaths(
  repoRoot: string,
  registry: readonly Invariant[] = INVARIANTS
): Promise<readonly RegistryDefect[]> {
  const { stat } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const defects: RegistryDefect[] = [];

  for (const inv of registry) {
    for (const path of inv.protects) {
      try {
        await stat(join(repoRoot, path));
      } catch {
        defects.push({
          invariantId: inv.id,
          problem: `protects a path that does not exist: ${path}`,
        });
      }
    }
  }
  return defects;
}
