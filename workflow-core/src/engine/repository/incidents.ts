import type { Kysely } from "kysely";
import { v4 as uuid } from "uuid";
import type {
  Database,
  IncidentStateValue,
  IncidentType,
} from "../db/types";

export interface IncidentRow {
  id: string;
  instance_id: string;
  token_id: string | null;
  job_id: string | null;
  type: IncidentType;
  state: IncidentStateValue;
  error_message: string;
  created_at: Date;
  resolved_at: Date | null;
  resolved_by: string | null;
}

export async function createIncident(
  db: Kysely<Database>,
  params: {
    instanceId: string;
    tokenId?: string | null;
    jobId?: string | null;
    type: IncidentType;
    errorMessage: string;
  },
): Promise<IncidentRow> {
  const row = await db
    .insertInto("incidents")
    .values({
      id: uuid(),
      instance_id: params.instanceId,
      token_id: params.tokenId ?? null,
      job_id: params.jobId ?? null,
      type: params.type,
      error_message: params.errorMessage,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return row as IncidentRow;
}

export async function findIncident(
  db: Kysely<Database>,
  id: string,
): Promise<IncidentRow | null> {
  const row = await db
    .selectFrom("incidents")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  return (row as IncidentRow | undefined) ?? null;
}

export async function listIncidents(
  db: Kysely<Database>,
  filter: { instanceId?: string; state?: IncidentStateValue } = {},
): Promise<IncidentRow[]> {
  let q = db.selectFrom("incidents").selectAll();
  if (filter.instanceId) q = q.where("instance_id", "=", filter.instanceId);
  if (filter.state) q = q.where("state", "=", filter.state);
  const rows = await q.orderBy("created_at", "desc").execute();
  return rows as IncidentRow[];
}

export async function markIncidentResolved(
  db: Kysely<Database>,
  id: string,
  resolvedBy: string | null,
): Promise<void> {
  await db
    .updateTable("incidents")
    .set({
      state: "resolved",
      resolved_at: new Date(),
      resolved_by: resolvedBy,
    })
    .where("id", "=", id)
    .execute();
}

export async function listIncidentsForInstance(
  db: Kysely<Database>,
  instanceId: string,
): Promise<IncidentRow[]> {
  return await listIncidents(db, { instanceId });
}
