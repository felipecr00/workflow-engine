export interface VariableMapping {
  source: string;
  target: string;
}

export interface TaskDefinition {
  type: string;
  retries: number;
}

export interface IoMapping {
  inputs: VariableMapping[];
  outputs: VariableMapping[];
}

export type ElementType =
  | "startEvent"
  | "endEvent"
  | "serviceTask"
  | "userTask"
  | "manualTask"
  | "sendTask"
  | "exclusiveGateway"
  | "parallelGateway"
  | "intermediateCatchEvent"
  | "intermediateThrowEvent";

// EndEvent has three variants in Sprint 3. Structurally identical (incoming
// flows, no outgoing) so we keep one element type and switch by kind in the
// executor.
export type EndEventKind = "none" | "terminate" | "error";

export type TimerKind = "duration" | "date";

export interface TimerDefinition {
  kind: TimerKind;
  // For "duration", the body is an ISO 8601 duration like PT5M.
  // For "date", the body is an ISO 8601 timestamp.
  // We keep the raw string so the executor can re-parse against the current
  // clock at the moment a token reaches the element.
  expression: string;
}

interface BaseElement {
  id: string;
  name?: string;
}

export interface StartEventElement extends BaseElement {
  type: "startEvent";
}

export interface EndEventElement extends BaseElement {
  type: "endEvent";
  endEventKind: EndEventKind;
  // Populated only when endEventKind === "error". Resolved from the
  // bpmn:Error referenced via errorRef on the EventDefinition.
  errorCode?: string;
}

export interface ServiceTaskElement extends BaseElement {
  type: "serviceTask";
  taskDefinition: TaskDefinition;
  ioMapping?: IoMapping;
}

export interface SendTaskElement extends BaseElement {
  type: "sendTask";
  taskDefinition: TaskDefinition;
  ioMapping?: IoMapping;
}

export interface ManualTaskElement extends BaseElement {
  type: "manualTask";
}

export interface ExclusiveGatewayElement extends BaseElement {
  type: "exclusiveGateway";
  // Sequence-flow id of the default flow, if any. Conditions on outgoing
  // flows are kept on the SequenceFlow itself.
  defaultFlow?: string;
}

export interface ParallelGatewayElement extends BaseElement {
  type: "parallelGateway";
}

export interface AssignmentDefinition {
  assignee?: string;
  candidateGroups?: string;
}

export interface UserTaskElement extends BaseElement {
  type: "userTask";
  ioMapping?: IoMapping;
  assignment?: AssignmentDefinition;
  formKey?: string;
}

export interface IntermediateCatchEventElement extends BaseElement {
  type: "intermediateCatchEvent";
  timer: TimerDefinition;
}

export interface IntermediateThrowEventElement extends BaseElement {
  type: "intermediateThrowEvent";
}

export type ProcessElement =
  | StartEventElement
  | EndEventElement
  | ServiceTaskElement
  | UserTaskElement
  | ManualTaskElement
  | SendTaskElement
  | ExclusiveGatewayElement
  | ParallelGatewayElement
  | IntermediateCatchEventElement
  | IntermediateThrowEventElement;

export interface SequenceFlow {
  id: string;
  sourceRef: string;
  targetRef: string;
  conditionExpression?: string;
}

export interface InternalProcessDefinition {
  key: string;
  name?: string;
  elements: Map<string, ProcessElement>;
  flowsBySource: Map<string, SequenceFlow[]>;
  flowsByTarget: Map<string, SequenceFlow[]>;
  startEventIds: string[];
}
