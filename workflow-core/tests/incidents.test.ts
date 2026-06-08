import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Engine } from "../src/engine";
import { resetDatabase, TEST_DATABASE_URL } from "./helpers/db";
import { HELLO_BPMN, waitUntil } from "./helpers/fixtures";

describe("retries, incidents, and resolve", () => {
  let engine: Engine;

  beforeAll(async () => {
    await resetDatabase();
  });

  beforeEach(async () => {
    if (engine) await engine.stop();
    await resetDatabase();
    engine = new Engine({
      databaseUrl: TEST_DATABASE_URL,
      jobPollIntervalMs: 20,
      retryBaseDelayMs: 0,
      retryMaxDelayMs: 0,
      autoStartJobRunner: false,
    });
    await engine.start();
  });

  afterAll(async () => {
    if (engine) await engine.stop();
  });

  it("retries a flaky handler until it succeeds", async () => {
    let attempts = 0;
    engine.registerHandler("greet", () => {
      attempts += 1;
      if (attempts < 3) throw new Error("transient");
      return { greeting: "ok" };
    });
    await engine.deploy(HELLO_BPMN);
    const instance = await engine.createInstance("hello-world", { name: "x" });

    await engine.runOneTick(); // attempt 1 → fail, retry
    await engine.runOneTick(); // attempt 2 → fail, retry
    await engine.runOneTick(); // attempt 3 → success

    const snapshot = await engine.getInstance(instance.id);
    expect(attempts).toBe(3);
    expect(snapshot?.state).toBe("completed");
    expect(snapshot?.variables.greeting).toBe("ok");
    expect(snapshot?.incidents).toHaveLength(0);
  });

  it("opens an incident after retries are exhausted", async () => {
    engine.registerHandler("greet", () => {
      throw new Error("permanent");
    });
    await engine.deploy(HELLO_BPMN);
    const instance = await engine.createInstance("hello-world", { name: "x" });
    await engine.runOneTick();
    await engine.runOneTick();
    await engine.runOneTick();

    const snapshot = await engine.getInstance(instance.id);
    expect(snapshot?.jobs[0]?.state).toBe("incident");
    expect(snapshot?.incidents).toHaveLength(1);
    expect(snapshot?.incidents[0]?.state).toBe("active");
    expect(snapshot?.incidents[0]?.error_message).toMatch(/permanent/);
    expect(snapshot?.tokens.find((t) => t.element_id === "Task_Greet")?.state).toBe("incident");
  });

  it("listIncidents filters by instance and active state", async () => {
    engine.registerHandler("greet", () => { throw new Error("boom"); });
    await engine.deploy(HELLO_BPMN);
    const a = await engine.createInstance("hello-world", { name: "a" });
    const b = await engine.createInstance("hello-world", { name: "b" });
    await engine.runOneTick();
    await engine.runOneTick();
    await engine.runOneTick();

    const all = await engine.listIncidents();
    expect(all).toHaveLength(2);

    const justA = await engine.listIncidents({ instanceId: a.id });
    expect(justA).toHaveLength(1);
    expect(justA[0]?.instance_id).toBe(a.id);

    // Resolve one and verify it disappears from active-only filter.
    await engine.resolveIncident(all[0]!.id, "tester");
    const stillActive = await engine.listIncidents();
    expect(stillActive).toHaveLength(1);

    const includingResolved = await engine.listIncidents({ activeOnly: false });
    expect(includingResolved).toHaveLength(2);
    // unused: just exercise the b instance reference so linters don't warn
    expect(b.id).toBeTruthy();
  });

  it("resolving an incident re-arms the job and the instance can complete", async () => {
    let attempts = 0;
    engine.registerHandler("greet", () => {
      attempts += 1;
      // First three attempts (the original tries) throw; after resolve we
      // succeed on the next attempt.
      if (attempts <= 3) throw new Error("still broken");
      return { greeting: "fixed" };
    });
    await engine.deploy(HELLO_BPMN);
    const instance = await engine.createInstance("hello-world", { name: "x" });

    await engine.runOneTick();
    await engine.runOneTick();
    await engine.runOneTick();

    let snapshot = await engine.getInstance(instance.id);
    expect(snapshot?.incidents).toHaveLength(1);
    const incidentId = snapshot!.incidents[0]!.id;

    await engine.resolveIncident(incidentId, "operator");
    snapshot = await engine.getInstance(instance.id);
    expect(snapshot?.incidents[0]?.state).toBe("resolved");
    expect(snapshot?.jobs[0]?.state).toBe("pending");
    expect(snapshot?.jobs[0]?.retries_remaining).toBe(snapshot?.jobs[0]?.retries_total);
    expect(snapshot?.tokens.find((t) => t.element_id === "Task_Greet")?.state).toBe("waiting");

    await engine.runOneTick();

    snapshot = await engine.getInstance(instance.id);
    expect(snapshot?.state).toBe("completed");
    expect(snapshot?.variables.greeting).toBe("fixed");
    expect(attempts).toBe(4);
    expect(snapshot?.audit.map((a) => a.event_type)).toContain("INCIDENT_RESOLVED");
  });

  it("respects retry backoff timing", async () => {
    // 100ms backoff: a tick run immediately after a failure should NOT see
    // the job ready yet.
    await engine.stop();
    engine = new Engine({
      databaseUrl: TEST_DATABASE_URL,
      jobPollIntervalMs: 25,
      retryBaseDelayMs: 200,
      retryMaxDelayMs: 200,
      autoStartJobRunner: false,
    });
    await engine.start();

    let attempts = 0;
    engine.registerHandler("greet", () => {
      attempts += 1;
      if (attempts < 2) throw new Error("transient");
      return { greeting: "ok" };
    });
    await engine.deploy(HELLO_BPMN);
    const instance = await engine.createInstance("hello-world", { name: "x" });

    await engine.runOneTick(); // attempt 1 → fail, retry scheduled 200ms out
    expect(attempts).toBe(1);

    // Immediate tick: still gated by backoff.
    const result = await engine.runOneTick();
    expect(result.jobs).toBe(0);
    expect(attempts).toBe(1);

    // Wait for the backoff window, then a tick should process attempt 2.
    await waitUntil(async () => {
      await engine.runOneTick();
      const s = await engine.getInstance(instance.id);
      return s?.state === "completed";
    });
    expect(attempts).toBe(2);
  });
});
