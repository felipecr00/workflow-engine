import type { FastifyInstance } from "fastify";
import type { Engine } from "../../engine";

interface DeployBody {
  bpmnXml: string;
  name?: string;
}

interface DefinitionIdParams {
  id: string;
}

interface VersionsParams {
  key: string;
}

export function registerDefinitionRoutes(app: FastifyInstance, engine: Engine): void {
  app.get("/definitions", async () => {
    const definitions = await engine.listDefinitions();
    return { definitions };
  });

  app.get<{ Params: DefinitionIdParams }>(
    "/definitions/:id",
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
      const def = await engine.getDefinition(req.params.id);
      if (!def) {
        reply.code(404);
        return { error: "not_found" };
      }
      return def;
    },
  );

  app.get<{ Params: VersionsParams }>(
    "/definitions/:key/versions",
    {
      schema: {
        params: {
          type: "object",
          required: ["key"],
          properties: { key: { type: "string" } },
        },
      },
    },
    async (req) => {
      const versions = await engine.listDefinitionVersions(req.params.key);
      return { versions };
    },
  );

  app.post<{ Body: DeployBody }>(
    "/definitions",
    {
      schema: {
        body: {
          type: "object",
          required: ["bpmnXml"],
          properties: {
            bpmnXml: { type: "string", minLength: 1 },
            name: { type: "string" },
          },
        },
      },
    },
    async (req, reply) => {
      try {
        const result = await engine.deploy(req.body.bpmnXml, req.body.name ?? null);
        reply.code(201);
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        reply.code(400);
        return { error: "deploy_failed", message };
      }
    },
  );
}
