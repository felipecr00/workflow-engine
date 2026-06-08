import type { FastifyInstance } from "fastify";
import { sql } from "kysely";
import type { Engine } from "../../engine";

export function registerHealthRoutes(app: FastifyInstance, engine: Engine): void {
  app.get("/health", async () => ({ status: "ok" }));
  app.get("/ready", async () => {
    await sql`SELECT 1`.execute(engine.db);
    return { status: "ready" };
  });
}
