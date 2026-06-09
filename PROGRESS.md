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

Sprint 1 de Forms **completo** en la rama `feat/forms-sprint-1`
(no mergeada a `main`). El engine sigue en Phase 1–2 más esta
capa de forms:

- Storage `forms` versionado por key con deploy idempotente
  (deep-equal del schema). Columna `format` (`form-js` | `json-schema`)
  + `tenant_id` con default `'default'` (sin enforcement multi-tenant).
- Parser reconoce `<zeebe:formDefinition formKey|formId="…"/>` en
  `bpmn:userTask`.
- En `enterUserTask` el executor resuelve `findLatestFormByKey` y
  hace snapshot de `form_key` + `form_version` en `user_tasks`. Si
  el key no resuelve, se crea un incident `unhandled_error` con
  mensaje accionable.
- REST: `POST /forms`, `GET /forms`, `GET /forms/:key`,
  `GET /forms/:key/versions/:version`, y nuevo `GET /user-tasks/:id`
  que devuelve el task con el form embebido.
- Validación server-side AJV vía un derivador form-js → JSON Schema
  (subset Sprint 1: textfield/textarea/number/checkbox/datetime/
  select/radio/taglist/checklist + validate.required/min/max/
  minLength/maxLength/pattern). Forms con tipos no soportados se
  rechazan con `400 unsupported_field_type` al deploy.
  `POST /user-tasks/:id/complete` valida contra el snapshot del
  form (no la última versión) y devuelve
  `400 validation_failed` con `details: [{path, message}]`.
- Frontend (`workflow-web`): si el task trae form, se monta un
  `@bpmn-io/form-js` Form dinámicamente, con el schema embebido y
  los `input_variables` como data inicial; el botón Complete usa
  `form.submit()` y muestra los errores inline. Sin form, se mantiene
  el fallback ad-hoc anterior.

Suite: 72 tests (3 nuevos en parser, 8 en `forms.test.ts`, 8 en
`user-tasks.test.ts` para el flujo con forms). Web build limpio.

## Pendientes inmediatos

- [ ] Esperar review/aprobación para mergear `feat/forms-sprint-1` a `main`.
- [ ] **Sprint 2** — Vista standalone `/modeler/forms` con CRUD +
      editor gráfico de form-js, y mejor display de errores
      (mapear `Field_xxx` → key).
- [ ] **Sprint 3** — Picker de form en el properties panel del userTask
      en el modeler bpmn-js.

## Tests flakies conocidos (pre-existentes)

- `tests/gateways.test.ts > parallel join (batchSize=1, multi-tick)` y
  `tests/restart-recovery.test.ts > pending job after restart` fallan
  esporádicamente por timing del scheduler. No tocan `userTask`, no
  fueron introducidos por este Sprint, y pasan al correr aislados.

---

## Sesiones

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
