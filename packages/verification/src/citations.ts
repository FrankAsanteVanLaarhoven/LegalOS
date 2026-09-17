/**
 * Citation extraction.
 *
 * The point is not to parse law perfectly. It is to notice that the model has
 * emitted something *shaped like* an authority — "paragraph 276ADE",
 * "[2002] UKIAT 00702", "Appendix FM" — so that every such token can be forced
 * to resolve against the source registry. A citation-shaped token that does not
 * resolve is indistinguishable from a fabricated one and is treated as such.
 */

export type CitationKind =
  | "immigration_rule_paragraph"
  | "appendix"
  | "statute"
  | "statutory_instrument"
  | "section"
  | "neutral_citation"
  | "procedure_rule";

export interface ExtractedCitation {
  readonly kind: CitationKind;
  readonly text: string;
  readonly index: number;
}

interface Pattern {
  readonly kind: CitationKind;
  readonly regex: RegExp;
}

const PATTERNS: readonly Pattern[] = [
  // "paragraph 276ADE", "para. 320(7A)", "paragraph 276ADE(1)(vi)"
  {
    kind: "immigration_rule_paragraph",
    regex: /\bpara(?:graph|\.)?\s+\d+[A-Z]{0,4}(?:\([0-9A-Za-z]{1,5}\))*/gi,
  },
  // "Appendix FM", "Appendix Skilled Worker"
  {
    kind: "appendix",
    regex: /\bAppendix\s+(?:[A-Z]{2,}|[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})/g,
  },
  // "Immigration Act 1971", "Modern Slavery Act 2015"
  {
    kind: "statute",
    regex: /\b(?:[A-Z][A-Za-z']+\s+){1,6}Act\s+\d{4}\b/g,
  },
  // "S.I. 2014/2604", "SI 2014/2604"
  {
    kind: "statutory_instrument",
    regex: /\bS\.?I\.?\s+\d{4}\/\d+\b/g,
  },
  // "section 3C", "s. 117B"
  {
    kind: "section",
    regex: /\b(?:section|s\.)\s*\d+[A-Z]{0,3}\b/gi,
  },
  // "[2002] UKIAT 00702", "[2019] UKSC 3"
  {
    kind: "neutral_citation",
    regex: /\[\d{4}\]\s+[A-Z]{2,10}(?:\s+(?:Civ|Admin|IAC))?\s+\d+/g,
  },
  // "rule 24 of the Tribunal Procedure Rules"
  {
    kind: "procedure_rule",
    regex: /\brule\s+\d+[A-Z]{0,3}\b/gi,
  },
];

/**
 * Leading words the statute pattern would otherwise absorb — "The Immigration
 * Act 1971" must resolve against a registry entry titled "Immigration Act 1971".
 */
const LEADING_STOPWORDS =
  /^(?:the|a|an|this|that|these|those|under|in|of|and|but|if|when|where|see|per)\s+/i;

export function extractCitations(text: string): readonly ExtractedCitation[] {
  const found: ExtractedCitation[] = [];
  for (const { kind, regex } of PATTERNS) {
    // Each pattern carries /g, so reset lastIndex before reuse.
    regex.lastIndex = 0;
    for (const match of text.matchAll(regex)) {
      if (match.index === undefined) continue;
      found.push(trimLeadingStopwords({ kind, text: match[0].trim(), index: match.index }));
    }
  }
  return dedupeOverlapping(found);
}

function trimLeadingStopwords(citation: ExtractedCitation): ExtractedCitation {
  let { text, index } = citation;
  let stripped = LEADING_STOPWORDS.exec(text);
  while (stripped) {
    const width = stripped[0].length;
    text = text.slice(width);
    index += width;
    stripped = LEADING_STOPWORDS.exec(text);
  }
  return { kind: citation.kind, text, index };
}

/**
 * "Immigration Act 1971" also matches the `section` pattern's neighbourhood and
 * "Appendix Skilled Worker" can be caught twice. Prefer the longest match at any
 * overlapping span so one authority is reported once.
 */
function dedupeOverlapping(citations: readonly ExtractedCitation[]): readonly ExtractedCitation[] {
  const sorted = [...citations].sort((a, b) =>
    a.index === b.index ? b.text.length - a.text.length : a.index - b.index
  );
  const kept: ExtractedCitation[] = [];
  for (const candidate of sorted) {
    const end = candidate.index + candidate.text.length;
    const overlaps = kept.some((existing) => {
      const existingEnd = existing.index + existing.text.length;
      return candidate.index < existingEnd && existing.index < end;
    });
    if (!overlaps) kept.push(candidate);
  }
  return kept.sort((a, b) => a.index - b.index);
}

/** Normalises a citation for comparison against registry titles and citations. */
export function normaliseCitation(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,]/g, "")
    .replace(/\bparagraph\b/g, "para")
    .replace(/\s+/g, " ")
    .trim();
}
