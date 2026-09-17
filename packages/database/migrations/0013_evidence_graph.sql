-- The evidence graph, persisted.
--
-- An edge between two pieces of evidence is an assertion that somebody or
-- something made. Drawn without its author it reads as a fact about the case,
-- and a graph of unattributed edges is a diagram of conclusions nobody owns.
--
-- There is deliberately no probability column anywhere in this schema. "AI
-- confidence 84%" is not a state a person can act on and this platform shows no
-- confidence figures; what a reader needs is who asserted the relationship and
-- on what basis. Those are the states below, and they are ordered by how much
-- weight a submission can bear.

CREATE TABLE graph_nodes (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    case_id         uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,

    node_type       text NOT NULL CHECK (node_type IN (
                        'evidence', 'timeline_event', 'person', 'issue',
                        'claim', 'document', 'deadline')),
    -- The row this node stands for, in whichever table owns it.
    subject_id      text NOT NULL,
    label           text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),

    -- One node per subject per case: a graph with two nodes for the same
    -- document draws two different pictures of one case.
    CONSTRAINT one_node_per_subject UNIQUE (case_id, node_type, subject_id)
);

CREATE INDEX graph_nodes_case_idx ON graph_nodes(case_id, node_type);

CREATE TABLE graph_edges (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    case_id         uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,

    from_node_id    uuid NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
    to_node_id      uuid NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
    relationship    text NOT NULL CHECK (relationship IN (
                        'supports', 'contradicts', 'corroborates', 'supersedes',
                        'refers_to', 'derived_from', 'concerns', 'precedes')),

    -- Validity over time, so a relationship that stopped holding is retired
    -- rather than deleted. What was believed on the day of a submission is
    -- often the question.
    valid_from      timestamptz NOT NULL DEFAULT now(),
    valid_to        timestamptz,
    superseded_by   uuid REFERENCES graph_edges(id) ON DELETE RESTRICT,

    created_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT an_edge_does_not_loop CHECK (from_node_id <> to_node_id),
    CONSTRAINT retired_edges_have_an_end CHECK (
        superseded_by IS NULL OR valid_to IS NOT NULL
    )
);

CREATE INDEX graph_edges_case_idx ON graph_edges(case_id) WHERE valid_to IS NULL;
CREATE INDEX graph_edges_from_idx ON graph_edges(from_node_id);
CREATE INDEX graph_edges_to_idx ON graph_edges(to_node_id);

-- Who asserted an edge, and on what basis. Separate from the edge because one
-- relationship can be proposed by a model and later confirmed by a person, and
-- both assertions are worth keeping.
CREATE TABLE graph_assertions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- RESTRICT: an assertion outlives the edge it was made about. See 0010.
    edge_id         uuid NOT NULL REFERENCES graph_edges(id) ON DELETE RESTRICT,

    -- The four kinds of thing that can assert a relationship, and they carry
    -- different weight. A submission may rest on the last two; it may not rest
    -- on the first without a person adopting it.
    assertion_type  text NOT NULL CHECK (assertion_type IN (
                        'machine_proposed',
                        'source_backed',
                        'human_confirmed',
                        'disputed')),

    asserted_by_type text NOT NULL CHECK (asserted_by_type IN ('user', 'agent')),
    asserted_by_id   text NOT NULL,
    -- The execution behind a machine assertion, so it is reproducible.
    execution_id     uuid REFERENCES ai_executions(id) ON DELETE RESTRICT,
    -- Why, in words a reader can check.
    reason           text NOT NULL,
    asserted_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT machine_assertions_cite_an_execution CHECK (
        assertion_type <> 'machine_proposed' OR execution_id IS NOT NULL
    ),
    CONSTRAINT human_assertions_name_a_person CHECK (
        assertion_type <> 'human_confirmed' OR asserted_by_type = 'user'
    )
);

CREATE INDEX graph_assertions_edge_idx ON graph_assertions(edge_id, asserted_at DESC);

-- The evidence an assertion rests on.
CREATE TABLE graph_evidence_links (
    assertion_id uuid NOT NULL REFERENCES graph_assertions(id) ON DELETE CASCADE,
    evidence_id  uuid NOT NULL REFERENCES evidence_items(id) ON DELETE RESTRICT,
    locator      text,
    PRIMARY KEY (assertion_id, evidence_id)
);

-- An assertion is a record of what somebody claimed at a moment. Retracting it
-- is a new assertion, not an edit to the old one.
CREATE TRIGGER graph_assertions_no_change
    BEFORE UPDATE OR DELETE ON graph_assertions
    FOR EACH ROW EXECUTE FUNCTION records_are_append_only();

CREATE TRIGGER graph_assertions_no_truncate
    BEFORE TRUNCATE ON graph_assertions
    FOR EACH STATEMENT EXECUTE FUNCTION refuse_truncate();
