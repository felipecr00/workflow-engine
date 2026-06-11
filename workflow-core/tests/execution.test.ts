import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Engine } from "../src/engine";
import { resetDatabase, TEST_DATABASE_URL } from "./helpers/db";
import { HELLO_BPMN, TWO_TASK_BPMN, waitUntil } from "./helpers/fixtures";

describe("engine execution (happy path)", () => {
  let engine: Engine;

  beforeAll(async () => {
    await resetDatabase();
  });

  beforeEach(async () => {
    if (engine) await engine.stop();
    await resetDatabase();
    engine = new Engine({
      databaseUrl: TEST_DATABASE_URL,
      jobPollIntervalMs: 25,
      autoStartJobRunner: false, // tests drive ticks manually
    });
    await engine.start();
  });

  afterAll(async () => {
    if (engine) await engine.stop();
  });

  it("runs a single-task process end to end", async () => {
    const greetings: string[] = [];
    engine.registerHandler("greet", async (ctx) => {
      greetings.push(String(ctx.variables.name));
      return { greeting: `hello, ${ctx.variables.name}` };
    });

    const deploy = await engine.deploy(HELLO_BPMN);
    expect(deploy.version).toBe(1);

    const instance = await engine.createInstance("hello-world", { name: "world" });

    await engine.runOneTick();

    const snapshot = await engine.getInstance(instance.id);
    expect(snapshot?.state).toBe("completed");
    expect(snapshot?.variables).toEqual({ name: "world", greeting: "hello, world" });
    expect(greetings).toEqual(["world"]);

    const jobs = snapshot!.jobs;
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.state).toBe("completed");

    const auditTypes = snapshot!.audit.map((a) => a.event_type);
    expect(auditTypes).toContain("INSTANCE_CREATED");
    expect(auditTypes).toContain("JOB_CREATED");
    expect(auditTypes).toContain("JOB_COMPLETED");
    expect(auditTypes).toContain("INSTANCE_COMPLETED");
  });

  it("runs a two-task process across multiple ticks", async () => {
    const observed: string[] = [];
    engine.registerHandler("step-a", () => {
      observed.push("a");
    });
    engine.registerHandler("step-b", () => {
      observed.push("b");
    });

    await engine.deploy(TWO_TASK_BPMN);
    const instance = await engine.createInstance("two-step", {});

    // Each tick processes up to batchSize jobs. We expect two jobs total
    // (one per service task), each scheduled only after the previous completes.
    await engine.runOneTick();
    await engine.runOneTick();

    const snapshot = await engine.getInstance(instance.id);
    expect(snapshot?.state).toBe("completed");
    expect(observed).toEqual(["a", "b"]);
  });

  it("auto-versions deployments per process key", async () => {
    engine.registerHandler("greet", () => ({ greeting: "hi" }));
    const v1 = await engine.deploy(HELLO_BPMN);
    const v2 = await engine.deploy(HELLO_BPMN);
    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);

    const instance = await engine.createInstance("hello-world", { name: "x" });
    const snapshot = await engine.getInstance(instance.id);
    expect(snapshot?.definitionVersion).toBe(2);
  });

  it("rejects deploy if a handler is missing", async () => {
    await expect(engine.deploy(HELLO_BPMN)).rejects.toThrow(/no handler/i);
  });

  it("retries a throwing handler and ultimately raises an incident", async () => {
    // Disable backoff delay so successive ticks process each retry attempt.
    await engine.stop();
    engine = new Engine({
      databaseUrl: TEST_DATABASE_URL,
      jobPollIntervalMs: 25,
      retryBaseDelayMs: 0,
      retryMaxDelayMs: 0,
      autoStartJobRunner: false,
    });
    await engine.start();

    let attempts = 0;
    engine.registerHandler("greet", () => {
      attempts += 1;
      throw new Error("kaboom");
    });
    await engine.deploy(HELLO_BPMN);
    const instance = await engine.createInstance("hello-world", { name: "x" });

    // BPMN sets retries=3, so we expect 3 total attempts before an incident.
    await engine.runOneTick();
    await engine.runOneTick();
    await engine.runOneTick();

    const snapshot = await engine.getInstance(instance.id);
    expect(attempts).toBe(3);
    expect(snapshot?.state).toBe("active");
    expect(snapshot?.jobs[0]?.state).toBe("incident");
    expect(snapshot?.jobs[0]?.error_message).toMatch(/kaboom/);
    expect(snapshot?.incidents).toHaveLength(1);
    expect(snapshot?.incidents[0]?.type).toBe("job_retries_exhausted");
    const auditTypes = snapshot!.audit.map((a) => a.event_type);
    expect(auditTypes.filter((t) => t === "JOB_FAILED").length).toBe(2);
    expect(auditTypes).toContain("JOB_RETRIES_EXHAUSTED");
    expect(auditTypes).toContain("INCIDENT_CREATED");
  });

  it("runs a SendTask job via the same handler mechanism as a ServiceTask", async () => {
    const SEND_TASK_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:zeebe="http://camunda.org/schema/zeebe/1.0">
  <bpmn:process id="send-task-test" isExecutable="true">
    <bpmn:startEvent id="Start"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:sendTask id="SendMail">
      <bpmn:extensionElements>
        <zeebe:taskDefinition type="send-mail" retries="1" />
      </bpmn:extensionElements>
      <bpmn:incoming>F1</bpmn:incoming><bpmn:outgoing>F2</bpmn:outgoing>
    </bpmn:sendTask>
    <bpmn:endEvent id="End"><bpmn:incoming>F2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="SendMail"/>
    <bpmn:sequenceFlow id="F2" sourceRef="SendMail" targetRef="End"/>
  </bpmn:process>
</bpmn:definitions>`;

    let received: unknown = null;
    engine.registerHandler("send-mail", (ctx) => {
      received = ctx.variables;
      return { sent: true };
    });
    await engine.deploy(SEND_TASK_BPMN);
    const inst = await engine.createInstance("send-task-test", { to: "alice" });
    await engine.runOneTick();

    const snap = await engine.getInstance(inst.id);
    expect(snap?.state).toBe("completed");
    expect(snap?.variables).toMatchObject({ to: "alice", sent: true });
    expect(received).toMatchObject({ to: "alice" });

    const sendCreated = snap!.audit.find(
      (a) => a.event_type === "SEND_TASK_JOB_CREATED",
    );
    expect(sendCreated).toBeDefined();
    expect((sendCreated!.metadata as { kind?: string }).kind).toBe("send");

    const sendCompleted = snap!.audit.find(
      (a) =>
        a.event_type === "JOB_COMPLETED" &&
        (a.metadata as { kind?: string }).kind === "send",
    );
    expect(sendCompleted).toBeDefined();
  });

  it("walks through an IntermediateThrowEvent None without blocking", async () => {
    const THROW_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:zeebe="http://camunda.org/schema/zeebe/1.0">
  <bpmn:process id="throw-test" isExecutable="true">
    <bpmn:startEvent id="Start"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:intermediateThrowEvent id="Checkpoint" name="midway">
      <bpmn:incoming>F1</bpmn:incoming><bpmn:outgoing>F2</bpmn:outgoing>
    </bpmn:intermediateThrowEvent>
    <bpmn:serviceTask id="After">
      <bpmn:extensionElements>
        <zeebe:taskDefinition type="after-throw" retries="1" />
      </bpmn:extensionElements>
      <bpmn:incoming>F2</bpmn:incoming><bpmn:outgoing>F3</bpmn:outgoing>
    </bpmn:serviceTask>
    <bpmn:endEvent id="End"><bpmn:incoming>F3</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="Checkpoint"/>
    <bpmn:sequenceFlow id="F2" sourceRef="Checkpoint" targetRef="After"/>
    <bpmn:sequenceFlow id="F3" sourceRef="After" targetRef="End"/>
  </bpmn:process>
</bpmn:definitions>`;

    engine.registerHandler("after-throw", () => ({ ok: true }));
    await engine.deploy(THROW_BPMN);
    const inst = await engine.createInstance("throw-test", {});
    await engine.runOneTick();

    const snap = await engine.getInstance(inst.id);
    expect(snap?.state).toBe("completed");

    const throwAudit = snap!.audit.find((a) => a.event_type === "THROW_EVENT_NONE");
    expect(throwAudit).toBeDefined();
    expect(throwAudit!.element_id).toBe("Checkpoint");
  });

  it("can run the job runner on its interval (auto-start)", async () => {
    await engine.stop();
    engine = new Engine({
      databaseUrl: TEST_DATABASE_URL,
      jobPollIntervalMs: 20,
    });
    await engine.start();
    engine.registerHandler("greet", () => ({ greeting: "hi" }));
    await engine.deploy(HELLO_BPMN);
    const instance = await engine.createInstance("hello-world", { name: "x" });

    await waitUntil(async () => {
      const s = await engine.getInstance(instance.id);
      return s?.state === "completed";
    });
  });
});
