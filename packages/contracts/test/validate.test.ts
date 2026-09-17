import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CONTRACTS,
  defineContract,
  validateContracts,
  validateTables,
  type RepositoryContract,
} from "../src/index.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

const sound: RepositoryContract = defineContract({
  repository: "SoundRepository",
  module: "apps/web/src/lib/repositories/sound.ts",
  rationale:
    "A well-formed contract used to check that the validator accepts one, long enough to be reviewable by someone who did not write it.",
  tables: ["cases"],
  surfaces: ["Overview"],
  invariants: [],
  guarantees: [
    {
      id: "SD-G1",
      statement: "Every read is scoped to one organisation.",
      kind: "scoping",
      refuses:
        "a row belonging to another organisation appears in the result because scoping was applied in the panel rather than the query",
      provedBy: "sound_scoped",
    },
  ],
});

test("a well-formed contract has no defects", () => {
  assert.deepEqual(validateContracts([sound]), []);
});

test("a refusal that only restates the guarantee is rejected", () => {
  // The defect this catches is subtle and expensive: "is not organisation
  // scoped" gives a test author nothing to attempt, so what gets written is a
  // test that calls the method and asserts it returned an array. That passes
  // forever and proves nothing.
  const vague = defineContract({
    ...sound,
    guarantees: [{ ...sound.guarantees[0]!, refuses: "is not organisation scoped" }],
  });
  const defects = validateContracts([vague]);
  assert.equal(defects.length, 1);
  assert.match(defects[0]!.problem, /concrete failure/);
});

test("a guarantee with no proving check is a defect, not a status", () => {
  // It could never be honoured, so declaring it would quietly add permanent
  // debt that looks like work in progress.
  const unprovable = defineContract({
    ...sound,
    guarantees: [{ ...sound.guarantees[0]!, provedBy: "" }],
  });
  assert.match(validateContracts([unprovable])[0]!.problem, /names no proving check/);
});

test("two guarantees cannot share one proving check", () => {
  const shared = defineContract({
    ...sound,
    guarantees: [
      sound.guarantees[0]!,
      { ...sound.guarantees[0]!, id: "SD-G2", statement: "Something else entirely, at length." },
    ],
  });
  // One test proving two guarantees means one of them is not being measured —
  // whichever the test was not actually written for.
  assert.match(validateContracts([shared])[0]!.problem, /already claimed by/);
});

test("duplicate guarantee ids across contracts are caught", () => {
  const other = defineContract({
    ...sound,
    repository: "OtherRepository",
    module: "apps/web/src/lib/repositories/other.ts",
    guarantees: [{ ...sound.guarantees[0]!, provedBy: "other_scoped" }],
  });
  assert.match(validateContracts([sound, other])[0]!.problem, /duplicate guarantee id/);
});

test("a contract naming a table no migration creates is a defect", async () => {
  const wrong = defineContract({ ...sound, tables: ["deadlines", "invented_table"] });
  const defects = await validateTables(repoRoot, [wrong]);
  assert.equal(defects.length, 1);
  assert.match(defects[0]!.problem, /invented_table/);
});

test("every table the real contracts name is created by a migration", async () => {
  assert.deepEqual(await validateTables(repoRoot), []);
});

test("the real registry is structurally sound", () => {
  assert.deepEqual(validateContracts(), []);
});

test("every real guarantee names a distinct check", () => {
  const checks = CONTRACTS.flatMap((c) => c.guarantees.map((g) => g.provedBy));
  assert.equal(new Set(checks).size, checks.length);
});
