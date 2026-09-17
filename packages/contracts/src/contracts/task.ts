import { defineContract } from "../guarantee.ts";

/**
 * The task repository contract.
 *
 * A task on a migration case is usually a commitment to someone that something
 * will be done before a date that cannot move. The guarantees below are mostly
 * about keeping visible who asked for it and who is allowed to close it.
 */
export const TASK_CONTRACT = defineContract({
  repository: "TaskRepository",
  module: "packages/repositories/src/task.ts",
  rationale:
    "A task list is where a caseworker decides what to do next. If a model-proposed task is indistinguishable from one a solicitor set, the list quietly delegates prioritisation to a model that nobody agreed to trust with it.",
  tables: ["tasks", "task_events", "task_dependencies", "task_evidence_links"],
  surfaces: ["Tasks", "Overview", "Deadlines"],
  invariants: ["INV-001", "INV-004", "AG-003"],
  guarantees: [
    {
      id: "TK-G1",
      statement: "Every read is scoped to one organisation and one case.",
      kind: "scoping",
      refuses:
        "a task from another organisation's case appears in an assignee's list because assignment was queried before scope",
      provedBy: "task_reads_are_organisation_scoped",
    },
    {
      id: "TK-G2",
      statement:
        "A task a model proposed is returned marked as such, with the execution that proposed it.",
      kind: "provenance",
      refuses:
        "a caseworker works through a list believing a solicitor set the priorities, when a model did",
      provedBy: "task_agent_origin_is_visible",
    },
    {
      id: "TK-G3",
      statement: "A task requiring a professional is returned marked as requiring one.",
      kind: "provenance",
      refuses:
        "reserved work is completed by whoever had capacity, because the list gave no sign it was reserved",
      provedBy: "task_professional_requirement_visible",
    },
    {
      id: "TK-G4",
      statement: "Completion writes an event naming who completed it and when.",
      kind: "integrity",
      refuses:
        "a status is set to completed with no record of who did it, which is a label rather than a task",
      provedBy: "task_completion_is_evented",
    },
    {
      id: "TK-G5",
      statement: "A concurrent write against a stale version is refused rather than applied.",
      kind: "integrity",
      refuses:
        "two caseworkers close the same task from two screens and the second silently overwrites the first, losing one of the two accounts of what was done",
      provedBy: "task_concurrent_write_refused",
    },
    {
      id: "TK-G6",
      statement:
        "Dependencies and evidence links are returned as identifiers, not flattened into text.",
      kind: "provenance",
      refuses:
        "a blocked task shows a description of what blocks it rather than the task itself, so nothing can navigate to the blocker",
      provedBy: "task_links_returned_as_references",
    },
    {
      id: "TK-G7",
      statement: "Completed and cancelled tasks are excluded from a default read.",
      kind: "filtering",
      refuses:
        "the operational list grows without bound and what requires action now is buried in what was done last year",
      provedBy: "task_closed_excluded_by_default",
    },
    {
      id: "TK-G8",
      statement: "No fixture is ever served in place of a persisted task.",
      kind: "availability",
      refuses: "an invented task is worked on as though a person had asked for it",
      provedBy: "task_no_fixture_fallback",
    },
    {
      // Added with the implementation, matching DL-G9 and RV-G9. A completion
      // likelihood against a task is precisely the figure a caseworker would
      // triage by and precisely the one nothing here could justify.
      id: "TK-G9",
      statement: "No probability, confidence, score or percentage is emitted, under any name.",
      kind: "abstention",
      refuses:
        "a queue is worked in the order of a completion-likelihood or productivity figure, neither of which any observation in this system was calibrated to produce",
      provedBy: "task_emits_no_probability",
    },
  ],
});
