export interface EngineConfig {
  databaseUrl: string;
  jobPollIntervalMs: number;
  jobBatchSize: number;
  schedulerLockKey: number;
}

const env = process.env;

export function loadConfig(overrides: Partial<EngineConfig> = {}): EngineConfig {
  return {
    databaseUrl:
      overrides.databaseUrl ??
      env.DATABASE_URL ??
      "postgres://workflow:workflow@localhost:5432/workflow",
    jobPollIntervalMs: overrides.jobPollIntervalMs ?? Number(env.JOB_POLL_INTERVAL_MS ?? 250),
    jobBatchSize: overrides.jobBatchSize ?? Number(env.JOB_BATCH_SIZE ?? 16),
    schedulerLockKey: overrides.schedulerLockKey ?? Number(env.SCHEDULER_LOCK_KEY ?? 7263401),
  };
}
