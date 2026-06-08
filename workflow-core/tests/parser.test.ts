import { describe, expect, it } from "vitest";
import { parseProcess, ParseError } from "../src/engine";
import { HELLO_BPMN } from "./helpers/fixtures";

describe("parseProcess", () => {
  it("parses a simple hello-world BPMN with zeebe extensions", async () => {
    const def = await parseProcess(HELLO_BPMN);

    expect(def.key).toBe("hello-world");
    expect(def.name).toBe("Hello World");
    expect(def.startEventIds).toEqual(["StartEvent_1"]);
    expect(def.elements.size).toBe(3);

    const task = def.elements.get("Task_Greet");
    expect(task?.type).toBe("serviceTask");
    if (task?.type !== "serviceTask") throw new Error("type guard");
    expect(task.taskDefinition.type).toBe("greet");
    expect(task.taskDefinition.retries).toBe(3);
    expect(task.ioMapping?.inputs).toEqual([
      { source: "=variables.name", target: "name" },
    ]);
    expect(task.ioMapping?.outputs).toEqual([
      { source: "=result.greeting", target: "variables.greeting" },
    ]);

    expect(def.flowsBySource.get("StartEvent_1")?.[0]?.targetRef).toBe("Task_Greet");
    expect(def.flowsBySource.get("Task_Greet")?.[0]?.targetRef).toBe("EndEvent_1");
  });

  it("rejects a service task missing zeebe:taskDefinition", async () => {
    const xml = `<?xml version="1.0"?>
      <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
        <bpmn:process id="bad" isExecutable="true">
          <bpmn:startEvent id="s"><bpmn:outgoing>f</bpmn:outgoing></bpmn:startEvent>
          <bpmn:serviceTask id="t">
            <bpmn:incoming>f</bpmn:incoming><bpmn:outgoing>g</bpmn:outgoing>
          </bpmn:serviceTask>
          <bpmn:endEvent id="e"><bpmn:incoming>g</bpmn:incoming></bpmn:endEvent>
          <bpmn:sequenceFlow id="f" sourceRef="s" targetRef="t"/>
          <bpmn:sequenceFlow id="g" sourceRef="t" targetRef="e"/>
        </bpmn:process>
      </bpmn:definitions>`;
    await expect(parseProcess(xml)).rejects.toBeInstanceOf(ParseError);
  });

  it("rejects unsupported BPMN elements clearly", async () => {
    const xml = `<?xml version="1.0"?>
      <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
        <bpmn:process id="bad" isExecutable="true">
          <bpmn:startEvent id="s"><bpmn:outgoing>f</bpmn:outgoing></bpmn:startEvent>
          <bpmn:subProcess id="u">
            <bpmn:incoming>f</bpmn:incoming><bpmn:outgoing>g</bpmn:outgoing>
          </bpmn:subProcess>
          <bpmn:endEvent id="e"><bpmn:incoming>g</bpmn:incoming></bpmn:endEvent>
          <bpmn:sequenceFlow id="f" sourceRef="s" targetRef="u"/>
          <bpmn:sequenceFlow id="g" sourceRef="u" targetRef="e"/>
        </bpmn:process>
      </bpmn:definitions>`;
    await expect(parseProcess(xml)).rejects.toThrow(/Unsupported/);
  });
});
