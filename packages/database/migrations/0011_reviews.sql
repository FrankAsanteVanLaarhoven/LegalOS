-- Human review.
--
-- This is the boundary the whole platform is arranged around: a machine
-- proposes, a named qualified person authorises. The schema has to make that
-- boundary a fact rather than a workflow convention.
--
-- Three tables rather than one, because a request, a decision and the history
-- between them are different things. A single row moving from `pending` to
-- `approved` records only the last state anyone left it in — and the question
-- afterwards is never "what does it say now", it is "who approved this, on what
-- basis, and what did they see".

CREATE TABLE review_requests (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    case_id         uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,

    -- What is being reviewed, and where it came from.
    subject_type    text NOT NULL CHECK (subject_type IN (
                        'ai_output', 'draft_document', 'evidence_assessment',
                        'bundle', 'filing', 'deadline', 'other')),
    subject_id      text NOT NULL,
    -- The execution that produced it, where a model did. Null for human work.
    execution_id    uuid REFERENCES ai_executions(id) ON DELETE RESTRICT,

    -- Whether a regulated professional is required, as opposed to any reviewer.
    -- Reserved legal activities cannot be authorised by a caseworker, and that
    -- is a legal constraint rather than a staffing preference.
    requires_professional boolean NOT NULL DEFAULT false,
    reserved_activity     text,

    requested_by    uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    requested_at    timestamptz NOT NULL DEFAULT now(),
    -- Derived from the deadline it serves, where it serves one.
    due_deadline_id uuid REFERENCES deadlines(id) ON DELETE SET NULL,

    status          text NOT NULL DEFAULT 'open' CHECK (status IN (
                        'open', 'decided', 'withdrawn', 'expired')),

    CONSTRAINT reserved_activities_require_a_professional CHECK (
        reserved_activity IS NULL OR requires_professional = true
    )
);

CREATE INDEX review_requests_case_open_idx
    ON review_requests(case_id, requested_at) WHERE status = 'open';
CREATE INDEX review_requests_org_open_idx
    ON review_requests(organisation_id, requested_at) WHERE status = 'open';
CREATE INDEX review_requests_execution_idx ON review_requests(execution_id);

-- The decision itself. Written once, never edited.
CREATE TABLE review_decisions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id      uuid NOT NULL REFERENCES review_requests(id) ON DELETE RESTRICT,

    decision        text NOT NULL CHECK (decision IN (
                        'approved', 'approved_with_amendments', 'refused',
                        'referred_onward')),
    -- Why. A decision with no basis cannot be reviewed by anyone else, and an
    -- approval is exactly the thing somebody may need to defend later.
    basis           text NOT NULL,

    decided_by      uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    -- The reviewer's role and regulatory reference as they were at the moment
    -- of the decision. Copied deliberately: a person's role changes, and the
    -- question afterwards is what they were when they signed it.
    decided_by_role text NOT NULL,
    regulatory_reference text,
    decided_at      timestamptz NOT NULL DEFAULT now(),

    -- What the reviewer was looking at, so a later reader sees the same thing.
    subject_digest  char(64) NOT NULL,

    CONSTRAINT one_decision_per_request UNIQUE (request_id),

    -- A professional decision names the registration it was made under.
    CONSTRAINT professional_decisions_cite_registration CHECK (
        decided_by_role NOT IN ('solicitor', 'barrister')
        OR regulatory_reference IS NOT NULL
    )
);

CREATE INDEX review_decisions_decided_by_idx ON review_decisions(decided_by, decided_at DESC);

-- Everything that happened along the way: assignment, comment, escalation.
CREATE TABLE review_events (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- RESTRICT for the same reason as the decision above: the trigger refuses
    -- the delete regardless, so CASCADE would be a claim the database cannot
    -- honour.
    request_id   uuid NOT NULL REFERENCES review_requests(id) ON DELETE RESTRICT,
    event        text NOT NULL CHECK (event IN (
                     'requested', 'assigned', 'commented', 'escalated',
                     'decided', 'withdrawn', 'expired', 'reopened')),
    actor_id     uuid REFERENCES users(id) ON DELETE RESTRICT,
    detail       text,
    at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX review_events_request_idx ON review_events(request_id, id);

-- A decision is evidence of who authorised what. Neither it nor the history
-- leading to it may be rewritten.
CREATE TRIGGER review_decisions_no_change
    BEFORE UPDATE OR DELETE ON review_decisions
    FOR EACH ROW EXECUTE FUNCTION records_are_append_only();

CREATE TRIGGER review_decisions_no_truncate
    BEFORE TRUNCATE ON review_decisions
    FOR EACH STATEMENT EXECUTE FUNCTION refuse_truncate();

CREATE TRIGGER review_events_no_change
    BEFORE UPDATE OR DELETE ON review_events
    FOR EACH ROW EXECUTE FUNCTION records_are_append_only();

CREATE TRIGGER review_events_no_truncate
    BEFORE TRUNCATE ON review_events
    FOR EACH STATEMENT EXECUTE FUNCTION refuse_truncate();
