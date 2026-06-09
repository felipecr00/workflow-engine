import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Pool } from "pg";

const MIGRATIONS_DIR = resolve(__dirname, "../../../migrations");

export async function runMigrations(pool: Pool): Promise<string[]> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version     VARCHAR     PRIMARY KEY,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const { rows } = await client.query<{ version: string }>(
      "SELECT version FROM schema_migrations",
    );
    const applied = new Set(rows.map((r) => r.version));

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    const newlyApplied: string[] = [];

    for (const file of files) {
      const version = file.replace(/\.sql$/, "");
      if (applied.has(version)) continue;

      const sql = readFileSync(resolve(MIGRATIONS_DIR, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [version]);
        await client.query("COMMIT");
        newlyApplied.push(version);
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }

    return newlyApplied;
  } finally {
    client.release();
  }
}

export async function dropAllForTests(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      DROP TABLE IF EXISTS projects, folders, audit_log, forms, user_tasks, incidents, timers, jobs, tokens,
        process_instances, process_definitions, schema_migrations CASCADE;
      DROP TYPE IF EXISTS user_task_state, incident_state, incident_type, timer_state,
        timer_type, job_state, token_state, instance_state CASCADE;
    `);
  } finally {
    client.release();
  }
}
