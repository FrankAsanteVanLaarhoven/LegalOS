import { defineContract } from "../guarantee.ts";

/**
 * The deadline repository contract.
 *
 * Written before the repository, so it constrains the implementation rather
 * than describing it. Every `provedBy` names a check that does not exist yet;
 * naming them here is what fixes the shape of the tests Phase 3 has to write.
 */
export const DEADLINE_CONTRACT = defineContract({
  repository: "DeadlineRepository",
  module: "packages/repositories/src/deadline.ts",
  rationale:
    "A missed statutory deadline is frequently unrecoverable, and the person it affects usually cannot check it themselves. Everything this boundary guarantees exists so that a date on a screen can be traced to the document it came from by somebody who was not there when it was recorded.",
  tables: ["deadlines", "deadline_events"],
  surfaces: ["Deadlines", "Overview", "Tasks"],
  invariants: ["INV-001", "INV-004", "AU-001"],
  guarantees: [
    {
      id: "DL-G1",
      statement: "Every read is scoped to one organisation, whatever the caller passes.",
      kind: "scoping",
      refuses:
        "a deadline belonging to another organisation appears in a caseworker's list because the caller passed a case id from a tenancy they are not a member of",
      provedBy: "deadline_reads_are_organisation_scoped",
    },
    {
      id: "DL-G2",
      statement:
        "Permission is resolved against the workspace the case belongs to, after the case is known.",
      kind: "permission",
      refuses:
        "a caller reads a case in another workspace by naming a workspace they are legitimately a member of",
      provedBy: "deadline_permission_resolved_after_case",
    },
    {
      id: "DL-G3",
      statement:
        "An authoritative deadline is returned with its source type and locator, or it is not returned at all.",
      kind: "provenance",
      refuses:
        "a statutory date is rendered with nothing to check it against, looking identical to one a solicitor has verified",
      provedBy: "deadline_provenance_or_omission",
    },
    {
      id: "DL-G4",
      statement:
        "Classification, verification state and certainty state are always present on a returned deadline.",
      kind: "provenance",
      refuses:
        "an internal target renders identically to a tribunal direction, so a caseworker treats a soft date as binding or a binding one as soft",
      provedBy: "deadline_states_always_emitted",
    },
    {
      id: "DL-G5",
      statement: "Superseded and withdrawn deadlines are excluded from a default read.",
      kind: "filtering",
      refuses:
        "a tribunal extends a direction and the workspace still shows the original date alongside the new one, with nothing to say which governs",
      provedBy: "deadline_superseded_excluded",
    },
    {
      id: "DL-G6",
      statement:
        "Absence of a database, absence of the case, refusal and unreachability stay distinguishable.",
      kind: "availability",
      refuses:
        "an unreachable database renders as an empty deadline list, so a case with three imminent deadlines reads as a case with none",
      provedBy: "deadline_unavailability_distinguished",
    },
    {
      id: "DL-G7",
      statement: "No fixture is ever served in place of a persisted row.",
      kind: "availability",
      refuses:
        "a page serves a TypeScript literal when the database has nothing, indistinguishable from one serving a record",
      provedBy: "deadline_no_fixture_fallback",
    },
    {
      id: "DL-G8",
      statement: "A change to a deadline writes an event; nothing is silently rewritten.",
      kind: "integrity",
      refuses:
        "a date is corrected and the record shows only the corrected value, so the correction — often the thing that has to be explained later — leaves no trace",
      provedBy: "deadline_changes_are_evented",
    },
    {
      // Added when the repository was implemented, not renamed from anything.
      // The abstention was stated for the graph in GR-G3 and is just as load-
      // bearing here: a date is exactly the kind of thing somebody would want a
      // reliability figure against, and it is exactly the kind of figure this
      // system has no basis to produce.
      id: "DL-G9",
      statement: "No probability, confidence, score or percentage is emitted, under any name.",
      kind: "abstention",
      refuses:
        "a caseworker triages by a reliability figure attached to a date, which no observation in this system was ever calibrated to support",
      provedBy: "deadline_emits_no_probability",
    },
  ],
});
