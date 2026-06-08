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
  | "exclusiveGateway"
  | "parallelGateway"
  | "intermediateCatchEvent";

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
}

export interface ServiceTaskElement extends BaseElement {
  type: "serviceTask";
  taskDefinition: TaskDefinition;
  ioMapping?: IoMapping;
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
}

export interface IntermediateCatchEventElement extends BaseElement {
  type: "intermediateCatchEvent";
  timer: TimerDefinition;
}

export type ProcessElement =
  | StartEventElement
  | EndEventElement
  | ServiceTaskElement
  | UserTaskElement
  | ExclusiveGatewayElement
  | ParallelGatewayElement
  | IntermediateCatchEventElement;

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
