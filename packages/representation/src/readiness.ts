/**
 * Representation readiness.
 *
 * Readiness describes preparation, never prospects. The distinction is the
 * whole design: "your witness statement is a draft and your medical evidence is
 * outstanding" is a fact about the file, checkable by anyone. "Your case is
 * strong" is a prediction about a judge, and nothing here can make one.
 *
 * So every item below is a state a human can verify by looking, and there is no
 * aggregate score. A single percentage across evidence, deadlines and review
 * would read as a likelihood of winning no matter how it was labelled.
 */

export type ItemState =
  "not_started" | "in_progress" | "awaiting_third_party" | "complete" | "overdue";

export type ReadinessArea =
  | "evidence"
  | "procedural_deadlines"
  | "witness_statement"
  | "medical_evidence"
  | "hearing_preparation"
  | "professional_review";

export interface ReadinessItem {
  readonly area: ReadinessArea;
  readonly label: string;
  readonly state: ItemState;
  /** What the state was determined from, so a reviewer can check it. */
  readonly basis: string;
  /** Who the file is waiting on, when it is waiting on someone. */
  readonly waitingOn: string | null;
  /** ISO date, when the item has one. */
  readonly dueBy: string | null;
}

export interface ReadinessReport {
  readonly items: readonly ReadinessItem[];
  readonly outstanding: readonly ReadinessItem[];
  readonly overdue: readonly ReadinessItem[];
  /**
   * Deliberately absent: any overall score, percentage or likelihood. See the
   * module comment — an aggregate here becomes a prediction in the reader's
   * head regardless of the label above it.
   */
  readonly summary: string;
}

export interface CaseFacts {
  readonly evidenceRequired: readonly string[];
  readonly evidenceReceived: readonly string[];
  /** Evidence requested from a third party and not yet returned. */
  readonly evidenceAwaited: readonly { item: string; from: string; chasedAt: string | null }[];
  readonly witnessStatementState: ItemState;
  readonly deadlines: readonly { label: string; dueBy: string; met: boolean }[];
  readonly practiceSessionsCompleted: number;
  readonly professionalReviewState: ItemState;
  /** ISO date used to decide what is overdue. Passed in, never read from a clock. */
  readonly asOf: string;
}

export function assessReadiness(facts: CaseFacts): ReadinessReport {
  const items: ReadinessItem[] = [];

  const received = new Set(facts.evidenceReceived);
  const missing = facts.evidenceRequired.filter((item) => !received.has(item));

  items.push({
    area: "evidence",
    label: "Evidence on file",
    state: missing.length === 0 ? "complete" : "in_progress",
    basis: `${received.size} of ${new Set(facts.evidenceRequired).size} required items received`,
    waitingOn: null,
    dueBy: null,
  });

  for (const awaited of facts.evidenceAwaited) {
    items.push({
      area: awaited.item.toLowerCase().includes("medical") ? "medical_evidence" : "evidence",
      label: awaited.item,
      state: "awaiting_third_party",
      basis: awaited.chasedAt
        ? `requested from ${awaited.from}, last chased ${awaited.chasedAt}`
        : `requested from ${awaited.from}, not yet chased`,
      waitingOn: awaited.from,
      dueBy: null,
    });
  }

  items.push({
    area: "witness_statement",
    label: "Witness statement",
    state: facts.witnessStatementState,
    basis: "recorded state of the statement on file",
    waitingOn: null,
    dueBy: null,
  });

  for (const deadline of facts.deadlines) {
    const overdue = !deadline.met && Date.parse(deadline.dueBy) < Date.parse(facts.asOf);
    items.push({
      area: "procedural_deadlines",
      label: deadline.label,
      state: deadline.met ? "complete" : overdue ? "overdue" : "in_progress",
      basis: deadline.met ? "recorded as met" : `due ${deadline.dueBy}`,
      waitingOn: null,
      dueBy: deadline.dueBy,
    });
  }

  items.push({
    area: "hearing_preparation",
    label: "Practice sessions completed",
    // A count is a fact. Whether it is "enough" is not something this can know.
    state: facts.practiceSessionsCompleted > 0 ? "in_progress" : "not_started",
    basis: `${facts.practiceSessionsCompleted} completed`,
    waitingOn: null,
    dueBy: null,
  });

  items.push({
    area: "professional_review",
    label: "Review by a qualified professional",
    state: facts.professionalReviewState,
    basis: "recorded review state",
    waitingOn: facts.professionalReviewState === "complete" ? null : "reviewer",
    dueBy: null,
  });

  const outstanding = items.filter((item) => item.state !== "complete" && item.state !== "overdue");
  const overdue = items.filter((item) => item.state === "overdue");

  const summary =
    overdue.length > 0
      ? `${overdue.length} deadline${overdue.length === 1 ? "" : "s"} passed without being met. Speak to an adviser now.`
      : outstanding.length === 0
        ? "Every recorded item is complete. This describes the file, not the outcome."
        : `${outstanding.length} item${outstanding.length === 1 ? "" : "s"} outstanding. This describes the file, not the outcome.`;

  return { items, outstanding, overdue, summary };
}

/** Missing required evidence, named rather than scored. */
export function missingEvidence(facts: CaseFacts): readonly string[] {
  const received = new Set(facts.evidenceReceived);
  return [...new Set(facts.evidenceRequired)].filter((item) => !received.has(item));
}
