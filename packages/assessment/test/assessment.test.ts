import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DIMENSIONS, PROBES, assess } from "../src/index.ts";

/**
 * The instrument, tested against directories it did not come from.
 *
 * An assessment tool exercised only against the repository that contains it
 * proves that it agrees with itself. These use scratch directories so the
 * probes have to find, or fail to find, artefacts nobody arranged for them.
 */

test("every criterion belongs to a declared dimension", () => {
  for (const probe of PROBES) {
    assert.ok(
      DIMENSIONS.includes(probe.criterion.dimension),
      `${probe.criterion.id} has dimension ${probe.criterion.dimension}`
    );
  }
});

test("criterion ids are unique", () => {
  const ids = PROBES.map((p) => p.criterion.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("every criterion says what would satisfy it", () => {
  // A criterion a reader cannot act on is a score with no next step.
  for (const probe of PROBES) {
    assert.ok(probe.criterion.satisfiedBy.length > 30, `${probe.criterion.id} is too thin`);
  }
});

test("an empty directory reports no evidence, never failure", async () => {
  // Absence is not a defect. A new repository has no deployment evidence
  // because it has had no deployments.
  const empty = await mkdtemp(join(tmpdir(), "assess-empty-"));
  const results = await assess(empty);
  const all = results.flatMap((d) => d.criteria);

  assert.equal(all.filter((c) => c.state === "met").length, 0);
  assert.equal(all.filter((c) => c.state === "not_met").length, 0);
  assert.equal(all.filter((c) => c.state === "no_evidence").length, all.length);
});

test("artefacts placed in a scratch directory are found", async () => {
  const root = await mkdtemp(join(tmpdir(), "assess-some-"));
  await mkdir(join(root, "docs/adr"), { recursive: true });
  await writeFile(join(root, "docs/INVARIANTS.md"), "# properties\n");
  await writeFile(join(root, "docs/OPERATOR_RUNBOOK.md"), "# runbook\n");

  const results = await assess(root);
  const byId = new Map(results.flatMap((d) => d.criteria).map((c) => [c.criterion.id, c]));

  assert.equal(byId.get("GOV-1")?.state, "met");
  assert.equal(byId.get("DOC-1")?.state, "met");
  assert.equal(byId.get("DOC-2")?.state, "met");
  // Nothing was placed for these.
  assert.equal(byId.get("BEN-1")?.state, "no_evidence");
  assert.equal(byId.get("OPS-3")?.state, "no_evidence");
});

test("an empty falsification directory is not_met rather than no_evidence", async () => {
  // The distinction the instrument turns on: somebody built the mechanism and
  // recorded nothing with it, which is different from never having built it.
  const root = await mkdtemp(join(tmpdir(), "assess-fal-"));
  await mkdir(join(root, "docs/falsification"), { recursive: true });

  const results = await assess(root);
  const byId = new Map(results.flatMap((d) => d.criteria).map((c) => [c.criterion.id, c]));
  assert.equal(byId.get("FAL-1")?.state, "met");
  assert.equal(byId.get("FAL-2")?.state, "not_met");
});

test("a token number of falsification records does not satisfy the threshold", async () => {
  const root = await mkdtemp(join(tmpdir(), "assess-token-"));
  await mkdir(join(root, "docs/falsification"), { recursive: true });
  for (let i = 0; i < 3; i += 1) {
    await writeFile(join(root, `docs/falsification/r${i}.json`), "{}");
  }
  const results = await assess(root);
  const byId = new Map(results.flatMap((d) => d.criteria).map((c) => [c.criterion.id, c]));
  assert.equal(byId.get("FAL-2")?.state, "not_met");
});

test("the instrument discriminates between a bare and a furnished directory", async () => {
  const bare = await mkdtemp(join(tmpdir(), "assess-bare-"));
  const furnished = await mkdtemp(join(tmpdir(), "assess-full-"));
  await mkdir(join(furnished, "docs/adr"), { recursive: true });
  await mkdir(join(furnished, "datasets/x"), { recursive: true });
  await writeFile(join(furnished, "docs/INVARIANTS.md"), "#\n");

  const met = async (root: string) =>
    (await assess(root)).flatMap((d) => d.criteria).filter((c) => c.state === "met").length;

  assert.ok((await met(furnished)) > (await met(bare)));
});
