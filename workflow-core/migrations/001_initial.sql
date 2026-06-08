-- Phase 1 initial schema. Phase 2 (timers, retries, incidents) and Phase 3
-- (versioning extensions) are already provided for; only writes/reads to
-- those tables are added in their respective phases.

CREATE TYPE instance_state AS ENUM (
  'active', 'completed', 'terminated', 'suspended'
);

CREATE TYPE token_state AS ENUM (
  'active', 'waiting', 'completed', 'incident'
);

CREATE TYPE job_state AS ENUM (
  'pending', 'active', 'completed', 'failed', 'incident'
);

CREATE TYPE timer_type AS ENUM ('duration', 'date', 'cycle');
CREATE TYPE timer_state AS ENUM ('active', 'fired', 'cancelled');

CREATE TYPE incident_type AS ENUM (
  'job_retries_exhausted',
  'expression_error',
  'timer_error',
  'unhandled_error'
);
CREATE TYPE incident_state AS ENUM ('active', 'resolved');

CREATE TABLE process_definitions (
  id           UUID         PRIMARY KEY,
  key          VARCHAR      NOT NULL,
  version      INTEGER      NOT NULL,
  name         VARCHAR,
  bpmn_xml     TEXT         NOT NULL,
  deployed_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  is_active    BOOLEAN      NOT NULL DEFAULT TRUE,
  CONSTRAINT uq_definition_key_version UNIQUE (key, version)
);
CREATE INDEX idx_definitions_key ON process_definitions (key);

CREATE TABLE process_instances (
  id                  UUID            PRIMARY KEY,
  definition_id       UUID            NOT NULL REFERENCES process_definitions(id),
  definition_key      VARCHAR         NOT NULL,
  definition_version  INTEGER         NOT NULL,
  state               instance_state  NOT NULL DEFAULT 'active',
  variables           JSONB           NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  ended_at            TIMESTAMPTZ,
  correlation_key     VARCHAR
);
CREATE INDEX idx_instances_state      ON process_instances (state);
CREATE INDEX idx_instances_definition ON process_instances (definition_key, definition_version);

CREATE TABLE tokens (
  id            UUID         PRIMARY KEY,
  instance_id   UUID         NOT NULL REFERENCES process_instances(id),
  element_id    VARCHAR      NOT NULL,
  element_type  VARCHAR      NOT NULL,
  state         token_state  NOT NULL DEFAULT 'active',
  scope_id      UUID,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_tokens_instance ON tokens (instance_id);
CREATE INDEX idx_tokens_state    ON tokens (state);

CREATE TABLE jobs (
  id                 UUID        PRIMARY KEY,
  instance_id        UUID        NOT NULL REFERENCES process_instances(id),
  token_id           UUID        NOT NULL REFERENCES tokens(id),
  element_id         VARCHAR     NOT NULL,
  job_type           VARCHAR     NOT NULL,
  state              job_state   NOT NULL DEFAULT 'pending',
  input_variables    JSONB       NOT NULL DEFAULT '{}'::jsonb,
  output_variables   JSONB,
  retries_total      INTEGER     NOT NULL DEFAULT 3,
  retries_remaining  INTEGER     NOT NULL DEFAULT 3,
  error_code         VARCHAR,
  error_message      TEXT,
  worker_id          VARCHAR,
  lock_expires_at    TIMESTAMPTZ,
  scheduled_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_jobs_state_scheduled
  ON jobs (state, scheduled_at)
  WHERE state IN ('pending', 'failed');

CREATE TABLE timers (
  id           UUID         PRIMARY KEY,
  instance_id  UUID         NOT NULL REFERENCES process_instances(id),
  token_id     UUID         REFERENCES tokens(id),
  element_id   VARCHAR      NOT NULL,
  timer_type   timer_type   NOT NULL,
  due_at       TIMESTAMPTZ  NOT NULL,
  state        timer_state  NOT NULL DEFAULT 'active',
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_timers_state_due
  ON timers (state, due_at)
  WHERE state = 'active';

CREATE TABLE incidents (
  id             UUID            PRIMARY KEY,
  instance_id    UUID            NOT NULL REFERENCES process_instances(id),
  token_id       UUID            REFERENCES tokens(id),
  job_id         UUID            REFERENCES jobs(id),
  type           incident_type   NOT NULL,
  state          incident_state  NOT NULL DEFAULT 'active',
  error_message  TEXT            NOT NULL,
  created_at     TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  resolved_at    TIMESTAMPTZ,
  resolved_by    VARCHAR
);
CREATE INDEX idx_incidents_instance ON incidents (instance_id);
CREATE INDEX idx_incidents_state    ON incidents (state);

CREATE TABLE audit_log (
  id            UUID         PRIMARY KEY,
  instance_id   UUID         NOT NULL REFERENCES process_instances(id),
  token_id      UUID,
  job_id        UUID,
  timer_id      UUID,
  incident_id   UUID,
  event_type    VARCHAR      NOT NULL,
  element_id    VARCHAR,
  element_type  VARCHAR,
  metadata      JSONB        NOT NULL DEFAULT '{}'::jsonb,
  occurred_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_audit_instance   ON audit_log (instance_id, occurred_at);
CREATE INDEX idx_audit_event_type ON audit_log (event_type);
