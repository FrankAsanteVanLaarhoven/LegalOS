import type { SourceRegistry } from "@legalos/knowledge";
import { hallucinationRate, type CitationJudgement } from "@legalos/reliability";
import { evaluateWorkflow, findWorkflow } from "@legalos/rules";
import { verify } from "@legalos/verification";

import type { BenchReport, BenchTask, CheckResult, SystemUnderTest, TaskResult } from "./types.ts";

export interface RunOptions {
  readonly registry: SourceRegistry;
}

export async function runBench(
  tasks: readonly BenchTask[],
  system: SystemUnderTest,
  options: RunOptions
): Promise<BenchReport> {
  const results: TaskResult[] = [];
  const judgements: CitationJudgement[] = [];

  for (const task of tasks) {
    const response = await system(task);
    const ruleResult =
      task.workflowId && task.facts
        ? evaluateWorkflow(findWorkflow(task.workflowId) ?? missing(task.workflowId), task.facts, {
            registry: options.registry,
          })
        : undefined;

    const verdict = verify({
      text: response.text,
      registry: options.registry,
      ...(ruleResult ? { ruleResult } : {}),
    });

    judgements.push({
      emitted: verdict.citations.map((c) => c.text),
      supported: verdict.resolvedCitations,
      required: task.expectation.requiredSourceIds ?? [],
    });

    const checks: CheckResult[] = [];
    const { expectation } = task;

    if (expectation.mustNotContain) {
      for (const phrase of expectation.mustNotContain) {
        const present = response.text.toLowerCase().includes(phrase.toLowerCase());
        checks.push({
          check: `must-not-contain:${phrase}`,
          passed: !present,
          detail: present ? `found "${phrase}"` : "absent",
        });
      }
    }

    if (expectation.requiredSourceIds) {
      for (const sourceId of expectation.requiredSourceIds) {
        const cited = verdict.resolvedCitations.includes(sourceId);
        checks.push({
          check: `must-cite:${sourceId}`,
          passed: cited,
          detail: cited ? "cited and resolved" : "not cited",
        });
      }
    }

    const raisedCodes = new Set(verdict.findings.map((f) => f.code));
    for (const code of expectation.requiredReasonCodes ?? []) {
      checks.push({
        check: `must-raise:${code}`,
        passed: raisedCodes.has(code),
        detail: raisedCodes.has(code) ? "raised" : "not raised",
      });
    }
    for (const code of expectation.forbiddenReasonCodes ?? []) {
      checks.push({
        check: `must-not-raise:${code}`,
        passed: !raisedCodes.has(code),
        detail: raisedCodes.has(code) ? "raised" : "not raised",
      });
    }

    if (expectation.expectRelease !== undefined) {
      // Release requires both halves: the text must survive verification AND,
      // where a workflow applies, the engine must be able to release a
      // conclusion. Either one alone is not enough to show a user.
      const released = verdict.releasable && (ruleResult?.releasable ?? true);
      checks.push({
        check: "release-decision",
        passed: released === expectation.expectRelease,
        detail: `released=${released} (verification=${verdict.releasable}, engine=${ruleResult?.releasable ?? "n/a"}), expected=${expectation.expectRelease}`,
      });
    }

    if (expectation.expectedDecision !== undefined) {
      checks.push({
        check: "rule-decision",
        passed: ruleResult?.decision === expectation.expectedDecision,
        detail: `decision=${ruleResult?.decision ?? "none"}, expected=${expectation.expectedDecision}`,
      });
    }

    for (const evidence of expectation.expectedMissingEvidence ?? []) {
      const identified = ruleResult?.missingEvidence.includes(evidence) ?? false;
      checks.push({
        check: `must-identify-missing:${evidence}`,
        passed: identified,
        detail: identified ? "identified" : "not identified",
      });
    }

    results.push({
      taskId: task.id,
      category: task.category,
      passed: checks.length > 0 && checks.every((c) => c.passed),
      checks,
    });
  }

  const byCategory: Record<string, { total: number; passed: number }> = {};
  for (const result of results) {
    const bucket = (byCategory[result.category] ??= { total: 0, passed: 0 });
    bucket.total += 1;
    if (result.passed) bucket.passed += 1;
  }

  const passed = results.filter((r) => r.passed).length;
  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    passRate: results.length === 0 ? null : passed / results.length,
    byCategory,
    results,
    hallucinationRate: hallucinationRate(judgements).value,
  };
}

function missing(workflowId: string): never {
  throw new Error(`bench task references unknown workflow: ${workflowId}`);
}

/** Compact human-readable summary for CI logs. */
export function formatReport(report: BenchReport): string {
  const lines = [
    `LegalOS Bench — ${report.passed}/${report.total} tasks passed` +
      (report.passRate === null ? "" : ` (${(report.passRate * 100).toFixed(1)}%)`),
    report.hallucinationRate === null
      ? "citation hallucination rate: n/a (no citations emitted)"
      : `citation hallucination rate: ${(report.hallucinationRate * 100).toFixed(1)}%`,
    "",
  ];
  for (const [category, bucket] of Object.entries(report.byCategory)) {
    lines.push(`  ${category}: ${bucket.passed}/${bucket.total}`);
  }
  const failures = report.results.filter((r) => !r.passed);
  if (failures.length > 0) {
    lines.push("", "Failures:");
    for (const failure of failures) {
      for (const check of failure.checks.filter((c) => !c.passed)) {
        lines.push(`  ${failure.taskId} — ${check.check}: ${check.detail}`);
      }
    }
  }
  return lines.join("\n");
}
