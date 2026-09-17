export {
  defineContract,
  GUARANTEE_KINDS,
  type Guarantee,
  type GuaranteeKind,
  type RepositoryContract,
  type RepositoryContractSpec,
} from "./guarantee.ts";

export {
  BLOCKING,
  breaches,
  evaluateAll,
  evaluateContract,
  evaluateGuarantee,
  GUARANTEE_PRECEDENCE,
  type ContractEnvironment,
  type ContractResult,
  type GuaranteeResult,
  type GuaranteeStatus,
} from "./evaluate.ts";

export { CONTRACTS } from "./registry.ts";
export { formatContracts } from "./report.ts";
export {
  validateContracts,
  validateInvariantRefs,
  validateTables,
  type ContractDefect,
} from "./validate.ts";
