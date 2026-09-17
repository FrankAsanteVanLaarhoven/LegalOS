/**
 * @legalos/evidence-review — the Evidence Consistency Engine.
 *
 * Named deliberately. A "contradiction detector" implies the system has decided
 * something is false, which is a human legal assessment and not one software is
 * competent to make. This engine observes that information differs, offers the
 * ordinary reasons it might, and asks whether the person wants to explain.
 *
 * Two properties are enforced rather than documented:
 *
 *  1. The vocabulary of accusation is unavailable. `assertNeutralLanguage`
 *     throws on "deception", "credibility", "lying", "fabricated",
 *     "dishonest" and their relatives, and every observation passes through it
 *     on construction. A future prompt template cannot reintroduce them.
 *
 *  2. Every observation carries candidate explanations before it carries a
 *     request. Difference is not dishonesty: fragmented chronology is a
 *     recognised feature of traumatic memory, and dates also drift through
 *     translation, transcription, calendar conversion and administrative error.
 *     Presenting a discrepancy without those alternatives invites someone to
 *     "correct" truthful testimony to match a document.
 */

export type ObservationLevel =
  | "missing_information"
  | "potential_ambiguity"
  | "clarification_invited"
  | "professional_review_recommended";

/**
 * Ordinary reasons two records differ, none of which involve dishonesty.
 * Attached to every observation so the person sees them before the question.
 */
export type CandidateExplanation =
  | "traumatic_memory"
  | "translation_or_interpretation"
  | "calendar_conversion"
  | "document_prepared_by_another"
  | "administrative_or_clerical_error"
  | "estimate_rather_than_exact_date"
  | "different_event_being_described";

export const EXPLANATION_TEXT: Readonly<Record<CandidateExplanation, string>> = {
  traumatic_memory:
    "Memory of distressing events is often fragmented or out of order. This is well recognised and does not mean an account is untrue.",
  translation_or_interpretation:
    "Details can shift when an account is given through an interpreter or translated between languages.",
  calendar_conversion:
    "Dates can differ when converted between calendars, or when only a month or season was known.",
  document_prepared_by_another:
    "Someone else may have written the document, and may have recorded something differently from how it was described to them.",
  administrative_or_clerical_error:
    "Official records contain typing and transcription errors more often than people expect.",
  estimate_rather_than_exact_date:
    "One record may be an approximate date and the other an exact one.",
  different_event_being_described:
    "The two records may be describing different events rather than the same one.",
};

/**
 * Terms the engine may never emit.
 *
 * These are conclusions about a person, reserved to a decision-maker who has
 * heard them. A system that reaches them in a case file has both exceeded its
 * competence and created a document that can be used against its own user.
 */
export const FORBIDDEN_TERMS: readonly string[] = [
  "deception",
  "deceptive",
  "credibility",
  "not credible",
  "incredible",
  "lying",
  "lied",
  "lie",
  "fabricated",
  "fabrication",
  "dishonest",
  "dishonesty",
  "false statement",
  "untruthful",
  "inconsistency detected",
  "contradiction",
  "discrepancy detected",
];

export class ForbiddenLanguageError extends Error {
  constructor(term: string, text: string) {
    super(
      `refusing to emit "${term}": that is a conclusion about a person, not an observation about records. Offending text: "${text}"`
    );
    this.name = "ForbiddenLanguageError";
  }
}

/** Throws if `text` contains accusatory vocabulary. */
export function assertNeutralLanguage(text: string): void {
  const haystack = text.toLowerCase();
  for (const term of FORBIDDEN_TERMS) {
    // Word-boundary match so "believe" does not trip on "lie".
    const pattern = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    if (pattern.test(haystack)) throw new ForbiddenLanguageError(term, text);
  }
}

export interface RecordReference {
  /** Evidence artefact or statement id. */
  readonly sourceId: string;
  readonly label: string;
  /** The exact text observed, so a reviewer can check the observation. */
  readonly quote: string;
}

export interface EvidenceObservation {
  readonly id: string;
  readonly level: ObservationLevel;
  /** Neutral description of what differs, never why. */
  readonly observation: string;
  readonly records: readonly RecordReference[];
  readonly candidateExplanations: readonly CandidateExplanation[];
  /** The question put to the person, phrased as an invitation. */
  readonly clarificationPrompt: string;
  readonly humanReviewRecommended: boolean;
}

export interface ObservationInput {
  readonly id: string;
  readonly level: ObservationLevel;
  readonly observation: string;
  readonly records: readonly RecordReference[];
  readonly candidateExplanations?: readonly CandidateExplanation[];
}

/**
 * Builds an observation, refusing accusatory language and requiring that
 * alternatives accompany anything put to the person.
 */
export function observe(input: ObservationInput): EvidenceObservation {
  assertNeutralLanguage(input.observation);

  const needsExplanations =
    input.level === "clarification_invited" || input.level === "professional_review_recommended";

  const explanations = input.candidateExplanations ?? [];
  if (needsExplanations && explanations.length === 0) {
    throw new Error(
      `observation ${input.id} asks about a difference without offering any ordinary explanation for it`
    );
  }

  return {
    id: input.id,
    level: input.level,
    observation: input.observation,
    records: input.records,
    candidateExplanations: explanations,
    clarificationPrompt: promptFor(input.level),
    humanReviewRecommended: input.level === "professional_review_recommended",
  };
}

function promptFor(level: ObservationLevel): string {
  switch (level) {
    case "missing_information":
      return "This does not appear to be on file yet. Would you like help obtaining it?";
    case "potential_ambiguity":
      return "This could be read more than one way. Would you like to add detail?";
    case "clarification_invited":
      return "These records say different things. If there is a reason for the difference, would you like to explain it in your own words?";
    case "professional_review_recommended":
      return "This is worth going through with a qualified adviser before anything is submitted. Would you like help finding one?";
  }
}

/* ------------------------------------------------------------------ */
/* Explanation ledger — nothing disappears                             */
/* ------------------------------------------------------------------ */

export type ExplanationState = "open" | "explained" | "reviewed" | "accepted_as_is";

export interface ExplanationEntry {
  readonly observationId: string;
  readonly state: ExplanationState;
  /** The person's own words. Never rewritten by the system. */
  readonly explanation: string | null;
  /** Evidence supporting the explanation, if any was added. */
  readonly supportingEvidenceIds: readonly string[];
  readonly at: string;
  readonly by: string;
}

export class ExplanationLedger {
  readonly #entries: ExplanationEntry[] = [];

  /** Appends; never edits. The history of how an account developed is evidence. */
  record(entry: ExplanationEntry): void {
    if (entry.explanation !== null) assertNeutralLanguage(entry.by);
    this.#entries.push(entry);
  }

  entries(): readonly ExplanationEntry[] {
    return [...this.#entries];
  }

  history(observationId: string): readonly ExplanationEntry[] {
    return this.#entries.filter((entry) => entry.observationId === observationId);
  }

  /** Current state of an observation, or `open` when nothing is recorded. */
  stateOf(observationId: string): ExplanationState {
    return this.history(observationId).at(-1)?.state ?? "open";
  }

  outstanding(observations: readonly EvidenceObservation[]): readonly EvidenceObservation[] {
    return observations.filter((o) => this.stateOf(o.id) === "open");
  }
}

/* ------------------------------------------------------------------ */
/* Missing evidence guidance                                           */
/* ------------------------------------------------------------------ */

export interface EvidenceGuidance {
  readonly item: string;
  readonly held: boolean;
  /** Why this is commonly provided — practical, never predictive. */
  readonly why: string;
  readonly howToObtain: string | null;
}

/**
 * What people commonly provide for a matter type, and what is not yet on file.
 *
 * Framed as what is typical rather than what is required: this cannot know what
 * a particular case needs, and saying "you need this" about something optional
 * causes its own harm.
 */
export function guideMissingEvidence(
  typical: readonly { item: string; why: string; howToObtain: string | null }[],
  held: readonly string[]
): readonly EvidenceGuidance[] {
  const onFile = new Set(held);
  return typical.map((entry) => ({
    item: entry.item,
    held: onFile.has(entry.item),
    why: entry.why,
    howToObtain: entry.howToObtain,
  }));
}

/**
 * Encouragement that rests on the work done, never on the prospects.
 *
 * Passed through the same language gate, because "you have a strong case" and
 * "your credibility is good" are the same category of statement.
 */
export function encouragement(completedItems: number, outstandingItems: number): string {
  const message =
    outstandingItems === 0
      ? "Everything recorded so far is complete. Working through it step by step makes an adviser's job much easier."
      : `${completedItems} item${completedItems === 1 ? "" : "s"} complete, ${outstandingItems} still to go. Many people find this process overwhelming; doing it one item at a time is enough.`;
  assertNeutralLanguage(message);
  return message;
}
