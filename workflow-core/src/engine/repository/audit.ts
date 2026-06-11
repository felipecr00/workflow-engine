import type { Kysely } from "kysely";
import { v4 as uuid } from "uuid";
import type { Database } from "../db/types";

export type AuditEventType =
  | "INSTANCE_CREATED"
  | "INSTANCE_COMPLETED"
  | "INSTANCE_TERMINATED"
  | "TOKEN_CREATED"
  | "TOKEN_COMPLETED"
  | "JOB_CREATED"
  | "JOB_ACTIVATED"
  | "JOB_COMPLETED"
  | "JOB_FAILED"
  | "JOB_CANCELLED"
  | "JOB_RETRIES_EXHAUSTED"
  | "TIMER_CREATED"
  | "TIMER_FIRED"
  | "TIMER_CANCELLED"
  | "INCIDENT_CREATED"
  | "INCIDENT_RESOLVED"
  | "INSTANCE_MIGRATED"
  | "USER_TASK_CREATED"
  | "USER_TASK_CLAIMED"
  | "USER_TASK_COMPLETED"
  | "USER_TASK_CANCELLED"
  | "MANUAL_TASK_CREATED"
  | "MANUAL_TASK_COMPLETED"
  | "SEND_TASK_JOB_CREATED"
  | "THROW_EVENT_NONE";

export interface AuditEventRow {
  id: string;
  instance_id: string;
  token_id: string | null;
  job_id: string | null;
  timer_id: string | null;
  incident_id: string | null;
  event_type: string;
  element_id: string | null;
  element_type: string | null;
  metadata: Record<string, unknown>;
  occurred_at: Date;
}

export async function recordAudit(
  db: Kysely<Database>,
  params: {
    instanceId: string;
    tokenId?: string | null;
    jobId?: string | null;
    timerId?: string | null;
    incidentId?: string | null;
    eventType: AuditEventType;
    elementId?: string | null;
    elementType?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await db
    .insertInto("audit_log")
    .values({
      id: uuid(),
      instance_id: params.instanceId,
      token_id: params.tokenId ?? null,
      job_id: params.jobId ?? null,
      timer_id: params.timerId ?? null,
      incident_id: params.incidentId ?? null,
      event_type: params.eventType,
      element_id: params.elementId ?? null,
      element_type: params.elementType ?? null,
      metadata: JSON.stringify(params.metadata ?? {}) as unknown as never,
    })
    .execute();
}

export async function listAuditForInstance(
  db: Kysely<Database>,
  instanceId: string,
): Promise<AuditEventRow[]> {
  const rows = await db
    .selectFrom("audit_log")
    .selectAll()
    .where("instance_id", "=", instanceId)
    .orderBy("occurred_at", "asc")
    .execute();
  return rows as AuditEventRow[];
}
