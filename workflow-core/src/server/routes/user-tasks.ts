import type { FastifyInstance } from "fastify";
import { FormValidationError, type Engine } from "../../engine";

interface UserTaskParams {
  id: string;
}

interface ClaimBody {
  claimedBy: string;
}

interface CompleteBody {
  variables?: Record<string, unknown>;
}

interface ListQuery {
  instanceId?: string;
  state?: string;
  assignee?: string;
}

export function registerUserTaskRoutes(app: FastifyInstance, engine: Engine): void {
  app.get<{ Querystring: ListQuery }>(
    "/user-tasks",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            instanceId: { type: "string" },
            state: { type: "string" },
            assignee: { type: "string" },
          },
        },
      },
    },
    async (req) => {
      const tasks = await engine.listUserTasks({
        instanceId: req.query.instanceId,
        state: req.query.state,
        assignee: req.query.assignee,
      });
      return { userTasks: tasks };
    },
  );

  app.get<{ Params: UserTaskParams }>(
    "/user-tasks/:id",
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
      const task = await engine.getUserTaskDetail(req.params.id);
      if (!task) {
        reply.code(404);
        return { error: "not_found" };
      }
      return task;
    },
  );

  app.post<{ Params: UserTaskParams; Body: ClaimBody }>(
    "/user-tasks/:id/claim",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        body: {
          type: "object",
          required: ["claimedBy"],
          properties: {
            claimedBy: { type: "string", minLength: 1 },
          },
        },
      },
    },
    async (req, reply) => {
      try {
        await engine.claimUserTask(req.params.id, req.body.claimedBy);
        return { ok: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        reply.code(400);
        return { error: "claim_failed", message };
      }
    },
  );

  app.post<{ Params: UserTaskParams; Body: CompleteBody }>(
    "/user-tasks/:id/complete",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        body: {
          type: "object",
          properties: {
            variables: { type: "object", additionalProperties: true },
          },
        },
      },
    },
    async (req, reply) => {
      try {
        await engine.completeUserTask(req.params.id, req.body.variables ?? {});
        return { ok: true };
      } catch (err) {
        if (err instanceof FormValidationError) {
          reply.code(400);
          return { error: "validation_failed", details: err.details };
        }
        const message = err instanceof Error ? err.message : String(err);
        reply.code(400);
        return { error: "complete_failed", message };
      }
    },
  );

  app.post<{ Params: UserTaskParams }>(
    "/user-tasks/:id/cancel",
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
      try {
        await engine.cancelUserTask(req.params.id);
        return { ok: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        reply.code(400);
        return { error: "cancel_failed", message };
      }
    },
  );
}
