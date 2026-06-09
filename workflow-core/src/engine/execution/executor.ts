import type { Transaction } from "kysely";
import { sql } from "kysely";
import type { Database } from "../db/types";
import { evaluateBoolean } from "../expressions";
import type {
  ExclusiveGatewayElement,
  InternalProcessDefinition,
  IntermediateCatchEventElement,
  ParallelGatewayElement,
  ProcessElement,
  SequenceFlow,
  ServiceTaskElement,
  UserTaskElement,
} from "../parser/types";
import { computeTimerDueAt } from "../timer/iso-duration";
import { recordAudit } from "../repository/audit";
import { findLatestFormByKey } from "../repository/forms";
import { createIncident } from "../repository/incidents";
import {
  findInstance,
  markInstanceCompleted,
  setInstanceVariables,
} from "../repository/instances";
import { createJob, findJob, markJobCompleted } from "../repository/jobs";
import {
  createUserTask,
  findUserTask,
  markUserTaskCompleted,
} from "../repository/user-tasks";
import { createTimer } from "../repository/timers";
import {
  createToken,
  findToken,
  listLiveTokensForInstance,
  setTokenState,
} from "../repository/tokens";
import { applyInputMapping, applyOutputMapping } from "../variables/mapping";

export class ExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExecutionError";
  }
}

export interface DefinitionLookup {
  get(definitionId: string): InternalProcessDefinition | undefined;
}

type Trx = Transaction<Database>;

// Take a row-level lock on the instance for the duration of this
// transaction. Serializes all token advancement within a single instance
// across concurrent workers — important for parallel-gateway joins, and
// cheap when there is no contention.
export async function lockInstance(trx: Trx, instanceId: string): Promise<void> {
  await sql`SELECT id FROM process_instances WHERE id = ${instanceId} FOR UPDATE`
    .execute(trx);
}

export async function advanceToken(
  trx: Trx,
  defs: DefinitionLookup,
  tokenId: string,
): Promise<void> {
  let cursorId: string | null = tokenId;
  while (cursorId) {
    const token = await findToken(trx, cursorId);
    if (!token || token.state !== "active") return;

    const instance = await findInstance(trx, token.instance_id);
    if (!instance) {
      throw new ExecutionError(`Instance ${token.instance_id} not found`);
    }

    const def = defs.get(instance.definition_id);
    if (!def) {
      throw new ExecutionError(
        `Definition ${instance.definition_id} not loaded in cache`,
      );
    }

    const element = def.elements.get(token.element_id);
    if (!element) {
      throw new ExecutionError(
        `Element ${token.element_id} not present in definition ${def.key}`,
      );
    }

    cursorId = await stepElement(trx, defs, def, element, token, instance.variables);
  }
}

async function stepElement(
  trx: Trx,
  defs: DefinitionLookup,
  def: InternalProcessDefinition,
  element: ProcessElement,
  token: { id: string; instance_id: string },
  variables: Record<string, unknown>,
): Promise<string | null> {
  switch (element.type) {
    case "startEvent":
      return await singleOutFollow(trx, def, element, token);

    case "serviceTask":
      return await enterServiceTask(trx, element, token, variables);

    case "userTask":
      return await enterUserTask(trx, element, token, variables);

    case "intermediateCatchEvent":
      return await enterTimerCatch(trx, element, token);

    case "exclusiveGateway":
      return await stepExclusiveGateway(trx, def, element, token, variables);

    case "parallelGateway":
      return await stepParallelGateway(trx, def, element, token);

    case "endEvent": {
      await setTokenState(trx, token.id, "completed");
      await recordAudit(trx, {
        instanceId: token.instance_id,
        tokenId: token.id,
        eventType: "TOKEN_COMPLETED",
        elementId: element.id,
        elementType: element.type,
      });
      const live = await listLiveTokensForInstance(trx, token.instance_id);
      if (live.length === 0) {
        await markInstanceCompleted(trx, token.instance_id);
        await recordAudit(trx, {
          instanceId: token.instance_id,
          eventType: "INSTANCE_COMPLETED",
        });
      }
      return null;
    }

    default: {
      const t: never = element;
      throw new ExecutionError(`Unhandled element ${(t as ProcessElement).type}`);
    }
  }
}

async function singleOutFollow(
  trx: Trx,
  def: InternalProcessDefinition,
  element: ProcessElement,
  token: { id: string; instance_id: string },
): Promise<string> {
  const outgoing = def.flowsBySource.get(element.id) ?? [];
  if (outgoing.length !== 1) {
    throw new ExecutionError(
      `Element ${element.id} (${element.type}) requires exactly one outgoing flow`,
    );
  }
  return await moveToNext(trx, def, element, token, outgoing[0]!);
}

async function enterServiceTask(
  trx: Trx,
  element: ServiceTaskElement,
  token: { id: string; instance_id: string },
  variables: Record<string, unknown>,
): Promise<null> {
  const input = applyInputMapping(element.ioMapping, variables);
  const job = await createJob(trx, {
    instanceId: token.instance_id,
    tokenId: token.id,
    elementId: element.id,
    jobType: element.taskDefinition.type,
    inputVariables: input,
    retries: element.taskDefinition.retries,
  });
  await setTokenState(trx, token.id, "waiting");
  await recordAudit(trx, {
    instanceId: token.instance_id,
    tokenId: token.id,
    jobId: job.id,
    eventType: "JOB_CREATED",
    elementId: element.id,
    elementType: element.type,
    metadata: { jobType: element.taskDefinition.type },
  });
  return null;
}

async function enterUserTask(
  trx: Trx,
  element: UserTaskElement,
  token: { id: string; instance_id: string },
  variables: Record<string, unknown>,
): Promise<null> {
  const input = applyInputMapping(element.ioMapping, variables);

  const candidateGroups = element.assignment?.candidateGroups
    ? element.assignment.candidateGroups.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  // Resolve the form (if any) at task-creation time so the renderer sees a
  // stable version even if newer versions of the form get deployed later.
  // A formKey that does not resolve raises an incident — same shape as a
  // service task with no registered handler.
  let formKey: string | null = null;
  let formVersion: number | null = null;
  if (element.formKey) {
    const form = await findLatestFormByKey(trx, element.formKey);
    if (!form) {
      await setTokenState(trx, token.id, "incident");
      const incident = await createIncident(trx, {
        instanceId: token.instance_id,
        tokenId: token.id,
        type: "unhandled_error",
        errorMessage: `User task ${element.id} references formKey "${element.formKey}" but no form is deployed with that key`,
      });
      await recordAudit(trx, {
        instanceId: token.instance_id,
        tokenId: token.id,
        incidentId: incident.id,
        eventType: "INCIDENT_CREATED",
        elementId: element.id,
        elementType: element.type,
        metadata: { reason: "form_not_deployed", formKey: element.formKey },
      });
      return null;
    }
    formKey = form.key;
    formVersion = form.version;
  }

  const userTask = await createUserTask(trx, {
    instanceId: token.instance_id,
    tokenId: token.id,
    elementId: element.id,
    taskName: element.name,
    assignee: element.assignment?.assignee,
    candidateGroups,
    inputVariables: input,
    formKey,
    formVersion,
  });
  await setTokenState(trx, token.id, "waiting");
  await recordAudit(trx, {
    instanceId: token.instance_id,
    tokenId: token.id,
    eventType: "USER_TASK_CREATED",
    elementId: element.id,
    elementType: element.type,
    metadata: {
      userTaskId: userTask.id,
      assignee: element.assignment?.assignee,
      candidateGroups,
      formKey,
      formVersion,
    },
  });
  return null;
}

async function enterTimerCatch(
  trx: Trx,
  element: IntermediateCatchEventElement,
  token: { id: string; instance_id: string },
): Promise<null> {
  const dueAt = computeTimerDueAt(element.timer.kind, element.timer.expression);
  const timer = await createTimer(trx, {
    instanceId: token.instance_id,
    tokenId: token.id,
    elementId: element.id,
    timerType: element.timer.kind,
    dueAt,
  });
  await setTokenState(trx, token.id, "waiting");
  await recordAudit(trx, {
    instanceId: token.instance_id,
    tokenId: token.id,
    timerId: timer.id,
    eventType: "TIMER_CREATED",
    elementId: element.id,
    elementType: element.type,
    metadata: { dueAt: dueAt.toISOString(), expression: element.timer.expression },
  });
  return null;
}

async function stepExclusiveGateway(
  trx: Trx,
  def: InternalProcessDefinition,
  element: ExclusiveGatewayElement,
  token: { id: string; instance_id: string },
  variables: Record<string, unknown>,
): Promise<string> {
  const outgoing = def.flowsBySource.get(element.id) ?? [];

  // Evaluate conditional flows in declared order. Skip the default flow
  // during this pass — it's the explicit fallback.
  let chosen: SequenceFlow | undefined;
  for (const flow of outgoing) {
    if (flow.id === element.defaultFlow) continue;
    if (!flow.conditionExpression) continue;
    const ok = evaluateBoolean(flow.conditionExpression, { variables });
    if (ok) {
      chosen = flow;
      break;
    }
  }
  if (!chosen && element.defaultFlow) {
    chosen = outgoing.find((f) => f.id === element.defaultFlow);
  }
  if (!chosen) {
    throw new ExecutionError(
      `ExclusiveGateway ${element.id}: no condition matched and no default flow`,
    );
  }

  await recordAudit(trx, {
    instanceId: token.instance_id,
    tokenId: token.id,
    eventType: "TOKEN_COMPLETED",
    elementId: element.id,
    elementType: element.type,
    metadata: { takenFlow: chosen.id, isDefault: chosen.id === element.defaultFlow },
  });
  return await moveToNext(trx, def, element, token, chosen);
}

async function stepParallelGateway(
  trx: Trx,
  def: InternalProcessDefinition,
  element: ParallelGatewayElement,
  token: { id: string; instance_id: string },
): Promise<string | null> {
  const incoming = def.flowsByTarget.get(element.id) ?? [];
  const outgoing = def.flowsBySource.get(element.id) ?? [];

  if (incoming.length <= 1) {
    // Split (or no-op join): one in, N out. Complete this token and create
    // one outgoing token per outgoing flow. Schedule them all for
    // independent advancement.
    await setTokenState(trx, token.id, "completed");
    await recordAudit(trx, {
      instanceId: token.instance_id,
      tokenId: token.id,
      eventType: "TOKEN_COMPLETED",
      elementId: element.id,
      elementType: element.type,
    });
    if (outgoing.length === 1) {
      const first = outgoing[0]!;
      const nextElement = def.elements.get(first.targetRef);
      if (!nextElement) {
        throw new ExecutionError(`Unknown target ${first.targetRef}`);
      }
      const next = await createToken(trx, {
        instanceId: token.instance_id,
        elementId: nextElement.id,
        elementType: nextElement.type,
      });
      await recordAudit(trx, {
        instanceId: token.instance_id,
        tokenId: next.id,
        eventType: "TOKEN_CREATED",
        elementId: nextElement.id,
        elementType: nextElement.type,
      });
      return next.id;
    }
    // Two or more outgoing → fork. Advance each fork after creating it.
    const newIds: string[] = [];
    for (const flow of outgoing) {
      const nextElement = def.elements.get(flow.targetRef);
      if (!nextElement) {
        throw new ExecutionError(`Unknown target ${flow.targetRef}`);
      }
      const next = await createToken(trx, {
        instanceId: token.instance_id,
        elementId: nextElement.id,
        elementType: nextElement.type,
      });
      await recordAudit(trx, {
        instanceId: token.instance_id,
        tokenId: next.id,
        eventType: "TOKEN_CREATED",
        elementId: nextElement.id,
        elementType: nextElement.type,
      });
      newIds.push(next.id);
    }
    // Advance forks 2..N inline so they reach their next blocking element
    // before we return. The first fork is returned for the outer loop to
    // continue with. (lockInstance has already been acquired by the
    // top-level caller.)
    for (let i = 1; i < newIds.length; i++) {
      await advanceToken(trx, { get: () => def }, newIds[i]!);
    }
    return newIds[0] ?? null;
  }

  // Join: this token has just arrived at the gateway. Park it as waiting
  // and check whether tokens from every incoming flow are now present.
  await setTokenState(trx, token.id, "waiting");

  const arrived = await trx
    .selectFrom("tokens")
    .selectAll()
    .where("instance_id", "=", token.instance_id)
    .where("element_id", "=", element.id)
    .where("state", "=", "waiting")
    .execute();

  if (arrived.length < incoming.length) {
    return null;
  }

  // Enough tokens have arrived. Consume the oldest N (one per incoming flow)
  // and emit a single token onto the outgoing flow. Any extras (loops, which
  // we don't yet support) remain waiting.
  const consume = arrived.slice(0, incoming.length);
  for (const t of consume) {
    await setTokenState(trx, t.id, "completed");
    await recordAudit(trx, {
      instanceId: token.instance_id,
      tokenId: t.id,
      eventType: "TOKEN_COMPLETED",
      elementId: element.id,
      elementType: element.type,
      metadata: { join: true },
    });
  }

  if (outgoing.length !== 1) {
    throw new ExecutionError(
      `ParallelGateway ${element.id} join expects exactly one outgoing flow (got ${outgoing.length})`,
    );
  }
  const nextElement = def.elements.get(outgoing[0]!.targetRef);
  if (!nextElement) {
    throw new ExecutionError(`Unknown target ${outgoing[0]!.targetRef}`);
  }
  const next = await createToken(trx, {
    instanceId: token.instance_id,
    elementId: nextElement.id,
    elementType: nextElement.type,
  });
  await recordAudit(trx, {
    instanceId: token.instance_id,
    tokenId: next.id,
    eventType: "TOKEN_CREATED",
    elementId: nextElement.id,
    elementType: nextElement.type,
  });
  return next.id;
}

async function moveToNext(
  trx: Trx,
  def: InternalProcessDefinition,
  element: ProcessElement,
  token: { id: string; instance_id: string },
  flow: SequenceFlow,
): Promise<string> {
  const nextElement = def.elements.get(flow.targetRef);
  if (!nextElement) {
    throw new ExecutionError(`Outgoing flow targets unknown element ${flow.targetRef}`);
  }

  if (element.type !== "exclusiveGateway") {
    // exclusiveGateway emits its own TOKEN_COMPLETED audit with metadata.
    await setTokenState(trx, token.id, "completed");
    await recordAudit(trx, {
      instanceId: token.instance_id,
      tokenId: token.id,
      eventType: "TOKEN_COMPLETED",
      elementId: element.id,
      elementType: element.type,
    });
  } else {
    await setTokenState(trx, token.id, "completed");
  }

  const next = await createToken(trx, {
    instanceId: token.instance_id,
    elementId: nextElement.id,
    elementType: nextElement.type,
  });
  await recordAudit(trx, {
    instanceId: token.instance_id,
    tokenId: next.id,
    eventType: "TOKEN_CREATED",
    elementId: nextElement.id,
    elementType: nextElement.type,
  });
  return next.id;
}

export async function completeServiceTask(
  trx: Trx,
  defs: DefinitionLookup,
  params: {
    jobId: string;
    result: Record<string, unknown> | undefined;
  },
): Promise<void> {
  const job = await findJob(trx, params.jobId);
  if (!job) throw new ExecutionError(`Job ${params.jobId} not found`);
  if (job.state !== "active") {
    throw new ExecutionError(
      `Job ${params.jobId} is in state ${job.state}, expected active`,
    );
  }
  await lockInstance(trx, job.instance_id);

  const token = await findToken(trx, job.token_id);
  if (!token) throw new ExecutionError(`Token ${job.token_id} missing`);
  const instance = await findInstance(trx, job.instance_id);
  if (!instance) throw new ExecutionError(`Instance ${job.instance_id} missing`);
  const def = defs.get(instance.definition_id);
  if (!def) throw new ExecutionError(`Definition not loaded for instance ${instance.id}`);
  const element = def.elements.get(token.element_id);
  if (!element || element.type !== "serviceTask") {
    throw new ExecutionError(
      `Token ${token.id} is not at a service task (got ${element?.type})`,
    );
  }

  const newVars = applyOutputMapping(element.ioMapping, params.result, instance.variables);
  await setInstanceVariables(trx, instance.id, newVars);

  await markJobCompleted(trx, job.id, params.result);
  await recordAudit(trx, {
    instanceId: instance.id,
    tokenId: token.id,
    jobId: job.id,
    eventType: "JOB_COMPLETED",
    elementId: element.id,
    elementType: element.type,
  });

  await setTokenState(trx, token.id, "active");
  const nextId = await singleOutFollow(trx, def, element, {
    id: token.id,
    instance_id: token.instance_id,
  });
  await advanceToken(trx, defs, nextId);
}

// Resume a token that was waiting at an intermediateCatchEvent because its
// timer just fired.
export async function fireTimerForToken(
  trx: Trx,
  defs: DefinitionLookup,
  params: { tokenId: string; timerId: string },
): Promise<void> {
  const token = await findToken(trx, params.tokenId);
  if (!token) throw new ExecutionError(`Token ${params.tokenId} missing`);
  if (token.state !== "waiting") {
    // Timer fired for a token no longer waiting — likely already completed.
    return;
  }
  await lockInstance(trx, token.instance_id);

  const instance = await findInstance(trx, token.instance_id);
  if (!instance) throw new ExecutionError(`Instance missing`);
  const def = defs.get(instance.definition_id);
  if (!def) throw new ExecutionError(`Definition not loaded`);
  const element = def.elements.get(token.element_id);
  if (!element || element.type !== "intermediateCatchEvent") {
    throw new ExecutionError(
      `Token ${token.id} is not at an intermediate catch event (got ${element?.type})`,
    );
  }

  await recordAudit(trx, {
    instanceId: token.instance_id,
    tokenId: token.id,
    timerId: params.timerId,
    eventType: "TIMER_FIRED",
    elementId: element.id,
    elementType: element.type,
  });

  await setTokenState(trx, token.id, "active");
  const nextId = await singleOutFollow(trx, def, element, {
    id: token.id,
    instance_id: token.instance_id,
  });
  await advanceToken(trx, defs, nextId);
}

export async function completeUserTaskAction(
  trx: Trx,
  defs: DefinitionLookup,
  params: {
    userTaskId: string;
    result: Record<string, unknown> | undefined;
  },
): Promise<void> {
  const userTask = await findUserTask(trx, params.userTaskId);
  if (!userTask) throw new ExecutionError(`User task ${params.userTaskId} not found`);
  if (userTask.state !== "created" && userTask.state !== "claimed") {
    throw new ExecutionError(
      `User task ${params.userTaskId} is in state ${userTask.state}, expected created or claimed`,
    );
  }
  await lockInstance(trx, userTask.instance_id);

  const token = await findToken(trx, userTask.token_id);
  if (!token) throw new ExecutionError(`Token ${userTask.token_id} missing`);
  const instance = await findInstance(trx, userTask.instance_id);
  if (!instance) throw new ExecutionError(`Instance ${userTask.instance_id} missing`);
  const def = defs.get(instance.definition_id);
  if (!def) throw new ExecutionError(`Definition not loaded for instance ${instance.id}`);
  const element = def.elements.get(token.element_id);
  if (!element || element.type !== "userTask") {
    throw new ExecutionError(
      `Token ${token.id} is not at a user task (got ${element?.type})`,
    );
  }

  const newVars = applyOutputMapping(element.ioMapping, params.result, instance.variables);
  await setInstanceVariables(trx, instance.id, newVars);

  await markUserTaskCompleted(trx, userTask.id, params.result);
  await recordAudit(trx, {
    instanceId: instance.id,
    tokenId: token.id,
    eventType: "USER_TASK_COMPLETED",
    elementId: element.id,
    elementType: element.type,
    metadata: { userTaskId: userTask.id },
  });

  await setTokenState(trx, token.id, "active");
  const nextId = await singleOutFollow(trx, def, element, {
    id: token.id,
    instance_id: token.instance_id,
  });
  await advanceToken(trx, defs, nextId);
}
