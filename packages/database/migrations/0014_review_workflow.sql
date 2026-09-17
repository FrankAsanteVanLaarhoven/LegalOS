-- Review workflow: assignment, priority, and a concurrency token.
--
-- Migration 0011 modelled the part of review that carries legal weight — the
-- separation of request, decision and history — and deliberately nothing else.
-- Implementing the repository established what the operational half needs, and
-- it is not derivable from what is already there:
--
--   * an assignee, because "unassigned" and "assigned to someone who has not
--     looked yet" are different queue states and a reviewer needs to find their
--     own work;
--   * a priority, because a queue ordered only by arrival time asks a reviewer
--     to read every row to find the urgent one;
--   * a state for a request that is waiting on material, because deriving it
--     from the absence of something is how a blocked review becomes invisible;
--   * a concurrency token.
--
-- The token is an integer, and that is the whole reason it is an integer. The
-- deadline repository used `updated_at` and the first version compared a
-- PostgreSQL timestamptz — microseconds — against a value that had round-tripped
-- through a JavaScript date, which cannot hold them. Every legitimate
-- verification would have been refused as stale while looking exactly like
-- correct concurrency control. A counter has no precision to lose.

ALTER TABLE review_requests
    -- Who is to do it. Nullable: a request can exist before anyone is free.
    ADD COLUMN assigned_to   uuid REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN assigned_at   timestamptz,
    -- The role this review requires, as opposed to who happens to hold it.
    ADD COLUMN required_role text CHECK (required_role IN (
                       'caseworker', 'adviser', 'solicitor', 'reviewer', 'admin')),
    ADD COLUMN priority      text NOT NULL DEFAULT 'normal'
                       CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    -- Ordering rank, generated rather than written, so a queue cannot be
    -- reordered by editing a number and the text stays readable in psql.
    -- Sorting the text directly would give high, low, normal, urgent.
    ADD COLUMN priority_rank smallint GENERATED ALWAYS AS (
                       CASE priority
                           WHEN 'urgent' THEN 0
                           WHEN 'high'   THEN 1
                           WHEN 'normal' THEN 2
                           ELSE 3
                       END) STORED,
    -- Why a review was asked for, in the requester's words.
    ADD COLUMN reason        text,
    -- What was submitted, so a decision taken against a later version is
    -- visible as such rather than appearing to cover the original.
    ADD COLUMN subject_digest char(64),
    ADD COLUMN version       integer NOT NULL DEFAULT 1,
    ADD COLUMN updated_at    timestamptz NOT NULL DEFAULT now();

-- Both or neither: an assignee with no assignment time cannot be ordered or
-- chased, and an assignment time with no assignee is a record of nothing.
ALTER TABLE review_requests
    ADD CONSTRAINT assignment_records_when_it_happened CHECK (
        (assigned_to IS NULL) = (assigned_at IS NULL));

-- A review that requires a professional must say which professional role, or
-- the requirement is a flag nobody can act on.
ALTER TABLE review_requests
    ADD CONSTRAINT professional_reviews_name_the_role CHECK (
        requires_professional = false OR required_role IN ('solicitor', 'adviser'));

-- A request waiting on material is a state, not an absence. Without it, a
-- review blocked on a missing document is indistinguishable from one nobody
-- has picked up, and the second gets chased while the first waits.
ALTER TABLE review_requests DROP CONSTRAINT review_requests_status_check;
ALTER TABLE review_requests ADD CONSTRAINT review_requests_status_check CHECK (
    status IN ('open', 'awaiting_material', 'decided', 'withdrawn', 'expired'));

-- The queue reads. Both are ordered exactly as the repository orders them, so
-- the index can satisfy the sort as well as the filter.
CREATE INDEX review_requests_queue_idx
    ON review_requests(organisation_id, priority_rank, requested_at, id)
    WHERE status IN ('open', 'awaiting_material');

CREATE INDEX review_requests_reviewer_idx
    ON review_requests(assigned_to, priority_rank, requested_at, id)
    WHERE status IN ('open', 'awaiting_material');

-- Case history, which is unfiltered: a closed review is the interesting one
-- when somebody asks what was approved and by whom.
CREATE INDEX review_requests_case_history_idx
    ON review_requests(case_id, requested_at, id);
