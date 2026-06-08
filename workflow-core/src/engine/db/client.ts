import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import type { Database } from "./types";

export interface DbClient {
  db: Kysely<Database>;
  pool: Pool;
  close(): Promise<void>;
}

export function createDbClient(
  databaseUrl: string,
  options: { maxConnections?: number } = {},
): DbClient {
  // pg's SCRAM implementation requires a password string even when the server
  // uses trust auth.  If the URL has no password, inject a dummy one so the
  // handshake completes (trust ignores it).
  const parsed = new URL(databaseUrl);
  if (!parsed.password) parsed.password = "trust";
  const pool = new Pool({
    connectionString: parsed.toString(),
    max: options.maxConnections ?? 10,
    idleTimeoutMillis: 5_000,
    allowExitOnIdle: true,
  });
  const db = new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
    log(event) {
      if (process.env.LOG_SQL && event.level === "query") {
        console.log("[SQL]", event.query.sql, JSON.stringify(event.query.parameters));
      }
    },
  });
  return {
    db,
    pool,
    async close() {
      await db.destroy();
    },
  };
}
