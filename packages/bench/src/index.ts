/**
 * @legalos/bench — LegalOS Bench.
 *
 * A benchmark the platform is scored against continuously, rather than a claim
 * that it performs well. The system under test is injected, so the same suite
 * scores the live product, an offline fixture, or a candidate model.
 */

export { runBench, formatReport, type RunOptions } from "./runner.ts";
export { BENCH_TASKS } from "./tasks.ts";
export type {
  BenchReport,
  BenchTask,
  CheckResult,
  Expectation,
  SystemResponse,
  SystemUnderTest,
  TaskCategory,
  TaskResult,
} from "./types.ts";

export {
  environmentDigest,
  readRoutingEvidence,
  routingEvidenceDirectory,
  isCurrent,
  isAdequate,
  MINIMUM_SAMPLES as BENCH_MINIMUM_SAMPLES,
  MINIMUM_REPEATS as BENCH_MINIMUM_REPEATS,
  type RoutingEvidence,
  type ExecutionEnvironment,
} from "./routing-evidence.ts";

export {
  digestSamples,
  verifyDataset,
  readDatasets,
  datasetDirectory,
  MINIMUM_REVIEWERS,
  type DatasetSample,
  type DatasetManifest,
  type DatasetDefect,
  type SampleProvenance,
} from "./dataset.ts";
