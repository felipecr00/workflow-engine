import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Engine, parseIsoDurationMs, DurationParseError } from "../src/engine";
import { resetDatabase, TEST_DATABASE_URL } from "./helpers/db";
import { waitUntil } from "./helpers/fixtures";

const TIMER_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:zeebe="http://camunda.org/schema/zeebe/1.0"
                  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                  id="Definitions_timer">
  <bpmn:process id="timer-proc" isExecutable="true">
    <bpmn:startEvent id="Start"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:intermediateCatchEvent id="Wait">
      <bpmn:incoming>F1</bpmn:incoming>
      <bpmn:outgoing>F2</bpmn:outgoing>
      <bpmn:timerEventDefinition>
        <bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT0.05S</bpmn:timeDuration>
      </bpmn:timerEventDefinition>
    </bpmn:intermediateCatchEvent>
    <bpmn:serviceTask id="After">
      <bpmn:extensionElements>
        <zeebe:taskDefinition type="after-wait" retries="1"/>
      </bpmn:extensionElements>
      <bpmn:incoming>F2</bpmn:incoming><bpmn:outgoing>F3</bpmn:outgoing>
    </bpmn:serviceTask>
    <bpmn:endEvent id="End"><bpmn:incoming>F3</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="Wait"/>
    <bpmn:sequenceFlow id="F2" sourceRef="Wait" targetRef="After"/>
    <bpmn:sequenceFlow id="F3" sourceRef="After" targetRef="End"/>
  </bpmn:process>
</bpmn:definitions>`;

describe("ISO 8601 duration", () => {
  it("parses common forms", () => {
    expect(parseIsoDurationMs("PT5M")).toBe(5 * 60_000);
    expect(parseIsoDurationMs("PT1H30M")).toBe(90 * 60_000);
    expect(parseIsoDurationMs("PT45S")).toBe(45_000);
    expect(parseIsoDurationMs("PT0.5S")).toBe(500);
    expect(parseIsoDurationMs("P1DT2H")).toBe((24 + 2) * 60 * 60_000);
  });

  it("rejects empty or malformed input", () => {
    expect(() => parseIsoDurationMs("P")).toThrow(DurationParseError);
    expect(() => parseIsoDurationMs("5M")).toThrow(DurationParseError);
    expect(() => parseIsoDurationMs("PT")).toThrow(DurationParseError);
    expect(() => parseIsoDurationMs("PT1Y")).toThrow(DurationParseError);
  });
});

describe("intermediate timer catch", () => {
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
      autoStartJobRunner: true,
    });
    await engine.start();
  });

  afterAll(async () => {
    if (engine) await engine.stop();
  });

  it("waits, then resumes after the timer fires", async () => {
    let ran = false;
    engine.registerHandler("after-wait", () => {
      ran = true;
    });
    await engine.deploy(TIMER_BPMN);
    const instance = await engine.createInstance("timer-proc", {});

    // Right after createInstance: token should be waiting at Wait, timer pending.
    const initial = await engine.getInstance(instance.id);
    expect(initial?.state).toBe("active");
    const waitingToken = initial!.tokens.find(
      (t) => t.element_id === "Wait" && t.state === "waiting",
    );
    expect(waitingToken).toBeTruthy();
    expect(initial?.timers).toHaveLength(1);
    expect(initial?.timers[0]?.state).toBe("active");

    await waitUntil(async () => {
      const s = await engine.getInstance(instance.id);
      return s?.state === "completed";
    });

    expect(ran).toBe(true);
    const finalSnapshot = await engine.getInstance(instance.id);
    expect(finalSnapshot?.timers[0]?.state).toBe("fired");
    const auditTypes = finalSnapshot!.audit.map((a) => a.event_type);
    expect(auditTypes).toContain("TIMER_CREATED");
    expect(auditTypes).toContain("TIMER_FIRED");
  });
});
