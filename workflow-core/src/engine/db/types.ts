import type { Generated, JSONColumnType } from "kysely";

export type InstanceState = "active" | "completed" | "terminated" | "suspended";
export type TokenState = "active" | "waiting" | "completed" | "incident";
export type JobState = "pending" | "active" | "completed" | "failed" | "incident";
export type TimerType = "duration" | "date" | "cycle";
export type TimerStateValue = "active" | "fired" | "cancelled";
export type IncidentType =
  | "job_retries_exhausted"
  | "expression_error"
  | "timer_error"
  | "unhandled_error";
export type IncidentStateValue = "active" | "resolved";

export interface ProcessDefinitionsTable {
  id: string;
  key: string;
  version: number;
  name: string | null;
  bpmn_xml: string;
  deployed_at: Generated<Date>;
  is_active: Generated<boolean>;
}

export interface ProcessInstancesTable {
  id: string;
  definition_id: string;
  definition_key: string;
  definition_version: number;
  state: Generated<InstanceState>;
  variables: JSONColumnType<Record<string, unknown>>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  ended_at: Date | null;
  correlation_key: string | null;
}

export interface TokensTable {
  id: string;
  instance_id: string;
  element_id: string;
  element_type: string;
  state: Generated<TokenState>;
  scope_id: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface JobsTable {
  id: string;
  instance_id: string;
  token_id: string;
  element_id: string;
  job_type: string;
  state: Generated<JobState>;
  input_variables: JSONColumnType<Record<string, unknown>>;
  output_variables: JSONColumnType<Record<string, unknown> | null> | null;
  retries_total: Generated<number>;
  retries_remaining: Generated<number>;
  error_code: string | null;
  error_message: string | null;
  worker_id: string | null;
  lock_expires_at: Date | null;
  scheduled_at: Generated<Date>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface TimersTable {
  id: string;
  instance_id: string;
  token_id: string | null;
  element_id: string;
  timer_type: TimerType;
  due_at: Date;
  state: Generated<TimerStateValue>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface IncidentsTable {
  id: string;
  instance_id: string;
  token_id: string | null;
  job_id: string | null;
  type: IncidentType;
  state: Generated<IncidentStateValue>;
  error_message: string;
  created_at: Generated<Date>;
  resolved_at: Date | null;
  resolved_by: string | null;
}

export type UserTaskState = "created" | "claimed" | "completed" | "cancelled";

export interface UserTasksTable {
  id: string;
  instance_id: string;
  token_id: string;
  element_id: string;
  task_name: string | null;
  assignee: string | null;
  candidate_groups: string[];
  state: Generated<UserTaskState>;
  input_variables: JSONColumnType<Record<string, unknown>>;
  output_variables: JSONColumnType<Record<string, unknown> | null> | null;
  claimed_by: string | null;
  claimed_at: Date | null;
  completed_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface AuditLogTable {
  id: string;
  instance_id: string;
  token_id: string | null;
  job_id: string | null;
  timer_id: string | null;
  incident_id: string | null;
  event_type: string;
  element_id: string | null;
  element_type: string | null;
  metadata: JSONColumnType<Record<string, unknown>>;
  occurred_at: Generated<Date>;
}

export interface FoldersTable {
  id: string;
  name: string;
  parent_id: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ProjectsTable {
  id: string;
  name: string;
  folder_id: string | null;
  bpmn_xml: string;
  description: string | null;
  deployed_definition_id: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface Database {
  process_definitions: ProcessDefinitionsTable;
  process_instances: ProcessInstancesTable;
  tokens: TokensTable;
  jobs: JobsTable;
  timers: TimersTable;
  incidents: IncidentsTable;
  user_tasks: UserTasksTable;
  audit_log: AuditLogTable;
  folders: FoldersTable;
  projects: ProjectsTable;
}
