-- Graph lifecycle: supersession, invalidation provenance, live-edge uniqueness,
-- and a locator that is actually usable.
--
-- Migration 0013 modelled what an assertion is and refused to store a
-- probability. Implementing the repository established four things it cannot
-- yet record:
--
--   * how one assertion replaces another. `graph_assertions` refuses UPDATE by
--     trigger, which is correct — a retraction is a new assertion, not an edit
--     — but there was nothing to point the new row at the old one, so the chain
--     was unreadable.
--   * who invalidated an edge and why. `valid_to` said when a relationship
--     stopped holding and nothing said on whose judgement.
--   * that two identical live edges are the same relationship. Nothing stopped
--     a second one being created, and a graph with two edges for one
--     relationship draws two different pictures of one case.
--   * that a locator is usable. The column was nullable, so `source_backed`
--     could be claimed with nothing to turn to — which is EV-005 failing
--     quietly, and EV-005 is the invariant this migration exists to make
--     observable.

-- Supersession as a pointer on the replacement, matching the deadlines pattern.
-- It has to be this way round: the original cannot be updated to point forward,
-- because the append-only trigger refuses.
ALTER TABLE graph_assertions
    ADD COLUMN supersedes_id uuid REFERENCES graph_assertions(id) ON DELETE RESTRICT;

CREATE INDEX graph_assertions_supersedes_idx ON graph_assertions(supersedes_id);

-- An assertion may replace only one predecessor, and a predecessor may be
-- replaced only once. Without this a supersession chain forks and no reader can
-- say which assertion is current.
CREATE UNIQUE INDEX graph_assertions_one_replacement_idx
    ON graph_assertions(supersedes_id) WHERE supersedes_id IS NOT NULL;

-- Who retired a relationship, and why.
ALTER TABLE graph_edges
    ADD COLUMN invalidated_by uuid REFERENCES users(id) ON DELETE RESTRICT,
    ADD COLUMN invalidation_reason text;

ALTER TABLE graph_edges
    ADD CONSTRAINT invalidation_names_an_end CHECK (
        invalidated_by IS NULL OR valid_to IS NOT NULL);

-- One live edge per relationship between two nodes. Retired edges are exempt,
-- because the same relationship can hold, stop, and hold again — and each
-- period is its own row.
CREATE UNIQUE INDEX graph_edges_live_unique_idx
    ON graph_edges(case_id, from_node_id, to_node_id, relationship)
    WHERE valid_to IS NULL;

-- A locator with nothing in it is worse than no locator: it satisfies a
-- traceability check while giving a reader nothing to turn to.
ALTER TABLE graph_evidence_links
    ADD COLUMN created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
    ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE graph_evidence_links
    ADD CONSTRAINT evidence_links_carry_a_locator CHECK (
        locator IS NOT NULL AND btrim(locator) <> '');

CREATE INDEX graph_evidence_links_evidence_idx ON graph_evidence_links(evidence_id);

-- Organisation-wide live edges, for a caseload-level view.
CREATE INDEX graph_edges_org_live_idx
    ON graph_edges(organisation_id, case_id, id) WHERE valid_to IS NULL;
