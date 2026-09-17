import { observed, unavailable, type Observation } from "./observe.ts";

/**
 * The EV-005 observer: "Every assertion is traceable to a document."
 *
 * EV-005 sat at `no_observer` from the day the invariant registry was written,
 * because the tables it would have to read did not exist. They do now, and this
 * is the observer — but the reason it took a file of its own is the list of
 * things it must refuse to be satisfied by.
 *
 * It does **not** report satisfied because:
 *
 *   - `graph_evidence_links` exists. A table is not evidence.
 *   - the table has rows. Rows somewhere do not make *this* assertion traceable.
 *   - the assertion cites a source-looking identifier. An identifier is not a
 *     document; ADR-003 is open precisely because untyped references resolve to
 *     nothing and look fine.
 *   - a *different* assertion on the same edge has evidence. Two assertions can
 *     say opposite things about one relationship.
 *   - the link points at an evidence item that does not exist.
 *   - the locator is null, empty or whitespace. "Somewhere in this document" is
 *     not a citation.
 *   - the evidence belongs to another case, or another organisation. A document
 *     from a different matter supporting a claim in this one is a worse failure
 *     than no document.
 *   - the evidence item has no provenance. An item nobody can account for is
 *     not documentary support, whatever its title says.
 *   - the file was never stored, or has been marked unavailable. A row is not
 *     bytes, and a bundle assembled from one fails at the hearing.
 *   - the item has been erased under a retention policy.
 *
 * Scope: `source_backed` assertions. Those are the ones claiming documentary
 * backing, and they are the only ones the invariant is about. A
 * `machine_proposed` assertion makes no documentary claim and is not in breach
 * for lacking a document; it is in breach if anyone *renders* it as though it
 * had one, which is GR-G4's job rather than this one's.
 */

export const TRACEABILITY_OBSERVATION = "assertions_carry_source_locator";

/**
 * The query, kept here rather than inlined so the integration suite can prove
 * the observer the system actually runs instead of a re-typed copy of it.
 *
 * The join chain is the guarantee: assertion → its edge → the case, then the
 * link → the evidence item → *the same* case. A link whose evidence belongs
 * elsewhere fails the last comparison and counts as a violation, which is why
 * the check cannot be written as a simple EXISTS on `assertion_id`.
 */
export const TRACEABILITY_SQL = `
  SELECT
    count(*)::int AS total,
    count(*) FILTER (
      WHERE NOT EXISTS (
        SELECT 1
          FROM graph_evidence_links l
          JOIN evidence_items ev ON ev.id = l.evidence_id
          LEFT JOIN evidence_files f ON f.id = ev.current_file_id
         WHERE l.assertion_id = a.id
           -- A locator that says where to look. A storage key or a filename is
           -- not a substantive locator and a blank one is not a citation.
           AND l.locator IS NOT NULL
           AND btrim(l.locator) <> ''
           -- Same case. A real document from another matter satisfies the
           -- foreign key completely and supports nothing.
           AND ev.case_id = e.case_id
           -- Same organisation, checked independently of the case.
           AND ev.organisation_id = e.organisation_id
           -- Provenance: how it got here, on somebody's word. An item nobody
           -- can account for is not documentary support.
           AND EXISTS (SELECT 1 FROM evidence_provenance p WHERE p.evidence_id = ev.id)
           -- Not erased, and not withdrawn as unavailable.
           AND ev.retention_state <> 'erased'
           AND ev.verification_state <> 'unavailable'
           -- Retrievable bytes, or an explicit metadata-only classification.
           -- A row whose file was never stored is not a document.
           AND (f.availability = 'available' OR ev.evidence_type = 'country_evidence')
      )
    )::int AS violations
  FROM graph_assertions a
  JOIN graph_edges e ON e.id = a.edge_id
  WHERE a.assertion_type = 'source_backed'
    AND e.valid_to IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM graph_assertions s WHERE s.supersedes_id = a.id
    )`;

export interface TraceabilityReading {
  /** `source_backed` assertions currently in force. */
  readonly total: number;
  /** Those with no usable, same-case, resolvable evidence link. */
  readonly violations: number;
  readonly outcome: "satisfied" | "violated" | "not_applicable";
}

export function readingOf(total: number, violations: number): TraceabilityReading {
  return {
    total,
    violations,
    outcome: total === 0 ? "not_applicable" : violations === 0 ? "satisfied" : "violated",
  };
}

/**
 * Takes the observation.
 *
 * With no assertions at all the result is `unavailable`, not `satisfied`. An
 * empty table demonstrates nothing about traceability, and reporting a green
 * invariant on the strength of having no data is the exact failure mode this
 * repository exists to refuse — the same reason `1 of 16` is published rather
 * than rounded up.
 */
export async function observeAssertionTraceability(
  query: (sql: string) => Promise<{ rows: Record<string, unknown>[] }>
): Promise<Observation> {
  try {
    const result = await query(TRACEABILITY_SQL);
    const total = Number(result.rows[0]?.total ?? 0);
    const violations = Number(result.rows[0]?.violations ?? 0);
    const reading = readingOf(total, violations);

    if (reading.outcome === "not_applicable") {
      return unavailable(
        TRACEABILITY_OBSERVATION,
        "database query over graph_assertions, graph_evidence_links and evidence_items",
        "no source-backed assertions have been recorded, so traceability cannot be measured. An empty table is not evidence that every assertion is traceable."
      );
    }

    return observed(
      TRACEABILITY_OBSERVATION,
      reading.outcome === "satisfied",
      "database",
      `${total} source-backed assertion(s) in force, ${violations} without a same-case, same-organisation, provenanced, available evidence item carrying a non-blank locator`
    );
  } catch (error) {
    return unavailable(
      TRACEABILITY_OBSERVATION,
      "database query over graph_assertions, graph_evidence_links and evidence_items",
      `query failed: ${error instanceof Error ? error.message : "unknown error"}`
    );
  }
}

/** The observation reported when no database is configured at all. */
export function traceabilityUnavailable(): Observation {
  return unavailable(
    TRACEABILITY_OBSERVATION,
    "database query over graph_assertions, graph_evidence_links and evidence_items",
    "no database configured, so assertion traceability cannot be measured"
  );
}
