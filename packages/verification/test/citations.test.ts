import { test } from "node:test";
import assert from "node:assert/strict";

import { extractCitations, normaliseCitation } from "../src/citations.ts";

function texts(input: string): string[] {
  return extractCitations(input).map((c) => c.text);
}

test("catches an invented immigration rule paragraph", () => {
  const found = extractCitations("Under paragraph 276ADE you may qualify.");
  assert.equal(found.length, 1);
  assert.equal(found[0]?.kind, "immigration_rule_paragraph");
  assert.equal(found[0]?.text, "paragraph 276ADE");
});

test("catches appendix references", () => {
  assert.ok(texts("See Appendix FM for details.").includes("Appendix FM"));
  assert.ok(
    texts("Appendix Skilled Worker applies.").some((t) => t.startsWith("Appendix Skilled"))
  );
});

test("catches statutes and neutral citations", () => {
  assert.ok(texts("the Modern Slavery Act 2015 applies").includes("Modern Slavery Act 2015"));
  assert.ok(texts("see [2002] UKIAT 00702").includes("[2002] UKIAT 00702"));
});

test("catches statutory instruments and sections", () => {
  assert.ok(texts("under S.I. 2014/2604").includes("S.I. 2014/2604"));
  assert.ok(texts("section 3C leave continues").includes("section 3C"));
});

test("plain prose with no authority produces no citations", () => {
  assert.deepEqual(texts("You should speak to an adviser about your options."), []);
});

test("overlapping matches are reported once", () => {
  const found = extractCitations("the Immigration Act 1971 section 3C");
  const spans: readonly (readonly [number, number])[] = found.map(
    (c) => [c.index, c.index + c.text.length] as const
  );
  for (let i = 0; i < spans.length; i += 1) {
    for (let j = i + 1; j < spans.length; j += 1) {
      const [aStart, aEnd] = spans[i]!;
      const [bStart, bEnd] = spans[j]!;
      assert.ok(aEnd <= bStart || bEnd <= aStart, `spans overlap: ${JSON.stringify(spans)}`);
    }
  }
});

test("normalisation folds paragraph spellings together", () => {
  assert.equal(normaliseCitation("Paragraph 276ADE"), normaliseCitation("para 276ADE"));
});
