import { Pool } from "pg";
import { dropAllForTests } from "../../src/engine";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://workflow:workflow@localhost:5432/workflow";

export async function resetDatabase(): Promise<void> {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  try {
    await dropAllForTests(pool);
  } finally {
    await pool.end();
  }
}
