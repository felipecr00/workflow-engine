import type { FastifyInstance } from "fastify";
import type { Kysely } from "kysely";
import type { Database } from "../../engine/db/types";
import {
  createProject,
  getProject,
  updateProject,
  deleteProject,
} from "../../engine/repository/projects";

interface ProjectParams {
  id: string;
}

interface CreateProjectBody {
  name: string;
  folderId?: string | null;
  bpmnXml?: string;
  description?: string;
}

interface UpdateProjectBody {
  name?: string;
  bpmnXml?: string;
  description?: string | null;
  deployedDefinitionId?: string | null;
  folderId?: string | null;
}

const DEFAULT_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                  id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="Start" name="Start" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="Start_di" bpmnElement="Start">
        <dc:Bounds x="180" y="160" width="36" height="36" />
        <bpmndi:BPMNLabel><dc:Bounds x="186" y="203" width="24" height="14" /></bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

export function registerProjectRoutes(app: FastifyInstance, db: Kysely<Database>): void {
  app.post<{ Body: CreateProjectBody }>(
    "/projects",
    {
      schema: {
        body: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string", minLength: 1 },
            folderId: { type: ["string", "null"] },
            bpmnXml: { type: "string" },
            description: { type: "string" },
          },
        },
      },
    },
    async (req, reply) => {
      const project = await createProject(
        db,
        req.body.name,
        req.body.folderId ?? null,
        req.body.bpmnXml ?? DEFAULT_BPMN,
        req.body.description,
      );
      reply.code(201);
      return project;
    },
  );

  app.get<{ Params: ProjectParams }>(
    "/projects/:id",
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
      const project = await getProject(db, req.params.id);
      if (!project) {
        reply.code(404);
        return { error: "not_found" };
      }
      return project;
    },
  );

  app.put<{ Params: ProjectParams; Body: UpdateProjectBody }>(
    "/projects/:id",
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
            name: { type: "string", minLength: 1 },
            bpmnXml: { type: "string" },
            description: { type: ["string", "null"] },
            deployedDefinitionId: { type: ["string", "null"] },
            folderId: { type: ["string", "null"] },
          },
        },
      },
    },
    async (req, reply) => {
      const updates: Record<string, unknown> = {};
      if (req.body.name !== undefined) updates.name = req.body.name;
      if (req.body.bpmnXml !== undefined) updates.bpmn_xml = req.body.bpmnXml;
      if (req.body.description !== undefined) updates.description = req.body.description;
      if (req.body.deployedDefinitionId !== undefined)
        updates.deployed_definition_id = req.body.deployedDefinitionId;
      if (req.body.folderId !== undefined) updates.folder_id = req.body.folderId;

      try {
        const project = await updateProject(db, req.params.id, updates);
        return project;
      } catch {
        reply.code(404);
        return { error: "not_found" };
      }
    },
  );

  app.delete<{ Params: ProjectParams }>(
    "/projects/:id",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
      },
    },
    async (req) => {
      await deleteProject(db, req.params.id);
      return { ok: true };
    },
  );
}
