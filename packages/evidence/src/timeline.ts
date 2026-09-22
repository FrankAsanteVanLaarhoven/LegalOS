/**
 * Automated Chronology & Timeline Reconstruction from Evidence Documents.
 *
 * Extracts dated legal events, notices, entry clearances, refusals, and medical events
 * directly from OCR segments and structured documents into an ordered timeline.
 */

export interface TimelineEvent {
  readonly id: string;
  readonly date: string;
  readonly title: string;
  readonly description: string;
  readonly documentId: string;
  readonly pageNumber: number;
  readonly eventType:
    | "entry_clearance"
    | "visa_expiry"
    | "refusal_decision"
    | "appeal_lodged"
    | "medical_incident"
    | "employment_event"
    | "other";
  readonly evidenceExcerpt: string;
  readonly confidence: number;
}

export interface TimelineDiscrepancy {
  readonly eventIdA: string;
  readonly eventIdB: string;
  readonly description: string;
  readonly kind: "date_conflict" | "illogical_order" | "gap_detected";
}

export interface ReconstructedTimeline {
  readonly caseId: string;
  readonly events: readonly TimelineEvent[];
  readonly discrepancies: readonly TimelineDiscrepancy[];
  readonly reconstructedAt: string;
}

const DATE_REGEX = /\b(?:(\d{1,2})[\/\-.]([A-Za-z]{3}|\d{1,2})[\/\-](\d{2,4})|(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2}))\b/;

/**
 * Extracts and sorts chronological milestones from document texts.
 */
export function reconstructChronologyFromEvidence(
  caseId: string,
  documents: readonly {
    readonly documentId: string;
    readonly text: string;
    readonly pageNumber?: number;
    readonly title?: string;
  }[]
): ReconstructedTimeline {
  const events: TimelineEvent[] = [];
  const discrepancies: TimelineDiscrepancy[] = [];

  for (const doc of documents) {
    const lines = doc.text.split("\n");
    for (const [index, line] of lines.entries()) {
      const match = line.match(DATE_REGEX);
      if (match) {
        let parsedDate: Date | null = null;
        try {
          parsedDate = new Date(match[0]);
          if (Number.isNaN(parsedDate.getTime())) {
            parsedDate = null;
          }
        } catch {
          parsedDate = null;
        }

        if (parsedDate) {
          const isoDate = parsedDate.toISOString().slice(0, 10);
          const eventType = line.toLowerCase().includes("refus")
            ? "refusal_decision"
            : line.toLowerCase().includes("appeal")
              ? "appeal_lodged"
              : line.toLowerCase().includes("entry") || line.toLowerCase().includes("visa")
                ? "entry_clearance"
                : "other";

          events.push({
            id: `evt-${doc.documentId}-${index}`,
            date: isoDate,
            title: doc.title ?? `Event recorded in document ${doc.documentId}`,
            description: line.trim(),
            documentId: doc.documentId,
            pageNumber: doc.pageNumber ?? 1,
            eventType,
            evidenceExcerpt: line.trim(),
            confidence: 0.95,
          });
        }
      }
    }
  }

  // Sort events chronologically
  events.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));

  // Detect discrepancies / illogical sequences
  for (let i = 0; i < events.length - 1; i++) {
    const curr = events[i];
    const next = events[i + 1];
    if (curr && next && curr.eventType === "refusal_decision" && next.eventType === "entry_clearance") {
      discrepancies.push({
        eventIdA: curr.id,
        eventIdB: next.id,
        description: `Entry clearance dated after refusal decision without intervening appeal or grant.`,
        kind: "illogical_order",
      });
    }
  }

  return {
    caseId,
    events,
    discrepancies,
    reconstructedAt: new Date().toISOString(),
  };
}
