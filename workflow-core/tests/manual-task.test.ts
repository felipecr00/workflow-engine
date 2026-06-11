import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Engine } from "../src/engine";
import { resetDatabase, TEST_DATABASE_URL } from "./helpers/db";

const MANUAL_TASK_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
  <bpmn:process id="manual-task-test" name="Manual Task Test" isExecutable="true">
    <bpmn:startEvent id="Start"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:manualTask id="DoStuff" name="Do the thing">
      <bpmn:incoming>F1</bpmn:incoming><bpmn:outgoing>F2</bpmn:outgoing>
    </bpmn:manualTask>
    <bpmn:endEvent id="End"><bpmn:incoming>F2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="DoStuff" />
    <bpmn:sequenceFlow id="F2" sourceRef="DoStuff" targetRef="End" />
  </bpmn:process>
</bpmn:definitions>`;

describe("Manual Task", () => {
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

  it("creates a user_tasks row with element_type=manualTask and no assignee/form", async () => {
    await engine.deploy(MANUAL_TASK_BPMN);
    const inst = await engine.createInstance("manual-task-test", { run: 1 });

    const snap = await engine.getInstance(inst.id);
    expect(snap?.state).toBe("active");
    expect(snap!.userTasks).toHaveLength(1);

    const task = snap!.userTasks[0]!;
    expect(task.element_id).toBe("DoStuff");
    expect(task.task_name).toBe("Do the thing");
    expect(task.state).toBe("created");
    expect(task.assignee).toBeNull();
    expect(task.candidate_groups).toEqual([]);
    expect(task.form_key).toBeNull();
    expect(task.form_version).toBeNull();

    const audit = snap!.audit.find((a) => a.event_type === "MANUAL_TASK_CREATED");
    expect(audit).toBeDefined();
    expect((audit!.metadata as { userTaskId: string }).userTaskId).toBe(task.id);
  });

  it("completes via /user-tasks/:id/complete, merges variables, and advances", async () => {
    await engine.deploy(MANUAL_TASK_BPMN);
    const inst = await engine.createInstance("manual-task-test", { existing: "kept" });

    const tasks = await engine.listUserTasks();
    expect(tasks).toHaveLength(1);

    await engine.completeUserTask(tasks[0]!.id, { signedOff: true });

    const snap = await engine.getInstance(inst.id);
    expect(snap?.state).toBe("completed");
    expect(snap?.variables).toMatchObject({ existing: "kept", signedOff: true });

    const auditTypes = snap!.audit.map((a) => a.event_type);
    expect(auditTypes).toContain("MANUAL_TASK_CREATED");
    expect(auditTypes).toContain("MANUAL_TASK_COMPLETED");
    expect(auditTypes).toContain("INSTANCE_COMPLETED");
  });

  it("manual tasks show up in the global /user-tasks listing", async () => {
    await engine.deploy(MANUAL_TASK_BPMN);
    await engine.createInstance("manual-task-test");

    const all = await engine.listUserTasks();
    expect(all).toHaveLength(1);
    expect(all[0]!.element_id).toBe("DoStuff");
  });
});
