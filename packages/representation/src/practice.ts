/**
 * Hearing practice.
 *
 * Procedural familiarisation only: what happens, who speaks, what an
 * interpreter does, what "I do not recall" is allowed to mean. That is
 * genuinely useful and reduces a real source of distress.
 *
 * What this module refuses to do, and why it refuses in code rather than in
 * documentation:
 *
 * Tribunals assess credibility partly on how a person presents. Trauma
 * survivors characteristically present with flat affect, avoided eye contact
 * and inconsistent recall — recognised responses, acknowledged in Home Office
 * and judicial guidance. Coaching someone to suppress those presentations does
 * two harmful things at once: it removes a signal a judge may need to see, and
 * it makes testimony look rehearsed, which is itself a documented route to an
 * adverse credibility finding.
 *
 * So there is no demeanour score here. Not a hidden one, not an internal one —
 * `scoreDemeanour` exists solely to throw, so that any future call site fails
 * loudly instead of quietly growing the feature back.
 */

export type PracticeRole = "judge" | "presenting_officer" | "interpreter" | "witness";

export interface PracticeQuestion {
  readonly id: string;
  readonly role: PracticeRole;
  readonly text: string;
  /** What this question is teaching the user to expect. */
  readonly purpose: string;
}

export interface PracticeSession {
  readonly id: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly questions: readonly PracticeQuestion[];
  /** Number of questions the user answered. Descriptive only. */
  readonly questionsAnswered: number;
  /** Whether an interpreter role was used. */
  readonly interpreterUsed: boolean;
}

/**
 * What a session may report back.
 *
 * Every field is procedural or descriptive. None of it evaluates the person, or
 * the content of their evidence.
 */
export interface SessionSummary {
  readonly sessionId: string;
  readonly questionsAsked: number;
  readonly questionsAnswered: number;
  readonly durationSeconds: number;
  readonly interpreterUsed: boolean;
  /** Procedural points to read about, not performance notes. */
  readonly suggestedReading: readonly string[];
  /** Stated plainly on every summary. */
  readonly disclaimer: string;
}

const DISCLAIMER =
  "This is practice with the process, not with your evidence. Answer truthfully at your hearing, including saying that you do not remember or do not know. Nothing here predicts what a judge will decide.";

export function summariseSession(session: PracticeSession): SessionSummary {
  const durationSeconds = Math.max(
    0,
    Math.round((Date.parse(session.endedAt) - Date.parse(session.startedAt)) / 1000)
  );

  const suggestedReading: string[] = [];
  if (!session.interpreterUsed) {
    suggestedReading.push("How to ask for an interpreter, and what they may and may not do");
  }
  if (session.questionsAnswered < session.questions.length) {
    suggestedReading.push("What happens if you cannot answer a question");
  }
  suggestedReading.push("Who is in the hearing room and what each person does");

  return {
    sessionId: session.id,
    questionsAsked: session.questions.length,
    questionsAnswered: session.questionsAnswered,
    durationSeconds,
    interpreterUsed: session.interpreterUsed,
    suggestedReading,
    disclaimer: DISCLAIMER,
  };
}

/**
 * Refuses to score how a person presents while giving evidence.
 *
 * Kept as a throwing function rather than omitted, so that a future caller
 * reaching for it gets an explanation instead of an empty space to fill in.
 */
export function scoreDemeanour(): never {
  throw new Error(
    "Demeanour is not scored. Coaching eye contact, confidence or body language before a " +
      "credibility assessment can suppress recognised trauma responses and make truthful " +
      "testimony appear rehearsed, which is itself a route to an adverse finding. Practise the " +
      "procedure, not the performance."
  );
}

/** Topics practice may cover. Anything about the content of evidence is absent. */
export const PRACTICE_TOPICS: readonly string[] = [
  "who is present in the hearing room",
  "the order in which people speak",
  "how to ask for a break",
  "how to ask for a question to be repeated",
  "how an interpreter works and how to correct one",
  "what to do if you do not understand a question",
  "that saying you do not remember is a permitted answer",
  "how long a hearing usually takes",
  "what happens after the hearing",
];
