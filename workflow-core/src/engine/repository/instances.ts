import type { Kysely } from 'kysely';
import { v4 as uuid } from 'uuid';
import type { Database, InstanceState } from '../db/types';

export interface ProcessInstanceRow {
  id: string;
  definition_id: string;
  definition_key: string;
  definition_version: number;
  definition_name: string | null;
  state: InstanceState;
  variables: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  ended_at: Date | null;
  correlation_key: string | null;
}

export async function createInstance(
  db: Kysely<Database>,
  params: {
    definitionId: string;
    definitionKey: string;
    definitionVersion: number;
    definitionName: string | null;
    variables: Record<string, unknown>;
  },
): Promise<ProcessInstanceRow> {
  const row = await db
    .insertInto('process_instances')
    .values({
      id: uuid(),
      definition_id: params.definitionId,
      definition_key: params.definitionKey,
      definition_version: params.definitionVersion,
      definition_name: params.definitionName,
      variables: JSON.stringify(params.variables) as unknown as never,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return row as ProcessInstanceRow;
}

export async function findInstance(
  db: Kysely<Database>,
  id: string,
): Promise<ProcessInstanceRow | null> {
  const row = await db
    .selectFrom('process_instances')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  return (row as ProcessInstanceRow | undefined) ?? null;
}

export async function setInstanceVariables(
  db: Kysely<Database>,
  id: string,
  variables: Record<string, unknown>,
): Promise<void> {
  await db
    .updateTable('process_instances')
    .set({
      variables: JSON.stringify(variables) as unknown as never,
      updated_at: new Date(),
    })
    .where('id', '=', id)
    .execute();
}

export async function updateInstanceDefinition(
  db: Kysely<Database>,
  id: string,
  params: {
    definitionId: string;
    definitionKey: string;
    definitionVersion: number;
  },
): Promise<void> {
  await db
    .updateTable('process_instances')
    .set({
      definition_id: params.definitionId,
      definition_key: params.definitionKey,
      definition_version: params.definitionVersion,
      updated_at: new Date(),
    })
    .where('id', '=', id)
    .execute();
}

export async function listInstances(
  db: Kysely<Database>,
  filter: { state?: InstanceState; definitionKey?: string } = {},
): Promise<ProcessInstanceRow[]> {
  let q = db.selectFrom('process_instances').selectAll();
  if (filter.state) {
    q = q.where('state', '=', filter.state);
  }
  if (filter.definitionKey) {
    q = q.where('definition_key', '=', filter.definitionKey);
  }
  const rows = await q.orderBy('created_at', 'desc').limit(200).execute();
  return rows as ProcessInstanceRow[];
}

export async function markInstanceCompleted(
  db: Kysely<Database>,
  id: string,
): Promise<void> {
  const now = new Date();
  await db
    .updateTable('process_instances')
    .set({ state: 'completed', updated_at: now, ended_at: now })
    .where('id', '=', id)
    .execute();
}
