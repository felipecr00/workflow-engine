import type { FastifyInstance } from "fastify";
import type { Engine } from "../../engine";

interface ListQuery {
  instanceId?: string;
  activeOnly?: string;
}

interface ResolveBody {
  resolvedBy?: string;
}

export function registerIncidentRoutes(app: FastifyInstance, engine: Engine): void {
  app.get<{ Querystring: ListQuery }>(
    "/incidents",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            instanceId: { type: "string" },
            activeOnly: { type: "string" },
          },
        },
      },
    },
    async (req) => {
      const activeOnly = req.query.activeOnly !== "false";
      return await engine.listIncidents({
        instanceId: req.query.instanceId,
        activeOnly,
      });
    },
  );

  app.post<{ Params: { id: string }; Body: ResolveBody }>(
    "/incidents/:id/resolve",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        body: {
          type: "object",
          properties: { resolvedBy: { type: "string" } },
        },
      },
    },
    async (req, reply) => {
      try {
        await engine.resolveIncident(req.params.id, req.body?.resolvedBy ?? null);
        return { status: "resolved" };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        reply.code(404);
        return { error: "resolve_failed", message };
      }
    },
  );
}
