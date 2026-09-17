-- The evidence foundation.
--
-- `evidence_items` has been a stub since 0001: a title, a category and a status
-- describing whether somebody sent a thing. EV-001 has reported *failed* for the
-- whole programme because of it — its observer looks for a checksum column and
-- does not find one. See docs/EVIDENCE_INVENTORY.md.
--
-- The distinctions this migration insists on, because collapsing any of them is
-- how an evidence store becomes an attachments table:
--
--   * the logical item is not the file. A corrected scan is a new file version
--     of the same item, and every citation to that item stays valid.
--   * the file is not its provenance. Bytes and a digest say what something is;
--     provenance says how it got here and on whose word.
--   * file integrity is not source authenticity is not professional
--     interpretation. Three different claims, three different states, and a
--     single `verified` flag would let the weakest stand in for the strongest.
--   * availability is not existence. An evidence item whose file is gone must
--     not read as evidence.
--
-- One identity, extended. `evidence_items` keeps its id, so every existing
-- foreign key from tasks, the graph and the bootstrap stays valid.

-- ---------------------------------------------------------------------------
-- The logical item
-- ---------------------------------------------------------------------------

ALTER TABLE evidence_items
    -- Tenancy reachable without a join. Every repository proves the
    -- organisation before it reads; this lets the predicate be written.
    ADD COLUMN organisation_id uuid REFERENCES organizations(id) ON DELETE CASCADE,

    -- A bounded vocabulary beside the legacy free-text `category`, which is
    -- left alone rather than migrated on a guess about what its values mean.
    ADD COLUMN evidence_type text NOT NULL DEFAULT 'other' CHECK (evidence_type IN (
                        'identity_document', 'correspondence', 'decision_letter',
                        'medical_report', 'expert_report', 'witness_statement',
                        'financial_record', 'employment_record', 'photograph',
                        'audio', 'video', 'messaging_export', 'country_evidence',
                        'court_document', 'other')),
    ADD COLUMN description text,

    -- How this item is known to be what it claims. The refined vocabulary the
    -- graph lacked: a client's account and a solicitor's confirmation are
    -- different things and must not share a value.
    ADD COLUMN source_classification text NOT NULL DEFAULT 'person_reported'
                       CHECK (source_classification IN (
                        'person_reported', 'document_supported',
                        'professional_confirmed', 'model_inferred')),

    -- Four separate claims, never collapsed into one boolean. `digest_verified`
    -- says the bytes are the bytes; it says nothing about whether the document
    -- is genuine, and `source_verified` says nothing about whether a
    -- professional accepts what it shows.
    ADD COLUMN verification_state text NOT NULL DEFAULT 'unverified'
                       CHECK (verification_state IN (
                        'unverified', 'digest_verified', 'source_verified',
                        'professionally_verified', 'disputed', 'unavailable',
                        'superseded')),

    ADD COLUMN sensitivity text NOT NULL DEFAULT 'standard' CHECK (sensitivity IN (
                        'standard', 'sensitive', 'special_category')),
    ADD COLUMN retention_state text NOT NULL DEFAULT 'active' CHECK (retention_state IN (
                        'active', 'restricted', 'erasure_requested', 'erased')),

    ADD COLUMN created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
    ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
    -- Integer, matching every other concurrency token in the platform. A
    -- timestamp token loses to JavaScript date precision; a counter cannot.
    ADD COLUMN version integer NOT NULL DEFAULT 1;

-- Backfill tenancy from the case, then require it. Rows exist from the
-- bootstrap, so this cannot be NOT NULL on creation.
UPDATE evidence_items e
   SET organisation_id = w.organization_id
  FROM cases c JOIN workspaces w ON w.id = c.workspace_id
 WHERE c.id = e.case_id AND e.organisation_id IS NULL;

ALTER TABLE evidence_items ALTER COLUMN organisation_id SET NOT NULL;

CREATE INDEX evidence_items_case_active_idx
    ON evidence_items(case_id, evidence_type, created_at, id)
    WHERE retention_state <> 'erased';
CREATE INDEX evidence_items_org_idx ON evidence_items(organisation_id, created_at, id);

-- ---------------------------------------------------------------------------
-- File versions
-- ---------------------------------------------------------------------------

-- A physical version of the bytes. Never overwritten: a corrected file is a new
-- version, and the citation to version 1 stays meaningful.
CREATE TABLE evidence_files (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    evidence_id       uuid NOT NULL REFERENCES evidence_items(id) ON DELETE RESTRICT,
    version           integer NOT NULL,

    -- The storage system is not this database. `development_filesystem` is
    -- named for exactly what it is, so nothing in a report can imply a
    -- production object store that does not exist.
    storage_provider  text NOT NULL CHECK (storage_provider IN (
                          'development_filesystem', 'none')),
    storage_key       text NOT NULL,

    original_filename text,
    media_type        text NOT NULL,
    byte_size         bigint NOT NULL CHECK (byte_size >= 0),

    -- The content identity. EV-001 exists for this column.
    digest            char(64) NOT NULL,
    digest_algorithm  text NOT NULL DEFAULT 'sha-256'
                          CHECK (digest_algorithm IN ('sha-256')),

    uploaded_by       uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    uploaded_at       timestamptz NOT NULL DEFAULT now(),

    -- Whether the bytes are actually retrievable now. `pending` is the state
    -- between a database row and a completed upload, and it is why an evidence
    -- item is never reported available on the strength of a row existing.
    availability      text NOT NULL DEFAULT 'pending' CHECK (availability IN (
                          'pending', 'available', 'unavailable', 'quarantined')),

    -- Declared, never assumed. `not_scanned` is the honest default and no
    -- report may describe it as clean.
    scan_state        text NOT NULL DEFAULT 'not_scanned' CHECK (scan_state IN (
                          'not_scanned', 'clean', 'infected', 'scan_failed')),
    encryption_state  text NOT NULL DEFAULT 'none' CHECK (encryption_state IN (
                          'none', 'provider_managed')),
    key_reference     text,

    superseded_by     uuid REFERENCES evidence_files(id) ON DELETE RESTRICT,

    CONSTRAINT one_file_per_version UNIQUE (evidence_id, version),
    -- A superseded file is not the current one, whatever its availability says.
    CONSTRAINT superseded_files_are_not_available CHECK (
        superseded_by IS NULL OR availability <> 'available'),
    -- Encryption is claimed only with a key to point at.
    CONSTRAINT encryption_names_its_key CHECK (
        encryption_state = 'none' OR key_reference IS NOT NULL)
);

CREATE INDEX evidence_files_item_idx ON evidence_files(evidence_id, version DESC, id);
CREATE INDEX evidence_files_digest_idx ON evidence_files(digest);
CREATE UNIQUE INDEX evidence_files_one_replacement_idx
    ON evidence_files(superseded_by) WHERE superseded_by IS NOT NULL;

-- The current version, once the table it points at exists.
ALTER TABLE evidence_items
    ADD COLUMN current_file_id uuid REFERENCES evidence_files(id) ON DELETE RESTRICT;

-- ---------------------------------------------------------------------------
-- Provenance
-- ---------------------------------------------------------------------------

-- How an item entered the system, on whose word. Append-only: a corrected
-- provenance statement is a new record pointing at the old one, because
-- "the client said it came from the Home Office, and later said otherwise" is
-- two facts and the second does not erase the first.
CREATE TABLE evidence_provenance (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    evidence_id        uuid NOT NULL REFERENCES evidence_items(id) ON DELETE RESTRICT,

    acquisition        text NOT NULL CHECK (acquisition IN (
                           'client_supplied', 'solicitor_supplied',
                           'authority_supplied', 'court_supplied',
                           'system_generated', 'model_derived', 'imported',
                           'photographed', 'scanned')),

    source_actor       text,
    source_organisation text,
    acquired_at        timestamptz,
    original_locator   text,
    custody_note       text,

    asserted_by        uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    asserted_at        timestamptz NOT NULL DEFAULT now(),

    external_reference text,
    external_digest    char(64),

    -- The execution behind model-derived material, so it is reproducible.
    execution_id       uuid REFERENCES ai_executions(id) ON DELETE RESTRICT,

    supersedes_id      uuid REFERENCES evidence_provenance(id) ON DELETE RESTRICT,

    CONSTRAINT model_derived_provenance_cites_an_execution CHECK (
        acquisition <> 'model_derived' OR execution_id IS NOT NULL)
);

CREATE INDEX evidence_provenance_item_idx ON evidence_provenance(evidence_id, asserted_at, id);
CREATE UNIQUE INDEX evidence_provenance_one_replacement_idx
    ON evidence_provenance(supersedes_id) WHERE supersedes_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Derivations
-- ---------------------------------------------------------------------------

-- An OCR text layer, a translation or a redaction is a new evidence item that
-- exists because of another. EV-004 is about exactly this link.
CREATE TABLE evidence_derivations (
    derived_id   uuid NOT NULL REFERENCES evidence_items(id) ON DELETE RESTRICT,
    source_id    uuid NOT NULL REFERENCES evidence_items(id) ON DELETE RESTRICT,
    kind         text NOT NULL CHECK (kind IN (
                     'ocr', 'translation', 'redaction', 'extract', 'transcript')),
    engine       text,
    engine_version text,
    execution_id uuid REFERENCES ai_executions(id) ON DELETE RESTRICT,
    created_by   uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (derived_id, source_id, kind),
    CONSTRAINT a_derivation_is_not_its_own_source CHECK (derived_id <> source_id)
);

CREATE INDEX evidence_derivations_source_idx ON evidence_derivations(source_id);

-- ---------------------------------------------------------------------------
-- History
-- ---------------------------------------------------------------------------

CREATE TABLE evidence_events (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- RESTRICT: recorded history pins the item it describes.
    evidence_id uuid NOT NULL REFERENCES evidence_items(id) ON DELETE RESTRICT,
    event       text NOT NULL CHECK (event IN (
                    'created', 'provenance_recorded', 'file_attached',
                    'file_available', 'file_superseded', 'digest_verified',
                    'source_verified', 'professionally_verified', 'disputed',
                    'unavailable', 'derivation_recorded', 'commented')),
    actor_id    uuid REFERENCES users(id) ON DELETE RESTRICT,
    detail      text,
    at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX evidence_events_item_idx ON evidence_events(evidence_id, id);

CREATE TRIGGER evidence_events_no_change
    BEFORE UPDATE OR DELETE ON evidence_events
    FOR EACH ROW EXECUTE FUNCTION records_are_append_only();

CREATE TRIGGER evidence_events_no_truncate
    BEFORE TRUNCATE ON evidence_events
    FOR EACH STATEMENT EXECUTE FUNCTION refuse_truncate();

CREATE TRIGGER evidence_provenance_no_change
    BEFORE UPDATE OR DELETE ON evidence_provenance
    FOR EACH ROW EXECUTE FUNCTION records_are_append_only();

CREATE TRIGGER evidence_provenance_no_truncate
    BEFORE TRUNCATE ON evidence_provenance
    FOR EACH STATEMENT EXECUTE FUNCTION refuse_truncate();

-- A file version records what bytes were received. Correcting it means a new
-- version, never an edit to the old one.
CREATE TRIGGER evidence_files_no_delete
    BEFORE DELETE ON evidence_files
    FOR EACH ROW EXECUTE FUNCTION records_are_append_only();

CREATE TRIGGER evidence_files_no_truncate
    BEFORE TRUNCATE ON evidence_files
    FOR EACH STATEMENT EXECUTE FUNCTION refuse_truncate();

-- ---------------------------------------------------------------------------
-- Compatibility corrections
-- ---------------------------------------------------------------------------

-- RESTRICT everywhere else, CASCADE here. A deleted evidence item would have
-- silently dropped its task links, and the item cannot be deleted anyway once
-- it carries history — so the cascade only ever described something impossible.
ALTER TABLE task_evidence_links
    DROP CONSTRAINT task_evidence_links_evidence_id_fkey,
    ADD CONSTRAINT task_evidence_links_evidence_id_fkey
        FOREIGN KEY (evidence_id) REFERENCES evidence_items(id) ON DELETE RESTRICT;

-- The refined classification the graph lacked, added rather than remapped.
-- Existing `human_confirmed` rows keep their value: nothing here knows whether
-- a given one was a client's account or a solicitor's confirmation, and
-- guessing would rewrite history on an assumption.
ALTER TABLE graph_assertions DROP CONSTRAINT graph_assertions_assertion_type_check;
ALTER TABLE graph_assertions ADD CONSTRAINT graph_assertions_assertion_type_check CHECK (
    assertion_type IN (
        'machine_proposed', 'person_reported', 'source_backed',
        'human_confirmed', 'disputed'));

-- A person's report is relayed by a named person, like a confirmation.
ALTER TABLE graph_assertions DROP CONSTRAINT human_assertions_name_a_person;
ALTER TABLE graph_assertions ADD CONSTRAINT human_assertions_name_a_person CHECK (
    assertion_type NOT IN ('human_confirmed', 'person_reported')
    OR asserted_by_type = 'user');
