import type { Kysely } from "kysely";
import { v4 as uuid } from "uuid";
import type { Database, TokenState } from "../db/types";

export interface TokenRow {
  id: string;
  instance_id: string;
  element_id: string;
  element_type: string;
  state: TokenState;
  scope_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export async function createToken(
  db: Kysely<Database>,
  params: {
    instanceId: string;
    elementId: string;
    elementType: string;
    state?: TokenState;
  },
): Promise<TokenRow> {
  const row = await db
    .insertInto("tokens")
    .values({
      id: uuid(),
      instance_id: params.instanceId,
      element_id: params.elementId,
      element_type: params.elementType,
      state: params.state ?? "active",
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return row as TokenRow;
}

export async function setTokenState(
  db: Kysely<Database>,
  id: string,
  state: TokenState,
): Promise<void> {
  await db
    .updateTable("tokens")
    .set({ state, updated_at: new Date() })
    .where("id", "=", id)
    .execute();
}

export async function findToken(
  db: Kysely<Database>,
  id: string,
): Promise<TokenRow | null> {
  const row = await db
    .selectFrom("tokens")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  return (row as TokenRow | undefined) ?? null;
}

export async function listLiveTokensForInstance(
  db: Kysely<Database>,
  instanceId: string,
): Promise<TokenRow[]> {
  const rows = await db
    .selectFrom("tokens")
    .selectAll()
    .where("instance_id", "=", instanceId)
    .where("state", "in", ["active", "waiting", "incident"])
    .execute();
  return rows as TokenRow[];
}

export async function remapTokenElement(
  db: Kysely<Database>,
  id: string,
  newElementId: string,
  newElementType: string,
): Promise<void> {
  await db
    .updateTable("tokens")
    .set({ element_id: newElementId, element_type: newElementType, updated_at: new Date() })
    .where("id", "=", id)
    .execute();
}

export async function listAllTokensForInstance(
  db: Kysely<Database>,
  instanceId: string,
): Promise<TokenRow[]> {
  const rows = await db
    .selectFrom("tokens")
    .selectAll()
    .where("instance_id", "=", instanceId)
    .orderBy("created_at", "asc")
    .execute();
  return rows as TokenRow[];
}
