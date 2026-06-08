import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Engine } from "../src/engine";
import { resetDatabase, TEST_DATABASE_URL } from "./helpers/db";

const XOR_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:zeebe="http://camunda.org/schema/zeebe/1.0"
                  id="Definitions_xor">
  <bpmn:process id="approval" isExecutable="true">
    <bpmn:startEvent id="Start"><bpmn:outgoing>F0</bpmn:outgoing></bpmn:startEvent>
    <bpmn:exclusiveGateway id="Gw" default="Flow_other">
      <bpmn:incoming>F0</bpmn:incoming>
      <bpmn:outgoing>Flow_approve</bpmn:outgoing>
      <bpmn:outgoing>Flow_reject</bpmn:outgoing>
      <bpmn:outgoing>Flow_other</bpmn:outgoing>
    </bpmn:exclusiveGateway>
    <bpmn:serviceTask id="Approve">
      <bpmn:extensionElements>
        <zeebe:taskDefinition type="approve" retries="1" />
      </bpmn:extensionElements>
      <bpmn:incoming>Flow_approve</bpmn:incoming><bpmn:outgoing>Fa</bpmn:outgoing>
    </bpmn:serviceTask>
    <bpmn:serviceTask id="Reject">
      <bpmn:extensionElements>
        <zeebe:taskDefinition type="reject" retries="1" />
      </bpmn:extensionElements>
      <bpmn:incoming>Flow_reject</bpmn:incoming><bpmn:outgoing>Fr</bpmn:outgoing>
    </bpmn:serviceTask>
    <bpmn:serviceTask id="Escalate">
      <bpmn:extensionElements>
        <zeebe:taskDefinition type="escalate" retries="1" />
      </bpmn:extensionElements>
      <bpmn:incoming>Flow_other</bpmn:incoming><bpmn:outgoing>Fo</bpmn:outgoing>
    </bpmn:serviceTask>
    <bpmn:endEvent id="End">
      <bpmn:incoming>Fa</bpmn:incoming>
      <bpmn:incoming>Fr</bpmn:incoming>
      <bpmn:incoming>Fo</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="F0" sourceRef="Start" targetRef="Gw"/>
    <bpmn:sequenceFlow id="Flow_approve" sourceRef="Gw" targetRef="Approve">
      <bpmn:conditionExpression>=variables.amount &lt; 1000 &amp;&amp; variables.approved</bpmn:conditionExpression>
    </bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="Flow_reject" sourceRef="Gw" targetRef="Reject">
      <bpmn:conditionExpression>=variables.approved == false</bpmn:conditionExpression>
    </bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="Flow_other" sourceRef="Gw" targetRef="Escalate"/>
    <bpmn:sequenceFlow id="Fa" sourceRef="Approve" targetRef="End"/>
    <bpmn:sequenceFlow id="Fr" sourceRef="Reject" targetRef="End"/>
    <bpmn:sequenceFlow id="Fo" sourceRef="Escalate" targetRef="End"/>
  </bpmn:process>
</bpmn:definitions>`;

const PARALLEL_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:zeebe="http://camunda.org/schema/zeebe/1.0"
                  id="Definitions_par">
  <bpmn:process id="par" isExecutable="true">
    <bpmn:startEvent id="Start"><bpmn:outgoing>F0</bpmn:outgoing></bpmn:startEvent>
    <bpmn:parallelGateway id="Split">
      <bpmn:incoming>F0</bpmn:incoming>
      <bpmn:outgoing>Fa</bpmn:outgoing>
      <bpmn:outgoing>Fb</bpmn:outgoing>
    </bpmn:parallelGateway>
    <bpmn:serviceTask id="A">
      <bpmn:extensionElements><zeebe:taskDefinition type="task-a" retries="1"/></bpmn:extensionElements>
      <bpmn:incoming>Fa</bpmn:incoming><bpmn:outgoing>Fa2</bpmn:outgoing>
    </bpmn:serviceTask>
    <bpmn:serviceTask id="B">
      <bpmn:extensionElements><zeebe:taskDefinition type="task-b" retries="1"/></bpmn:extensionElements>
      <bpmn:incoming>Fb</bpmn:incoming><bpmn:outgoing>Fb2</bpmn:outgoing>
    </bpmn:serviceTask>
    <bpmn:parallelGateway id="Join">
      <bpmn:incoming>Fa2</bpmn:incoming>
      <bpmn:incoming>Fb2</bpmn:incoming>
      <bpmn:outgoing>F3</bpmn:outgoing>
    </bpmn:parallelGateway>
    <bpmn:serviceTask id="Final">
      <bpmn:extensionElements><zeebe:taskDefinition type="final" retries="1"/></bpmn:extensionElements>
      <bpmn:incoming>F3</bpmn:incoming><bpmn:outgoing>F4</bpmn:outgoing>
    </bpmn:serviceTask>
    <bpmn:endEvent id="End"><bpmn:incoming>F4</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="F0" sourceRef="Start" targetRef="Split"/>
    <bpmn:sequenceFlow id="Fa" sourceRef="Split" targetRef="A"/>
    <bpmn:sequenceFlow id="Fb" sourceRef="Split" targetRef="B"/>
    <bpmn:sequenceFlow id="Fa2" sourceRef="A" targetRef="Join"/>
    <bpmn:sequenceFlow id="Fb2" sourceRef="B" targetRef="Join"/>
    <bpmn:sequenceFlow id="F3" sourceRef="Join" targetRef="Final"/>
    <bpmn:sequenceFlow id="F4" sourceRef="Final" targetRef="End"/>
  </bpmn:process>
</bpmn:definitions>`;

describe("gateways", () => {
  let engine: Engine;

  beforeAll(async () => {
    await resetDatabase();
  });

  beforeEach(async () => {
    if (engine) await engine.stop();
    await resetDatabase();
    engine = new Engine({
      databaseUrl: TEST_DATABASE_URL,
      autoStartJobRunner: false,
    });
    await engine.start();
  });

  afterAll(async () => {
    if (engine) await engine.stop();
  });

  describe("XOR gateway", () => {
    it("takes the first matching condition", async () => {
      const calls: string[] = [];
      engine.registerHandler("approve", () => { calls.push("approve"); });
      engine.registerHandler("reject", () => { calls.push("reject"); });
      engine.registerHandler("escalate", () => { calls.push("escalate"); });

      await engine.deploy(XOR_BPMN);
      const instance = await engine.createInstance("approval", {
        amount: 500,
        approved: true,
      });
      await engine.runOneTick();

      const snapshot = await engine.getInstance(instance.id);
      expect(snapshot?.state).toBe("completed");
      expect(calls).toEqual(["approve"]);
    });

    it("falls back to the default flow when no condition matches", async () => {
      const calls: string[] = [];
      engine.registerHandler("approve", () => { calls.push("approve"); });
      engine.registerHandler("reject", () => { calls.push("reject"); });
      engine.registerHandler("escalate", () => { calls.push("escalate"); });

      await engine.deploy(XOR_BPMN);
      const instance = await engine.createInstance("approval", {
        amount: 5000, // disqualifies approve
        approved: true, // disqualifies reject
      });
      await engine.runOneTick();

      const snapshot = await engine.getInstance(instance.id);
      expect(snapshot?.state).toBe("completed");
      expect(calls).toEqual(["escalate"]);
    });

    it("audits which flow was taken", async () => {
      engine.registerHandler("approve", () => { /* no-op */ });
      engine.registerHandler("reject", () => { /* no-op */ });
      engine.registerHandler("escalate", () => { /* no-op */ });
      await engine.deploy(XOR_BPMN);
      const instance = await engine.createInstance("approval", {
        amount: 100,
        approved: true,
      });
      await engine.runOneTick();
      const snapshot = await engine.getInstance(instance.id);
      const completed = snapshot!.audit.find(
        (a) => a.event_type === "TOKEN_COMPLETED" && a.element_id === "Gw",
      );
      expect(completed?.metadata).toMatchObject({ takenFlow: "Flow_approve" });
    });
  });

  describe("parallel gateway", () => {
    it("splits, executes branches independently, and joins", async () => {
      const calls: string[] = [];
      engine.registerHandler("task-a", () => { calls.push("a"); });
      engine.registerHandler("task-b", () => { calls.push("b"); });
      engine.registerHandler("final", () => { calls.push("final"); });

      await engine.deploy(PARALLEL_BPMN);
      const instance = await engine.createInstance("par", {});

      // Each branch's service task is one job; both are pending after the
      // split. With a generous batchSize, one tick drains both, then the
      // join produces the Final job, which a second tick drains.
      await engine.runOneTick();
      await engine.runOneTick();

      const snapshot = await engine.getInstance(instance.id);
      expect(snapshot?.state).toBe("completed");
      expect(calls.slice(0, 2).sort()).toEqual(["a", "b"]);
      expect(calls[2]).toBe("final");
    });

    it("the join waits until all incoming branches arrive", async () => {
      const calls: string[] = [];
      engine.registerHandler("task-a", () => { calls.push("a"); });
      engine.registerHandler("task-b", () => { calls.push("b"); });
      engine.registerHandler("final", () => { calls.push("final"); });

      // batchSize=1 so we process one job per tick: this guarantees that the
      // join sees only one arriving token at a time on the first tick after
      // task A completes.
      await engine.stop();
      engine = new Engine({
        databaseUrl: TEST_DATABASE_URL,
        jobBatchSize: 1,
        autoStartJobRunner: false,
      });
      await engine.start();
      engine.registerHandler("task-a", () => { calls.push("a"); });
      engine.registerHandler("task-b", () => { calls.push("b"); });
      engine.registerHandler("final", () => { calls.push("final"); });
      await engine.deploy(PARALLEL_BPMN);
      const instance = await engine.createInstance("par", {});

      // Tick 1: one of A/B runs; the join receives one token, waits.
      await engine.runOneTick();
      let snapshot = await engine.getInstance(instance.id);
      expect(snapshot?.state).toBe("active");
      const waitingAtJoin = snapshot!.tokens.filter(
        (t) => t.element_id === "Join" && t.state === "waiting",
      );
      expect(waitingAtJoin).toHaveLength(1);
      expect(calls).toHaveLength(1);

      // Tick 2: the other branch runs, join completes, Final is queued.
      await engine.runOneTick();
      snapshot = await engine.getInstance(instance.id);
      expect(calls).toHaveLength(2);

      // Tick 3: Final completes, instance done.
      await engine.runOneTick();
      snapshot = await engine.getInstance(instance.id);
      expect(snapshot?.state).toBe("completed");
      expect(calls[2]).toBe("final");
    });
  });
});
