-- Carry the human-readable process name on each instance so lists, tables,
-- detail views and dashboards can display the user-defined name (e.g.
-- "Employee Onboarding") instead of the technical process key (e.g.
-- "Process_1"). The name is snapshotted at instance-creation time from the
-- deployed definition, keeping it stable across later re-deploys/versions.

ALTER TABLE process_instances ADD COLUMN definition_name VARCHAR;

-- Backfill existing instances from their deployed definition's name.
UPDATE process_instances pi
SET definition_name
= pd.name
FROM process_definitions pd
WHERE pi.definition_id = pd.id
  AND pi.definition_name IS NULL;

CREATE INDEX idx_instances_definition_name ON process_instances (definition_name);
