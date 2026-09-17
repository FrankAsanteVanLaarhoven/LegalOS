import type { Guarantee, RepositoryContract } from "./guarantee.ts";

/**
 * Evaluating a contract against the repository that is meant to provide it.
 *
 * Five outcomes. The one that matters is `unimplemented`, which exists so that
 * contracts can be written *before* the code — which is the only order in which
 * a contract constrains anything. Written afterwards it describes what the code
 * happens to do, and a description of the implementation cannot be violated by
 * the implementation.
 */
export type GuaranteeStatus =
  /** The proving check ran and reported false. */
  | "failed"
  /** The module exists and this guarantee names no proving check. */
  | "no_observer"
  /** The module exists, a check is named, and there is no current evidence. */
  | "unproven"
  /** The module does not exist yet. Expected, and not a defect. */
  | "unimplemented"
  /** A check attempted the failure this guarantee names, and it was refused. */
  | "honoured";

/**
 * Precedence, worst first.
 *
 * `no_observer` and `unproven` both mean live code nobody has verified, and
 * both outrank `unimplemented` by a long way: unwritten code cannot mislead
 * anyone, whereas a repository in use whose guarantees were never tested is
 * exactly the state a panel will be built on top of. `no_observer` sits above
 * `unproven` because naming no check at all is a decision, while missing
 * evidence is often just a suite that has not been run.
 */
export const GUARANTEE_PRECEDENCE: readonly GuaranteeStatus[] = [
  "failed",
  "no_observer",
  "unproven",
  "unimplemented",
  "honoured",
];

/** Statuses that mean the repository is in use and something is unverified. */
export const BLOCKING: readonly GuaranteeStatus[] = ["failed", "no_observer", "unproven"];

export interface GuaranteeResult {
  readonly id: string;
  readonly repository: string;
  readonly statement: string;
  readonly kind: Guarantee["kind"];
  readonly status: GuaranteeStatus;
  readonly nextAction: string;
}

export interface ContractResult {
  readonly repository: string;
  readonly module: string;
  readonly implemented: boolean;
  readonly guarantees: readonly GuaranteeResult[];
  readonly status: GuaranteeStatus;
}

/** What the evaluator needs to know about the world. Injected, so it is testable. */
export interface ContractEnvironment {
  /** Whether the repository module exists. */
  moduleExists(path: string): boolean;
  /** Current evidence for a check: true held, false failed, null nothing current. */
  evidenceFor(checkId: string): boolean | null;
}

export function evaluateGuarantee(
  contract: RepositoryContract,
  guarantee: Guarantee,
  env: ContractEnvironment
): GuaranteeResult {
  const base = {
    id: guarantee.id,
    repository: contract.repository,
    statement: guarantee.statement,
    kind: guarantee.kind,
  };

  // Checked before anything else. A contract for code that does not exist is a
  // specification, and a specification cannot be in breach.
  if (!env.moduleExists(contract.module)) {
    return {
      ...base,
      status: "unimplemented",
      nextAction: `Write ${contract.module}, then prove ${guarantee.id} with ${guarantee.provedBy || "a check"}.`,
    };
  }

  if (!guarantee.provedBy) {
    return {
      ...base,
      status: "no_observer",
      nextAction: `${contract.module} exists and ${guarantee.id} names no proving check. Write a test that attempts: ${guarantee.refuses}`,
    };
  }

  const evidence = env.evidenceFor(guarantee.provedBy);
  if (evidence === false) {
    return {
      ...base,
      status: "failed",
      nextAction: `${guarantee.provedBy} reported false. The repository permits: ${guarantee.refuses}`,
    };
  }
  if (evidence === null) {
    return {
      ...base,
      status: "unproven",
      nextAction: `${contract.module} is in use and ${guarantee.provedBy} has no current evidence. Run the integration suite against TEST_DATABASE_URL.`,
    };
  }

  return { ...base, status: "honoured", nextAction: "Proved by attempting the failure it names." };
}

const worst = (statuses: readonly GuaranteeStatus[]): GuaranteeStatus =>
  GUARANTEE_PRECEDENCE.find((candidate) => statuses.includes(candidate)) ?? "honoured";

export function evaluateContract(
  contract: RepositoryContract,
  env: ContractEnvironment
): ContractResult {
  const guarantees = contract.guarantees.map((g) => evaluateGuarantee(contract, g, env));
  return {
    repository: contract.repository,
    module: contract.module,
    implemented: env.moduleExists(contract.module),
    guarantees,
    status: worst(guarantees.map((g) => g.status)),
  };
}

export function evaluateAll(
  contracts: readonly RepositoryContract[],
  env: ContractEnvironment
): readonly ContractResult[] {
  return contracts.map((c) => evaluateContract(c, env));
}

/**
 * The build rule.
 *
 * An unimplemented contract never fails: writing contracts ahead of code is the
 * point, and a gate that punished it would push everyone into writing them
 * afterwards, where they are worthless. Everything else fails, because every
 * other state means a module that callers can already import and something
 * about it that nobody has demonstrated.
 */
export function breaches(results: readonly ContractResult[]): readonly GuaranteeResult[] {
  return results.flatMap((r) => r.guarantees.filter((g) => BLOCKING.includes(g.status)));
}
