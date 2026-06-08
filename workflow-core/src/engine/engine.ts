import type { Pool } from 'pg';
import type { Kysely } from 'kysely';
import { createDbClient, type DbClient } from './db/client';
import type { Database } from './db/types';
import { runMigrations } from './db/migrator';
import {
  advanceToken,
  completeUserTaskAction,
  lockInstance,
} from './execution/executor';
import { HandlerRegistry, type JobHandler } from './execution/handler-registry';
import { Scheduler } from './execution/scheduler';
import { parseProcess } from './parser/parser';
import type { InternalProcessDefinition } from './parser/types';
import {
  recordAudit,
  listAuditForInstance,
  type AuditEventRow,
} from './repository/audit';
import {
  findDefinitionById,
  findDefinitionByKeyAndVersion,
  findLatestDefinitionByKey,
  insertDefinition,
  listActiveDefinitions,
  listDefinitionVersions,
  type DeployedDefinitionRow,
} from './repository/definitions';
import {
  createInstance,
  findInstance,
  listInstances,
  updateInstanceDefinition,
  type ProcessInstanceRow,
} from './repository/instances';
import {
  findIncident,
  listIncidents,
  listIncidentsForInstance,
  markIncidentResolved,
  type IncidentRow,
} from './repository/incidents';
import {
  findJob,
  listJobsForInstance,
  reactivateJobForResolve,
  remapJobElement,
  type JobRow,
} from './repository/jobs';
import {
  listTimersForInstance,
  remapTimerElement,
  type TimerRow,
} from './repository/timers';
import {
  cancelUserTask,
  claimUserTask,
  findUserTask,
  listUserTasks,
  listUserTasksForInstance,
  type UserTaskRow,
} from './repository/user-tasks';
import {
  createToken,
  listAllTokensForInstance,
  listLiveTokensForInstance,
  remapTokenElement,
  setTokenState,
  type TokenRow,
} from './repository/tokens';

export interface MigrateInstanceParams {
  instanceId: string;
  targetDefinitionKey: string;
  targetVersion: number;
  elementMapping: Record<string, string>;
}

export interface MigrateInstanceResult {
  instanceId: string;
  previousDefinitionId: string;
  previousVersion: number;
  newDefinitionId: string;
  newVersion: number;
  tokensMigrated: number;
  jobsMigrated: number;
  timersMigrated: number;
}

export interface EngineOptions {
  databaseUrl: string;
  jobPollIntervalMs?: number;
  jobBatchSize?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
  autoStartJobRunner?: boolean;
}

export interface DeployResult {
  id: string;
  key: string;
  version: number;
  name: string | null;
  deployedAt: Date;
}

export interface CreateInstanceResult {
  id: string;
  definitionId: string;
  definitionKey: string;
  definitionVersion: number;
  definitionName: string | null;
  state: string;
}

export interface InstanceSnapshot {
  id: string;
  definitionId: string;
  definitionKey: string;
  definitionVersion: number;
  definitionName: string | null;
  state: string;
  variables: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  endedAt: Date | null;
  tokens: TokenRow[];
  jobs: JobRow[];
  timers: TimerRow[];
  userTasks: UserTaskRow[];
  incidents: IncidentRow[];
  audit: AuditEventRow[];
}

class DefinitionCache {
  private byId = new Map<string, InternalProcessDefinition>();

  set(definitionId: string, def: InternalProcessDefinition): void {
    this.byId.set(definitionId, def);
  }

  get(definitionId: string): InternalProcessDefinition | undefined {
    return this.byId.get(definitionId);
  }

  clear(): void {
    this.byId.clear();
  }
}

export class Engine {
  private readonly handlers = new HandlerRegistry();
  private readonly cache = new DefinitionCache();
  private client: DbClient | null = null;
  private scheduler: Scheduler | null = null;
  private started = false;

  constructor(private readonly options: EngineOptions) {}

  get db(): Kysely<Database> {
    if (!this.client)
      throw new Error('Engine not started — call engine.start() first');
    return this.client.db;
  }

  get pool(): Pool {
    if (!this.client)
      throw new Error('Engine not started — call engine.start() first');
    return this.client.pool;
  }

  registerHandler(type: string, handler: JobHandler): void {
    this.handlers.register(type, handler);
  }

  async start(): Promise<void> {
    if (this.started) return;
    const client = createDbClient(this.options.databaseUrl);
    this.client = client;
    await runMigrations(client.pool);

    const defs = await listActiveDefinitions(client.db);
    for (const row of defs) {
      const parsed = await parseProcess(row.bpmn_xml);
      this.cache.set(row.id, parsed);
    }

    this.scheduler = new Scheduler(client.db, this.handlers, this.cache, {
      pollIntervalMs: this.options.jobPollIntervalMs ?? 250,
      batchSize: this.options.jobBatchSize ?? 16,
      retryBaseDelayMs: this.options.retryBaseDelayMs,
      retryMaxDelayMs: this.options.retryMaxDelayMs,
    });

    await this.scheduler.recoverStaleActiveJobs();

    if (this.options.autoStartJobRunner !== false) {
      this.scheduler.start();
    }

    this.started = true;
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    if (this.scheduler) {
      await this.scheduler.stop();
      this.scheduler = null;
    }
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
    this.cache.clear();
    this.started = false;
  }

  async runOneTick(): Promise<{ jobs: number; timers: number }> {
    if (!this.scheduler) throw new Error('Engine not started');
    return await this.scheduler.tick();
  }

  async deploy(bpmnXml: string, name?: string | null): Promise<DeployResult> {
    const parsed = await parseProcess(bpmnXml);
    for (const el of parsed.elements.values()) {
      if (
        el.type === 'serviceTask' &&
        !this.handlers.has(el.taskDefinition.type)
      ) {
        throw new Error(
          `Cannot deploy ${parsed.key}: no handler registered for task type "${el.taskDefinition.type}"`,
        );
      }
    }

    const row = await insertDefinition(this.db, {
      key: parsed.key,
      name: name ?? parsed.name ?? null,
      bpmnXml,
    });
    this.cache.set(row.id, parsed);

    return {
      id: row.id,
      key: row.key,
      version: row.version,
      name: row.name,
      deployedAt: row.deployed_at,
    };
  }

  async createInstance(
    processKey: string,
    variables: Record<string, unknown> = {},
  ): Promise<CreateInstanceResult> {
    const def = await findLatestDefinitionByKey(this.db, processKey);
    if (!def) {
      throw new Error(`No active definition deployed with key "${processKey}"`);
    }
    let parsed = this.cache.get(def.id);
    if (!parsed) {
      parsed = await parseProcess(def.bpmn_xml);
      this.cache.set(def.id, parsed);
    }

    const startEventId = parsed.startEventIds[0]!;
    const startElement = parsed.elements.get(startEventId)!;

    const result = await this.db.transaction().execute(async (trx) => {
      const instance = await createInstance(trx, {
        definitionId: def.id,
        definitionKey: def.key,
        definitionVersion: def.version,
        definitionName: def.name,
        variables,
      });
      await recordAudit(trx, {
        instanceId: instance.id,
        eventType: 'INSTANCE_CREATED',
        metadata: { definitionKey: def.key, definitionVersion: def.version },
      });

      const token = await createToken(trx, {
        instanceId: instance.id,
        elementId: startElement.id,
        elementType: startElement.type,
      });
      await recordAudit(trx, {
        instanceId: instance.id,
        tokenId: token.id,
        eventType: 'TOKEN_CREATED',
        elementId: startElement.id,
        elementType: startElement.type,
      });

      await advanceToken(trx, this.cache, token.id);
      return instance;
    });

    return {
      id: result.id,
      definitionId: result.definition_id,
      definitionKey: result.definition_key,
      definitionVersion: result.definition_version,
      definitionName: result.definition_name,
      state: result.state,
    };
  }

  async getInstance(id: string): Promise<InstanceSnapshot | null> {
    const instance = await findInstance(this.db, id);
    if (!instance) return null;
    const [tokens, jobs, timers, userTasks, incidents, audit] =
      await Promise.all([
        listAllTokensForInstance(this.db, id),
        listJobsForInstance(this.db, id),
        listTimersForInstance(this.db, id),
        listUserTasksForInstance(this.db, id),
        listIncidentsForInstance(this.db, id),
        listAuditForInstance(this.db, id),
      ]);
    return snapshotFromRow(
      instance,
      tokens,
      jobs,
      timers,
      userTasks,
      incidents,
      audit,
    );
  }

  async listInstances(
    filter: {
      state?: string;
      definitionKey?: string;
    } = {},
  ): Promise<ProcessInstanceRow[]> {
    return await listInstances(this.db, {
      state: filter.state as any,
      definitionKey: filter.definitionKey,
    });
  }

  async listDefinitions(): Promise<DeployedDefinitionRow[]> {
    return await listActiveDefinitions(this.db);
  }

  async getDefinition(id: string): Promise<DeployedDefinitionRow | null> {
    return await findDefinitionById(this.db, id);
  }

  async listDefinitionVersions(key: string): Promise<DeployedDefinitionRow[]> {
    return await listDefinitionVersions(this.db, key);
  }

  async listIncidents(
    filter: {
      instanceId?: string;
      activeOnly?: boolean;
    } = {},
  ): Promise<IncidentRow[]> {
    return await listIncidents(this.db, {
      instanceId: filter.instanceId,
      state: filter.activeOnly === false ? undefined : 'active',
    });
  }

  async resolveIncident(
    incidentId: string,
    resolvedBy: string | null = null,
  ): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const incident = await findIncident(trx, incidentId);
      if (!incident) {
        throw new Error(`Incident ${incidentId} not found`);
      }
      if (incident.state === 'resolved') {
        return;
      }
      await lockInstance(trx, incident.instance_id);
      await markIncidentResolved(trx, incidentId, resolvedBy);
      await recordAudit(trx, {
        instanceId: incident.instance_id,
        tokenId: incident.token_id,
        jobId: incident.job_id,
        incidentId: incident.id,
        eventType: 'INCIDENT_RESOLVED',
        metadata: { resolvedBy },
      });

      if (incident.job_id) {
        const job = await findJob(trx, incident.job_id);
        if (job) {
          await reactivateJobForResolve(trx, job.id);
          if (incident.token_id) {
            await setTokenState(trx, incident.token_id, 'waiting');
          }
        }
      }
    });
  }
  async listUserTasks(
    filter: {
      instanceId?: string;
      state?: string;
      assignee?: string;
    } = {},
  ): Promise<UserTaskRow[]> {
    return await listUserTasks(this.db, {
      instanceId: filter.instanceId,
      state: filter.state as any,
      assignee: filter.assignee,
    });
  }

  async claimUserTask(userTaskId: string, claimedBy: string): Promise<void> {
    const task = await findUserTask(this.db, userTaskId);
    if (!task) throw new Error(`User task ${userTaskId} not found`);
    if (task.state !== 'created' && task.state !== 'claimed') {
      throw new Error(`Cannot claim user task in state "${task.state}"`);
    }
    await claimUserTask(this.db, userTaskId, claimedBy);
    await recordAudit(this.db, {
      instanceId: task.instance_id,
      tokenId: task.token_id,
      eventType: 'USER_TASK_CLAIMED',
      elementId: task.element_id,
      metadata: { userTaskId, claimedBy },
    });
  }

  async completeUserTask(
    userTaskId: string,
    variables: Record<string, unknown> = {},
  ): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      await completeUserTaskAction(trx, this.cache, {
        userTaskId,
        result: Object.keys(variables).length > 0 ? variables : undefined,
      });
    });
  }

  async cancelUserTask(userTaskId: string): Promise<void> {
    const task = await findUserTask(this.db, userTaskId);
    if (!task) throw new Error(`User task ${userTaskId} not found`);
    if (task.state !== 'created' && task.state !== 'claimed') {
      throw new Error(`Cannot cancel user task in state "${task.state}"`);
    }
    await cancelUserTask(this.db, userTaskId);
    await setTokenState(this.db, task.token_id, 'active');
    await recordAudit(this.db, {
      instanceId: task.instance_id,
      tokenId: task.token_id,
      eventType: 'USER_TASK_CANCELLED',
      elementId: task.element_id,
      metadata: { userTaskId },
    });
  }

  async migrateInstance(
    params: MigrateInstanceParams,
  ): Promise<MigrateInstanceResult> {
    const targetDef = await findDefinitionByKeyAndVersion(
      this.db,
      params.targetDefinitionKey,
      params.targetVersion,
    );
    if (!targetDef) {
      throw new Error(
        `No definition found for key "${params.targetDefinitionKey}" version ${params.targetVersion}`,
      );
    }

    let parsedTarget = this.cache.get(targetDef.id);
    if (!parsedTarget) {
      parsedTarget = await parseProcess(targetDef.bpmn_xml);
      this.cache.set(targetDef.id, parsedTarget);
    }

    const result = await this.db.transaction().execute(async (trx) => {
      await lockInstance(trx, params.instanceId);

      const instance = await findInstance(trx, params.instanceId);
      if (!instance) {
        throw new Error(`Instance ${params.instanceId} not found`);
      }
      if (instance.state !== 'active') {
        throw new Error(
          `Cannot migrate instance in state "${instance.state}" — only active instances can be migrated`,
        );
      }
      if (instance.definition_id === targetDef.id) {
        throw new Error('Instance is already on the target definition version');
      }

      const liveTokens = await listLiveTokensForInstance(
        trx,
        params.instanceId,
      );

      const unmapped: string[] = [];
      for (const token of liveTokens) {
        const mappedElementId = params.elementMapping[token.element_id];
        if (!mappedElementId) {
          unmapped.push(token.element_id);
          continue;
        }
        if (!parsedTarget!.elements.has(mappedElementId)) {
          throw new Error(
            `Element mapping target "${mappedElementId}" does not exist in target definition`,
          );
        }
      }
      if (unmapped.length > 0) {
        const unique = [...new Set(unmapped)];
        throw new Error(
          `Element mapping is incomplete — unmapped live elements: ${unique.join(
            ', ',
          )}`,
        );
      }

      let tokensMigrated = 0;
      for (const token of liveTokens) {
        const newElementId = params.elementMapping[token.element_id]!;
        const newElement = parsedTarget!.elements.get(newElementId)!;
        await remapTokenElement(trx, token.id, newElementId, newElement.type);
        tokensMigrated++;
      }

      const jobs = await listJobsForInstance(trx, params.instanceId);
      let jobsMigrated = 0;
      for (const job of jobs) {
        if (job.state === 'completed' || job.state === 'incident') continue;
        const newElementId = params.elementMapping[job.element_id];
        if (newElementId) {
          await remapJobElement(trx, job.id, newElementId);
          jobsMigrated++;
        }
      }

      const timers = await listTimersForInstance(trx, params.instanceId);
      let timersMigrated = 0;
      for (const timer of timers) {
        if (timer.state !== 'active') continue;
        const newElementId = params.elementMapping[timer.element_id];
        if (newElementId) {
          await remapTimerElement(trx, timer.id, newElementId);
          timersMigrated++;
        }
      }

      const prevDefId = instance.definition_id;
      const prevVersion = instance.definition_version;

      await updateInstanceDefinition(trx, params.instanceId, {
        definitionId: targetDef.id,
        definitionKey: targetDef.key,
        definitionVersion: targetDef.version,
      });

      await recordAudit(trx, {
        instanceId: params.instanceId,
        eventType: 'INSTANCE_MIGRATED',
        metadata: {
          previousDefinitionId: prevDefId,
          previousVersion: prevVersion,
          newDefinitionId: targetDef.id,
          newVersion: targetDef.version,
          elementMapping: params.elementMapping,
          tokensMigrated,
          jobsMigrated,
          timersMigrated,
        },
      });

      return {
        instanceId: params.instanceId,
        previousDefinitionId: prevDefId,
        previousVersion: prevVersion,
        newDefinitionId: targetDef.id,
        newVersion: targetDef.version,
        tokensMigrated,
        jobsMigrated,
        timersMigrated,
      };
    });

    return result;
  }
}

function snapshotFromRow(
  row: ProcessInstanceRow,
  tokens: TokenRow[],
  jobs: JobRow[],
  timers: TimerRow[],
  userTasks: UserTaskRow[],
  incidents: IncidentRow[],
  audit: AuditEventRow[],
): InstanceSnapshot {
  return {
    id: row.id,
    definitionId: row.definition_id,
    definitionKey: row.definition_key,
    definitionVersion: row.definition_version,
    definitionName: row.definition_name,
    state: row.state,
    variables: row.variables,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    endedAt: row.ended_at,
    tokens,
    jobs,
    timers,
    userTasks,
    incidents,
    audit,
  };
}
