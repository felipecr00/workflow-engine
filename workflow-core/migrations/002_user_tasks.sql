CREATE TYPE user_task_state AS ENUM ('created', 'claimed', 'completed', 'cancelled');

CREATE TABLE user_tasks (
  id                UUID             PRIMARY KEY,
  instance_id       UUID             NOT NULL REFERENCES process_instances(id),
  token_id          UUID             NOT NULL REFERENCES tokens(id),
  element_id        VARCHAR          NOT NULL,
  task_name         VARCHAR,
  assignee          VARCHAR,
  candidate_groups  TEXT[]           NOT NULL DEFAULT '{}',
  state             user_task_state  NOT NULL DEFAULT 'created',
  input_variables   JSONB            NOT NULL DEFAULT '{}'::jsonb,
  output_variables  JSONB,
  claimed_by        VARCHAR,
  claimed_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_tasks_instance ON user_tasks (instance_id);
CREATE INDEX idx_user_tasks_state    ON user_tasks (state) WHERE state IN ('created', 'claimed');
CREATE INDEX idx_user_tasks_assignee ON user_tasks (assignee) WHERE assignee IS NOT NULL;
