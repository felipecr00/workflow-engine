import type { FastifyInstance } from "fastify";
import { UnsupportedFormFieldError, type Engine } from "../../engine";

interface FormKeyParams {
  key: string;
}

interface FormKeyVersionParams {
  key: string;
  version: string;
}

interface DeployFormBody {
  key: string;
  schema: Record<string, unknown>;
  format?: "form-js" | "json-schema";
  uiSchema?: Record<string, unknown> | null;
}

export function registerFormRoutes(app: FastifyInstance, engine: Engine): void {
  app.post<{ Body: DeployFormBody }>(
    "/forms",
    {
      schema: {
        body: {
          type: "object",
          required: ["key", "schema"],
          properties: {
            key: { type: "string", minLength: 1 },
            schema: { type: "object", additionalProperties: true },
            format: { type: "string", enum: ["form-js", "json-schema"] },
            uiSchema: {
              anyOf: [
                { type: "object", additionalProperties: true },
                { type: "null" },
              ],
            },
          },
        },
      },
    },
    async (req, reply) => {
      try {
        const row = await engine.deployForm({
          key: req.body.key,
          schema: req.body.schema,
          format: req.body.format,
          uiSchema: req.body.uiSchema ?? null,
        });
        reply.code(201);
        return {
          id: row.id,
          key: row.key,
          version: row.version,
          format: row.format,
          deployedAt: row.deployed_at,
        };
      } catch (err) {
        if (err instanceof UnsupportedFormFieldError) {
          reply.code(400);
          return { error: "unsupported_field_type", details: err.details };
        }
        const message = err instanceof Error ? err.message : String(err);
        reply.code(400);
        return { error: "deploy_failed", message };
      }
    },
  );

  app.get("/forms", async () => {
    const forms = await engine.listForms();
    return {
      forms: forms.map((f) => ({
        key: f.key,
        version: f.version,
        format: f.format,
        deployedAt: f.deployed_at,
      })),
    };
  });

  app.get<{ Params: FormKeyParams }>(
    "/forms/:key",
    {
      schema: {
        params: {
          type: "object",
          required: ["key"],
          properties: { key: { type: "string" } },
        },
      },
    },
    async (req, reply) => {
      const row = await engine.getLatestForm(req.params.key);
      if (!row) {
        reply.code(404);
        return { error: "not_found" };
      }
      return formPayload(row);
    },
  );

  app.get<{ Params: FormKeyVersionParams }>(
    "/forms/:key/versions/:version",
    {
      schema: {
        params: {
          type: "object",
          required: ["key", "version"],
          properties: {
            key: { type: "string" },
            version: { type: "string", pattern: "^[0-9]+$" },
          },
        },
      },
    },
    async (req, reply) => {
      const version = Number.parseInt(req.params.version, 10);
      const row = await engine.getFormByVersion(req.params.key, version);
      if (!row) {
        reply.code(404);
        return { error: "not_found" };
      }
      return formPayload(row);
    },
  );
}

function formPayload(row: {
  id: string;
  key: string;
  version: number;
  format: string;
  schema: Record<string, unknown>;
  ui_schema: Record<string, unknown> | null;
  deployed_at: Date;
}) {
  return {
    id: row.id,
    key: row.key,
    version: row.version,
    format: row.format,
    schema: row.schema,
    uiSchema: row.ui_schema,
    deployedAt: row.deployed_at,
  };
}
