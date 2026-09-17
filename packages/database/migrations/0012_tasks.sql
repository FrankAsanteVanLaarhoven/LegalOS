-- Tasks.
--
-- Not a checklist. A task on a migration case is usually a commitment to
-- someone that something will be done before a date that cannot move, so it
-- references the deadline it serves, the evidence it concerns and the review it
-- awaits rather than restating them as free text.
--
-- The distinction the schema insists on: "assigned to a caseworker" and
-- "requires a solicitor to authorise" are different facts, and only the second
-- is a regulatory constraint. Conflating them is how reserved work ends up done
-- by whoever had capacity.

CREATE TABLE tasks (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    case_id         uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,

    task_type       text NOT NULL,
    title           text NOT NULL,
    description     text,

    status          text NOT NULL DEFAULT 'open' CHECK (status IN (
                        'open', 'in_progress', 'blocked', 'awaiting_review',
                        'completed', 'cancelled')),
    priority        text NOT NULL DEFAULT 'normal' CHECK (priority IN (
                        'low', 'normal', 'high', 'urgent')),

    -- Where the task came from. A task a model proposed is not the same as one
    -- a solicitor set, and a person deciding what to do next needs to know
    -- which they are looking at.
    source          text NOT NULL CHECK (source IN (
                        'human', 'agent_proposed', 'deadline_derived', 'policy_rule')),
    -- The execution that proposed it, where one did.
    proposed_by_execution uuid REFERENCES ai_executions(id) ON DELETE RESTRICT,

    created_by      uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    assigned_to     uuid REFERENCES users(id) ON DELETE SET NULL,

    -- A regulatory constraint, not a workflow preference.
    requires_professional boolean NOT NULL DEFAULT false,

    -- What it serves and concerns.
    deadline_id     uuid REFERENCES deadlines(id) ON DELETE SET NULL,
    review_request_id uuid REFERENCES review_requests(id) ON DELETE SET NULL,

    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    completed_at    timestamptz,
    -- Optimistic concurrency: two caseworkers closing the same task should not
    -- silently overwrite one another.
    version         integer NOT NULL DEFAULT 1,

    CONSTRAINT completed_tasks_have_a_time CHECK (
        (status = 'completed') = (completed_at IS NOT NULL)
    ),
    CONSTRAINT agent_proposed_tasks_cite_an_execution CHECK (
        source <> 'agent_proposed' OR proposed_by_execution IS NOT NULL
    ),
    -- A task awaiting review must say which review, or nothing resolves it.
    CONSTRAINT awaiting_review_names_the_review CHECK (
        status <> 'awaiting_review' OR review_request_id IS NOT NULL
    )
);

CREATE INDEX tasks_case_open_idx ON tasks(case_id, priority, created_at)
    WHERE status NOT IN ('completed', 'cancelled');
CREATE INDEX tasks_assigned_idx ON tasks(assigned_to, status)
    WHERE status NOT IN ('completed', 'cancelled');
CREATE INDEX tasks_deadline_idx ON tasks(deadline_id);

-- Evidence a task concerns. Many-to-many, because "obtain the medical report"
-- may satisfy several gaps and one gap may need several documents.
CREATE TABLE task_evidence_links (
    task_id     uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    evidence_id uuid NOT NULL REFERENCES evidence_items(id) ON DELETE CASCADE,
    relation    text NOT NULL CHECK (relation IN ('produces', 'requires', 'concerns')),
    PRIMARY KEY (task_id, evidence_id, relation)
);

-- Ordering constraints between tasks.
CREATE TABLE task_dependencies (
    task_id       uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    depends_on_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, depends_on_id),
    CONSTRAINT a_task_does_not_depend_on_itself CHECK (task_id <> depends_on_id)
);

-- What happened, kept apart from what is currently true.
CREATE TABLE task_events (
    id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- RESTRICT: history pins the task it describes. See 0010 for the reasoning.
    task_id   uuid NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
    event     text NOT NULL CHECK (event IN (
                  'created', 'assigned', 'unassigned', 'started', 'blocked',
                  'unblocked', 'sent_for_review', 'completed', 'cancelled',
                  'reopened', 'commented')),
    actor_id  uuid REFERENCES users(id) ON DELETE RESTRICT,
    detail    text,
    at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX task_events_task_idx ON task_events(task_id, id);

-- A status field records only where somebody left it. Who closed a task, and
-- when, is the part that matters afterwards.
CREATE TRIGGER task_events_no_change
    BEFORE UPDATE OR DELETE ON task_events
    FOR EACH ROW EXECUTE FUNCTION records_are_append_only();

CREATE TRIGGER task_events_no_truncate
    BEFORE TRUNCATE ON task_events
    FOR EACH STATEMENT EXECUTE FUNCTION refuse_truncate();
