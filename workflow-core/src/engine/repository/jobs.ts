import type { Kysely, Transaction } from "kysely";
import { sql } from "kysely";
import { v4 as uuid } from "uuid";
import type { Database, JobState } from "../db/types";

export interface JobRow {
  id: string;
  instance_id: string;
  token_id: string;
  element_id: string;
  job_type: string;
  state: JobState;
  input_variables: Record<string, unknown>;
  output_variables: Record<string, unknown> | null;
  retries_total: number;
  retries_remaining: number;
  error_code: string | null;
  error_message: string | null;
  worker_id: string | null;
  lock_expires_at: Date | null;
  scheduled_at: Date;
  created_at: Date;
  updated_at: Date;
}

export async function createJob(
  db: Kysely<Database>,
  params: {
    instanceId: string;
    tokenId: string;
    elementId: string;
    jobType: string;
    inputVariables: Record<string, unknown>;
    retries: number;
  },
): Promise<JobRow> {
  // scheduled_at is set explicitly from the Node clock to match the
  // claim-side comparison (`scheduled_at <= new Date()`). Mixing JS time
  // with Postgres NOW() is unsafe — even a few ms of skew makes a freshly
  // created job ineligible for the very next tick.
  const row = await db
    .insertInto("jobs")
    .values({
      id: uuid(),
      instance_id: params.instanceId,
      token_id: params.tokenId,
      element_id: params.elementId,
      job_type: params.jobType,
      input_variables: JSON.stringify(params.inputVariables) as unknown as never,
      retries_total: params.retries,
      retries_remaining: params.retries,
      scheduled_at: new Date(),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return row as JobRow;
}

// Claim a single pending job (or a 'failed' job whose retry timer has
// elapsed) using FOR UPDATE SKIP LOCKED. The transaction must be held open
// while the job runs.
export async function claimNextPendingJob(
  trx: Transaction<Database>,
  lockTtlMs: number,
  workerId: string,
): Promise<JobRow | null> {
  const candidate = await trx
    .selectFrom("jobs")
    .select("id")
    .where("state", "in", ["pending", "failed"])
    .where("scheduled_at", "<=", new Date())
    .orderBy("scheduled_at", "asc")
    .limit(1)
    .forUpdate()
    .modifyEnd(sql`SKIP LOCKED`)
    .executeTakeFirst();

  if (!candidate) return null;

  const lockExpiresAt = new Date(Date.now() + lockTtlMs);
  const updated = await trx
    .updateTable("jobs")
    .set({
      state: "active",
      worker_id: workerId,
      lock_expires_at: lockExpiresAt,
      updated_at: new Date(),
    })
    .where("id", "=", candidate.id)
    .returningAll()
    .executeTakeFirstOrThrow();

  return updated as JobRow;
}

export async function markJobCompleted(
  db: Kysely<Database>,
  id: string,
  output: Record<string, unknown> | undefined,
): Promise<void> {
  await db
    .updateTable("jobs")
    .set({
      state: "completed",
      output_variables: (output
        ? JSON.stringify(output)
        : null) as unknown as never,
      updated_at: new Date(),
      lock_expires_at: null,
    })
    .where("id", "=", id)
    .execute();
}

export async function markJobFailedForRetry(
  db: Kysely<Database>,
  id: string,
  params: {
    retriesRemaining: number;
    scheduledAt: Date;
    errorCode?: string;
    errorMessage: string;
  },
): Promise<void> {
  await db
    .updateTable("jobs")
    .set({
      state: "failed",
      retries_remaining: params.retriesRemaining,
      scheduled_at: params.scheduledAt,
      error_code: params.errorCode ?? null,
      error_message: params.errorMessage,
      worker_id: null,
      lock_expires_at: null,
      updated_at: new Date(),
    })
    .where("id", "=", id)
    .execute();
}

export async function reactivateJobForResolve(
  db: Kysely<Database>,
  id: string,
): Promise<void> {
  await db
    .updateTable("jobs")
    .set((eb) => ({
      state: "pending",
      retries_remaining: eb.ref("retries_total"),
      scheduled_at: new Date(),
      error_code: null,
      error_message: null,
      worker_id: null,
      lock_expires_at: null,
      updated_at: new Date(),
    }))
    .where("id", "=", id)
    .execute();
}

export async function markJobIncident(
  db: Kysely<Database>,
  id: string,
  err: { code?: string; message: string },
): Promise<void> {
  await db
    .updateTable("jobs")
    .set({
      state: "incident",
      retries_remaining: 0,
      error_code: err.code ?? null,
      error_message: err.message,
      updated_at: new Date(),
      lock_expires_at: null,
    })
    .where("id", "=", id)
    .execute();
}

export async function remapJobElement(
  db: Kysely<Database>,
  id: string,
  newElementId: string,
): Promise<void> {
  await db
    .updateTable("jobs")
    .set({ element_id: newElementId, updated_at: new Date() })
    .where("id", "=", id)
    .execute();
}

export async function findJob(
  db: Kysely<Database>,
  id: string,
): Promise<JobRow | null> {
  const row = await db
    .selectFrom("jobs")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  return (row as JobRow | undefined) ?? null;
}

export async function listJobsForInstance(
  db: Kysely<Database>,
  instanceId: string,
): Promise<JobRow[]> {
  const rows = await db
    .selectFrom("jobs")
    .selectAll()
    .where("instance_id", "=", instanceId)
    .orderBy("created_at", "asc")
    .execute();
  return rows as JobRow[];
}

// Used by Terminate End Events. Cancels jobs that are still in-flight; ones
// already 'completed', 'incident' or 'cancelled' are left untouched. A worker
// that subsequently completes an 'active' job we cancel here will fail the
// completion guard (state != 'active'), which is the desired behaviour.
export async function cancelAllOpenJobsForInstance(
  db: Kysely<Database>,
  instanceId: string,
): Promise<number> {
  const result = await db
    .updateTable("jobs")
    .set({
      state: "cancelled",
      worker_id: null,
      lock_expires_at: null,
      updated_at: new Date(),
    })
    .where("instance_id", "=", instanceId)
    .where("state", "in", ["pending", "active", "failed"])
    .executeTakeFirst();
  return Number(result.numUpdatedRows ?? 0);
}
