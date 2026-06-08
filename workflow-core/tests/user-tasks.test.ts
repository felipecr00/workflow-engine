import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Engine } from "../src/engine";
import { resetDatabase, TEST_DATABASE_URL } from "./helpers/db";

// Start → UserTask_Approve → ServiceTask_Process → End
const USER_TASK_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:zeebe="http://camunda.org/schema/zeebe/1.0"
                  targetNamespace="http://workflow-engine/tests"
                  id="Defs_ut">
  <bpmn:process id="user-task-test" name="User Task Test" isExecutable="true">
    <bpmn:startEvent id="Start"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:userTask id="Approve" name="Approve Request">
      <bpmn:extensionElements>
        <zeebe:assignmentDefinition assignee="manager" candidateGroups="approvers,leads" />
        <zeebe:ioMapping>
          <zeebe:input source="=variables.requestId" target="requestId" />
          <zeebe:output source="=result.approved" target="variables.approved" />
        </zeebe:ioMapping>
      </bpmn:extensionElements>
      <bpmn:incoming>F1</bpmn:incoming><bpmn:outgoing>F2</bpmn:outgoing>
    </bpmn:userTask>
    <bpmn:serviceTask id="Process">
      <bpmn:extensionElements>
        <zeebe:taskDefinition type="process-request" retries="3" />
      </bpmn:extensionElements>
      <bpmn:incoming>F2</bpmn:incoming><bpmn:outgoing>F3</bpmn:outgoing>
    </bpmn:serviceTask>
    <bpmn:endEvent id="End"><bpmn:incoming>F3</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="Approve" />
    <bpmn:sequenceFlow id="F2" sourceRef="Approve" targetRef="Process" />
    <bpmn:sequenceFlow id="F3" sourceRef="Process" targetRef="End" />
  </bpmn:process>
</bpmn:definitions>`;

// Start → UserTask_Simple → End  (no assignment, no IO mapping)
const SIMPLE_USER_TASK_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:zeebe="http://camunda.org/schema/zeebe/1.0"
                  targetNamespace="http://workflow-engine/tests"
                  id="Defs_sut">
  <bpmn:process id="simple-user-task" name="Simple User Task" isExecutable="true">
    <bpmn:startEvent id="Start"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:userTask id="Review" name="Review Item">
      <bpmn:incoming>F1</bpmn:incoming><bpmn:outgoing>F2</bpmn:outgoing>
    </bpmn:userTask>
    <bpmn:endEvent id="End"><bpmn:incoming>F2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="Review" />
    <bpmn:sequenceFlow id="F2" sourceRef="Review" targetRef="End" />
  </bpmn:process>
</bpmn:definitions>`;

describe("user tasks", () => {
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
    engine.registerHandler("process-request", async () => ({ processed: true }));
    await engine.start();
  });

  afterAll(async () => {
    if (engine) await engine.stop();
  });

  it("creates a user task when instance reaches bpmn:userTask", async () => {
    await engine.deploy(USER_TASK_BPMN);
    const inst = await engine.createInstance("user-task-test", { requestId: "REQ-001" });

    const snap = await engine.getInstance(inst.id);
    expect(snap!.state).toBe("active");
    expect(snap!.userTasks).toHaveLength(1);

    const task = snap!.userTasks[0]!;
    expect(task.element_id).toBe("Approve");
    expect(task.task_name).toBe("Approve Request");
    expect(task.state).toBe("created");
    expect(task.assignee).toBe("manager");
    expect(task.candidate_groups).toEqual(["approvers", "leads"]);
    expect(task.input_variables).toEqual({ requestId: "REQ-001" });

    const waitingTokens = snap!.tokens.filter((t) => t.state === "waiting");
    expect(waitingTokens).toHaveLength(1);
    expect(waitingTokens[0]!.element_id).toBe("Approve");
  });

  it("lists user tasks with filters", async () => {
    await engine.deploy(USER_TASK_BPMN);
    await engine.createInstance("user-task-test", { requestId: "REQ-001" });

    const all = await engine.listUserTasks();
    expect(all).toHaveLength(1);

    const byState = await engine.listUserTasks({ state: "created" });
    expect(byState).toHaveLength(1);

    const byAssignee = await engine.listUserTasks({ assignee: "manager" });
    expect(byAssignee).toHaveLength(1);

    const none = await engine.listUserTasks({ assignee: "nobody" });
    expect(none).toHaveLength(0);
  });

  it("claims a user task", async () => {
    await engine.deploy(USER_TASK_BPMN);
    const inst = await engine.createInstance("user-task-test", { requestId: "REQ-001" });

    const tasks = await engine.listUserTasks({ state: "created" });
    const taskId = tasks[0]!.id;

    await engine.claimUserTask(taskId, "alice");

    const snap = await engine.getInstance(inst.id);
    const task = snap!.userTasks[0]!;
    expect(task.state).toBe("claimed");
    expect(task.claimed_by).toBe("alice");
    expect(task.assignee).toBe("alice");
    expect(task.claimed_at).toBeTruthy();

    const audit = snap!.audit.filter((a) => a.event_type === "USER_TASK_CLAIMED");
    expect(audit).toHaveLength(1);
  });

  it("completes a user task and advances the process", async () => {
    await engine.deploy(USER_TASK_BPMN);
    const inst = await engine.createInstance("user-task-test", { requestId: "REQ-001" });

    const tasks = await engine.listUserTasks();
    await engine.claimUserTask(tasks[0]!.id, "alice");
    await engine.completeUserTask(tasks[0]!.id, { approved: true });

    // Token should have advanced past the user task to the service task
    const snap = await engine.getInstance(inst.id);
    const completedTask = snap!.userTasks.find((t) => t.id === tasks[0]!.id)!;
    expect(completedTask.state).toBe("completed");
    expect(completedTask.output_variables).toEqual({ approved: true });

    // Variables should have output mapping applied
    expect(snap!.variables).toMatchObject({ requestId: "REQ-001", approved: true });

    // Service task should now be pending
    const pendingJobs = snap!.jobs.filter((j) => j.state === "pending");
    expect(pendingJobs).toHaveLength(1);
    expect(pendingJobs[0]!.element_id).toBe("Process");
  });

  it("completes user task without prior claim (direct complete)", async () => {
    await engine.deploy(USER_TASK_BPMN);
    const inst = await engine.createInstance("user-task-test", { requestId: "REQ-001" });

    const tasks = await engine.listUserTasks();
    await engine.completeUserTask(tasks[0]!.id, { approved: false });

    const snap = await engine.getInstance(inst.id);
    expect(snap!.userTasks[0]!.state).toBe("completed");
    expect(snap!.variables).toMatchObject({ approved: false });
  });

  it("full lifecycle: user task → service task → end", async () => {
    await engine.deploy(USER_TASK_BPMN);
    const inst = await engine.createInstance("user-task-test", { requestId: "REQ-001" });

    const tasks = await engine.listUserTasks();
    await engine.completeUserTask(tasks[0]!.id, { approved: true });

    // Run the scheduler to process the service task
    await engine.runOneTick();

    const snap = await engine.getInstance(inst.id);
    expect(snap!.state).toBe("completed");
    expect(snap!.variables).toMatchObject({
      requestId: "REQ-001",
      approved: true,
      processed: true,
    });
  });

  it("simple user task without assignment or IO mapping", async () => {
    await engine.deploy(SIMPLE_USER_TASK_BPMN);
    const inst = await engine.createInstance("simple-user-task");

    const snap = await engine.getInstance(inst.id);
    const task = snap!.userTasks[0]!;
    expect(task.element_id).toBe("Review");
    expect(task.assignee).toBeNull();
    expect(task.candidate_groups).toEqual([]);

    await engine.completeUserTask(task.id);

    const final = await engine.getInstance(inst.id);
    expect(final!.state).toBe("completed");
  });

  it("cancels a user task", async () => {
    await engine.deploy(USER_TASK_BPMN);
    const inst = await engine.createInstance("user-task-test", { requestId: "REQ-001" });

    const tasks = await engine.listUserTasks();
    await engine.cancelUserTask(tasks[0]!.id);

    const snap = await engine.getInstance(inst.id);
    expect(snap!.userTasks[0]!.state).toBe("cancelled");

    const audit = snap!.audit.filter((a) => a.event_type === "USER_TASK_CANCELLED");
    expect(audit).toHaveLength(1);
  });

  it("rejects completing an already completed user task", async () => {
    await engine.deploy(SIMPLE_USER_TASK_BPMN);
    await engine.createInstance("simple-user-task");

    const tasks = await engine.listUserTasks();
    await engine.completeUserTask(tasks[0]!.id);

    await expect(engine.completeUserTask(tasks[0]!.id)).rejects.toThrow(
      /state completed/,
    );
  });

  it("rejects claiming a completed user task", async () => {
    await engine.deploy(SIMPLE_USER_TASK_BPMN);
    await engine.createInstance("simple-user-task");

    const tasks = await engine.listUserTasks();
    await engine.completeUserTask(tasks[0]!.id);

    await expect(engine.claimUserTask(tasks[0]!.id, "bob")).rejects.toThrow(
      /Cannot claim/,
    );
  });
});
