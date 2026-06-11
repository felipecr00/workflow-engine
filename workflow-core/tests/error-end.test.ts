import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Engine } from "../src/engine";
import { resetDatabase, TEST_DATABASE_URL } from "./helpers/db";

// Linear process with a single Error end event.
const LINEAR_ERROR_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:zeebe="http://camunda.org/schema/zeebe/1.0">
  <bpmn:error id="Error_Validation" name="Validation" errorCode="VALIDATION_FAILED" />
  <bpmn:process id="linear-error" name="Linear Error" isExecutable="true">
    <bpmn:startEvent id="Start"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:endEvent id="ErrEnd">
      <bpmn:incoming>F1</bpmn:incoming>
      <bpmn:errorEventDefinition id="ErrDef_1" errorRef="Error_Validation" />
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="ErrEnd" />
  </bpmn:process>
</bpmn:definitions>`;

// Parallel: one branch error-ends, the other reaches a normal End. Instance
// must remain active (other branch alive); error branch token is in incident.
const PARALLEL_ERROR_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:zeebe="http://camunda.org/schema/zeebe/1.0">
  <bpmn:error id="Error_Boom" name="Boom" errorCode="BOOM" />
  <bpmn:process id="parallel-error" name="Parallel Error" isExecutable="true">
    <bpmn:startEvent id="Start"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:parallelGateway id="Split">
      <bpmn:incoming>F1</bpmn:incoming>
      <bpmn:outgoing>F_Err</bpmn:outgoing>
      <bpmn:outgoing>F_Wait</bpmn:outgoing>
    </bpmn:parallelGateway>
    <bpmn:userTask id="WaitTask" name="Wait" >
      <bpmn:incoming>F_Wait</bpmn:incoming>
      <bpmn:outgoing>F_WaitToEnd</bpmn:outgoing>
    </bpmn:userTask>
    <bpmn:endEvent id="WaitEnd"><bpmn:incoming>F_WaitToEnd</bpmn:incoming></bpmn:endEvent>
    <bpmn:endEvent id="ErrEnd">
      <bpmn:incoming>F_Err</bpmn:incoming>
      <bpmn:errorEventDefinition id="ErrDef_1" errorRef="Error_Boom" />
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="Split" />
    <bpmn:sequenceFlow id="F_Err" sourceRef="Split" targetRef="ErrEnd" />
    <bpmn:sequenceFlow id="F_Wait" sourceRef="Split" targetRef="WaitTask" />
    <bpmn:sequenceFlow id="F_WaitToEnd" sourceRef="WaitTask" targetRef="WaitEnd" />
  </bpmn:process>
</bpmn:definitions>`;

describe("Error End Event", () => {
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

  it("creates an incident with the errorCode and parks the token in incident", async () => {
    await engine.deploy(LINEAR_ERROR_BPMN);
    const inst = await engine.createInstance("linear-error", {});

    const snap = await engine.getInstance(inst.id);
    // No boundary catch yet: instance stays active with a token in incident.
    expect(snap?.state).toBe("active");
    expect(snap!.incidents).toHaveLength(1);

    const incident = snap!.incidents[0]!;
    expect(incident.type).toBe("error_end_event");
    expect(incident.error_message).toMatch(/VALIDATION_FAILED/);
    expect(incident.state).toBe("active");

    const stuckTokens = snap!.tokens.filter((t) => t.state === "incident");
    expect(stuckTokens).toHaveLength(1);
    expect(stuckTokens[0]!.element_id).toBe("ErrEnd");

    const auditCreate = snap!.audit.find(
      (a) =>
        a.event_type === "INCIDENT_CREATED" &&
        (a.metadata as { reason?: string }).reason === "error_end_event",
    );
    expect(auditCreate).toBeDefined();
    expect((auditCreate!.metadata as { errorCode?: string }).errorCode).toBe(
      "VALIDATION_FAILED",
    );
  });

  it("keeps the instance active when another branch still has live tokens", async () => {
    await engine.deploy(PARALLEL_ERROR_BPMN);
    const inst = await engine.createInstance("parallel-error", {});

    const snap = await engine.getInstance(inst.id);
    expect(snap?.state).toBe("active");
    expect(snap!.incidents).toHaveLength(1);

    // One token incident (Error branch), one token waiting (UserTask branch).
    const waiting = snap!.tokens.filter((t) => t.state === "waiting");
    expect(waiting).toHaveLength(1);
    expect(waiting[0]!.element_id).toBe("WaitTask");

    // Resolving the incident does NOT advance the error-branch token in
    // Sprint 3 (no boundary catch yet). It just marks the incident resolved.
    await engine.resolveIncident(snap!.incidents[0]!.id);

    const after = await engine.getInstance(inst.id);
    expect(after!.incidents[0]!.state).toBe("resolved");
    const errTokenAfter = after!.tokens.find(
      (t) => t.element_id === "ErrEnd",
    );
    expect(errTokenAfter!.state).toBe("incident");
    expect(after!.state).toBe("active");
  });
});
