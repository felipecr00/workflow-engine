# Workflow Engine

A single-node, Postgres-backed **BPMN workflow engine** inspired by Camunda
Zeebe, plus a browser-based **modeler & operations UI**. The repository is a
monorepo with two packages that work together:

| Package | Stack | Role |
| --- | --- | --- |
| [workflow-core](workflow-core) | Node.js 20, TypeScript, Fastify, Kysely, Postgres 16 | The engine itself: BPMN parser, token executor, scheduler, REST API. |
| [workflow-web](workflow-web) | Vite, TypeScript, `bpmn-js` | BPMN modeler + ops UI (home/folders, instances, user tasks, incidents). Talks to the core via HTTP. |

The web UI can be served two ways:

1. **Dev** — run Vite on `:5173` with a proxy to the engine on `:3000`.
2. **Prod** — build the web bundle, copy it into the engine, the engine serves it at `/modeler/`.

> A deep, feature-by-feature reference for the engine itself lives in
> [workflow-core/README.md](workflow-core/README.md). This document focuses on
> **how to get the whole stack up and running.**

---

## 1. Prerequisites

- **Node.js ≥ 20** (`node -v`)
- **npm** (bundled with Node) — or pnpm/yarn if you prefer.
- **Docker** + **Docker Compose** (for the local Postgres database).

> If you already have a Postgres 16 instance you want to use, you can skip
> Docker and just point `DATABASE_URL` at it. See [Environment variables](#5-environment-variables).

---

## 2. First-time setup

From the repository root:

```bash
# 1. Install backend dependencies
cd workflow-core
npm install

# 2. Start Postgres (detached)
docker compose up -d postgres

# 3. Apply database migrations
npm run migrate

# 4. Install frontend dependencies
cd ../workflow-web
npm install
```

You should now have:

- A Postgres container exposing `localhost:5432` with database `workflow`
  (user `workflow`, password `workflow`).
- Migrated schema with all tables (`process_definitions`, `process_instances`,
  `tokens`, `jobs`, `timers`, `incidents`, `user_tasks`, `folders`, `projects`, …).

---

## 3. Running in development

You need **two terminals** — one for the engine, one for the web UI.

### Terminal A — engine (port 3000)

```bash
cd workflow-core
npm run dev
```

This runs `tsx watch src/server/index.ts`. The Fastify server listens on
`http://localhost:3000` and starts polling jobs/timers every 250 ms.

### Terminal B — web UI (port 5173)

```bash
cd workflow-web
npm run dev
```

Open [http://localhost:5173/modeler/](http://localhost:5173/modeler/).

Vite proxies all engine endpoints (`/definitions`, `/instances`, `/incidents`,
`/user-tasks`, `/folders`, `/projects`, `/browse`, `/health`) to
`http://localhost:3000`. See [workflow-web/vite.config.ts](workflow-web/vite.config.ts).

The UI gives you:

- **Home** — folders & diagrams, full CRUD.
- **Modeler** — `bpmn-js` editor with the Zeebe properties panel; Save, Import, Export, Deploy.
- **Instances** — list & detail view (variables, tokens, jobs, timers, audit trail).
- **User Tasks** — claim/complete UI.
- **Incidents** — list and resolve.

---

## 4. Running in production (single server)

The engine can serve the pre-built web bundle, so the whole app runs on **one port**.

```bash
# 1. Build the web UI
cd workflow-web
npm run build                       # output: workflow-web/dist/

# 2. Build the engine
cd ../workflow-core
npm run build                       # output: workflow-core/dist/

# 3. Tell the engine where the web bundle lives
export WEB_DIST_DIR=$(pwd)/../workflow-web/dist

# 4. Make sure Postgres is up and migrated
docker compose up -d postgres
npm run migrate

# 5. Start the server
npm start
```

Now `http://localhost:3000/modeler/` serves the UI and the same origin
serves the REST API — no proxy needed. The engine also falls back to
`workflow-core/public/` if `WEB_DIST_DIR` is unset (see [workflow-core/src/server/app.ts](workflow-core/src/server/app.ts#L34)).

---

## 5. Environment variables

All read by the engine ([workflow-core/src/engine/config.ts](workflow-core/src/engine/config.ts)
and [workflow-core/src/server/index.ts](workflow-core/src/server/index.ts)).

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | `postgres://workflow:workflow@localhost:5432/workflow` | Postgres connection string. |
| `PORT` | `3000` | HTTP listen port. |
| `HOST` | `0.0.0.0` | HTTP bind address. |
| `JOB_POLL_INTERVAL_MS` | `250` | Scheduler tick interval. |
| `JOB_BATCH_SIZE` | `16` | Max jobs claimed per tick. |
| `SCHEDULER_LOCK_KEY` | `7263401` | Postgres advisory-lock key (multi-node). |
| `WEB_DIST_DIR` | `workflow-core/public` | Folder containing the built web UI. |

---

## 6. Smoke test (5 commands)

With both processes running (or the prod single-server flavor):

```bash
# Health check
curl http://localhost:3000/health

# Deploy the sample diagram
curl -X POST http://localhost:3000/definitions \
  -H 'Content-Type: application/json' \
  -d "{\"bpmnXml\": $(jq -Rs . < workflow-core/examples/processes/hello-world.bpmn)}"

# Start an instance (replace processKey with the one returned above; sample uses "hello-world")
curl -X POST http://localhost:3000/instances \
  -H 'Content-Type: application/json' \
  -d '{"processKey": "hello-world", "variables": {"name": "Felipe"}}'

# Inspect it
curl http://localhost:3000/instances/<instance-id>

# List active incidents
curl 'http://localhost:3000/incidents?activeOnly=true'
```

> The `greet` service task needs a registered handler to actually complete.
> Register handlers programmatically with `engine.registerHandler("greet", fn)`
> — see the [engine README](workflow-core/README.md) for the API shape.

---

## 7. Running tests

The test suite is in `workflow-core` and uses a real Postgres database (the
same one as dev).

```bash
cd workflow-core
docker compose up -d postgres       # if not already running
npm run migrate                     # if not already migrated
npm test                            # one-shot
npm run test:watch                  # watch mode
npm run typecheck                   # tsc --noEmit
```

The suites cover parsing, expressions, execution, gateways, timers,
incidents, user tasks, migrations, and restart recovery — see
[workflow-core/tests](workflow-core/tests).

---

## 8. Repository layout

```text
workflow-engine/
├── workflow-core/                    # Engine + REST API
│   ├── docker-compose.yml            # Postgres 16
│   ├── migrations/                   # SQL migrations
│   ├── examples/processes/           # Sample BPMN files
│   ├── src/
│   │   ├── engine/                   # parser, executor, scheduler, repos, db
│   │   └── server/                   # Fastify app + routes
│   └── tests/                        # Vitest suite
│
├── workflow-web/                     # Modeler & ops UI
│   ├── index.html
│   ├── vite.config.ts                # Dev proxy → :3000
│   └── src/                          # main.ts, api.ts, styles.css, …
│
├── .gitignore
└── README.md                         # ← you are here
```

---

## 9. Common issues

- **`ECONNREFUSED 127.0.0.1:5432`** — Postgres isn't running. `docker compose up -d postgres` from inside [workflow-core](workflow-core).
- **`relation "process_definitions" does not exist`** — Migrations weren't applied. `npm run migrate` inside [workflow-core](workflow-core).
- **UI shows blank page at `/modeler/`** — In production, confirm `WEB_DIST_DIR` is set and the folder contains `index.html`. In dev, hit the Vite URL `http://localhost:5173/modeler/`, not the engine port.
- **CORS errors in dev** — Don't call the engine directly from the browser on `:3000`; let the Vite proxy handle it. The proxied paths are listed in [workflow-web/vite.config.ts](workflow-web/vite.config.ts).
- **Port already in use** — Override with `PORT=3001 npm run dev` (engine) or edit `server.port` in [workflow-web/vite.config.ts](workflow-web/vite.config.ts).

---

## 10. Where to go next

- **Engine API reference, supported BPMN elements, FEEL subset, retry semantics, schema, and roadmap:**  
  → [workflow-core/README.md](workflow-core/README.md)
- **Sample BPMN:** [workflow-core/examples/processes/hello-world.bpmn](workflow-core/examples/processes/hello-world.bpmn)
- **Source entrypoints:** [workflow-core/src/server/index.ts](workflow-core/src/server/index.ts) and [workflow-web/src/main.ts](workflow-web/src/main.ts).
