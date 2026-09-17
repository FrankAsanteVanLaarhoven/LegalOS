-- Deadlines.
--
-- The date is the least important column here. A missed statutory deadline is
-- frequently unrecoverable, and the person it affects usually cannot check it
-- themselves — so what the record has to carry is where the date came from, who
-- recorded it, whether anyone qualified has confirmed it, and whether it has
-- since been replaced.
--
-- The invariant this schema exists to make enforceable:
--
--   No deadline may be presented as authoritative unless its source and
--   verification state are visible.
--
-- Enforced below rather than left to a panel, because a date rendered without
-- its provenance looks exactly like one that has been checked.

CREATE TABLE deadlines (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Scoped to both, so a tenant-scoped read never depends on a join being
    -- remembered, and a case moving organisation cannot orphan its dates.
    organisation_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    case_id         uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,

    deadline_type   text NOT NULL,
    deadline_at     timestamptz NOT NULL,
    -- Stored beside the instant, not instead of it. A tribunal direction is
    -- given in a place, and "4pm on the 14th" in London is a different moment
    -- from the same words in Lagos — where a client may be reading them.
    timezone        text NOT NULL DEFAULT 'Europe/London',

    -- What kind of obligation this is. The distinction decides whether missing
    -- it is a procedural failure or an internal target, and those must never
    -- render the same way.
    classification  text NOT NULL CHECK (classification IN (
                        'statutory',
                        'tribunal_directed',
                        'home_office_directed',
                        'contractual',
                        'internal_target',
                        'eligibility_monitoring')),

    -- Where the date came from.
    source_type     text NOT NULL CHECK (source_type IN (
                        'document', 'correspondence', 'legislation',
                        'direction', 'client_stated', 'calculated', 'unknown')),
    -- The evidence item or legal source it was read from, where there is one.
    source_id       text,
    -- Enough to find it again: a page, a paragraph, a rule number.
    source_locator  text,

    recorded_by     uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    recorded_at     timestamptz NOT NULL DEFAULT now(),

    -- Confirmation by someone qualified, which is a different act from
    -- recording. Both columns move together or neither does.
    verified_by     uuid REFERENCES users(id) ON DELETE RESTRICT,
    verified_at     timestamptz,
    verification_state text NOT NULL DEFAULT 'unverified' CHECK (verification_state IN (
                        'unverified',
                        'source_matched',
                        'professional_confirmed',
                        'disputed',
                        'superseded')),

    -- How the date itself was arrived at. An estimate presented as an exact
    -- date is the failure mode this column exists to prevent.
    certainty_state text NOT NULL DEFAULT 'unknown' CHECK (certainty_state IN (
                        'exact', 'calculated', 'estimated', 'unknown')),

    -- Replacement rather than mutation. A direction extended by a tribunal
    -- creates a new row pointing at the old one, so the history of what was
    -- believed and when survives.
    supersedes_id   uuid REFERENCES deadlines(id) ON DELETE RESTRICT,
    status          text NOT NULL DEFAULT 'open' CHECK (status IN (
                        'open', 'met', 'missed', 'superseded', 'withdrawn')),

    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),

    -- The invariant, at the level nothing can bypass. An obligation imposed by
    -- law or a direction must say where it came from; an internal target need
    -- not, because nobody is bound by it.
    CONSTRAINT authoritative_deadlines_cite_a_source CHECK (
        classification IN ('internal_target', 'eligibility_monitoring')
        OR (source_type <> 'unknown' AND source_locator IS NOT NULL)
    ),

    -- A verification without a verifier is an assertion. Both or neither.
    CONSTRAINT verification_names_a_verifier CHECK (
        (verification_state IN ('professional_confirmed', 'disputed'))
        = (verified_by IS NOT NULL AND verified_at IS NOT NULL)
    ),

    -- A superseded deadline names its replacement's existence through the
    -- inverse pointer, and must not still read as open.
    CONSTRAINT superseded_deadlines_are_closed CHECK (
        verification_state <> 'superseded' OR status = 'superseded'
    ),

    -- A date arrived at by calculation cannot claim to be exact.
    CONSTRAINT calculated_dates_are_not_exact CHECK (
        source_type <> 'calculated' OR certainty_state <> 'exact'
    )
);

-- Access patterns: the caseload view reads open deadlines by case in date
-- order, and the organisation-wide exposure view reads across cases.
CREATE INDEX deadlines_case_open_idx
    ON deadlines(case_id, deadline_at) WHERE status = 'open';
CREATE INDEX deadlines_org_open_idx
    ON deadlines(organisation_id, deadline_at) WHERE status = 'open';
CREATE INDEX deadlines_supersedes_idx ON deadlines(supersedes_id);

-- Destructive-operation policy for 0010 through 0013, stated once here because
-- all four domains follow it.
--
--   * Domain rows (deadlines, tasks, review_requests, graph_nodes, graph_edges)
--     cascade from the case and the organisation. Removing a tenancy is meant
--     to remove its working state.
--   * Event and decision rows never cascade and never delete. They reference
--     their parent with RESTRICT and carry a trigger refusing UPDATE, DELETE
--     and TRUNCATE. Two independent mechanisms, neither relying on the other.
--   * The consequence, stated plainly: a case that has recorded history cannot
--     be deleted by any statement. That is intended. It is also incomplete —
--     `audit_log` answers a data-protection erasure request by tombstoning the
--     payload and keeping the hash so the chain still verifies (PR-001), and
--     these four domains have no equivalent yet. Until they do, an erasure
--     request touching a deadline note or a review basis has no mechanism, and
--     that should surface as an error rather than as a delete that appeared to
--     work.
--
-- The append-only guard, named for what it does rather than for the first table
-- that needed it. `execution_records_are_immutable` is left in place for the
-- execution tables it already guards; a deadline correction refused with the
-- words "execution records are append-only" would send an operator looking in
-- the wrong place.
CREATE OR REPLACE FUNCTION records_are_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION '% is append-only: % is not permitted', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

-- Changes to a deadline are recorded, not overwritten.
CREATE TABLE deadline_events (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- RESTRICT, not CASCADE. The trigger below would refuse the cascaded delete
    -- anyway, so CASCADE would declare a behaviour that can never occur. Stating
    -- it as RESTRICT makes the real property visible in the schema: recorded
    -- history pins the row it describes.
    deadline_id  uuid NOT NULL REFERENCES deadlines(id) ON DELETE RESTRICT,
    event        text NOT NULL CHECK (event IN (
                     'recorded', 'verified', 'disputed', 'superseded',
                     'met', 'missed', 'withdrawn', 'corrected')),
    actor_id     uuid REFERENCES users(id) ON DELETE RESTRICT,
    detail       text,
    at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX deadline_events_deadline_idx ON deadline_events(deadline_id, id);

-- Append-only, for the same reason the audit log is: a date that was corrected
-- is a fact about the case, and the correction is often the most important
-- thing anyone will need to explain later.
CREATE TRIGGER deadline_events_no_change
    BEFORE UPDATE OR DELETE ON deadline_events
    FOR EACH ROW EXECUTE FUNCTION records_are_append_only();

CREATE TRIGGER deadline_events_no_truncate
    BEFORE TRUNCATE ON deadline_events
    FOR EACH STATEMENT EXECUTE FUNCTION refuse_truncate();
