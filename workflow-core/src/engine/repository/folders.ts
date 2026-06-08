import { v4 as uuid } from "uuid";
import type { Kysely } from "kysely";
import type { Database } from "../db/types";

export interface FolderRow {
  id: string;
  name: string;
  parent_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export async function createFolder(
  db: Kysely<Database>,
  name: string,
  parentId: string | null,
): Promise<FolderRow> {
  const id = uuid();
  const row = await db
    .insertInto("folders")
    .values({ id, name, parent_id: parentId })
    .returningAll()
    .executeTakeFirstOrThrow();
  return row as FolderRow;
}

export async function listFolders(
  db: Kysely<Database>,
  parentId: string | null,
): Promise<FolderRow[]> {
  let query = db.selectFrom("folders").selectAll().orderBy("name", "asc");
  if (parentId === null) {
    query = query.where("parent_id", "is", null);
  } else {
    query = query.where("parent_id", "=", parentId);
  }
  const rows = await query.execute();
  return rows as FolderRow[];
}

export async function getFolder(
  db: Kysely<Database>,
  id: string,
): Promise<FolderRow | null> {
  const row = await db
    .selectFrom("folders")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  return (row as FolderRow) ?? null;
}

export async function renameFolder(
  db: Kysely<Database>,
  id: string,
  name: string,
): Promise<FolderRow> {
  const row = await db
    .updateTable("folders")
    .set({ name, updated_at: new Date() })
    .where("id", "=", id)
    .returningAll()
    .executeTakeFirstOrThrow();
  return row as FolderRow;
}

export async function deleteFolder(
  db: Kysely<Database>,
  id: string,
): Promise<void> {
  await db.deleteFrom("folders").where("id", "=", id).execute();
}
