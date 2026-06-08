import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Engine } from "../src/engine";
import { resetDatabase, TEST_DATABASE_URL } from "./helpers/db";
import { HELLO_BPMN, TWO_TASK_BPMN, waitUntil } from "./helpers/fixtures";

describe("engine restart recovery", () => {
  let engine: Engine | null = null;

  beforeAll(async () => {
    await resetDatabase();
  });

  beforeEach(async () => {
    if (engine) await engine.stop();
    await resetDatabase();
    engine = null;
  });

  afterAll(async () => {
    if (engine) await engine.stop();
  });

  async function freshEngine(opts: {
    autoStart?: boolean;
    batchSize?: number;
  } = {}): Promise<Engine> {
    const e = new Engine({
      databaseUrl: TEST_DATABASE_URL,
      jobPollIntervalMs: 25,
      jobBatchSize: opts.batchSize ?? 16,
      autoStartJobRunner: opts.autoStart ?? false,
    });
    await e.start();
    return e;
  }

  it("resumes a pending job after the engine is restarted", async () => {
    // Engine A: deploy + create instance, do NOT process the job.
    engine = await freshEngine({ autoStart: false });
    engine.registerHandler("greet", () => ({ greeting: "hello again" }));
    await engine.deploy(HELLO_BPMN);
    const instance = await engine.createInstance("hello-world", { name: "ada" });

    // Job should be pending; instance should be active; token waiting at the
    // service task.
    let snapshot = await engine.getInstance(instance.id);
    expect(snapshot?.state).toBe("active");
    expect(snapshot?.jobs).toHaveLength(1);
    expect(snapshot?.jobs[0]?.state).toBe("pending");
    expect(snapshot?.tokens.find((t) => t.state === "waiting")?.element_id).toBe(
      "Task_Greet",
    );

    // Simulate a hard stop.
    await engine.stop();
    engine = null;

    // Engine B: brand new instance, no in-memory state. Must reconstruct
    // definitions from the DB, then complete the pending job.
    engine = await freshEngine({ autoStart: false });
    engine.registerHandler("greet", () => ({ greeting: "hello again" }));

    await engine.runOneTick();

    snapshot = await engine.getInstance(instance.id);
    expect(snapshot?.state).toBe("completed");
    expect(snapshot?.variables.greeting).toBe("hello again");
  });

  it("resumes mid-process: completes one task before restart, the next after", async () => {
    // batchSize=1 so a single tick processes exactly one job, leaving the
    // second task pending across the simulated restart.
    engine = await freshEngine({ autoStart: false, batchSize: 1 });
    engine.registerHandler("step-a", () => ({}));
    engine.registerHandler("step-b", () => ({}));
    await engine.deploy(TWO_TASK_BPMN);
    const instance = await engine.createInstance("two-step", {});

    // Process exactly one job (task A) and then "crash".
    await engine.runOneTick();

    let snapshot = await engine.getInstance(instance.id);
    expect(snapshot?.state).toBe("active");
    // After tick 1, A is completed and a token is now pending/waiting at B.
    const jobsByType = new Map(snapshot!.jobs.map((j) => [j.element_id, j]));
    expect(jobsByType.get("A")?.state).toBe("completed");
    expect(jobsByType.get("B")?.state).toBe("pending");

    await engine.stop();
    engine = null;

    // Restart with fresh handlers. Even step-a's handler does not need to be
    // re-registered for in-flight jobs because A is already complete; but
    // deploy validation requires both, so we register both anyway.
    engine = await freshEngine({ autoStart: false, batchSize: 1 });
    engine.registerHandler("step-a", () => ({}));
    engine.registerHandler("step-b", () => ({}));

    await engine.runOneTick();

    snapshot = await engine.getInstance(instance.id);
    expect(snapshot?.state).toBe("completed");
  });

  it("recovers jobs left in 'active' state from a previous worker", async () => {
    engine = await freshEngine({ autoStart: false });
    engine.registerHandler("greet", () => ({ greeting: "hi" }));
    await engine.deploy(HELLO_BPMN);
    const instance = await engine.createInstance("hello-world", { name: "x" });

    // Force the job into 'active' state without completing it — this is what
    // a hard crash mid-handler would leave behind.
    await engine.db
      .updateTable("jobs")
      .set({ state: "active", worker_id: "ghost", lock_expires_at: new Date(0) })
      .where("instance_id", "=", instance.id)
      .execute();

    await engine.stop();
    engine = null;

    // Fresh engine should reset that 'active' job to 'pending' at startup
    // and then process it normally.
    engine = await freshEngine({ autoStart: true });
    engine.registerHandler("greet", () => ({ greeting: "hi" }));

    await waitUntil(async () => {
      const s = await engine!.getInstance(instance.id);
      return s?.state === "completed";
    });

    const snapshot = await engine.getInstance(instance.id);
    expect(snapshot?.jobs[0]?.state).toBe("completed");
  });
});
