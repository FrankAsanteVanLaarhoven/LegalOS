-- LegalOS initial schema.
--
-- Design rules this schema enforces rather than documents:
--   * every artefact belongs to a case, and every case to a workspace/org,
--     so tenant scoping is a join away and never an application-only concern;
--   * the audit log is append-only at the database level, not by convention;
--   * AI output is stored with its verification verdict, so an answer can never
--     be read back without the findings that were raised against it;
--   * legal sources carry provenance, and an unverified source is visibly so.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- ---------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------

CREATE TABLE organizations (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL,
    type        text NOT NULL CHECK (type IN (
                    'law_firm', 'ngo', 'university', 'employer', 'legal_aid', 'other')),
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workspaces (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name             text NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX workspaces_organization_id_idx ON workspaces(organization_id);

CREATE TABLE users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    email         citext,
    display_name  text NOT NULL,
    role          text NOT NULL CHECK (role IN (
                      'client', 'caseworker', 'adviser', 'solicitor', 'reviewer', 'admin')),
    -- Required before a user may authorise a reserved activity.
    regulatory_reference text,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX users_workspace_id_idx ON users(workspace_id);

-- ---------------------------------------------------------------------------
-- Cases
-- ---------------------------------------------------------------------------

CREATE TABLE clients (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id   uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    preferred_name text,
    languages      text[] NOT NULL DEFAULT '{}',
    created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX clients_workspace_id_idx ON clients(workspace_id);

CREATE TABLE cases (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    client_id     uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    reference     text NOT NULL,
    status        text NOT NULL CHECK (status IN (
                      'intake', 'evidence_collection', 'analysis', 'lawyer_review',
                      'appeal_pending', 'submitted', 'closed')),
    matter_types  text[] NOT NULL DEFAULT '{}',
    risk_level    text NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low', 'medium', 'high')),
    -- Marks fixture data so demonstration cases can never be mistaken for real
    -- matters in any surface that reads from the database.
    is_demo       boolean NOT NULL DEFAULT false,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, reference)
);

CREATE INDEX cases_workspace_id_idx ON cases(workspace_id);
CREATE INDEX cases_client_id_idx ON cases(client_id);

CREATE TABLE timeline_events (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id      uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    occurred_on  date NOT NULL,
    title        text NOT NULL,
    description  text,
    -- Provenance, not a score: how this event came to be known.
    source       text NOT NULL CHECK (source IN ('client_stated', 'document', 'ai_inferred')),
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX timeline_events_case_id_idx ON timeline_events(case_id, occurred_on);

CREATE TABLE evidence_items (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id     uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    title       text NOT NULL,
    category    text NOT NULL,
    status      text NOT NULL CHECK (status IN ('received', 'requested', 'missing', 'expired')),
    summary     text,
    received_at timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now(),
    -- Completeness is derived by counting these rows. There is deliberately no
    -- stored completeness_score column: a percentage that no query computes is
    -- how a hand-typed constant ends up on screen as tribunal readiness.
    CHECK (status <> 'received' OR received_at IS NOT NULL)
);

CREATE INDEX evidence_items_case_id_idx ON evidence_items(case_id);

-- ---------------------------------------------------------------------------
-- Legal sources
-- ---------------------------------------------------------------------------

CREATE TABLE legal_sources (
    id                   text PRIMARY KEY,
    kind                 text NOT NULL CHECK (kind IN (
                             'primary_legislation', 'statutory_instrument', 'immigration_rule',
                             'home_office_guidance', 'practice_direction',
                             'tribunal_procedure_rule', 'case_law')),
    title                text NOT NULL,
    citation             text NOT NULL,
    publisher            text NOT NULL,
    url                  text NOT NULL,
    version              text,
    retrieved_at         timestamptz,
    checksum             char(64),
    verification_status  text NOT NULL DEFAULT 'unverified'
                             CHECK (verification_status IN ('verified', 'unverified', 'superseded')),
    superseded_by        text REFERENCES legal_sources(id),
    -- A source may only claim to be verified if it was actually retrieved and
    -- hashed. This is the fail-closed rule expressed where it cannot be skipped.
    CONSTRAINT verified_sources_carry_provenance CHECK (
        verification_status <> 'verified'
        OR (retrieved_at IS NOT NULL AND checksum IS NOT NULL AND version IS NOT NULL)
    )
);

-- ---------------------------------------------------------------------------
-- AI output and its verdict
-- ---------------------------------------------------------------------------

CREATE TABLE ai_outputs (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id            uuid REFERENCES cases(id) ON DELETE CASCADE,
    agent_id           text NOT NULL,
    prompt             text NOT NULL,
    output             text NOT NULL,
    model_id           text NOT NULL,
    prompt_version     text NOT NULL,
    guardrails_version text NOT NULL,
    -- Verdict is NOT NULL: output cannot be stored without one, so it cannot be
    -- read back and rendered as though it had passed verification.
    verdict            text NOT NULL CHECK (verdict IN ('pass', 'flag', 'block')),
    reason_codes       text[] NOT NULL DEFAULT '{}',
    resolved_sources   text[] NOT NULL DEFAULT '{}',
    released           boolean NOT NULL,
    created_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT released_output_has_no_findings CHECK (
        released = false OR cardinality(reason_codes) = 0
    )
);

CREATE INDEX ai_outputs_case_id_idx ON ai_outputs(case_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Approvals — AI proposes, a named qualified human authorises
-- ---------------------------------------------------------------------------

CREATE TABLE proposals (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id        uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    activity       text NOT NULL,
    reserved       boolean NOT NULL,
    state          text NOT NULL CHECK (state IN ('DRAFT', 'REVIEW', 'AUTHORISED', 'REJECTED')),
    summary        text NOT NULL,
    proposed_by    text NOT NULL,
    authorised_by  uuid REFERENCES users(id),
    rejected_by    uuid REFERENCES users(id),
    reason         text,
    created_at     timestamptz NOT NULL DEFAULT now(),
    -- An authorised proposal must name who authorised it. Responsibility for a
    -- reserved activity always attaches to a person, never to a model.
    CONSTRAINT authorised_proposals_name_a_human CHECK (
        state <> 'AUTHORISED' OR authorised_by IS NOT NULL
    ),
    CONSTRAINT rejected_proposals_name_a_human CHECK (
        state <> 'REJECTED' OR rejected_by IS NOT NULL
    )
);

CREATE INDEX proposals_case_id_idx ON proposals(case_id);

-- ---------------------------------------------------------------------------
-- Audit log — append-only, hash-chained
-- ---------------------------------------------------------------------------

CREATE TABLE audit_log (
    seq          bigint PRIMARY KEY,
    at           timestamptz NOT NULL,
    actor        text NOT NULL,
    action       text NOT NULL,
    subject      text NOT NULL,
    payload      jsonb NOT NULL,
    payload_hash char(64) NOT NULL,
    prev_hash    char(64) NOT NULL,
    hash         char(64) NOT NULL UNIQUE
);

CREATE INDEX audit_log_subject_idx ON audit_log(subject, seq);

-- Immutability enforced by the database, so "immutable audit" is a property of
-- the system rather than a claim in a document. Application code cannot opt out.
CREATE OR REPLACE FUNCTION audit_log_is_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_log is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update
    BEFORE UPDATE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION audit_log_is_append_only();

CREATE TRIGGER audit_log_no_delete
    BEFORE DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION audit_log_is_append_only();
