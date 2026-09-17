import { CHECKS, MANIFEST_VERSION, REQUIRED_CHECKS, type ReadinessCheck } from "./manifest.ts";

/**
 * Structural validation of the readiness model.
 *
 * This is the tier that runs on every push and needs no secret. It does not ask
 * whether the deployment is ready; it asks whether the platform still knows how
 * to find out. Those are different questions, and only the second can be
 * answered on a contributor's laptop.
 */

export interface ReadinessDefect {
  readonly checkId: string;
  readonly problem: string;
}

const OWNERS = new Set(["platform_operator", "legal_review_board", "platform"]);
const TIERS = new Set(["structural", "environment", "deployment"]);

export function validateManifest(
  checks: readonly ReadinessCheck[] = CHECKS,
  required: readonly string[] = REQUIRED_CHECKS,
  version: number = MANIFEST_VERSION
): readonly ReadinessDefect[] {
  const defects: ReadinessDefect[] = [];
  const seen = new Set<string>();
  const ids = new Set(checks.map((c) => c.id));

  if (!Number.isInteger(version) || version < 1) {
    defects.push({ checkId: "manifest", problem: `invalid manifest version ${version}` });
  }

  for (const check of checks) {
    if (seen.has(check.id)) defects.push({ checkId: check.id, problem: "duplicate id" });
    seen.add(check.id);

    if (!OWNERS.has(check.owner)) {
      defects.push({ checkId: check.id, problem: `unknown owner ${check.owner}` });
    }
    if (!TIERS.has(check.tier)) {
      defects.push({ checkId: check.id, problem: `unknown tier ${check.tier}` });
    }
    if (check.remedy.trim().length < 20) {
      // A remedy that does not say what to do leaves an operator with a red
      // line and no next step.
      defects.push({ checkId: check.id, problem: "remedy too thin to act on" });
    }
    for (const dependency of check.dependsOn ?? []) {
      if (!ids.has(dependency)) {
        defects.push({ checkId: check.id, problem: `depends on unknown check ${dependency}` });
      }
    }
  }

  for (const id of required) {
    if (!ids.has(id)) {
      // The defect this manifest exists to catch: a required check removed by a
      // refactor, leaving the model quietly weaker than it was.
      defects.push({ checkId: id, problem: "required by the manifest but no longer defined" });
    }
  }

  for (const cycle of findCycles(checks)) {
    defects.push({ checkId: cycle[0] ?? "?", problem: `dependency cycle: ${cycle.join(" -> ")}` });
  }

  return defects;
}

function findCycles(checks: readonly ReadinessCheck[]): readonly (readonly string[])[] {
  const byId = new Map(checks.map((c) => [c.id, c] as const));
  const cycles: string[][] = [];
  const state = new Map<string, "visiting" | "done">();

  const walk = (id: string, path: string[]): void => {
    if (state.get(id) === "done") return;
    if (state.get(id) === "visiting") {
      cycles.push([...path.slice(path.indexOf(id)), id]);
      return;
    }
    state.set(id, "visiting");
    for (const dependency of byId.get(id)?.dependsOn ?? []) walk(dependency, [...path, id]);
    state.set(id, "done");
  };

  for (const check of checks) walk(check.id, []);
  return cycles;
}
