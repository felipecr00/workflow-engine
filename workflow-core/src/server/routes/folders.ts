import type { FastifyInstance } from "fastify";
import type { Kysely } from "kysely";
import type { Database } from "../../engine/db/types";
import {
  createFolder,
  listFolders,
  getFolder,
  renameFolder,
  deleteFolder,
} from "../../engine/repository/folders";
import { listProjects } from "../../engine/repository/projects";

interface FolderParams {
  id: string;
}

interface CreateFolderBody {
  name: string;
  parentId?: string | null;
}

interface RenameFolderBody {
  name: string;
}

interface BrowseQuery {
  folderId?: string;
}

export function registerFolderRoutes(app: FastifyInstance, db: Kysely<Database>): void {
  // Browse: returns folders + projects in a given location
  app.get<{ Querystring: BrowseQuery }>(
    "/browse",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            folderId: { type: "string" },
          },
        },
      },
    },
    async (req) => {
      const parentId = req.query.folderId ?? null;
      const [folders, projects] = await Promise.all([
        listFolders(db, parentId),
        listProjects(db, parentId),
      ]);

      // Build breadcrumb trail
      const breadcrumbs: { id: string | null; name: string }[] = [];
      if (parentId) {
        let current = await getFolder(db, parentId);
        while (current) {
          breadcrumbs.unshift({ id: current.id, name: current.name });
          current = current.parent_id ? await getFolder(db, current.parent_id) : null;
        }
      }
      breadcrumbs.unshift({ id: null, name: "Home" });

      return { folders, projects, breadcrumbs };
    },
  );

  app.post<{ Body: CreateFolderBody }>(
    "/folders",
    {
      schema: {
        body: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string", minLength: 1 },
            parentId: { type: ["string", "null"] },
          },
        },
      },
    },
    async (req, reply) => {
      const folder = await createFolder(db, req.body.name, req.body.parentId ?? null);
      reply.code(201);
      return folder;
    },
  );

  app.put<{ Params: FolderParams; Body: RenameFolderBody }>(
    "/folders/:id",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        body: {
          type: "object",
          required: ["name"],
          properties: { name: { type: "string", minLength: 1 } },
        },
      },
    },
    async (req) => {
      return await renameFolder(db, req.params.id, req.body.name);
    },
  );

  app.delete<{ Params: FolderParams }>(
    "/folders/:id",
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
      await deleteFolder(db, req.params.id);
      return { ok: true };
    },
  );
}
