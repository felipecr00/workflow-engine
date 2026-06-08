import { Engine, loadConfig } from "../engine";
import { buildApp } from "./app";

async function main(): Promise<void> {
  const config = loadConfig();
  const engine = new Engine({
    databaseUrl: config.databaseUrl,
    jobPollIntervalMs: config.jobPollIntervalMs,
    jobBatchSize: config.jobBatchSize,
  });
  await engine.start();

  const app = buildApp({ engine, logger: true });
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? "0.0.0.0";

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "Shutting down");
    try {
      await app.close();
      await engine.stop();
      process.exit(0);
    } catch (err) {
      app.log.error(err, "Error during shutdown");
      process.exit(1);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await app.listen({ port, host });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Fatal:", err);
  process.exit(1);
});
