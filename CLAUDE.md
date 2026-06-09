# CLAUDE.md — Operating contract

Guía operativa para Claude Code trabajando sobre este repo. Lee esto antes de
tocar código. El `README.md` describe **qué** es el proyecto; este archivo
describe **cómo trabajar** en él.

---

## 1. Qué es este repo (resumen 30s)

Monorepo de un motor BPMN inspirado en Camunda Zeebe, con dos paquetes:

- **`workflow-core/`** — Motor: Node 20 + TypeScript + Fastify + Kysely + Postgres 16.
  Parser BPMN, ejecutor por tokens, scheduler, API REST. Punto de entrada:
  [workflow-core/src/server/index.ts](workflow-core/src/server/index.ts).
- **`workflow-web/`** — UI: Vite + TypeScript + `bpmn-js`. Modeler + ops UI.
  Punto de entrada: [workflow-web/src/main.ts](workflow-web/src/main.ts).

Estado durable vive en Postgres. **No** hay event sourcing ni consenso —
diseño deliberadamente simple de un solo nodo (con `FOR UPDATE SKIP LOCKED`
para que sea seguro escalar a varios procesos en el futuro).

Para el detalle funcional usa siempre:
- [README.md](README.md) — cómo levantar el stack.
- [workflow-core/README.md](workflow-core/README.md) — API, BPMN soportado, FEEL, retries, esquema, límites conocidos.

---

## 2. Comandos que importan

Todos desde `workflow-core/` salvo que se indique lo contrario.

| Acción | Comando |
| --- | --- |
| Instalar deps engine | `cd workflow-core && npm install` |
| Instalar deps web | `cd workflow-web && npm install` |
| Postgres local | `docker compose up -d postgres` (desde `workflow-core/`) |
| Aplicar migraciones | `npm run migrate` |
| Dev engine (`:3000`) | `npm run dev` |
| Dev web (`:5173`) | `cd workflow-web && npm run dev` |
| Build engine | `npm run build` |
| Build web | `cd workflow-web && npm run build` |
| Typecheck (sin emitir) | `npm run typecheck` |
| Tests (one-shot) | `npm test` |
| Tests (watch) | `npm run test:watch` |

**Antes de marcar una tarea como hecha, corre como mínimo `npm run typecheck` y
`npm test` en `workflow-core/`** si tocaste backend. Si tocaste sólo
`workflow-web/`, basta con `npm run build` ahí (no hay suite de tests UI todavía).

---

## 3. Arquitectura — dónde mirar primero

### Engine (`workflow-core/src/engine/`)
- `engine.ts` — facade. Punto de entrada lógico; casi todo se compone aquí.
- `parser/` — `bpmn-moddle` + descriptor `zeebe:` custom.
- `execution/` — `executor`, `scheduler`, `handler-registry`. **El executor toma
  un lock por fila de instancia** (`lockInstance`) para serializar avances
  concurrentes — respétalo al añadir lógica de tokens.
- `expressions/` — evaluador FEEL-subset. Aislado tras `ExpressionEvaluator`
  para poder cambiar a FEEL real más adelante.
- `repository/` — un módulo Kysely por tabla. **Toda la I/O a Postgres pasa
  por aquí**; no metas SQL crudo en otras capas.
- `db/` — cliente, tipos generados, migrador.
- `variables/` — input/output mapping para tareas.
- `timer/` — parser ISO 8601 (`PT…`, `timeDate`).

### Server (`workflow-core/src/server/`)
- `app.ts` — construcción de la app Fastify (rutas + servido estático del bundle web).
- `routes/` — `definitions`, `instances`, `incidents`, `user-tasks`, `folders`, `projects`, `browse`, `health`.

### Web (`workflow-web/src/`)
- `main.ts` — bootstrap del modeler y la ops UI.
- `api.ts` — cliente HTTP. Toda llamada al engine vive aquí.
- `default-diagram.ts`, `types/`, `styles.css`.

### Persistencia
- Migraciones SQL en [workflow-core/migrations/](workflow-core/migrations) (`001_initial.sql`, `002_user_tasks.sql`, `003_projects.sql`).
  Numeradas y **append-only**: nunca edites una migración ya aplicada — añade una nueva.

---

## 4. Convenciones

- **TypeScript estricto.** Tipos explícitos en bordes públicos (API, repos,
  parser output). Internamente puedes apoyarte en inferencia.
- **Imports ordenados:** built-ins → libs externas → rutas internas relativas.
- **Errores:** lanza `Error` con mensaje accionable. En el server, las rutas
  Fastify mapean a códigos HTTP en `routes/`; no atrapes y traguen errores en
  capas inferiores.
- **Naming:** archivos en kebab-case (`handler-registry.ts`), tipos en
  PascalCase, funciones/variables en camelCase, constantes SQL en `snake_case`
  para coincidir con el esquema.
- **Comentarios:** sólo cuando el *por qué* no sea evidente — invariantes
  ocultas, workarounds, decisiones sutiles. Nada de comentarios que repitan
  lo que el código ya dice.
- **No introduzcas abstracciones por anticipado.** Tres líneas similares es
  mejor que un helper prematuro.

---

## 5. Tests

- Framework: **Vitest** ([workflow-core/vitest.config.ts](workflow-core/vitest.config.ts)).
- Los tests **usan Postgres real**, no mocks. Asegúrate de tener `docker compose up -d postgres`
  y `npm run migrate` antes de correr la suite.
- Cobertura actual en [workflow-core/tests/](workflow-core/tests): parser, expressions, execution, gateways, timers, incidents, user-tasks, restart-recovery, migration.
- **Si añades una feature, añade su test** en el archivo temático correspondiente
  (o crea uno nuevo si es un eje nuevo). El estilo es "happy path + 1–2 edge cases relevantes" — no busques cobertura completa por sí misma.
- Helpers compartidos: [workflow-core/tests/helpers/](workflow-core/tests/helpers).

No hay suite de tests para `workflow-web/` todavía. Verifica cambios de UI
levantando el dev server y probando en navegador (ver §7).

---

## 6. Guardrails — qué NO hacer

- **No edites migraciones ya aplicadas.** Crea una nueva (`004_…sql`).
- **No metas SQL crudo fuera de `repository/`.** Toda I/O DB pasa por un repo
  Kysely. Si necesitas una nueva consulta, añádela ahí.
- **No mockees Postgres en tests.** La paridad con producción es parte del
  contrato de la suite — ya nos quemó con la migración antes.
- **No bypasses hooks de git** (`--no-verify`, `--no-gpg-sign`) salvo
  petición explícita del usuario.
- **No hagas `git push`, `git reset --hard`, ni operaciones destructivas** sin
  confirmación. Tampoco abras/cierres PRs ni issues por tu cuenta.
- **No instales dependencias nuevas** sin avisar antes y justificar el porqué.
- **No agregues frameworks de logging/metrics/feature-flags** por iniciativa propia.
- **No "limpies" código aledaño** mientras arreglas un bug. Cambios quirúrgicos.
- **No crees archivos `.md` nuevos** (READMEs, docs de plan, notas) salvo que
  el usuario lo pida.

---

## 7. Verificación antes de cerrar una tarea

| Tipo de cambio | Verificación mínima |
| --- | --- |
| Engine / parser / ejecutor | `npm run typecheck` + `npm test` en `workflow-core/`. Tests relevantes verdes. |
| API REST | Lo anterior + smoke manual con `curl` (ver §6 del [README](README.md#6-smoke-test-5-commands)). |
| Migración SQL | `npm run migrate` aplica limpio en una DB recién levantada + test de `migration.test.ts` cubre el cambio. |
| UI (workflow-web) | `npm run build` sin errores + `npm run dev` y probar el flujo en navegador (`http://localhost:5173/modeler/`). Reporta qué probaste. |
| Refactor sin cambio funcional | Typecheck + suite completa verdes. |

Si no pudiste verificar algo (p. ej. cambio en un handler externo), **dilo
explícitamente** en el mensaje final en vez de afirmar que funciona.

---

## 8. Ritmo de sesión (obligatorio)

**Al inicio de cada sesión no trivial:**
1. Usa `TaskCreate` para anotar el plan de la sesión como lista de tareas.
   Granularidad: una tarea por unidad verificable (no "implementar feature",
   sí "añadir parser para `timeCycle`" + "test de cycle timer" + "exponer en API").
   Marca `in_progress` al empezar, `completed` al terminar — una a la vez.
2. Si hay ambigüedad sustantiva (ej. "qué hacer cuando el timer compite con un
   job"), pregunta antes de implementar.
3. Para cambios > ~3 archivos o que tocan varias capas, esboza el plan en
   1–3 frases antes de tocar código.

**Durante la sesión:**
- Cambios pequeños y reversibles primero (`Edit`/`Read`).
- Commits sólo cuando el usuario lo pida explícitamente.
- Actualiza el estado de las tareas en tiempo real.

**Al cerrar la sesión (siempre que se haya tocado algo sustantivo):**
1. Añade una entrada nueva en [PROGRESS.md](PROGRESS.md) usando la plantilla
   al final del archivo. Va **arriba del todo** en la sección "Sesiones".
2. Refresca "Estado actual" y "Pendientes inmediatos" de la cabecera para
   reflejar lo que dejaste a medias.
3. Resumen al usuario en una o dos frases — qué cambió y qué quedó pendiente.
   Sin resúmenes largos del diff.

Si la sesión fue trivial (preguntas, lecturas, un typo), **no** crees tareas
ni actualices `PROGRESS.md`. Usa juicio: si tras la sesión alguien preguntara
"¿qué pasó hoy?", ¿la respuesta merece quedar registrada?

---

## 9. Decisiones de diseño asumidas (no las revivas sin discutir)

Estos puntos están deliberadamente así. No los cambies sin acordarlo:

- **Un solo nodo, sin consenso.** Multi-nodo es por advisory locks + `SKIP LOCKED`, no Raft/etc.
- **FEEL subset propio**, no FEEL completo. Está aislado tras una interfaz.
- **Polling scheduler** (`JOB_POLL_INTERVAL_MS`), no LISTEN/NOTIFY.
- **Retries con backoff exponencial** + incident al agotarse. Resolver un
  incident **resetea retries al total** (no incremental — está documentado).
- **Sin boundary timer events todavía.** Si te piden uno, avisa que es una fase
  aparte (race timer/job no trivial).
- **Cache de definiciones sin cota.** Acotarla es trabajo de Phase 5.

Los límites honestos están en [workflow-core/README.md](workflow-core/README.md#honest-limits-today). Consúltalos antes de proponer arreglos a "bugs" que en realidad son límites conocidos.
