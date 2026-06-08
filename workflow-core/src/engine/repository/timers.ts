import type { Kysely, Transaction } from "kysely";
import { sql } from "kysely";
import { v4 as uuid } from "uuid";
import type { Database, TimerStateValue, TimerType } from "../db/types";

export interface TimerRow {
  id: string;
  instance_id: string;
  token_id: string | null;
  element_id: string;
  timer_type: TimerType;
  due_at: Date;
  state: TimerStateValue;
  created_at: Date;
  updated_at: Date;
}

export async function createTimer(
  db: Kysely<Database>,
  params: {
    instanceId: string;
    tokenId: string | null;
    elementId: string;
    timerType: TimerType;
    dueAt: Date;
  },
): Promise<TimerRow> {
  const row = await db
    .insertInto("timers")
    .values({
      id: uuid(),
      instance_id: params.instanceId,
      token_id: params.tokenId,
      element_id: params.elementId,
      timer_type: params.timerType,
      due_at: params.dueAt,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return row as TimerRow;
}

export async function claimNextDueTimer(
  trx: Transaction<Database>,
): Promise<TimerRow | null> {
  const candidate = await trx
    .selectFrom("timers")
    .select("id")
    .where("state", "=", "active")
    .where("due_at", "<=", new Date())
    .orderBy("due_at", "asc")
    .limit(1)
    .forUpdate()
    .modifyEnd(sql`SKIP LOCKED`)
    .executeTakeFirst();

  if (!candidate) return null;

  const updated = await trx
    .updateTable("timers")
    .set({ state: "fired", updated_at: new Date() })
    .where("id", "=", candidate.id)
    .returningAll()
    .executeTakeFirstOrThrow();

  return updated as TimerRow;
}

export async function remapTimerElement(
  db: Kysely<Database>,
  id: string,
  newElementId: string,
): Promise<void> {
  await db
    .updateTable("timers")
    .set({ element_id: newElementId, updated_at: new Date() })
    .where("id", "=", id)
    .execute();
}

export async function listTimersForInstance(
  db: Kysely<Database>,
  instanceId: string,
): Promise<TimerRow[]> {
  const rows = await db
    .selectFrom("timers")
    .selectAll()
    .where("instance_id", "=", instanceId)
    .orderBy("created_at", "asc")
    .execute();
  return rows as TimerRow[];
}
