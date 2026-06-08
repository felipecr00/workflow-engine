import type { Kysely } from "kysely";
import { v4 as uuid } from "uuid";
import type { Database } from "../db/types";

export interface DeployedDefinitionRow {
  id: string;
  key: string;
  version: number;
  name: string | null;
  bpmn_xml: string;
  deployed_at: Date;
  is_active: boolean;
}

export async function insertDefinition(
  db: Kysely<Database>,
  params: { key: string; name: string | null; bpmnXml: string },
): Promise<DeployedDefinitionRow> {
  return await db.transaction().execute(async (trx) => {
    const maxRow = await trx
      .selectFrom("process_definitions")
      .select((eb) => eb.fn.max<number>("version").as("max_version"))
      .where("key", "=", params.key)
      .executeTakeFirst();

    const nextVersion = (maxRow?.max_version ?? 0) + 1;

    const row = await trx
      .insertInto("process_definitions")
      .values({
        id: uuid(),
        key: params.key,
        version: nextVersion,
        name: params.name,
        bpmn_xml: params.bpmnXml,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return row as DeployedDefinitionRow;
  });
}

export async function findLatestDefinitionByKey(
  db: Kysely<Database>,
  key: string,
): Promise<DeployedDefinitionRow | null> {
  const row = await db
    .selectFrom("process_definitions")
    .selectAll()
    .where("key", "=", key)
    .where("is_active", "=", true)
    .orderBy("version", "desc")
    .limit(1)
    .executeTakeFirst();
  return (row as DeployedDefinitionRow | undefined) ?? null;
}

export async function findDefinitionById(
  db: Kysely<Database>,
  id: string,
): Promise<DeployedDefinitionRow | null> {
  const row = await db
    .selectFrom("process_definitions")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  return (row as DeployedDefinitionRow | undefined) ?? null;
}

export async function findDefinitionByKeyAndVersion(
  db: Kysely<Database>,
  key: string,
  version: number,
): Promise<DeployedDefinitionRow | null> {
  const row = await db
    .selectFrom("process_definitions")
    .selectAll()
    .where("key", "=", key)
    .where("version", "=", version)
    .executeTakeFirst();
  return (row as DeployedDefinitionRow | undefined) ?? null;
}

export async function listDefinitionVersions(
  db: Kysely<Database>,
  key: string,
): Promise<DeployedDefinitionRow[]> {
  const rows = await db
    .selectFrom("process_definitions")
    .selectAll()
    .where("key", "=", key)
    .orderBy("version", "asc")
    .execute();
  return rows as DeployedDefinitionRow[];
}

export async function listActiveDefinitions(
  db: Kysely<Database>,
): Promise<DeployedDefinitionRow[]> {
  const rows = await db
    .selectFrom("process_definitions")
    .selectAll()
    .where("is_active", "=", true)
    .orderBy("deployed_at", "asc")
    .execute();
  return rows as DeployedDefinitionRow[];
}
