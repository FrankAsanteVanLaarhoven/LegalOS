import type { SourceRegistry } from "@legalos/knowledge";
import type { WorkflowResult } from "@legalos/rules";

import { extractCitations, normaliseCitation, type ExtractedCitation } from "./citations.ts";
import { REASON_CODES, specFor, type Severity } from "./codes.ts";

export interface Finding {
  readonly code: string;
  readonly severity: Severity;
  readonly title: string;
  readonly detail: string;
  /** The exact span of model output that triggered the finding, if any. */
  readonly evidence: string | null;
}

export type VerdictStatus = "pass" | "flag" | "block";

export interface Verdict {
  readonly status: VerdictStatus;
  readonly findings: readonly Finding[];
  readonly citations: readonly ExtractedCitation[];
  /** Citations that resolved to a usable registered source. */
  readonly resolvedCitations: readonly string[];
  /** True only when the text may be presented as legal output. */
  readonly releasable: boolean;
}

export interface VerifyInput {
  readonly text: string;
  readonly registry: SourceRegistry;
  /**
   * Deterministic outcome for the same question, when one exists. Used to catch
   * a model asserting eligibility that the rule engine does not support.
   */
  readonly ruleResult?: WorkflowResult;
}

interface PhrasePattern {
  readonly code: string;
  readonly regex: RegExp;
}

const PHRASE_PATTERNS: readonly PhrasePattern[] = [
  {
    code: "VER-005",
    regex:
      /\b(?:will (?:definitely |certainly )?(?:succeed|be granted|be approved|win)|guarantee[ds]?\b|you will get (?:your |a )?(?:visa|status|leave)|100% (?:certain|sure)|is certain to)\b/gi,
  },
  {
    code: "VER-006",
    regex:
      /\b(?:(?:do|does|don't|do not)\s*n?o?t?\s*need (?:a |an )?(?:solicitor|lawyer|barrister|adviser|representation)|no need (?:for|to instruct) (?:a )?(?:solicitor|lawyer|adviser)|without (?:a )?(?:solicitor|lawyer)\b)/gi,
  },
  {
    code: "VER-007",
    regex:
      /\b(?:confidence[:\s]+\d{1,3}\s*%|\d{1,3}\s*% (?:confiden(?:t|ce)|certain|likely|chance|probability)|probability of (?:success|approval))/gi,
  },
  {
    code: "VER-008",
    regex:
      /\b(?:you should (?:appeal|apply|submit|file)|submit (?:the |your )?(?:form|application|appeal)|file (?:the |your )?(?:appeal|application))\b/gi,
  },
];

const UNCERTAINTY_MARKERS =
  /\b(?:i (?:do not|don't) know|not verified|could not verify|unverified|check with|seek advice|may (?:not )?(?:be|apply)|subject to change|i cannot confirm)\b/i;

/** A cheap signal that the text is making legal assertions at all. */
const LEGAL_ASSERTION =
  /\b(?:eligible|ineligible|entitled|qualify|qualifies|requirement|immigration rules|leave to remain|visa|appeal|tribunal|lawful|unlawful)\b/i;

export function verify(input: VerifyInput): Verdict {
  const { text, registry, ruleResult } = input;
  const findings: Finding[] = [];

  if (text.trim().length === 0) {
    return {
      status: "block",
      findings: [finding("VER-009", "The model returned no text.", null)],
      citations: [],
      resolvedCitations: [],
      releasable: false,
    };
  }

  // 1. Every citation-shaped token must resolve to a usable source.
  const citations = extractCitations(text);
  const resolved: string[] = [];
  for (const citation of citations) {
    const match = findSource(registry, citation.text);
    if (!match) {
      findings.push(
        finding(
          "VER-001",
          `"${citation.text}" does not resolve to any registered legal source.`,
          citation.text
        )
      );
      continue;
    }
    const resolution = registry.resolve(match);
    if (!resolution.ok) {
      findings.push(
        finding(
          "VER-002",
          `"${citation.text}" resolves to ${match}, which is not usable (${resolution.failure}).`,
          citation.text
        )
      );
      continue;
    }
    resolved.push(match);
  }

  // 2. Legal assertions with no citation at all.
  if (citations.length === 0 && LEGAL_ASSERTION.test(text)) {
    findings.push(finding("VER-003", "Legal propositions were stated with no citation.", null));
  }

  // 3. Prohibited phrasings.
  for (const { code, regex } of PHRASE_PATTERNS) {
    regex.lastIndex = 0;
    for (const match of text.matchAll(regex)) {
      findings.push(finding(code, `Matched prohibited phrasing.`, match[0]));
    }
  }

  // 4. Disagreement with the deterministic engine.
  if (ruleResult) {
    const contradiction = contradictsEngine(text, ruleResult);
    if (contradiction) {
      findings.push(
        finding(
          "VER-004",
          `Text asserts ${contradiction} but the rule engine returned "${ruleResult.decision}" (releasable: ${ruleResult.releasable}).`,
          contradiction
        )
      );
    }
  }

  // 5. No acknowledgement of limits on a legal answer.
  if (LEGAL_ASSERTION.test(text) && !UNCERTAINTY_MARKERS.test(text)) {
    findings.push(
      finding(
        "VER-010",
        "No statement of what could not be verified accompanies the legal content.",
        null
      )
    );
  }

  const status = deriveStatus(findings);
  return {
    status,
    findings,
    citations,
    resolvedCitations: [...new Set(resolved)],
    releasable: status === "pass",
  };
}

function deriveStatus(findings: readonly Finding[]): VerdictStatus {
  if (findings.some((f) => f.severity === "block")) return "block";
  if (findings.length > 0) return "flag";
  return "pass";
}

function finding(code: string, detail: string, evidence: string | null): Finding {
  const spec = specFor(code);
  return {
    code: spec.code,
    severity: spec.severity,
    title: spec.title,
    detail,
    evidence,
  };
}

/**
 * Resolve a citation-shaped token to a registered source id by matching against
 * the source's citation and title. Deliberately conservative: no fuzzy matching,
 * because a near-miss on a rule number is exactly the failure being guarded.
 */
function findSource(registry: SourceRegistry, citationText: string): string | null {
  const needle = normaliseCitation(citationText);
  if (needle.length === 0) return null;
  for (const source of registry.list()) {
    const haystacks = [normaliseCitation(source.citation), normaliseCitation(source.title)];
    if (haystacks.some((h) => h.includes(needle))) return source.id;
  }
  return null;
}

/**
 * Looks for an eligibility assertion in the text that the engine does not
 * support. Only fires when the engine has an opinion the text contradicts.
 */
function contradictsEngine(text: string, result: WorkflowResult): string | null {
  const claimsEligible =
    /\b(?:you (?:are|will be) eligible|you qualify|you meet (?:all )?the requirements)\b/i;
  const claimsIneligible =
    /\b(?:you (?:are|will be) (?:not eligible|ineligible)|you do not qualify)\b/i;

  const eligibleMatch = claimsEligible.exec(text);
  if (eligibleMatch && result.decision !== "satisfied") return eligibleMatch[0];
  if (eligibleMatch && !result.releasable) return eligibleMatch[0];

  const ineligibleMatch = claimsIneligible.exec(text);
  if (ineligibleMatch && result.decision !== "not_satisfied") return ineligibleMatch[0];

  return null;
}

export { REASON_CODES };
