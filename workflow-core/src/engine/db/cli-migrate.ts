import { Pool } from "pg";
import { loadConfig } from "../config";
import { runMigrations } from "./migrator";

async function main(): Promise<void> {
  const config = loadConfig();
  // Ensure password is set for pg's SCRAM handshake (trust auth ignores it)
  const parsed = new URL(config.databaseUrl);
  if (!parsed.password) parsed.password = "trust";
  const pool = new Pool({ connectionString: parsed.toString() });
  try {
    const applied = await runMigrations(pool);
    if (applied.length === 0) {
      console.log("No new migrations to apply.");
    } else {
      console.log("Applied migrations:", applied.join(", "));
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
