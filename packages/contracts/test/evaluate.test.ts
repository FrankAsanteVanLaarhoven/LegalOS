import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BLOCKING,
  breaches,
  CONTRACTS,
  defineContract,
  evaluateAll,
  evaluateContract,
  GUARANTEE_PRECEDENCE,
  type ContractEnvironment,
  type GuaranteeStatus,
} from "../src/index.ts";

/**
 * The evaluator, driven through every verdict it can reach.
 *
 * The same discipline the falsification records apply to observations: a
 * checker only ever seen returning one answer is indistinguishable from one
 * that cannot return the others. Every status below is produced deliberately,
 * including the two that fail the build.
 */

const contract = defineContract({
  repository: "ExampleRepository",
  module: "apps/web/src/lib/repositories/example.ts",
  rationale:
    "A fixture used to exercise the evaluator, long enough to satisfy the structural rule about rationales being reviewable.",
  tables: ["cases"],
  surfaces: ["Overview"],
  invariants: [],
  guarantees: [
    {
      id: "EX-G1",
      statement: "Every read is scoped to one organisation.",
      kind: "scoping",
      refuses:
        "a row belonging to another organisation appears in the result because scoping was applied in the panel rather than the query",
      provedBy: "example_scoped",
    },
  ],
});

const env = (over: Partial<ContractEnvironment> = {}): ContractEnvironment => ({
  moduleExists: () => true,
  evidenceFor: () => true,
  ...over,
});

const statusOf = (e: ContractEnvironment): GuaranteeStatus =>
  evaluateContract(contract, e).guarantees[0]!.status;

test("a contract for code that does not exist is unimplemented, not in breach", () => {
  // Writing contracts before the code is the only order in which a contract
  // constrains anything. A gate that punished it would push everyone into
  // writing them afterwards, where they describe the implementation instead.
  const result = evaluateContract(contract, env({ moduleExists: () => false }));
  assert.equal(result.status, "unimplemented");
  assert.equal(breaches([result]).length, 0);
});

test("the module existing turns an unproven guarantee into a breach", () => {
  // The whole point of the layer. The moment callers can import it, everything
  // it promises has to have been demonstrated.
  const result = evaluateContract(contract, env({ evidenceFor: () => null }));
  assert.equal(result.status, "unproven");
  assert.equal(breaches([result]).length, 1);
});

test("a guarantee naming no proving check reports no_observer once implemented", () => {
  const unprovable = defineContract({
    ...contract,
    guarantees: [{ ...contract.guarantees[0]!, provedBy: "" }],
  });
  const result = evaluateContract(unprovable, env());
  assert.equal(result.guarantees[0]!.status, "no_observer");
  assert.equal(breaches([result]).length, 1);
});

test("a proving check reporting false is a failure, not an absence", () => {
  const result = evaluateContract(contract, env({ evidenceFor: () => false }));
  assert.equal(result.status, "failed");
  assert.match(result.guarantees[0]!.nextAction, /The repository permits/);
});

test("a guarantee is honoured only when its check attempted the failure and it was refused", () => {
  assert.equal(statusOf(env()), "honoured");
  assert.equal(breaches([evaluateContract(contract, env())]).length, 0);
});

test("every reachable status is reachable", () => {
  // Stated as a test so a status cannot be added to the type and left
  // unreachable, which is how a vocabulary drifts away from what the code does.
  const reached = new Set<GuaranteeStatus>([
    statusOf(env({ moduleExists: () => false })),
    statusOf(env({ evidenceFor: () => null })),
    statusOf(env({ evidenceFor: () => false })),
    statusOf(env()),
    evaluateContract(
      defineContract({ ...contract, guarantees: [{ ...contract.guarantees[0]!, provedBy: "" }] }),
      env()
    ).guarantees[0]!.status,
  ]);
  assert.deepEqual([...reached].sort(), [...GUARANTEE_PRECEDENCE].sort());
});

test("a contract takes the worst status among its guarantees", () => {
  const mixed = defineContract({
    ...contract,
    guarantees: [
      { ...contract.guarantees[0]!, id: "EX-G1", provedBy: "proved" },
      { ...contract.guarantees[0]!, id: "EX-G2", provedBy: "unproved" },
    ],
  });
  const result = evaluateContract(
    mixed,
    env({ evidenceFor: (id) => (id === "proved" ? true : null) })
  );
  // One honoured guarantee does not make a repository trustworthy; the caller
  // relies on all of them.
  assert.equal(result.status, "unproven");
});

test("precedence puts unverified live code above unwritten code", () => {
  const rank = (s: GuaranteeStatus) => GUARANTEE_PRECEDENCE.indexOf(s);
  assert.ok(rank("failed") < rank("no_observer"));
  assert.ok(rank("no_observer") < rank("unproven"));
  assert.ok(rank("unproven") < rank("unimplemented"));
  assert.ok(rank("unimplemented") < rank("honoured"));
  assert.deepEqual([...BLOCKING], ["failed", "no_observer", "unproven"]);
});

test("the real registry is entirely unimplemented, and says so", () => {
  // Recorded rather than asserted informally. When the first repository lands
  // this test fails, which is the correct moment to look at the report again.
  const results = evaluateAll(CONTRACTS, env({ moduleExists: () => false }));
  assert.ok(results.every((r) => r.status === "unimplemented"));
  assert.equal(breaches(results).length, 0);
});
