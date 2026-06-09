-- Forms storage and link-up with user tasks.
--
-- `forms` is an append-only, versioned store. Versioning mirrors
-- `process_definitions`: a new deploy with the same key allocates
-- version = max(version) + 1. The application layer skips the insert
-- when the schema is deeply equal to the previous version, so callers
-- can re-POST the same payload without churning versions.
--
-- `tenant_id` carries 'default' for now: multi-tenancy is not wired
-- anywhere else in the engine yet. The column is here so the unique
-- constraint already includes it; flipping on tenant scoping later is
-- a config change, not a migration.
--
-- `format` discriminates the schema dialect. Sprint 1 only deploys
-- form-js; the column is here so we can introduce json-schema (rjsf)
-- later without migrating existing rows.

CREATE TABLE forms (
  id          UUID         PRIMARY KEY,
  tenant_id   TEXT         NOT NULL DEFAULT 'default',
  key         VARCHAR(255) NOT NULL,
  version     INTEGER      NOT NULL,
  schema      JSONB        NOT NULL,
  format      TEXT         NOT NULL DEFAULT 'form-js'
                            CHECK (format IN ('form-js', 'json-schema')),
  ui_schema   JSONB,
  deployed_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, key, version)
);

CREATE INDEX idx_forms_latest ON forms (tenant_id, key, version DESC);

ALTER TABLE user_tasks
  ADD COLUMN form_key     VARCHAR(255),
  ADD COLUMN form_version INTEGER;

CREATE INDEX idx_user_tasks_form_key
  ON user_tasks (form_key) WHERE form_key IS NOT NULL;
