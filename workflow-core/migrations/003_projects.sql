-- Folders for organising diagrams (tree structure via parent_id)
CREATE TABLE folders (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR     NOT NULL,
  parent_id   UUID        REFERENCES folders(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_folders_parent ON folders(parent_id);

-- Projects hold saved BPMN diagrams
CREATE TABLE projects (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name              VARCHAR     NOT NULL,
  folder_id         UUID        REFERENCES folders(id) ON DELETE SET NULL,
  bpmn_xml          TEXT        NOT NULL,
  description       VARCHAR,
  deployed_definition_id UUID   REFERENCES process_definitions(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_projects_folder ON projects(folder_id);
