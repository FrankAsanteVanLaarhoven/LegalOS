-- Authentication, with recovery as a precondition rather than a setting.
--
-- The ordering in this schema is the design. An account does not become usable
-- and then acquire recovery later; it cannot reach `active` until recovery is
-- adequate, because for this cohort a locked account is not an inconvenience.
-- Phones are shared and numbers change, and the account may hold the only copy
-- of someone's asylum evidence.

CREATE TABLE accounts (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- What to call them. Deliberately not a legal name: requiring one to open
    -- an account excludes people whose safety depends on not disclosing it.
    preferred_name  text NOT NULL,
    status          text NOT NULL DEFAULT 'pending_recovery' CHECK (status IN (
                        'pending_recovery',  -- contact verified, recovery inadequate
                        'active',
                        'suspended',
                        'closed')),
    created_at      timestamptz NOT NULL DEFAULT now(),
    -- Set when recovery first became adequate. An account may not be `active`
    -- without it, enforced below rather than left to application code.
    recovery_ready_at timestamptz,
    CONSTRAINT active_accounts_can_be_recovered CHECK (
        status <> 'active' OR recovery_ready_at IS NOT NULL
    )
);

-- Contact channels. Either email or phone is enough to open an account.
CREATE TABLE account_contacts (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    channel     text NOT NULL CHECK (channel IN ('email', 'phone')),
    value       text NOT NULL,
    verified_at timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (channel, value)
);

CREATE INDEX account_contacts_account_id_idx ON account_contacts(account_id);

-- Authentication factors.
--
-- `bound_to_contact` records the dependency that matters for recovery: a factor
-- delivered to a phone dies with that phone. Factors with a NULL binding
-- (passkeys, authenticator apps, recovery codes) survive losing it, which is
-- what `assessRecovery` in @legalos/identity checks for.
CREATE TABLE auth_factors (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id        uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    factor            text NOT NULL CHECK (factor IN (
                          'passkey', 'authenticator_app', 'email_code',
                          'sms_code', 'whatsapp_code', 'recovery_codes')),
    bound_to_contact  uuid REFERENCES account_contacts(id) ON DELETE CASCADE,
    -- Public key for passkeys; a hash for everything else. Never a secret.
    material          text NOT NULL,
    label             text,
    enrolled_at       timestamptz NOT NULL DEFAULT now(),
    last_used_at      timestamptz,
    revoked_at        timestamptz
);

CREATE INDEX auth_factors_account_id_idx ON auth_factors(account_id) WHERE revoked_at IS NULL;

-- Single-use recovery codes, stored only as hashes.
CREATE TABLE recovery_codes (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    code_hash   char(64) NOT NULL,
    used_at     timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (account_id, code_hash)
);

CREATE INDEX recovery_codes_account_id_idx ON recovery_codes(account_id) WHERE used_at IS NULL;

-- Sessions.
--
-- Short-lived and rotated. `revoked_at` rather than DELETE so a person can see
-- that a device was signed out and when — device management is a safety feature
-- for someone who may have been coerced into handing over a phone.
CREATE TABLE sessions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    -- sha-256 of the session token. The token itself is never stored.
    token_hash      char(64) NOT NULL UNIQUE,
    -- Rotates on refresh; the previous hash is kept briefly to detect replay.
    previous_hash   char(64),
    device_label    text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    last_seen_at    timestamptz NOT NULL DEFAULT now(),
    expires_at      timestamptz NOT NULL,
    revoked_at      timestamptz,
    revoked_reason  text,
    CONSTRAINT sessions_expire CHECK (expires_at > created_at)
);

CREATE INDEX sessions_account_id_idx ON sessions(account_id) WHERE revoked_at IS NULL;
CREATE INDEX sessions_expiry_idx ON sessions(expires_at) WHERE revoked_at IS NULL;

-- Workspace membership and role. Tenancy is a property of the membership, not
-- of the account, so one person may act in several organisations without
-- carrying permissions between them.
CREATE TABLE workspace_members (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    role          text NOT NULL CHECK (role IN (
                      'client', 'caseworker', 'adviser', 'solicitor', 'reviewer', 'admin')),
    -- Required before this member may authorise a reserved activity.
    regulatory_reference text,
    invited_by    uuid REFERENCES accounts(id),
    joined_at     timestamptz NOT NULL DEFAULT now(),
    removed_at    timestamptz,
    UNIQUE (workspace_id, account_id)
);

CREATE INDEX workspace_members_account_idx ON workspace_members(account_id) WHERE removed_at IS NULL;
CREATE INDEX workspace_members_workspace_idx ON workspace_members(workspace_id) WHERE removed_at IS NULL;
