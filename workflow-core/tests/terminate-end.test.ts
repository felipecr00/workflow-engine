import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Engine } from "../src/engine";
import { resetDatabase, TEST_DATABASE_URL } from "./helpers/db";

// Linear process whose only end event is a Terminate.
const LINEAR_TERMINATE_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:zeebe="http://camunda.org/schema/zeebe/1.0">
  <bpmn:process id="linear-terminate" name="Linear Terminate" isExecutable="true">
    <bpmn:startEvent id="Start"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:serviceTask id="Work">
      <bpmn:extensionElements>
        <zeebe:taskDefinition type="work" retries="1" />
      </bpmn:extensionElements>
      <bpmn:incoming>F1</bpmn:incoming><bpmn:outgoing>F2</bpmn:outgoing>
    </bpmn:serviceTask>
    <bpmn:endEvent id="End">
      <bpmn:incoming>F2</bpmn:incoming>
      <bpmn:terminateEventDefinition id="TerminateDef_1" />
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="Work" />
    <bpmn:sequenceFlow id="F2" sourceRef="Work" targetRef="End" />
  </bpmn:process>
</bpmn:definitions>`;

// Parallel split: one branch races to Terminate, the other has a long-running
// service task that should be cancelled.
const PARALLEL_TERMINATE_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:zeebe="http://camunda.org/schema/zeebe/1.0">
  <bpmn:process id="parallel-terminate" name="Parallel Terminate" isExecutable="true">
    <bpmn:startEvent id="Start"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:parallelGateway id="Split">
      <bpmn:incoming>F1</bpmn:incoming>
      <bpmn:outgoing>F_Fast</bpmn:outgoing>
      <bpmn:outgoing>F_Slow</bpmn:outgoing>
    </bpmn:parallelGateway>
    <bpmn:serviceTask id="Slow">
      <bpmn:extensionElements>
        <zeebe:taskDefinition type="slow-work" retries="1" />
      </bpmn:extensionElements>
      <bpmn:incoming>F_Slow</bpmn:incoming>
      <bpmn:outgoing>F_SlowToEnd</bpmn:outgoing>
    </bpmn:serviceTask>
    <bpmn:endEvent id="SlowEnd"><bpmn:incoming>F_SlowToEnd</bpmn:incoming></bpmn:endEvent>
    <bpmn:endEvent id="TerminateEnd">
      <bpmn:incoming>F_Fast</bpmn:incoming>
      <bpmn:terminateEventDefinition id="TerminateDef_1" />
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="Split" />
    <bpmn:sequenceFlow id="F_Fast" sourceRef="Split" targetRef="TerminateEnd" />
    <bpmn:sequenceFlow id="F_Slow" sourceRef="Split" targetRef="Slow" />
    <bpmn:sequenceFlow id="F_SlowToEnd" sourceRef="Slow" targetRef="SlowEnd" />
  </bpmn:process>
</bpmn:definitions>`;

describe("Terminate End Event", () => {
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
      autoStartJobRunner: false,
    });
    await engine.start();
  });

  afterAll(async () => {
    if (engine) await engine.stop();
  });

  it("terminates the instance and preserves variables", async () => {
    engine.registerHandler("work", () => ({ done: true }));
    await engine.deploy(LINEAR_TERMINATE_BPMN);
    const inst = await engine.createInstance("linear-terminate", { run: 1 });

    await engine.runOneTick();

    const snap = await engine.getInstance(inst.id);
    expect(snap?.state).toBe("terminated");
    expect(snap?.variables).toMatchObject({ run: 1, done: true });

    const audit = snap!.audit.map((a) => a.event_type);
    expect(audit).toContain("INSTANCE_TERMINATED");
    expect(audit).not.toContain("INSTANCE_COMPLETED");
  });

  it("cancels live tokens and pending jobs in a parallel branch", async () => {
    engine.registerHandler("slow-work", () => ({ slow: true }));
    await engine.deploy(PARALLEL_TERMINATE_BPMN);
    const inst = await engine.createInstance("parallel-terminate", {});

    // Creating the instance fires both fork branches inline. The "fast"
    // branch reaches TerminateEnd before the scheduler ever ticks, which is
    // exactly what we want: a still-pending slow-work job must be cancelled.
    const snap = await engine.getInstance(inst.id);
    expect(snap?.state).toBe("terminated");

    // No live tokens left.
    const live = snap!.tokens.filter(
      (t) => t.state === "active" || t.state === "waiting" || t.state === "incident",
    );
    expect(live).toHaveLength(0);

    // The slow-work job must be cancelled, never completed.
    const slow = snap!.jobs.find((j) => j.element_id === "Slow");
    expect(slow).toBeDefined();
    expect(slow!.state).toBe("cancelled");

    const audit = snap!.audit.find((a) => a.event_type === "INSTANCE_TERMINATED");
    expect(audit).toBeDefined();
    expect(audit!.metadata).toMatchObject({
      terminatedBy: "TerminateEnd",
      cancelledTokens: expect.any(Number),
      cancelledJobs: expect.any(Number),
    });
    expect((audit!.metadata as { cancelledJobs: number }).cancelledJobs).toBeGreaterThan(0);
  });

  it("a subsequent scheduler tick is a no-op for the terminated instance", async () => {
    engine.registerHandler("slow-work", () => ({ slow: true }));
    await engine.deploy(PARALLEL_TERMINATE_BPMN);
    await engine.createInstance("parallel-terminate", {});

    // Tick should not pick up the cancelled job.
    const before = await engine.runOneTick();
    expect(before.jobs).toBe(0);
  });
});
