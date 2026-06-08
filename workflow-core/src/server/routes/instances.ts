import type { FastifyInstance } from "fastify";
import type { Engine } from "../../engine";

interface CreateInstanceBody {
  processKey: string;
  variables?: Record<string, unknown>;
}

interface MigrateInstanceBody {
  targetDefinitionKey: string;
  targetVersion: number;
  elementMapping: Record<string, string>;
}

interface InstanceParams {
  id: string;
}

interface ListInstancesQuery {
  state?: string;
  definitionKey?: string;
}

export function registerInstanceRoutes(app: FastifyInstance, engine: Engine): void {
  app.get<{ Querystring: ListInstancesQuery }>(
    "/instances",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            state: { type: "string" },
            definitionKey: { type: "string" },
          },
        },
      },
    },
    async (req) => {
      const instances = await engine.listInstances({
        state: req.query.state,
        definitionKey: req.query.definitionKey,
      });
      return { instances };
    },
  );

  app.post<{ Body: CreateInstanceBody }>(
    "/instances",
    {
      schema: {
        body: {
          type: "object",
          required: ["processKey"],
          properties: {
            processKey: { type: "string", minLength: 1 },
            variables: { type: "object", additionalProperties: true },
          },
        },
      },
    },
    async (req, reply) => {
      try {
        const result = await engine.createInstance(
          req.body.processKey,
          req.body.variables ?? {},
        );
        reply.code(201);
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        reply.code(400);
        return { error: "create_instance_failed", message };
      }
    },
  );

  app.post<{ Params: InstanceParams; Body: MigrateInstanceBody }>(
    "/instances/:id/migrate",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        body: {
          type: "object",
          required: ["targetDefinitionKey", "targetVersion", "elementMapping"],
          properties: {
            targetDefinitionKey: { type: "string", minLength: 1 },
            targetVersion: { type: "integer", minimum: 1 },
            elementMapping: { type: "object", additionalProperties: { type: "string" } },
          },
        },
      },
    },
    async (req, reply) => {
      try {
        const result = await engine.migrateInstance({
          instanceId: req.params.id,
          targetDefinitionKey: req.body.targetDefinitionKey,
          targetVersion: req.body.targetVersion,
          elementMapping: req.body.elementMapping,
        });
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        reply.code(400);
        return { error: "migration_failed", message };
      }
    },
  );

  app.get<{ Params: InstanceParams }>(
    "/instances/:id",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
      },
    },
    async (req, reply) => {
      const snapshot = await engine.getInstance(req.params.id);
      if (!snapshot) {
        reply.code(404);
        return { error: "not_found" };
      }
      return snapshot;
    },
  );
}
