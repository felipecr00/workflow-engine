import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Engine } from "../src/engine";
import { resetDatabase, TEST_DATABASE_URL } from "./helpers/db";

// V1: Start → TaskA → End
const PROCESS_V1 = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:zeebe="http://camunda.org/schema/zeebe/1.0"
                  targetNamespace="http://workflow-engine/tests"
                  id="Defs_migrate">
  <bpmn:process id="migrate-test" name="Migrate Test" isExecutable="true">
    <bpmn:startEvent id="Start"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:serviceTask id="TaskA" name="Task A">
      <bpmn:extensionElements>
        <zeebe:taskDefinition type="do-work" retries="3" />
      </bpmn:extensionElements>
      <bpmn:incoming>F1</bpmn:incoming><bpmn:outgoing>F2</bpmn:outgoing>
    </bpmn:serviceTask>
    <bpmn:endEvent id="End"><bpmn:incoming>F2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="TaskA" />
    <bpmn:sequenceFlow id="F2" sourceRef="TaskA" targetRef="End" />
  </bpmn:process>
</bpmn:definitions>`;

// V2: Start → TaskA_v2 → TaskB → End  (TaskA renamed, new TaskB inserted)
const PROCESS_V2 = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:zeebe="http://camunda.org/schema/zeebe/1.0"
                  targetNamespace="http://workflow-engine/tests"
                  id="Defs_migrate">
  <bpmn:process id="migrate-test" name="Migrate Test v2" isExecutable="true">
    <bpmn:startEvent id="Start"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:serviceTask id="TaskA_v2" name="Task A v2">
      <bpmn:extensionElements>
        <zeebe:taskDefinition type="do-work" retries="3" />
      </bpmn:extensionElements>
      <bpmn:incoming>F1</bpmn:incoming><bpmn:outgoing>F2</bpmn:outgoing>
    </bpmn:serviceTask>
    <bpmn:serviceTask id="TaskB" name="Task B">
      <bpmn:extensionElements>
        <zeebe:taskDefinition type="do-more-work" retries="3" />
      </bpmn:extensionElements>
      <bpmn:incoming>F2</bpmn:incoming><bpmn:outgoing>F3</bpmn:outgoing>
    </bpmn:serviceTask>
    <bpmn:endEvent id="End"><bpmn:incoming>F3</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="TaskA_v2" />
    <bpmn:sequenceFlow id="F2" sourceRef="TaskA_v2" targetRef="TaskB" />
    <bpmn:sequenceFlow id="F3" sourceRef="TaskB" targetRef="End" />
  </bpmn:process>
</bpmn:definitions>`;

describe("versioning and migration", () => {
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
    engine.registerHandler("do-work", async () => ({ done: true }));
    engine.registerHandler("do-more-work", async () => ({ extra: true }));
    await engine.start();
  });

  afterAll(async () => {
    if (engine) await engine.stop();
  });

  it("deploys two versions and new instances use latest", async () => {
    const v1 = await engine.deploy(PROCESS_V1);
    expect(v1.version).toBe(1);
    const v2 = await engine.deploy(PROCESS_V2);
    expect(v2.version).toBe(2);

    const inst = await engine.createInstance("migrate-test");
    expect(inst.definitionVersion).toBe(2);
    expect(inst.definitionId).toBe(v2.id);
  });

  it("lists all versions for a process key", async () => {
    await engine.deploy(PROCESS_V1);
    await engine.deploy(PROCESS_V2);

    const versions = await engine.listDefinitionVersions("migrate-test");
    expect(versions).toHaveLength(2);
    expect(versions[0]!.version).toBe(1);
    expect(versions[1]!.version).toBe(2);
  });

  it("existing instance stays on deployed version", async () => {
    await engine.deploy(PROCESS_V1);
    const inst = await engine.createInstance("migrate-test");
    expect(inst.definitionVersion).toBe(1);

    await engine.deploy(PROCESS_V2);

    const snap = await engine.getInstance(inst.id);
    expect(snap!.definitionVersion).toBe(1);
  });

  it("migrates a waiting instance to a new version", async () => {
    const v1 = await engine.deploy(PROCESS_V1);
    const inst = await engine.createInstance("migrate-test");

    const before = await engine.getInstance(inst.id);
    const waitingTokens = before!.tokens.filter((t) => t.state === "waiting");
    expect(waitingTokens).toHaveLength(1);
    expect(waitingTokens[0]!.element_id).toBe("TaskA");

    const v2 = await engine.deploy(PROCESS_V2);

    const result = await engine.migrateInstance({
      instanceId: inst.id,
      targetDefinitionKey: "migrate-test",
      targetVersion: 2,
      elementMapping: { TaskA: "TaskA_v2" },
    });

    expect(result.previousVersion).toBe(1);
    expect(result.newVersion).toBe(2);
    expect(result.previousDefinitionId).toBe(v1.id);
    expect(result.newDefinitionId).toBe(v2.id);
    expect(result.tokensMigrated).toBe(1);
    expect(result.jobsMigrated).toBe(1);

    const after = await engine.getInstance(inst.id);
    expect(after!.definitionVersion).toBe(2);
    expect(after!.definitionId).toBe(v2.id);
    const migratedTokens = after!.tokens.filter((t) => t.state === "waiting");
    expect(migratedTokens).toHaveLength(1);
    expect(migratedTokens[0]!.element_id).toBe("TaskA_v2");
  });

  it("migrated instance continues execution on new definition", async () => {
    await engine.deploy(PROCESS_V1);
    const inst = await engine.createInstance("migrate-test");

    await engine.deploy(PROCESS_V2);
    await engine.migrateInstance({
      instanceId: inst.id,
      targetDefinitionKey: "migrate-test",
      targetVersion: 2,
      elementMapping: { TaskA: "TaskA_v2" },
    });

    // Tick until complete — the instance must traverse TaskA_v2 → TaskB → End
    // on the v2 definition.
    await engine.runOneTick();
    await engine.runOneTick();
    const final = await engine.getInstance(inst.id);
    expect(final!.state).toBe("completed");

    // Both jobs ran (TaskA_v2 via do-work, TaskB via do-more-work)
    const completedJobs = final!.jobs.filter((j) => j.state === "completed");
    expect(completedJobs).toHaveLength(2);
    expect(completedJobs.map((j) => j.element_id).sort()).toEqual(["TaskA_v2", "TaskB"]);
  });

  it("records INSTANCE_MIGRATED audit event", async () => {
    await engine.deploy(PROCESS_V1);
    const inst = await engine.createInstance("migrate-test");
    await engine.deploy(PROCESS_V2);

    await engine.migrateInstance({
      instanceId: inst.id,
      targetDefinitionKey: "migrate-test",
      targetVersion: 2,
      elementMapping: { TaskA: "TaskA_v2" },
    });

    const snap = await engine.getInstance(inst.id);
    const migrationAudit = snap!.audit.filter((a) => a.event_type === "INSTANCE_MIGRATED");
    expect(migrationAudit).toHaveLength(1);
    expect(migrationAudit[0]!.metadata).toMatchObject({
      previousVersion: 1,
      newVersion: 2,
      elementMapping: { TaskA: "TaskA_v2" },
    });
  });

  it("rejects migration with incomplete element mapping", async () => {
    await engine.deploy(PROCESS_V1);
    const inst = await engine.createInstance("migrate-test");
    await engine.deploy(PROCESS_V2);

    await expect(
      engine.migrateInstance({
        instanceId: inst.id,
        targetDefinitionKey: "migrate-test",
        targetVersion: 2,
        elementMapping: {},
      }),
    ).rejects.toThrow(/unmapped live elements.*TaskA/);
  });

  it("rejects migration targeting nonexistent version", async () => {
    await engine.deploy(PROCESS_V1);
    const inst = await engine.createInstance("migrate-test");

    await expect(
      engine.migrateInstance({
        instanceId: inst.id,
        targetDefinitionKey: "migrate-test",
        targetVersion: 99,
        elementMapping: { TaskA: "TaskA_v2" },
      }),
    ).rejects.toThrow(/No definition found/);
  });

  it("rejects migration to same version", async () => {
    await engine.deploy(PROCESS_V1);
    const inst = await engine.createInstance("migrate-test");

    await expect(
      engine.migrateInstance({
        instanceId: inst.id,
        targetDefinitionKey: "migrate-test",
        targetVersion: 1,
        elementMapping: { TaskA: "TaskA" },
      }),
    ).rejects.toThrow(/already on the target/);
  });

  it("rejects migration when mapping target element does not exist", async () => {
    await engine.deploy(PROCESS_V1);
    const inst = await engine.createInstance("migrate-test");
    await engine.deploy(PROCESS_V2);

    await expect(
      engine.migrateInstance({
        instanceId: inst.id,
        targetDefinitionKey: "migrate-test",
        targetVersion: 2,
        elementMapping: { TaskA: "NonExistent" },
      }),
    ).rejects.toThrow(/does not exist in target definition/);
  });

  it("rejects migration of a completed instance", async () => {
    await engine.deploy(PROCESS_V1);
    const inst = await engine.createInstance("migrate-test");
    await engine.runOneTick();
    const snap = await engine.getInstance(inst.id);
    expect(snap!.state).toBe("completed");

    await engine.deploy(PROCESS_V2);

    await expect(
      engine.migrateInstance({
        instanceId: inst.id,
        targetDefinitionKey: "migrate-test",
        targetVersion: 2,
        elementMapping: { TaskA: "TaskA_v2" },
      }),
    ).rejects.toThrow(/only active instances/);
  });
});
