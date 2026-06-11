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

  it("extracts formKey from zeebe:formDefinition on a userTask", async () => {
    const xml = `<?xml version="1.0"?>
      <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                        xmlns:zeebe="http://camunda.org/schema/zeebe/1.0">
        <bpmn:process id="p" isExecutable="true">
          <bpmn:startEvent id="s"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
          <bpmn:userTask id="Approve">
            <bpmn:extensionElements>
              <zeebe:formDefinition formKey="approval-form" />
            </bpmn:extensionElements>
            <bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing>
          </bpmn:userTask>
          <bpmn:endEvent id="e"><bpmn:incoming>f2</bpmn:incoming></bpmn:endEvent>
          <bpmn:sequenceFlow id="f1" sourceRef="s" targetRef="Approve"/>
          <bpmn:sequenceFlow id="f2" sourceRef="Approve" targetRef="e"/>
        </bpmn:process>
      </bpmn:definitions>`;
    const def = await parseProcess(xml);
    const task = def.elements.get("Approve");
    expect(task?.type).toBe("userTask");
    if (task?.type !== "userTask") throw new Error("type guard");
    expect(task.formKey).toBe("approval-form");
  });

  it("accepts formId as an alias for formKey on a userTask", async () => {
    const xml = `<?xml version="1.0"?>
      <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                        xmlns:zeebe="http://camunda.org/schema/zeebe/1.0">
        <bpmn:process id="p" isExecutable="true">
          <bpmn:startEvent id="s"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
          <bpmn:userTask id="Approve">
            <bpmn:extensionElements>
              <zeebe:formDefinition formId="embedded-approval" />
            </bpmn:extensionElements>
            <bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing>
          </bpmn:userTask>
          <bpmn:endEvent id="e"><bpmn:incoming>f2</bpmn:incoming></bpmn:endEvent>
          <bpmn:sequenceFlow id="f1" sourceRef="s" targetRef="Approve"/>
          <bpmn:sequenceFlow id="f2" sourceRef="Approve" targetRef="e"/>
        </bpmn:process>
      </bpmn:definitions>`;
    const def = await parseProcess(xml);
    const task = def.elements.get("Approve");
    if (task?.type !== "userTask") throw new Error("type guard");
    expect(task.formKey).toBe("embedded-approval");
  });

  it("leaves formKey undefined when userTask has no formDefinition", async () => {
    const xml = `<?xml version="1.0"?>
      <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                        xmlns:zeebe="http://camunda.org/schema/zeebe/1.0">
        <bpmn:process id="p" isExecutable="true">
          <bpmn:startEvent id="s"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
          <bpmn:userTask id="Approve">
            <bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing>
          </bpmn:userTask>
          <bpmn:endEvent id="e"><bpmn:incoming>f2</bpmn:incoming></bpmn:endEvent>
          <bpmn:sequenceFlow id="f1" sourceRef="s" targetRef="Approve"/>
          <bpmn:sequenceFlow id="f2" sourceRef="Approve" targetRef="e"/>
        </bpmn:process>
      </bpmn:definitions>`;
    const def = await parseProcess(xml);
    const task = def.elements.get("Approve");
    if (task?.type !== "userTask") throw new Error("type guard");
    expect(task.formKey).toBeUndefined();
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

  describe("EndEvent variants", () => {
    it("defaults to endEventKind=none when no eventDefinition is present", async () => {
      const def = await parseProcess(HELLO_BPMN);
      const end = def.elements.get("EndEvent_1");
      if (end?.type !== "endEvent") throw new Error("type guard");
      expect(end.endEventKind).toBe("none");
      expect(end.errorCode).toBeUndefined();
    });

    it("parses a Terminate end event", async () => {
      const xml = `<?xml version="1.0"?>
        <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
          <bpmn:process id="p" isExecutable="true">
            <bpmn:startEvent id="s"><bpmn:outgoing>f</bpmn:outgoing></bpmn:startEvent>
            <bpmn:endEvent id="e">
              <bpmn:incoming>f</bpmn:incoming>
              <bpmn:terminateEventDefinition id="TerminateDef_1" />
            </bpmn:endEvent>
            <bpmn:sequenceFlow id="f" sourceRef="s" targetRef="e"/>
          </bpmn:process>
        </bpmn:definitions>`;
      const def = await parseProcess(xml);
      const end = def.elements.get("e");
      if (end?.type !== "endEvent") throw new Error("type guard");
      expect(end.endEventKind).toBe("terminate");
    });

    it("parses an Error end event and resolves errorRef to errorCode", async () => {
      const xml = `<?xml version="1.0"?>
        <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
          <bpmn:error id="Error_Boom" name="Boom" errorCode="BOOM" />
          <bpmn:process id="p" isExecutable="true">
            <bpmn:startEvent id="s"><bpmn:outgoing>f</bpmn:outgoing></bpmn:startEvent>
            <bpmn:endEvent id="e">
              <bpmn:incoming>f</bpmn:incoming>
              <bpmn:errorEventDefinition id="ErrDef_1" errorRef="Error_Boom" />
            </bpmn:endEvent>
            <bpmn:sequenceFlow id="f" sourceRef="s" targetRef="e"/>
          </bpmn:process>
        </bpmn:definitions>`;
      const def = await parseProcess(xml);
      const end = def.elements.get("e");
      if (end?.type !== "endEvent") throw new Error("type guard");
      expect(end.endEventKind).toBe("error");
      expect(end.errorCode).toBe("BOOM");
    });

    it("rejects an Error end event whose errorRef is missing", async () => {
      // bpmn-moddle silently drops an errorRef that doesn't match any
      // bpmn:Error in the document, so parsing reaches the "missing errorRef"
      // branch here. The same branch covers a literally-omitted errorRef.
      const xml = `<?xml version="1.0"?>
        <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
          <bpmn:process id="p" isExecutable="true">
            <bpmn:startEvent id="s"><bpmn:outgoing>f</bpmn:outgoing></bpmn:startEvent>
            <bpmn:endEvent id="e">
              <bpmn:incoming>f</bpmn:incoming>
              <bpmn:errorEventDefinition id="ErrDef_1" errorRef="Error_Missing" />
            </bpmn:endEvent>
            <bpmn:sequenceFlow id="f" sourceRef="s" targetRef="e"/>
          </bpmn:process>
        </bpmn:definitions>`;
      await expect(parseProcess(xml)).rejects.toThrow(/missing errorRef/);
    });

    it("rejects an EndEvent with multiple eventDefinitions", async () => {
      const xml = `<?xml version="1.0"?>
        <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
          <bpmn:error id="Err_1" name="Err" errorCode="X" />
          <bpmn:process id="p" isExecutable="true">
            <bpmn:startEvent id="s"><bpmn:outgoing>f</bpmn:outgoing></bpmn:startEvent>
            <bpmn:endEvent id="e">
              <bpmn:incoming>f</bpmn:incoming>
              <bpmn:terminateEventDefinition id="TerminateDef_1" />
              <bpmn:errorEventDefinition id="ErrDef_1" errorRef="Err_1" />
            </bpmn:endEvent>
            <bpmn:sequenceFlow id="f" sourceRef="s" targetRef="e"/>
          </bpmn:process>
        </bpmn:definitions>`;
      await expect(parseProcess(xml)).rejects.toThrow(/multiple eventDefinitions/);
    });

    it("rejects an EndEvent with an unsupported eventDefinition type", async () => {
      const xml = `<?xml version="1.0"?>
        <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
          <bpmn:process id="p" isExecutable="true">
            <bpmn:startEvent id="s"><bpmn:outgoing>f</bpmn:outgoing></bpmn:startEvent>
            <bpmn:endEvent id="e">
              <bpmn:incoming>f</bpmn:incoming>
              <bpmn:cancelEventDefinition id="Cancel_1" />
            </bpmn:endEvent>
            <bpmn:sequenceFlow id="f" sourceRef="s" targetRef="e"/>
          </bpmn:process>
        </bpmn:definitions>`;
      await expect(parseProcess(xml)).rejects.toThrow(/not supported/);
    });
  });

  describe("ManualTask", () => {
    it("parses a manual task with id and name", async () => {
      const xml = `<?xml version="1.0"?>
        <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
          <bpmn:process id="p" isExecutable="true">
            <bpmn:startEvent id="s"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
            <bpmn:manualTask id="DoStuff" name="Manually do stuff">
              <bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing>
            </bpmn:manualTask>
            <bpmn:endEvent id="e"><bpmn:incoming>f2</bpmn:incoming></bpmn:endEvent>
            <bpmn:sequenceFlow id="f1" sourceRef="s" targetRef="DoStuff"/>
            <bpmn:sequenceFlow id="f2" sourceRef="DoStuff" targetRef="e"/>
          </bpmn:process>
        </bpmn:definitions>`;
      const def = await parseProcess(xml);
      const task = def.elements.get("DoStuff");
      expect(task?.type).toBe("manualTask");
      expect(task?.name).toBe("Manually do stuff");
    });
  });

  describe("SendTask", () => {
    it("parses a send task with zeebe:taskDefinition", async () => {
      const xml = `<?xml version="1.0"?>
        <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                          xmlns:zeebe="http://camunda.org/schema/zeebe/1.0">
          <bpmn:process id="p" isExecutable="true">
            <bpmn:startEvent id="s"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
            <bpmn:sendTask id="SendMail" name="Send mail">
              <bpmn:extensionElements>
                <zeebe:taskDefinition type="send-mail" retries="2" />
              </bpmn:extensionElements>
              <bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing>
            </bpmn:sendTask>
            <bpmn:endEvent id="e"><bpmn:incoming>f2</bpmn:incoming></bpmn:endEvent>
            <bpmn:sequenceFlow id="f1" sourceRef="s" targetRef="SendMail"/>
            <bpmn:sequenceFlow id="f2" sourceRef="SendMail" targetRef="e"/>
          </bpmn:process>
        </bpmn:definitions>`;
      const def = await parseProcess(xml);
      const task = def.elements.get("SendMail");
      expect(task?.type).toBe("sendTask");
      if (task?.type !== "sendTask") throw new Error("type guard");
      expect(task.taskDefinition.type).toBe("send-mail");
      expect(task.taskDefinition.retries).toBe(2);
    });

    it("rejects a send task missing zeebe:taskDefinition", async () => {
      const xml = `<?xml version="1.0"?>
        <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
          <bpmn:process id="p" isExecutable="true">
            <bpmn:startEvent id="s"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
            <bpmn:sendTask id="SendMail">
              <bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing>
            </bpmn:sendTask>
            <bpmn:endEvent id="e"><bpmn:incoming>f2</bpmn:incoming></bpmn:endEvent>
            <bpmn:sequenceFlow id="f1" sourceRef="s" targetRef="SendMail"/>
            <bpmn:sequenceFlow id="f2" sourceRef="SendMail" targetRef="e"/>
          </bpmn:process>
        </bpmn:definitions>`;
      await expect(parseProcess(xml)).rejects.toThrow(
        /SendTask SendMail is missing required zeebe:taskDefinition/,
      );
    });
  });

  describe("IntermediateThrowEvent", () => {
    it("parses a None intermediate throw event", async () => {
      const xml = `<?xml version="1.0"?>
        <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
          <bpmn:process id="p" isExecutable="true">
            <bpmn:startEvent id="s"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
            <bpmn:intermediateThrowEvent id="Throw" name="checkpoint">
              <bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing>
            </bpmn:intermediateThrowEvent>
            <bpmn:endEvent id="e"><bpmn:incoming>f2</bpmn:incoming></bpmn:endEvent>
            <bpmn:sequenceFlow id="f1" sourceRef="s" targetRef="Throw"/>
            <bpmn:sequenceFlow id="f2" sourceRef="Throw" targetRef="e"/>
          </bpmn:process>
        </bpmn:definitions>`;
      const def = await parseProcess(xml);
      const t = def.elements.get("Throw");
      expect(t?.type).toBe("intermediateThrowEvent");
      expect(t?.name).toBe("checkpoint");
    });

    it("rejects an intermediate throw event with a message event definition", async () => {
      const xml = `<?xml version="1.0"?>
        <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
          <bpmn:process id="p" isExecutable="true">
            <bpmn:startEvent id="s"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
            <bpmn:intermediateThrowEvent id="Throw">
              <bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing>
              <bpmn:messageEventDefinition id="MsgDef_1" />
            </bpmn:intermediateThrowEvent>
            <bpmn:endEvent id="e"><bpmn:incoming>f2</bpmn:incoming></bpmn:endEvent>
            <bpmn:sequenceFlow id="f1" sourceRef="s" targetRef="Throw"/>
            <bpmn:sequenceFlow id="f2" sourceRef="Throw" targetRef="e"/>
          </bpmn:process>
        </bpmn:definitions>`;
      await expect(parseProcess(xml)).rejects.toThrow(
        /only None throw events are supported/,
      );
    });
  });
});
