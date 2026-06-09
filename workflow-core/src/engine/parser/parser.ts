import { parseXml, type ModdleElement } from "./moddle";
import type {
  AssignmentDefinition,
  InternalProcessDefinition,
  IoMapping,
  ProcessElement,
  SequenceFlow,
  TaskDefinition,
  TimerDefinition,
  VariableMapping,
} from "./types";

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}

const SUPPORTED_TYPES = new Set([
  "bpmn:StartEvent",
  "bpmn:EndEvent",
  "bpmn:ServiceTask",
  "bpmn:UserTask",
  "bpmn:ExclusiveGateway",
  "bpmn:ParallelGateway",
  "bpmn:IntermediateCatchEvent",
  "bpmn:SequenceFlow",
]);

export async function parseProcess(xml: string): Promise<InternalProcessDefinition> {
  const { rootElement } = await parseXml(xml);

  if (rootElement.$type !== "bpmn:Definitions") {
    throw new ParseError(`Expected root bpmn:Definitions, got ${rootElement.$type}`);
  }

  const roots = (rootElement.rootElements as ModdleElement[] | undefined) ?? [];
  const processes = roots.filter((r) => r.$type === "bpmn:Process");

  if (processes.length === 0) {
    throw new ParseError("No bpmn:Process found in definitions");
  }
  if (processes.length > 1) {
    throw new ParseError(
      "Multiple bpmn:Process elements found; only single-process deployments are supported",
    );
  }

  const proc = processes[0]!;
  const processKey = proc.id;
  if (!processKey) {
    throw new ParseError("bpmn:Process is missing required @id attribute");
  }

  const flowElements = (proc.flowElements as ModdleElement[] | undefined) ?? [];
  const elements = new Map<string, ProcessElement>();
  const flows: SequenceFlow[] = [];

  for (const el of flowElements) {
    if (!SUPPORTED_TYPES.has(el.$type)) {
      throw new ParseError(
        `Unsupported BPMN element ${el.$type} (id=${el.id ?? "?"})`,
      );
    }
    if (!el.id) {
      throw new ParseError(`Element of type ${el.$type} is missing required @id`);
    }

    switch (el.$type) {
      case "bpmn:StartEvent":
        elements.set(el.id, {
          id: el.id,
          type: "startEvent",
          name: el.name as string | undefined,
        });
        break;

      case "bpmn:EndEvent":
        elements.set(el.id, {
          id: el.id,
          type: "endEvent",
          name: el.name as string | undefined,
        });
        break;

      case "bpmn:ServiceTask": {
        const { taskDefinition, ioMapping } = readServiceTaskExtensions(el);
        elements.set(el.id, {
          id: el.id,
          type: "serviceTask",
          name: el.name as string | undefined,
          taskDefinition,
          ioMapping,
        });
        break;
      }

      case "bpmn:UserTask": {
        const { ioMapping, assignment, formKey } = readUserTaskExtensions(el);
        elements.set(el.id, {
          id: el.id,
          type: "userTask",
          name: el.name as string | undefined,
          ioMapping,
          assignment,
          formKey,
        });
        break;
      }

      case "bpmn:ExclusiveGateway": {
        const defaultRef = readRef(el.default);
        elements.set(el.id, {
          id: el.id,
          type: "exclusiveGateway",
          name: el.name as string | undefined,
          defaultFlow: defaultRef,
        });
        break;
      }

      case "bpmn:ParallelGateway":
        elements.set(el.id, {
          id: el.id,
          type: "parallelGateway",
          name: el.name as string | undefined,
        });
        break;

      case "bpmn:IntermediateCatchEvent": {
        const timer = readTimerDefinition(el);
        elements.set(el.id, {
          id: el.id,
          type: "intermediateCatchEvent",
          name: el.name as string | undefined,
          timer,
        });
        break;
      }

      case "bpmn:SequenceFlow": {
        const sourceRef = readRef(el.sourceRef);
        const targetRef = readRef(el.targetRef);
        if (!sourceRef || !targetRef) {
          throw new ParseError(
            `bpmn:SequenceFlow ${el.id} requires both sourceRef and targetRef`,
          );
        }
        const conditionExpression = readConditionExpression(el);
        flows.push({ id: el.id, sourceRef, targetRef, conditionExpression });
        break;
      }
    }
  }

  const flowsBySource = new Map<string, SequenceFlow[]>();
  const flowsByTarget = new Map<string, SequenceFlow[]>();
  for (const flow of flows) {
    if (!elements.has(flow.sourceRef)) {
      throw new ParseError(
        `SequenceFlow ${flow.id} references unknown sourceRef ${flow.sourceRef}`,
      );
    }
    if (!elements.has(flow.targetRef)) {
      throw new ParseError(
        `SequenceFlow ${flow.id} references unknown targetRef ${flow.targetRef}`,
      );
    }
    pushTo(flowsBySource, flow.sourceRef, flow);
    pushTo(flowsByTarget, flow.targetRef, flow);
  }

  // Structural validation per element type.
  for (const el of elements.values()) {
    const outgoing = flowsBySource.get(el.id)?.length ?? 0;
    const incoming = flowsByTarget.get(el.id)?.length ?? 0;
    switch (el.type) {
      case "startEvent":
        if (outgoing !== 1) {
          throw new ParseError(
            `StartEvent ${el.id} must have exactly one outgoing flow (got ${outgoing})`,
          );
        }
        break;
      case "endEvent":
        if (incoming === 0) {
          throw new ParseError(`EndEvent ${el.id} must have at least one incoming flow`);
        }
        break;
      case "serviceTask":
        if (outgoing !== 1) {
          throw new ParseError(
            `ServiceTask ${el.id} must have exactly one outgoing flow (got ${outgoing})`,
          );
        }
        break;
      case "userTask":
        if (outgoing !== 1) {
          throw new ParseError(
            `UserTask ${el.id} must have exactly one outgoing flow (got ${outgoing})`,
          );
        }
        break;
      case "intermediateCatchEvent":
        if (outgoing !== 1) {
          throw new ParseError(
            `IntermediateCatchEvent ${el.id} must have exactly one outgoing flow`,
          );
        }
        break;
      case "exclusiveGateway":
        if (outgoing < 1) {
          throw new ParseError(
            `ExclusiveGateway ${el.id} needs at least one outgoing flow`,
          );
        }
        if (el.defaultFlow) {
          const ok = (flowsBySource.get(el.id) ?? []).some((f) => f.id === el.defaultFlow);
          if (!ok) {
            throw new ParseError(
              `ExclusiveGateway ${el.id} default flow ${el.defaultFlow} is not an outgoing flow`,
            );
          }
        }
        break;
      case "parallelGateway":
        if (outgoing === 0) {
          throw new ParseError(`ParallelGateway ${el.id} has no outgoing flow`);
        }
        if (incoming === 0) {
          throw new ParseError(`ParallelGateway ${el.id} has no incoming flow`);
        }
        if (incoming > 1 && outgoing > 1) {
          throw new ParseError(
            `ParallelGateway ${el.id} cannot be both a join and a split (incoming=${incoming}, outgoing=${outgoing})`,
          );
        }
        break;
    }
  }

  const startEventIds = Array.from(elements.values())
    .filter((e) => e.type === "startEvent")
    .map((e) => e.id);

  if (startEventIds.length === 0) {
    throw new ParseError("Process must define at least one bpmn:StartEvent");
  }

  return {
    key: processKey as string,
    name: proc.name as string | undefined,
    elements,
    flowsBySource,
    flowsByTarget,
    startEventIds,
  };
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}

function readRef(ref: unknown): string | undefined {
  if (!ref) return undefined;
  if (typeof ref === "string") return ref;
  if (typeof ref === "object" && ref !== null && "id" in ref) {
    const id = (ref as { id?: unknown }).id;
    return typeof id === "string" ? id : undefined;
  }
  return undefined;
}

function readConditionExpression(flow: ModdleElement): string | undefined {
  const cond = flow.conditionExpression as ModdleElement | undefined;
  if (!cond) return undefined;
  const body = cond.body;
  return typeof body === "string" ? body : undefined;
}

function readTimerDefinition(el: ModdleElement): TimerDefinition {
  const defs = (el.eventDefinitions as ModdleElement[] | undefined) ?? [];
  const timer = defs.find((d) => d.$type === "bpmn:TimerEventDefinition");
  if (!timer) {
    throw new ParseError(
      `IntermediateCatchEvent ${el.id} must have a bpmn:timerEventDefinition`,
    );
  }
  const duration = timer.timeDuration as ModdleElement | undefined;
  const date = timer.timeDate as ModdleElement | undefined;
  const cycle = timer.timeCycle as ModdleElement | undefined;
  if (cycle) {
    throw new ParseError(
      `IntermediateCatchEvent ${el.id}: bpmn:timeCycle is not supported (Phase 2)`,
    );
  }
  if (duration && typeof duration.body === "string") {
    return { kind: "duration", expression: duration.body.trim() };
  }
  if (date && typeof date.body === "string") {
    return { kind: "date", expression: date.body.trim() };
  }
  throw new ParseError(
    `IntermediateCatchEvent ${el.id} must declare timeDuration or timeDate`,
  );
}

function readServiceTaskExtensions(task: ModdleElement): {
  taskDefinition: TaskDefinition;
  ioMapping?: IoMapping;
} {
  const ext = task.extensionElements as ModdleElement | undefined;
  const values = (ext?.values as ModdleElement[] | undefined) ?? [];

  let taskDefinition: TaskDefinition | undefined;
  let ioMapping: IoMapping | undefined;

  for (const v of values) {
    if (v.$type === "zeebe:TaskDefinition") {
      const type = v.type;
      if (typeof type !== "string" || type.length === 0) {
        throw new ParseError(
          `ServiceTask ${task.id ?? "?"} is missing zeebe:taskDefinition @type`,
        );
      }
      const retriesRaw = v.retries;
      const retries =
        typeof retriesRaw === "string" ? parseInt(retriesRaw, 10) :
        typeof retriesRaw === "number" ? retriesRaw :
        3;
      taskDefinition = { type, retries: Number.isFinite(retries) ? retries : 3 };
    } else if (v.$type === "zeebe:IoMapping") {
      const inputs = ((v.inputParameters as ModdleElement[] | undefined) ?? [])
        .map(readMapping)
        .filter((m): m is VariableMapping => m !== null);
      const outputs = ((v.outputParameters as ModdleElement[] | undefined) ?? [])
        .map(readMapping)
        .filter((m): m is VariableMapping => m !== null);
      ioMapping = { inputs, outputs };
    }
  }

  if (!taskDefinition) {
    throw new ParseError(
      `ServiceTask ${task.id ?? "?"} is missing required zeebe:taskDefinition extension`,
    );
  }

  return { taskDefinition, ioMapping };
}

function readUserTaskExtensions(task: ModdleElement): {
  ioMapping?: IoMapping;
  assignment?: AssignmentDefinition;
  formKey?: string;
} {
  const ext = task.extensionElements as ModdleElement | undefined;
  const values = (ext?.values as ModdleElement[] | undefined) ?? [];

  let ioMapping: IoMapping | undefined;
  let assignment: AssignmentDefinition | undefined;
  let formKey: string | undefined;

  for (const v of values) {
    if (v.$type === "zeebe:IoMapping") {
      const inputs = ((v.inputParameters as ModdleElement[] | undefined) ?? [])
        .map(readMapping)
        .filter((m): m is VariableMapping => m !== null);
      const outputs = ((v.outputParameters as ModdleElement[] | undefined) ?? [])
        .map(readMapping)
        .filter((m): m is VariableMapping => m !== null);
      ioMapping = { inputs, outputs };
    } else if (v.$type === "zeebe:AssignmentDefinition") {
      assignment = {
        assignee: typeof v.assignee === "string" ? v.assignee : undefined,
        candidateGroups: typeof v.candidateGroups === "string" ? v.candidateGroups : undefined,
      };
    } else if (v.$type === "zeebe:FormDefinition") {
      // Camunda Modeler writes @formKey for store-backed forms and @formId
      // for embedded forms. Either resolves against our form store by the
      // same key, so we treat them as aliases here.
      const key =
        typeof v.formKey === "string" && v.formKey.length > 0
          ? v.formKey
          : typeof v.formId === "string" && v.formId.length > 0
            ? v.formId
            : undefined;
      if (key) formKey = key;
    }
  }

  return { ioMapping, assignment, formKey };
}

function readMapping(el: ModdleElement): VariableMapping | null {
  const source = el.source;
  const target = el.target;
  if (typeof source !== "string" || typeof target !== "string") return null;
  return { source, target };
}
