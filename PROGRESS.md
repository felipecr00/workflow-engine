# PROGRESS.md — Bitácora de progreso

Registro acumulativo de sesiones de trabajo. **Más reciente primero.**

> Cómo usar este archivo (resumen):
> - **Al inicio** de cada sesión no trivial, Claude usa `TaskCreate` para
>   planear y trackear el trabajo de la sesión.
> - **Al final** de la sesión, Claude añade una entrada nueva arriba del todo
>   (debajo de "Estado actual" / "Pendientes inmediatos") usando la plantilla
>   de abajo, y refresca esas dos secciones de cabecera.
> - Reglas completas en [CLAUDE.md](CLAUDE.md) §8 *Ritmo de sesión*.

---

## Estado actual

**Sprint 3 de cobertura BPMN** cerrado en rama `feat/bpmn-coverage-sprint-3`
(no pusheada). El parser ahora acepta 5 nuevos elementos BPMN sin cambios
estructurales en el schema: **Terminate End Event**, **Error End Event**,
**Manual Task**, **Send Task** e **Intermediate Throw Event (None)**.
- Parser: EndEvent pasa a tener un discriminador interno `endEventKind`
  (none/terminate/error). ManualTask y SendTask reusan tablas existentes
  (`user_tasks` y `jobs`) — distinguidas por `element_type` y por audit
  metadata.
- Executor: nuevos handlers `terminateInstance`, `raiseErrorEnd`,
  `enterManualTask`, `enterSendTask` y `stepIntermediateThrow`.
  `completeServiceTask` y `completeUserTaskAction` aceptan los nuevos
  tipos en sus guards.
- Migraciones 006/007/008 (un archivo por `ALTER TYPE ADD VALUE`):
  `token_state.cancelled`, `job_state.cancelled`,
  `incident_type.error_end_event`.
- Audit: 5 tipos nuevos (`JOB_CANCELLED`, `THROW_EVENT_NONE`,
  `MANUAL_TASK_CREATED`, `MANUAL_TASK_COMPLETED`, `SEND_TASK_JOB_CREATED`)
  + reuso de `INSTANCE_TERMINATED` (ya existía en el enum). Token cancelado
  por Terminate emite `TOKEN_COMPLETED` con `metadata.cancelledBy`.

**Migración React** de `workflow-web` mergeada en `main` (PR #3).

### Engine (`workflow-core/`)
- 5 nuevos elementos BPMN soportados (ver arriba).
- Suite: **91 verdes** + flakies pre-existentes inalterados (gateways
  parallel join, restart-recovery pending job, incidents retry backoff).

## Pendientes inmediatos

- [ ] Review y aprobación de la rama `feat/bpmn-coverage-sprint-3`
      para push/merge.
- [ ] **Sprint 4**: Subprocess (embedded) y CallActivity.
- [ ] Sprint 5: Message events / Receive Task.
- [ ] Sprint 6: Boundary events (timer/error/message) + propagación
      de Error End a boundary error catch.

## Tests flakies conocidos (pre-existentes)

- `tests/gateways.test.ts > parallel join (batchSize=1, multi-tick)` y
  `tests/restart-recovery.test.ts > pending job after restart` fallan
  esporádicamente por timing del scheduler. No tocan `userTask`, no
  fueron introducidos por este Sprint, y pasan al correr aislados.

---

## Sesiones

### 2026-06-09 — Sprint 3 BPMN coverage (Terminate / Error / Manual / Send / Throw)

**Objetivo:** subir la cobertura BPMN agregando 5 elementos que hoy hacen
fallar el deploy con `ParseError("Unsupported BPMN element ...")`,
sin tocar el schema base.

**Hecho:**
- Tipos: `EndEventKind` discriminador (`none|terminate|error`),
  `ManualTaskElement`, `SendTaskElement`, `IntermediateThrowEventElement`
  + unions en
  [parser/types.ts](workflow-core/src/engine/parser/types.ts).
- Parser: `SUPPORTED_TYPES` ampliado, lookup `errorById` desde
  `rootElements`, `readEndEventKind` con rechazos explícitos
  (múltiples definitions, errorRef ausente, tipo no soportado),
  rechazo de `IntermediateThrowEvent` con cualquier eventDefinition,
  validación estructural para sendTask/manualTask/throw
  ([parser.ts](workflow-core/src/engine/parser/parser.ts)).
- Migraciones (3 archivos, uno por `ALTER TYPE ADD VALUE`):
  [006_token_state_cancelled.sql](workflow-core/migrations/006_token_state_cancelled.sql),
  [007_job_state_cancelled.sql](workflow-core/migrations/007_job_state_cancelled.sql),
  [008_incident_type_error_end_event.sql](workflow-core/migrations/008_incident_type_error_end_event.sql).
  `instance_state.terminated`, `timer_state.cancelled` y
  `user_task_state.cancelled` ya existían — sólo se agregó lo faltante.
- Repository helpers de cancelación bulk:
  `cancelAllLiveTokensForInstance`
  ([tokens.ts](workflow-core/src/engine/repository/tokens.ts)),
  `cancelAllOpenJobsForInstance`
  ([jobs.ts](workflow-core/src/engine/repository/jobs.ts)),
  `cancelAllPendingTimersForInstance`
  ([timers.ts](workflow-core/src/engine/repository/timers.ts)),
  `cancelAllOpenUserTasksForInstance`
  ([user-tasks.ts](workflow-core/src/engine/repository/user-tasks.ts)),
  `markInstanceTerminated`
  ([instances.ts](workflow-core/src/engine/repository/instances.ts)).
- Executor: nuevo `stepEndEvent` con switch interno (`none` reutiliza
  el path existente, `terminate` cancela bulk + audit, `error` crea
  incident `error_end_event`); `enterSendTask` y `enterManualTask`;
  `stepIntermediateThrow` (pass-through con audit `THROW_EVENT_NONE`);
  `completeServiceTask` y `completeUserTaskAction` aceptan los
  nuevos tipos
  ([executor.ts](workflow-core/src/engine/execution/executor.ts)).
- `engine.deploy` valida handlers para SendTask igual que ServiceTask
  ([engine.ts](workflow-core/src/engine/engine.ts)).
- Tests nuevos: 10 nuevos parser tests
  ([parser.test.ts](workflow-core/tests/parser.test.ts)),
  [terminate-end.test.ts](workflow-core/tests/terminate-end.test.ts) (3),
  [error-end.test.ts](workflow-core/tests/error-end.test.ts) (2),
  [manual-task.test.ts](workflow-core/tests/manual-task.test.ts) (3),
  +2 tests en
  [execution.test.ts](workflow-core/tests/execution.test.ts) (SendTask
  end-to-end, IntermediateThrowEvent None).

**Decisiones tomadas en sesión:**
- EndEvent **un solo tipo con discriminador interno** (`endEventKind`),
  no tres tipos separados — estructuralmente idénticos.
- ManualTask y SendTask son **tipos propios** (no variantes de
  UserTask/ServiceTask) pero **reusan storage** (`user_tasks`/`jobs`).
  Razón: distinción semántica en BPMN, pero lifecycle idéntico.
- ManualTask se completa por `POST /user-tasks/:id/complete` —
  sin ioMapping ni form.
- 3 migraciones separadas (una por `ALTER TYPE ADD VALUE`).
  Razón: aunque PG16 permite ejecución dentro de transacción si el
  valor no se usa en la misma, partir reduce blast radius si una falla.
- Audit: **tipos dedicados** para `MANUAL_TASK_CREATED/COMPLETED` y
  `SEND_TASK_JOB_CREATED` (queries más limpios). Para tokens cancelados
  por Terminate **se reusa** `TOKEN_COMPLETED` con
  `metadata.cancelledBy='terminate_end_event'` (evita proliferar tipos
  cuando el estado fila ya lo dice). `JOB_CANCELLED` y
  `THROW_EVENT_NONE` se agregaron porque no había equivalentes.
- Error End Event en este sprint **sólo crea incident**, no propaga a
  boundary catch (Sprint 6).
- SendTask reusa el handler mechanism por `jobType` — los workers no
  distinguen entre ServiceTask y SendTask.

**Smoke manual (curl, DB recién migrada):**
1. **Deploy MTT** (Manual → Throw → Terminate):
   `POST /definitions` → `201 {id, key:"smoke-mtt", version:1}`.
2. **Create instance** → `201 {state:"active"}`. `GET /user-tasks?instanceId=...`
   muestra 1 fila con `element_id="Step1"`, `assignee:null`,
   `form_key:null`, `candidate_groups:[]`.
3. **Complete manual task** con `{signedOff:true}` →
   `{ok:true}`. `GET /instances/:id` ahora muestra
   `state:"terminated"`, `variables:{signedOff:true}`,
   tokens `Start/Step1/Checkpoint:completed`, `TerminateEnd:cancelled`,
   audit chain
   `... MANUAL_TASK_CREATED → MANUAL_TASK_COMPLETED → TOKEN_COMPLETED →
   THROW_EVENT_NONE → TOKEN_COMPLETED → INSTANCE_TERMINATED`.
4. **Deploy Error End** (`smoke-error` con `bpmn:error` declarado
   a nivel root y `errorCode="VALIDATION_FAILED"`) → `201`.
5. **Create instance** → state queda `"active"`, token en `ErrEnd:incident`,
   incident `type:"error_end_event"` con mensaje
   `Error end event E raised: errorCode=VALIDATION_FAILED`, audit incluye
   `INCIDENT_CREATED`.

**Pendiente / bloqueos:**
- Rama sin mergear, sin push. Esperando OK del usuario para abrir PR.
- Sprint 4 (Subprocess + CallActivity) es el próximo.

**Próximos pasos sugeridos:**
- Mergear cuando confirmes el contenido de los commits.
- Sprint 4: empezar por Subprocess embedded (sub-tokens en el mismo
  proceso) — CallActivity requiere multi-process deployment, que
  hoy está bloqueado por la validación de un único `bpmn:Process`
  por deployment.

---

### 2026-06-09 — Migración React de workflow-web

**Objetivo:** Migrar `workflow-web` de vanilla TypeScript monolítico
(2304 líneas en `main.ts`) a React 18 + React Router 6 + TanStack Query 5.
Refactor puro de arquitectura — sin cambios funcionales ni visuales.

**Hecho:**
- Instalación de deps: `react`, `react-dom`, `react-router-dom`,
  `@tanstack/react-query`, `@vitejs/plugin-react@4`, `@types/react`,
  `@types/react-dom`.
- Configuración: `vite.config.ts` con plugin React +
  `jsxImportSource: 'react'` (coexistencia con preact de form-js),
  `tsconfig.json` actualizado, `index.html` reducido a `<div id="root">`.
- 7 pages: `HomePage`, `ModelerPage`, `InstancesPage`,
  `InstanceDetailPage`, `TasksPage` (+ 5 sub-componentes en `tasks/`),
  `FormsListPage`, `FormEditorPage`, `IncidentsPage`.
- 4 hooks imperativos: `useBpmnModeler`, `useBpmnViewer`,
  `useFormEditor`, `usePersistedState`.
- 4 componentes compartidos: `Layout`, `StatusBar`, `Badge`, `Modal`.
- `utils.ts` con helpers extraídos (`fmtDate`, `truncate`, `cap`, etc.).
- Router con basename `/modeler`, redirect `/user-tasks` → `/tasks`.
- Fix en `api.ts`: añadidos `!res.ok` checks + `?? []` fallbacks en
  `listIncidents`, `listInstances`, `listDefinitions`, `listUserTasks`
  para compatibilidad con TanStack Query v5 (no permite `undefined`).
- Eliminado `main-legacy.ts`, eliminado componente `Placeholder`.

**Smoke visual (via Preview MCP, sin backend):**
1. **Home** (`/modeler/`) — Breadcrumbs "Home", botones New Folder +
   New Diagram, status bar "0 folder(s), 0 diagram(s)". ✓
2. **Instances** (`/modeler/instances`) — Dropdown "All states",
   Refresh, Start Instance, status bar "0 instance(s) loaded". ✓
3. **Tasklist** (`/modeler/tasks`) — Layout 3 columnas (sidebar con
   sort "Newest First" + Filters, center "Select a task", info panel
   "Task details will appear here"), status bar "0 task(s) loaded". ✓
4. **Forms** (`/modeler/forms`) — Refresh + New Form, empty state. ✓
5. **Form Editor** (`/modeler/forms/new`) — Palette izquierda con 22+
   componentes, canvas central, properties panel derecha, tabs
   Design/Preview/JSON, botones Export + Save & Deploy. ✓
6. **Incidents** (`/modeler/incidents`) — Refresh, empty state
   "No incidents found". ✓
7. **Navegación** — Todos los tabs del header funcionan,
   NavLink activo se subraya correctamente.
8. **Consola** — Cero errores en todas las vistas.

**No verificado (requiere backend corriendo):**
- Modeler con diagrama real (load/save/deploy BPMN).
- Instance Detail con tokens y overlays.
- Tasks con form-js viewer y complete flow.
- Forms deploy end-to-end.

**Build:** `vite build` limpio (warnings esperados de chunk size).

---

### 2026-06-08 — Sprint 2 Forms Editor (vista list + editor visual)

**Objetivo:** dar al usuario una pantalla para crear, editar y
deployar forms-js visualmente, equivalente a la de Camunda Forms.

**Hecho:**
- HTML: tab "Forms" + vistas `#view-forms` (lista) y
  `#view-form-editor` (toolbar 3 grupos + tabs Design/Preview/JSON +
  panels) en [index.html](workflow-web/index.html).
- CSS: import de `form-js-editor.css`, estilos para `.form-editor-tabs`,
  `.form-editor-panel`, `.form-json-editor`, `.forms-row-key`,
  `.form-editor-dirty`; `#forms-toolbar` y `#form-editor-toolbar`
  enchufados al selector compartido de toolbars
  ([styles.css](workflow-web/src/styles.css),
  [main.ts:14](workflow-web/src/main.ts:14)).
- Cliente API: [api.ts](workflow-web/src/api.ts) gana `FormInfo`,
  `FormDetail`, `listForms`, `getForm`, `deployForm`, y
  `UnsupportedFormFieldClientError` que mapea el 400 del backend.
- Router: nuevo `view: 'form-editor'` + `formKey`,
  rutas `/modeler/forms` / `/modeler/forms/new` /
  `/modeler/forms/:key`, con tab "Forms" highlighted incluso en el
  editor. `applyRoute` destruye el `FormEditor` al salir.
- Vista lista: `refreshForms` lista forms (key, version, format,
  deployed_at, Edit), botón "New Form" y "Create your first form" en
  el empty state.
- Vista editor: `openFormEditor(key|null)` carga
  `findLatestFormByKey` o un schema vacío default, monta
  `new FormEditor({ container })` vía import dinámico,
  importSchema, listener `changed` que marca el dirty `●`. El
  `teardownFormEditor` limpia editor + Viewer + textarea entre
  rutas.
- Tabs Design / Preview / JSON: cambio sincroniza con
  `editor.saveSchema()`; Preview crea un `Form` Viewer en
  `#form-editor-preview-host`; JSON pinta el schema serializado en
  un textarea read-only.
- Save: `btn-form-save` pide `prompt` el key si es nuevo, deploya
  con `api.deployForm`, refresca la URL canónica
  `/modeler/forms/:key`, limpia el dirty marker, status muestra
  la versión. Export descarga el JSON.
- **Bug-fix Vite (sin esto el editor no renderizaba)**: dedupe
  de `preact`, `preact/hooks` y `preact/jsx-runtime` en
  [vite.config.ts](workflow-web/vite.config.ts). `form-js-editor`
  pina `preact &lt;= 10.15.1`, el root tiene 10.29.2; sin dedupe Vite
  optimizaba dos preacts y los hooks del FormEditor escribían contra
  un registry distinto del que leía su renderer → canvas vacío y
  `PropertiesPanelRenderer.attachTo` tropezaba con ref null.

**Smoke manual (via Preview MCP):**
1. `/modeler/forms` → lista vacía con CTA "Create your first form".
2. New Form → editor con 22 paletas, canvas vacío, properties
   panel y los 3 tabs.
3. Importé un schema con 4 componentes (textfield+select+number+
   checkbox) — los 4 aparecen en Design y el dirty marker `●`
   se prende.
4. Tab Preview → 4 inputs renderizados por el Viewer.
5. Tab JSON → schema serializado, read-only, 886 chars.
6. Save &amp; Deploy con key `intake-request-form` →
   `v1` deployado, status "Deployed v1", URL pasa a
   `/modeler/forms/intake-request-form`, dirty limpio.
7. Volver a la lista → aparece el form.
8. Click en el key → editor reabre con el form cargado.
9. Modifico (añado un textarea `notes`), Save → `v2`.
10. Intento Save con `{type: 'table'}` (no soportado por backend) →
    status `Unsupported form-js field "rows" (type "table"). Remove
    or replace this component before saving.` Esperado.
11. Export → descarga un JSON de 999 bytes con el schema actual.
12. Deploy un BPMN con userTask `formKey="intake-request-form"`
    via curl, instancia creada → `user_tasks.form_version = 2`,
    `GET /user-tasks/:id` devuelve el form embebido con 5
    componentes.
13. Navegar a `/modeler/tasks/:id` → Viewer renderiza 5 inputs con
    label "intake-request-form v2". Loop end-to-end cerrado.

**Decisiones tomadas en sesión:**
- Dedupe de preact en lugar de cambiar versiones de form-js o
  reescribir el árbol de deps. Razón: invasivo mínimo, no toca
  package.json del root, y form-js-viewer/editor son ambos
  compatibles con preact 10.29.2 en runtime.
- Tab JSON read-only en Sprint 1 del editor. Parsear el JSON
  editado de vuelta al editor requiere validación contra
  `schemaVersion`/imports y otro round-trip; queda para polish.
- Integración con properties panel del BPMN modeler ("Open Form"
  button junto al campo formKey) queda **fuera de scope** —
  el plan la marcaba como opcional/nice-to-have. El usuario
  puede navegar manualmente desde la tab Forms.

**Pendiente / bloqueos:**
- Endpoint `DELETE /forms/:key` no existe en backend; la columna
  Actions sólo expone Edit por ahora.
- Errores inline del Viewer (Sprint 1) siguen mostrando IDs
  internos `Field_xxx` en lugar del key.

**Próximos pasos sugeridos:**
- Sprint 3: button "Open Form" en el properties panel del bpmn-js
  modeler para saltar entre BPMN y form editor.
- Polish: JSON editable con parse-back, Delete endpoint,
  display de errores mejorado.

---

### 2026-06-08 — Sprint 1 Forms (backend + frontend + smoke)

**Objetivo:** dar al engine soporte end-to-end de forms vía
`@bpmn-io/form-js`: storage versionado, parser `zeebe:formDefinition`,
snapshot en task creation, validación server-side, render en la UI.

**Hecho:**
- Migración [005_forms.sql](workflow-core/migrations/005_forms.sql)
  (tabla `forms` + columnas en `user_tasks`).
- Parser/types: `zeebe:FormDefinition` + `UserTaskElement.formKey`
  (acepta `formId` como alias).
  ([zeebe-descriptor.ts](workflow-core/src/engine/parser/zeebe-descriptor.ts),
  [parser.ts](workflow-core/src/engine/parser/parser.ts),
  [types.ts](workflow-core/src/engine/parser/types.ts)).
- Repositorio nuevo
  [repository/forms.ts](workflow-core/src/engine/repository/forms.ts):
  deploy idempotente, versionado auto, lookups, `listForms` latest-per-key.
- Executor `enterUserTask` resuelve y snapshotea form, o crea incident.
  ([executor.ts:189](workflow-core/src/engine/execution/executor.ts:189)).
- Engine facade: `deployForm`, `listForms`, `getLatestForm`,
  `getFormByVersion`, `getUserTaskDetail`, `completeUserTask` valida
  contra snapshot.
  ([engine.ts](workflow-core/src/engine/engine.ts)).
- Derivador + validador AJV
  [forms/validator.ts](workflow-core/src/engine/forms/validator.ts).
- Routes
  [routes/forms.ts](workflow-core/src/server/routes/forms.ts) +
  `GET /user-tasks/:id` y mapeo de `FormValidationError → 400` en
  [routes/user-tasks.ts](workflow-core/src/server/routes/user-tasks.ts).
- Frontend: `@bpmn-io/form-js` instalado y wired en
  [main.ts:renderFormJsForm](workflow-web/src/main.ts);
  [api.ts](workflow-web/src/api.ts) expone `getUserTaskDetail` y
  `CompleteValidationError`; estilos mínimos en
  [styles.css](workflow-web/src/styles.css); proxy `/forms` en
  [vite.config.ts](workflow-web/vite.config.ts).
- Tests nuevos: parser (3), `forms.test.ts` (8), user-tasks con
  forms (8). Suite: 72 verdes.
- Smoke manual: deploy form (con idempotencia y rechazo de
  `dynamiclist`/`group`), deploy BPMN con `formKey`, instancia
  creada → fila `user_tasks` con `form_key`/`form_version`,
  `GET /user-tasks/:id` devuelve form embebido,
  `complete` con payload inválido → `400 validation_failed`,
  payload válido → `200` e instancia `completed`. Browser
  (vía preview MCP): form-js Viewer renderizado con label
  "APPROVAL-FORM V1", validación inline al submit vacío,
  submit con datos válidos → instancia `completed` con
  variables `{ approved, comment, amount, requestId }`.

**Decisiones tomadas en sesión:**
- Validación server-side por **AJV** (derivador form-js → JSON Schema),
  no jsdom + form-js Viewer headless. Razón: server limpio sin DOM,
  sin riesgo de race entre requests, costo de mantenimiento bajo
  para el subset Sprint 1.
- Forms con tipos no soportados (`group`, `dynamiclist`, conditional/
  computed) **se rechazan con 400 al deploy** (fail fast), no se
  aceptan con validación skipeada.

**Pendiente / bloqueos:**
- Mejorar el display de errores de form-js en el frontend: hoy
  se muestran los IDs internos (`Field_xxx`) en vez del `key` semántico.
  Fix simple en Sprint 2.
- Rama sin mergear, sin push. Esperando OK del usuario para abrir PR.

**Próximos pasos sugeridos:**
- Mergear cuando el usuario confirme.
- Encolar Sprint 2: `/modeler/forms` standalone con CRUD y editor.

**Commits en la rama (no mergeada):**
- `483767e` feat(forms): storage, parser detection and task-time resolution
- `aec80cc` feat(forms): REST API, AJV validation and user-task form snapshot
- `953512e` feat(forms-web): render form-js Viewer in the user-task detail

---

### 2026-06-08 — Operating contract inicial

**Objetivo:** dejar a Claude Code con un contrato de trabajo claro sobre este repo.

**Hecho:**
- Creado [CLAUDE.md](CLAUDE.md) con: resumen del repo, comandos, mapa de
  arquitectura, convenciones, guardrails, verificación por tipo de cambio,
  flujo de sesión y decisiones de diseño asumidas.
- Creado [PROGRESS.md](PROGRESS.md) (este archivo) con el formato de bitácora.
- Añadida la regla "TaskCreate al inicio + actualizar PROGRESS.md al final" al
  CLAUDE.md.

**Pendiente / bloqueos:**
- Ninguno.

**Próximos pasos sugeridos:**
- Decidir si queremos `CLAUDE.md` por paquete (`workflow-core/`, `workflow-web/`)
  cuando las reglas diverjan.
- Considerar un pre-commit hook que recuerde actualizar `PROGRESS.md` si hay
  cambios sustantivos sin entrada nueva.

---

<!--
Plantilla para nuevas entradas (copia y pega arriba):

### YYYY-MM-DD — Título corto

**Objetivo:** una frase.

**Hecho:**
- bullet con archivo:linea cuando aplique.

**Pendiente / bloqueos:**
- qué quedó a medias y por qué.

**Próximos pasos sugeridos:**
- qué tomar primero en la próxima sesión.
-->
