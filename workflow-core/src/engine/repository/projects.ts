import { v4 as uuid } from "uuid";
import type { Kysely } from "kysely";
import type { Database } from "../db/types";

export interface ProjectRow {
  id: string;
  name: string;
  folder_id: string | null;
  bpmn_xml: string;
  description: string | null;
  deployed_definition_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export async function createProject(
  db: Kysely<Database>,
  name: string,
  folderId: string | null,
  bpmnXml: string,
  description?: string | null,
): Promise<ProjectRow> {
  const id = uuid();
  const row = await db
    .insertInto("projects")
    .values({
      id,
      name,
      folder_id: folderId,
      bpmn_xml: bpmnXml,
      description: description ?? null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return row as ProjectRow;
}

export async function listProjects(
  db: Kysely<Database>,
  folderId: string | null,
): Promise<ProjectRow[]> {
  let query = db.selectFrom("projects").selectAll().orderBy("name", "asc");
  if (folderId === null) {
    query = query.where("folder_id", "is", null);
  } else {
    query = query.where("folder_id", "=", folderId);
  }
  const rows = await query.execute();
  return rows as ProjectRow[];
}

export async function getProject(
  db: Kysely<Database>,
  id: string,
): Promise<ProjectRow | null> {
  const row = await db
    .selectFrom("projects")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  return (row as ProjectRow) ?? null;
}

export async function updateProject(
  db: Kysely<Database>,
  id: string,
  updates: {
    name?: string;
    bpmn_xml?: string;
    description?: string | null;
    deployed_definition_id?: string | null;
    folder_id?: string | null;
  },
): Promise<ProjectRow> {
  const row = await db
    .updateTable("projects")
    .set({ ...updates, updated_at: new Date() })
    .where("id", "=", id)
    .returningAll()
    .executeTakeFirstOrThrow();
  return row as ProjectRow;
}

export async function deleteProject(
  db: Kysely<Database>,
  id: string,
): Promise<void> {
  await db.deleteFrom("projects").where("id", "=", id).execute();
}
