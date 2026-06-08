import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { Engine } from "../engine";
import { registerDefinitionRoutes } from "./routes/definitions";
import { registerHealthRoutes } from "./routes/health";
import { registerIncidentRoutes } from "./routes/incidents";
import { registerInstanceRoutes } from "./routes/instances";
import { registerUserTaskRoutes } from "./routes/user-tasks";
import { registerFolderRoutes } from "./routes/folders";
import { registerProjectRoutes } from "./routes/projects";

export interface AppOptions {
  engine: Engine;
  logger?: boolean;
}

export function buildApp(opts: AppOptions): FastifyInstance {
  const app = Fastify({
    logger: opts.logger ?? false,
    bodyLimit: 10 * 1024 * 1024,
  });

  registerHealthRoutes(app, opts.engine);
  registerDefinitionRoutes(app, opts.engine);
  registerInstanceRoutes(app, opts.engine);
  registerIncidentRoutes(app, opts.engine);
  registerUserTaskRoutes(app, opts.engine);
  registerFolderRoutes(app, opts.engine.db);
  registerProjectRoutes(app, opts.engine.db);

  // Optionally serve a pre-built web modeler (copy dist/ here or set WEB_DIST_DIR)
  const modelerDist = process.env.WEB_DIST_DIR ?? join(__dirname, "../../public");
  if (existsSync(modelerDist)) {
    app.register(fastifyStatic, {
      root: modelerDist,
      prefix: "/modeler/",
    });

    // SPA fallback: any /modeler/* path that doesn't match a static file
    // gets index.html so client-side routing can handle it
    const indexPath = join(modelerDist, "index.html");
    if (existsSync(indexPath)) {
      const indexHtml = readFileSync(indexPath, "utf-8");
      app.setNotFoundHandler((req, reply) => {
        if (req.url.startsWith("/modeler")) {
          reply.type("text/html").send(indexHtml);
        } else {
          reply.code(404).send({ error: "Not found" });
        }
      });
    }
  }

  return app;
}
