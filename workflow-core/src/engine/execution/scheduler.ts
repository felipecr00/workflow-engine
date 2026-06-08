import type { Kysely } from "kysely";
import { sql } from "kysely";
import { v4 as uuid } from "uuid";
import type { Database } from "../db/types";
import { recordAudit } from "../repository/audit";
import { createIncident } from "../repository/incidents";
import {
  claimNextPendingJob,
  markJobFailedForRetry,
  markJobIncident,
  type JobRow,
} from "../repository/jobs";
import { claimNextDueTimer } from "../repository/timers";
import { setTokenState } from "../repository/tokens";
import {
  completeServiceTask,
  fireTimerForToken,
  type DefinitionLookup,
} from "./executor";
import type { HandlerRegistry, JobContext } from "./handler-registry";

export interface SchedulerOptions {
  pollIntervalMs: number;
  batchSize: number;
  lockTtlMs?: number;
  workerId?: string;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
  onError?: (err: unknown) => void;
}

const DEFAULT_LOCK_TTL_MS = 30_000;
const DEFAULT_RETRY_BASE_MS = 5_000;
const DEFAULT_RETRY_MAX_MS = 5 * 60_000;

export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private readonly workerId: string;
  private readonly lockTtlMs: number;
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;
  private readonly onError: (err: unknown) => void;

  constructor(
    private readonly db: Kysely<Database>,
    private readonly handlers: HandlerRegistry,
    private readonly defs: DefinitionLookup,
    private readonly options: SchedulerOptions,
  ) {
    this.workerId = options.workerId ?? `worker-${uuid()}`;
    this.lockTtlMs = options.lockTtlMs ?? DEFAULT_LOCK_TTL_MS;
    this.retryBaseMs = options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_MS;
    this.retryMaxMs = options.retryMaxDelayMs ?? DEFAULT_RETRY_MAX_MS;
    this.onError =
      options.onError ??
      ((err) => {
        // eslint-disable-next-line no-console
        console.error("[workflow-engine] scheduler error:", err);
      });
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.options.pollIntervalMs);
    void this.tick();
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    while (this.ticking) {
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  async tick(): Promise<{ jobs: number; timers: number }> {
    if (this.ticking) return { jobs: 0, timers: 0 };
    this.ticking = true;
    let timersFired = 0;
    let jobsProcessed = 0;
    try {
      // Timers first — firing a timer may produce a new job that this same
      // tick can then dispatch.
      for (let i = 0; i < this.options.batchSize; i++) {
        const fired = await this.fireOneTimer();
        if (!fired) break;
        timersFired += 1;
      }
      for (let i = 0; i < this.options.batchSize; i++) {
        const ranOne = await this.claimAndProcessOne();
        if (!ranOne) break;
        jobsProcessed += 1;
      }
    } catch (err) {
      this.onError(err);
    } finally {
      this.ticking = false;
    }
    return { jobs: jobsProcessed, timers: timersFired };
  }

  async recoverStaleActiveJobs(): Promise<number> {
    const result = await this.db
      .updateTable("jobs")
      .set({
        state: "pending",
        worker_id: null,
        lock_expires_at: null,
        scheduled_at: new Date(),
        updated_at: new Date(),
      })
      .where("state", "=", "active")
      .executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0);
  }

  private async fireOneTimer(): Promise<boolean> {
    const timer = await this.db.transaction().execute(async (trx) => {
      const t = await claimNextDueTimer(trx);
      if (!t || !t.token_id) return null;
      await fireTimerForToken(trx, this.defs, { tokenId: t.token_id, timerId: t.id });
      return t;
    });
    return timer !== null;
  }

  private async claimAndProcessOne(): Promise<boolean> {
    const job = await this.claim();
    if (!job) return false;

    await recordAudit(this.db, {
      instanceId: job.instance_id,
      tokenId: job.token_id,
      jobId: job.id,
      eventType: "JOB_ACTIVATED",
      elementId: job.element_id,
      metadata: { worker: this.workerId },
    });

    const handler = this.handlers.get(job.job_type);
    if (!handler) {
      await this.handleJobError(
        job,
        new Error(`No handler registered for job type "${job.job_type}"`),
      );
      return true;
    }

    const ctx: JobContext = {
      jobId: job.id,
      instanceId: job.instance_id,
      elementId: job.element_id,
      variables: job.input_variables,
    };

    let result: Record<string, unknown> | void | undefined;
    try {
      result = await handler(ctx);
    } catch (err) {
      await this.handleJobError(job, err instanceof Error ? err : new Error(String(err)));
      return true;
    }

    try {
      await this.db.transaction().execute(async (trx) => {
        await completeServiceTask(trx, this.defs, {
          jobId: job.id,
          result: result ?? undefined,
        });
      });
    } catch (err) {
      await this.handleJobError(job, err instanceof Error ? err : new Error(String(err)));
    }
    return true;
  }

  private async claim(): Promise<JobRow | null> {
    return await this.db.transaction().execute(async (trx) => {
      return await claimNextPendingJob(trx, this.lockTtlMs, this.workerId);
    });
  }

  // Exponential backoff: base * 2^(attempt) capped at max.
  // attempt = retries_total - retries_remaining - 1 (0 on first retry).
  private computeRetryDelayMs(retriesTotal: number, retriesRemainingAfterDecrement: number): number {
    const attempt = retriesTotal - retriesRemainingAfterDecrement - 1;
    const safe = attempt < 0 ? 0 : attempt;
    return Math.min(this.retryMaxMs, this.retryBaseMs * Math.pow(2, safe));
  }

  private async handleJobError(job: JobRow, err: Error): Promise<void> {
    const remaining = job.retries_remaining - 1;
    if (remaining > 0) {
      const delayMs = this.computeRetryDelayMs(job.retries_total, remaining);
      const scheduledAt = new Date(Date.now() + delayMs);
      await this.db.transaction().execute(async (trx) => {
        await markJobFailedForRetry(trx, job.id, {
          retriesRemaining: remaining,
          scheduledAt,
          errorCode: err.name,
          errorMessage: err.message,
        });
        await recordAudit(trx, {
          instanceId: job.instance_id,
          tokenId: job.token_id,
          jobId: job.id,
          eventType: "JOB_FAILED",
          elementId: job.element_id,
          metadata: {
            error: err.message,
            retriesRemaining: remaining,
            nextAttemptAt: scheduledAt.toISOString(),
          },
        });
      });
      return;
    }

    // Exhausted: open an incident.
    await this.db.transaction().execute(async (trx) => {
      await markJobIncident(trx, job.id, { code: err.name, message: err.message });
      await setTokenState(trx, job.token_id, "incident");
      const incident = await createIncident(trx, {
        instanceId: job.instance_id,
        tokenId: job.token_id,
        jobId: job.id,
        type: "job_retries_exhausted",
        errorMessage: err.message,
      });
      await recordAudit(trx, {
        instanceId: job.instance_id,
        tokenId: job.token_id,
        jobId: job.id,
        eventType: "JOB_RETRIES_EXHAUSTED",
        elementId: job.element_id,
        metadata: { error: err.message },
      });
      await recordAudit(trx, {
        instanceId: job.instance_id,
        tokenId: job.token_id,
        jobId: job.id,
        incidentId: incident.id,
        eventType: "INCIDENT_CREATED",
        elementId: job.element_id,
        metadata: { type: "job_retries_exhausted", error: err.message },
      });
    });
  }
}

export async function pingDb(db: Kysely<Database>): Promise<void> {
  await sql`SELECT 1`.execute(db);
}
