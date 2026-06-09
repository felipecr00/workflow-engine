import type { Kysely } from "kysely";
import { v4 as uuid } from "uuid";
import type { Database, UserTaskState } from "../db/types";

export interface UserTaskRow {
  id: string;
  instance_id: string;
  token_id: string;
  element_id: string;
  task_name: string | null;
  assignee: string | null;
  candidate_groups: string[];
  state: UserTaskState;
  input_variables: Record<string, unknown>;
  output_variables: Record<string, unknown> | null;
  claimed_by: string | null;
  claimed_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
  form_key: string | null;
  form_version: number | null;
}

export async function createUserTask(
  db: Kysely<Database>,
  params: {
    instanceId: string;
    tokenId: string;
    elementId: string;
    taskName?: string;
    assignee?: string;
    candidateGroups?: string[];
    inputVariables: Record<string, unknown>;
    formKey?: string | null;
    formVersion?: number | null;
  },
): Promise<UserTaskRow> {
  const row = await db
    .insertInto("user_tasks")
    .values({
      id: uuid(),
      instance_id: params.instanceId,
      token_id: params.tokenId,
      element_id: params.elementId,
      task_name: params.taskName ?? null,
      assignee: params.assignee ?? null,
      candidate_groups: params.candidateGroups ?? [],
      input_variables: JSON.stringify(params.inputVariables) as unknown as never,
      form_key: params.formKey ?? null,
      form_version: params.formVersion ?? null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return row as UserTaskRow;
}

export async function findUserTask(
  db: Kysely<Database>,
  id: string,
): Promise<UserTaskRow | null> {
  const row = await db
    .selectFrom("user_tasks")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  return (row as UserTaskRow | undefined) ?? null;
}

export async function listUserTasks(
  db: Kysely<Database>,
  filter: {
    instanceId?: string;
    state?: UserTaskState;
    assignee?: string;
  } = {},
): Promise<UserTaskRow[]> {
  let q = db.selectFrom("user_tasks").selectAll();
  if (filter.instanceId) {
    q = q.where("instance_id", "=", filter.instanceId);
  }
  if (filter.state) {
    q = q.where("state", "=", filter.state);
  }
  if (filter.assignee) {
    q = q.where("assignee", "=", filter.assignee);
  }
  const rows = await q.orderBy("created_at", "desc").limit(200).execute();
  return rows as UserTaskRow[];
}

export async function listUserTasksForInstance(
  db: Kysely<Database>,
  instanceId: string,
): Promise<UserTaskRow[]> {
  const rows = await db
    .selectFrom("user_tasks")
    .selectAll()
    .where("instance_id", "=", instanceId)
    .orderBy("created_at", "asc")
    .execute();
  return rows as UserTaskRow[];
}

export async function claimUserTask(
  db: Kysely<Database>,
  id: string,
  claimedBy: string,
): Promise<void> {
  const now = new Date();
  await db
    .updateTable("user_tasks")
    .set({
      state: "claimed",
      claimed_by: claimedBy,
      claimed_at: now,
      assignee: claimedBy,
      updated_at: now,
    })
    .where("id", "=", id)
    .where("state", "in", ["created", "claimed"])
    .execute();
}

export async function markUserTaskCompleted(
  db: Kysely<Database>,
  id: string,
  output: Record<string, unknown> | undefined,
): Promise<void> {
  const now = new Date();
  await db
    .updateTable("user_tasks")
    .set({
      state: "completed",
      output_variables: (output
        ? JSON.stringify(output)
        : null) as unknown as never,
      completed_at: now,
      updated_at: now,
    })
    .where("id", "=", id)
    .execute();
}

export async function cancelUserTask(
  db: Kysely<Database>,
  id: string,
): Promise<void> {
  await db
    .updateTable("user_tasks")
    .set({
      state: "cancelled",
      updated_at: new Date(),
    })
    .where("id", "=", id)
    .where("state", "in", ["created", "claimed"])
    .execute();
}
