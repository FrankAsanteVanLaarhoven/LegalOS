-- Task workflow: cancellation, orderable priority, link provenance.
--
-- Migration 0012 modelled what a task is. Implementing the repository
-- established five things it cannot yet record, none of them derivable from
-- what is there:
--
--   * when a task was cancelled. `completed_at` has an equality constraint
--     tying it to the status; cancellation had nowhere to put its time, so a
--     cancelled task could not say when it stopped mattering.
--   * an orderable priority. The column is text, so an index on it sorts
--     high, low, normal, urgent — which is alphabetical and not an ordering
--     any caseworker would recognise. `tasks_case_open_idx` was built on that
--     column and was therefore ordering the operational queue wrongly.
--   * an event vocabulary covering what the repository actually does. There
--     was no term for an update, a dependency or an evidence link, so those
--     changes would have had to be recorded as `commented` — which is how a
--     history stops being a history.
--   * who added a dependency, and why. An edge between two tasks with no
--     author is a constraint nobody can argue with.
--   * who linked a piece of evidence, and when.

ALTER TABLE tasks
    ADD COLUMN cancelled_at timestamptz,
    -- Ordering rank, generated rather than written, so a queue cannot be
    -- reordered by editing a number and the text stays readable.
    ADD COLUMN priority_rank smallint GENERATED ALWAYS AS (
                   CASE priority
                       WHEN 'urgent' THEN 0
                       WHEN 'high'   THEN 1
                       WHEN 'normal' THEN 2
                       ELSE 3
                   END) STORED;

-- Symmetric with `completed_tasks_have_a_time`, and for the same reason: a
-- cancelled task with no cancellation time cannot be distinguished from one
-- whose status was set by hand.
ALTER TABLE tasks
    ADD CONSTRAINT cancelled_tasks_have_a_time CHECK (
        (status = 'cancelled') = (cancelled_at IS NOT NULL));

-- A task is completed or cancelled, never both.
ALTER TABLE tasks
    ADD CONSTRAINT a_task_is_not_both_finished_and_abandoned CHECK (
        completed_at IS NULL OR cancelled_at IS NULL);

-- The events the repository writes. Recording an evidence link as `commented`
-- would leave a history that cannot answer "when was this attached".
ALTER TABLE task_events DROP CONSTRAINT task_events_event_check;
ALTER TABLE task_events ADD CONSTRAINT task_events_event_check CHECK (
    event IN (
        'created', 'updated', 'assigned', 'unassigned', 'started', 'blocked',
        'unblocked', 'sent_for_review', 'completed', 'cancelled', 'reopened',
        'commented', 'dependency_added', 'dependency_removed',
        'evidence_linked', 'evidence_unlinked'));

-- Provenance on both join tables. An ordering constraint between two tasks, or
-- a document attached to one, is a judgement somebody made, and the person it
-- later blocks is entitled to know who made it.
ALTER TABLE task_dependencies
    ADD COLUMN created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
    ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN reason     text;

ALTER TABLE task_evidence_links
    ADD COLUMN created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
    ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN note       text;

-- The operational read, rebuilt on the rank rather than the text. The old index
-- is dropped rather than kept: it sorted alphabetically, so leaving it would
-- leave a plan that looks ordered and is not.
DROP INDEX tasks_case_open_idx;
CREATE INDEX tasks_case_open_idx
    ON tasks(case_id, priority_rank, created_at, id)
    WHERE status NOT IN ('completed', 'cancelled');

-- An assignee's own queue, ordered as they read it.
DROP INDEX tasks_assigned_idx;
CREATE INDEX tasks_assigned_idx
    ON tasks(assigned_to, priority_rank, created_at, id)
    WHERE status NOT IN ('completed', 'cancelled');

-- Organisation-wide active work, for the caseload view.
CREATE INDEX tasks_org_open_idx
    ON tasks(organisation_id, priority_rank, created_at, id)
    WHERE status NOT IN ('completed', 'cancelled');

-- Full case history, unfiltered: a completed task is the interesting one when
-- somebody asks what was done.
CREATE INDEX tasks_case_history_idx ON tasks(case_id, created_at, id);

-- Reverse dependency lookup, for "what does this block".
CREATE INDEX task_dependencies_depends_on_idx ON task_dependencies(depends_on_id);
