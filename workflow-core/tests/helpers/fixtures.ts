export const HELLO_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:zeebe="http://camunda.org/schema/zeebe/1.0"
                  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                  targetNamespace="http://workflow-engine/tests"
                  id="Definitions_hello">
  <bpmn:process id="hello-world" name="Hello World" isExecutable="true">
    <bpmn:startEvent id="StartEvent_1" name="Start">
      <bpmn:outgoing>Flow_1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:serviceTask id="Task_Greet" name="Say hello">
      <bpmn:extensionElements>
        <zeebe:taskDefinition type="greet" retries="3" />
        <zeebe:ioMapping>
          <zeebe:input source="=variables.name" target="name" />
          <zeebe:output source="=result.greeting" target="variables.greeting" />
        </zeebe:ioMapping>
      </bpmn:extensionElements>
      <bpmn:incoming>Flow_1</bpmn:incoming>
      <bpmn:outgoing>Flow_2</bpmn:outgoing>
    </bpmn:serviceTask>
    <bpmn:endEvent id="EndEvent_1" name="Done">
      <bpmn:incoming>Flow_2</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="StartEvent_1" targetRef="Task_Greet" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_Greet"  targetRef="EndEvent_1" />
  </bpmn:process>
</bpmn:definitions>`;

export const TWO_TASK_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:zeebe="http://camunda.org/schema/zeebe/1.0"
                  targetNamespace="http://workflow-engine/tests"
                  id="Definitions_two">
  <bpmn:process id="two-step" name="Two Step" isExecutable="true">
    <bpmn:startEvent id="Start"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:serviceTask id="A">
      <bpmn:extensionElements>
        <zeebe:taskDefinition type="step-a" retries="3" />
      </bpmn:extensionElements>
      <bpmn:incoming>F1</bpmn:incoming><bpmn:outgoing>F2</bpmn:outgoing>
    </bpmn:serviceTask>
    <bpmn:serviceTask id="B">
      <bpmn:extensionElements>
        <zeebe:taskDefinition type="step-b" retries="3" />
      </bpmn:extensionElements>
      <bpmn:incoming>F2</bpmn:incoming><bpmn:outgoing>F3</bpmn:outgoing>
    </bpmn:serviceTask>
    <bpmn:endEvent id="End"><bpmn:incoming>F3</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="A" />
    <bpmn:sequenceFlow id="F2" sourceRef="A" targetRef="B" />
    <bpmn:sequenceFlow id="F3" sourceRef="B" targetRef="End" />
  </bpmn:process>
</bpmn:definitions>`;

export async function waitUntil(
  predicate: () => Promise<boolean> | boolean,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 5000;
  const intervalMs = opts.intervalMs ?? 25;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitUntil timed out after ${timeoutMs}ms`);
}
