import { test } from "node:test";
import assert from "node:assert/strict";

import {
  assertNeutralLanguage,
  encouragement,
  EXPLANATION_TEXT,
  ExplanationLedger,
  FORBIDDEN_TERMS,
  ForbiddenLanguageError,
  guideMissingEvidence,
  observe,
  type EvidenceObservation,
} from "../src/index.ts";

const RECORDS = [
  {
    sourceId: "doc-medical",
    label: "Medical report",
    quote: "Symptoms first reported in March.",
  },
  {
    sourceId: "doc-statement",
    label: "Witness statement",
    quote: "The symptoms began in August.",
  },
];

/* ---------------- the vocabulary of accusation is unavailable ---------------- */

test("every forbidden term is rejected", () => {
  for (const term of FORBIDDEN_TERMS) {
    assert.throws(
      () => assertNeutralLanguage(`The record shows ${term} here.`),
      ForbiddenLanguageError,
      term
    );
  }
});

test("the rejection explains why, so a future author understands", () => {
  try {
    assertNeutralLanguage("A credibility problem arises.");
    assert.fail("should have thrown");
  } catch (error) {
    assert.match(
      (error as Error).message,
      /a conclusion about a person, not an observation about records/
    );
  }
});

test("ordinary words containing forbidden substrings pass", () => {
  for (const safe of [
    "I believe the dates differ.",
    "The applicant relied on this document.",
    "These records are incomplete.",
  ]) {
    assert.doesNotThrow(() => assertNeutralLanguage(safe), safe);
  }
});

test("an observation cannot be constructed with accusatory wording", () => {
  assert.throws(
    () =>
      observe({
        id: "o1",
        level: "clarification_invited",
        observation: "The statement appears fabricated.",
        records: RECORDS,
        candidateExplanations: ["traumatic_memory"],
      }),
    ForbiddenLanguageError
  );
});

/* ---------------- difference is not dishonesty ---------------- */

test("asking about a difference requires offering ordinary explanations first", () => {
  assert.throws(
    () =>
      observe({
        id: "o1",
        level: "clarification_invited",
        observation: "The two records give different months.",
        records: RECORDS,
      }),
    /without offering any ordinary explanation/
  );
});

test("trauma is among the offered explanations, and is stated plainly", () => {
  const observation = observe({
    id: "o1",
    level: "clarification_invited",
    observation: "The two records give different months for when symptoms began.",
    records: RECORDS,
    candidateExplanations: ["traumatic_memory", "translation_or_interpretation"],
  });
  assert.ok(observation.candidateExplanations.includes("traumatic_memory"));
  assert.match(EXPLANATION_TEXT.traumatic_memory, /does not mean an account is untrue/);
});

test("missing information needs no explanations, because nothing is being questioned", () => {
  const observation = observe({
    id: "o2",
    level: "missing_information",
    observation: "No travel history is on file.",
    records: [],
  });
  assert.deepEqual(observation.candidateExplanations, []);
  assert.match(observation.clarificationPrompt, /help obtaining it/);
});

test("the prompt is an invitation, never a challenge", () => {
  const levels = [
    "missing_information",
    "potential_ambiguity",
    "clarification_invited",
    "professional_review_recommended",
  ] as const;

  for (const level of levels) {
    const observation = observe({
      id: `o-${level}`,
      level,
      observation: "The records differ.",
      records: RECORDS,
      candidateExplanations: ["administrative_or_clerical_error"],
    });
    assert.match(observation.clarificationPrompt, /\?$/, level);
    assert.doesNotThrow(() => assertNeutralLanguage(observation.clarificationPrompt), level);
  }
});

test("only the highest level recommends professional review", () => {
  const high = observe({
    id: "o3",
    level: "professional_review_recommended",
    observation: "Two identity documents give different dates of birth.",
    records: RECORDS,
    candidateExplanations: ["administrative_or_clerical_error", "calendar_conversion"],
  });
  assert.equal(high.humanReviewRecommended, true);

  const low = observe({
    id: "o4",
    level: "potential_ambiguity",
    observation: "One record gives a month and the other a season.",
    records: RECORDS,
  });
  assert.equal(low.humanReviewRecommended, false);
});

test("no observation ever concludes anything about the person", () => {
  const observation = observe({
    id: "o5",
    level: "professional_review_recommended",
    observation: "Two identity documents give different dates of birth.",
    records: RECORDS,
    candidateExplanations: ["administrative_or_clerical_error"],
  });
  const serialised = JSON.stringify(observation);
  assert.doesNotThrow(() => assertNeutralLanguage(serialised));
});

/* ---------------- the ledger keeps everything ---------------- */

test("an unexplained observation is open, and stays visible", () => {
  const ledger = new ExplanationLedger();
  const observation: EvidenceObservation = observe({
    id: "o1",
    level: "clarification_invited",
    observation: "The two records give different months.",
    records: RECORDS,
    candidateExplanations: ["traumatic_memory"],
  });
  assert.equal(ledger.stateOf("o1"), "open");
  assert.deepEqual(ledger.outstanding([observation]), [observation]);
});

test("the person's explanation is kept in their own words", () => {
  const ledger = new ExplanationLedger();
  const words = "I did not talk about it until August. I could not say it out loud before then.";
  ledger.record({
    observationId: "o1",
    state: "explained",
    explanation: words,
    supportingEvidenceIds: [],
    at: "2026-07-26T10:00:00.000Z",
    by: "user:client-1",
  });
  assert.equal(ledger.history("o1")[0]?.explanation, words);
  assert.equal(ledger.stateOf("o1"), "explained");
});

test("the ledger appends, so how an account developed remains visible", () => {
  const ledger = new ExplanationLedger();
  ledger.record({
    observationId: "o1",
    state: "explained",
    explanation: "First explanation.",
    supportingEvidenceIds: [],
    at: "2026-07-26T10:00:00.000Z",
    by: "user:client-1",
  });
  ledger.record({
    observationId: "o1",
    state: "reviewed",
    explanation: "First explanation.",
    supportingEvidenceIds: ["doc-therapy"],
    at: "2026-07-27T10:00:00.000Z",
    by: "user:solicitor-7",
  });
  assert.equal(ledger.history("o1").length, 2);
  assert.equal(ledger.stateOf("o1"), "reviewed");
});

test("an observation may be accepted as it stands", () => {
  const ledger = new ExplanationLedger();
  ledger.record({
    observationId: "o1",
    state: "accepted_as_is",
    explanation: null,
    supportingEvidenceIds: [],
    at: "2026-07-26T10:00:00.000Z",
    by: "user:solicitor-7",
  });
  assert.equal(ledger.stateOf("o1"), "accepted_as_is");
});

/* ---------------- missing evidence guidance ---------------- */

test("guidance reports what is typical and what is on file", () => {
  const guidance = guideMissingEvidence(
    [
      { item: "Passport", why: "Establishes identity.", howToObtain: null },
      {
        item: "Country expert report",
        why: "Commonly used to address conditions in the country concerned.",
        howToObtain: "Usually commissioned through a representative.",
      },
    ],
    ["Passport"]
  );
  assert.equal(guidance.find((g) => g.item === "Passport")?.held, true);
  assert.equal(guidance.find((g) => g.item === "Country expert report")?.held, false);
  for (const entry of guidance) {
    assert.ok(entry.why.length > 10, entry.item);
  }
});

test("encouragement rests on work done, never on prospects", () => {
  const message = encouragement(4, 2);
  assert.match(message, /4 items complete, 2 still to go/);
  assert.doesNotThrow(() => assertNeutralLanguage(message));
  assert.equal(/strong|likely|good chance|win/.test(message.toLowerCase()), false);

  const done = encouragement(6, 0);
  assert.match(done, /adviser's job much easier/);
  assert.equal(/strong|likely/.test(done.toLowerCase()), false);
});
