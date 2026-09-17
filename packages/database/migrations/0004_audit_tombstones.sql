-- Erasure, reconciled with an append-only audit chain.
--
-- Found by an integration test rather than by reading the code: the tombstone
-- functions in packages/privacy pass their unit tests, and the database refused
-- to execute them. `audit_log_no_update` blocked every UPDATE, and removing a
-- payload is an UPDATE, so the right to erasure could not be honoured for
-- anything recorded in the audit log. Two duties that both had to hold, and the
-- schema made one impossible.
--
-- The resolution is the one the architecture already described. An audit entry's
-- hash covers `payload_hash`, never the payload itself, so the payload can be
-- removed without touching anything the chain depends on. This narrows the
-- trigger to permit exactly that transition and nothing else.
--
-- What this deliberately does NOT permit:
--   * changing actor, action, subject, at, seq, or any hash
--   * un-tombstoning a row
--   * tombstoning a row twice, which would let a payload be replaced first
--
-- A tombstone is therefore one-way and content-only. Everything a reader needs
-- to know that an event happened, when, and by whom survives; only what was
-- recorded about it goes.

ALTER TABLE audit_log ADD COLUMN tombstoned_at timestamptz;

COMMENT ON COLUMN audit_log.tombstoned_at IS
    'Set when the payload was erased on request. The entry keeps its position, '
    'its hashes and its identity, so the chain still verifies without it.';

CREATE OR REPLACE FUNCTION audit_log_tombstone_only() RETURNS trigger AS $$
BEGIN
    -- Everything the chain is computed from must be untouched. Listed
    -- explicitly rather than compared as a row, so a column added later is a
    -- deliberate decision here rather than a silent gap.
    IF NEW.seq IS DISTINCT FROM OLD.seq
        OR NEW.at IS DISTINCT FROM OLD.at
        OR NEW.actor IS DISTINCT FROM OLD.actor
        OR NEW.action IS DISTINCT FROM OLD.action
        OR NEW.subject IS DISTINCT FROM OLD.subject
        OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash
        OR NEW.prev_hash IS DISTINCT FROM OLD.prev_hash
        OR NEW.hash IS DISTINCT FROM OLD.hash
    THEN
        RAISE EXCEPTION 'audit_log is append-only: only payload erasure is permitted';
    END IF;

    -- One direction only, and only once. Allowing a second tombstone would let
    -- a payload be substituted before erasure and leave no trace of it.
    IF OLD.tombstoned_at IS NOT NULL THEN
        RAISE EXCEPTION 'audit_log is append-only: entry % is already tombstoned', OLD.seq;
    END IF;
    IF NEW.tombstoned_at IS NULL THEN
        RAISE EXCEPTION 'audit_log is append-only: a tombstone must record when it was applied';
    END IF;

    -- The payload must actually be gone. A tombstone that leaves the content in
    -- place is the failure this exists to prevent, and it would look identical
    -- from outside.
    IF NEW.payload IS DISTINCT FROM '{}'::jsonb THEN
        RAISE EXCEPTION 'audit_log tombstone must empty the payload';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER audit_log_no_update ON audit_log;

CREATE TRIGGER audit_log_tombstone_only
    BEFORE UPDATE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION audit_log_tombstone_only();

-- DELETE stays forbidden. Erasure removes content; it does not remove the fact
-- that something happened, and a chain with a hole in it cannot be verified.
