# Workflow Engine

A single-node, Postgres-backed workflow engine inspired by Camunda Zeebe,
deliberately simplified (no event sourcing, no consensus). This repository
implements **Phases 1–2**.

## What works today

**Phase 1 — executable core** (already shipped)
- BPMN parsing via `bpmn-moddle` with a custom `zeebe:` extension descriptor.
- Token-based execution; durable state in Postgres.
- In-process handler registry (`engine.registerHandler(type, fn)`).
- Restart recovery (definitions re-hydrated from DB, stale `active` jobs reclaimed).
- REST API: `POST /definitions`, `POST /instances`, `GET /instances/:id`.

**Phase 2 — scheduling, gateways, retries, incidents**
- Polling scheduler that also fires due timers in each tick.
- Intermediate timer catch events (ISO 8601 `timeDuration` and `timeDate`).
- Exclusive (XOR) gateway with `conditionExpression` flows and `default` fallback.
- Parallel (AND) gateway: split (one in → N out) and join (N in → one out)
  with arrival-based completion logic.
- Custom FEEL-subset expression evaluator (literals, paths, `== != < <= > >= ! && ||`,
  string concat, numeric add/sub, parens).
- Service-task retries with exponential backoff; per-task `retries` attribute.
- Incidents created when retries are exhausted; REST API to list and resolve them.
- Instance-row lock during token advancement to safely serialize concurrent
  job completions within a single instance (parallel-gateway joins).
- Full audit vocabulary including `TIMER_CREATED`, `TIMER_FIRED`, `JOB_FAILED`,
  `JOB_RETRIES_EXHAUSTED`, `INCIDENT_CREATED`, `INCIDENT_RESOLVED`.

## Deferred to later phases

- Phase 3: instance migration between versions.
- Phase 4: embedded bpmn-js modeler + custom properties panel.
- Phase 5: token-overlay visualization, operations UI, escalation of stuck instances.
- Phase 6: user tasks.
- Boundary timer events (the timer/job race window is a meaningful design
  area; isolating it in its own change).
- Cycle timers (`R3/PT10M`).
- Message and signal events; subprocesses; multi-instance.

## Requirements

- Node.js ≥ 20
- PostgreSQL ≥ 14 (16 recommended) running locally — no Docker required.
  macOS: `brew install postgresql@16 && brew services start postgresql@16`.
  Linux: `sudo apt-get install -y postgresql && sudo systemctl enable --now postgresql`.

## Setup

```bash
npm install
npm run db:setup   # create the `workflow` role + database (idempotent)
npm run migrate    # apply SQL migrations
# shortcut: npm run setup  == db:setup + migrate
```

## Running the server

```bash
npm run dev        # tsx + watch
# or
npm run build && npm start
```

Listens on `:3000`; polls jobs and timers every 250 ms by default.

Environment variables:

- `DATABASE_URL` (default `postgres://workflow:workflow@localhost:5432/workflow`)
- `ADMIN_DATABASE_URL` (used only by `npm run db:setup`; defaults to your OS
  superuser on `localhost:5432/postgres`)
- `JOB_POLL_INTERVAL_MS` (default `250`)
- `JOB_BATCH_SIZE` (default `16`)
- `PORT` (default `3000`)

Programmatic-only options (see `EngineOptions`):
- `retryBaseDelayMs` (default `5000`) — initial retry delay
- `retryMaxDelayMs` (default `300000`) — cap on exponential backoff

## REST API

### Definitions
- `POST /definitions` — body `{ bpmnXml, name? }`; returns 201 with deploy result.

### Instances
- `POST /instances` — body `{ processKey, variables? }`; returns 201 with create result.
- `GET /instances/:id` — full snapshot: variables, tokens, jobs, timers,
  incidents, audit trail.

### Incidents (Phase 2)
- `GET /incidents` — list. Query params: `instanceId`, `activeOnly` (default true).
- `POST /incidents/:id/resolve` — body `{ resolvedBy? }`. Marks the incident
  resolved and, if it was a `job_retries_exhausted` incident, resets the job's
  retry counter and re-queues it. The instance can then complete normally.

### Health
- `GET /health`, `GET /ready`.

## BPMN elements supported

| Element | Notes |
|---|---|
| `bpmn:startEvent` | Exactly one outgoing flow. |
| `bpmn:endEvent` | When the last live token reaches end, instance completes. |
| `bpmn:serviceTask` | Requires `zeebe:taskDefinition`. Optional `zeebe:ioMapping`. |
| `bpmn:exclusiveGateway` | Conditions on outgoing flows; `default` attribute names the fallback flow id. |
| `bpmn:parallelGateway` | Split (1→N) or join (N→1). Cannot be both. |
| `bpmn:intermediateCatchEvent` + `bpmn:timerEventDefinition` | `bpmn:timeDuration` (ISO 8601 PT…) or `bpmn:timeDate` (ISO 8601 timestamp). |
| `bpmn:sequenceFlow` | `bpmn:conditionExpression` body honored on XOR outgoing flows. |

## `zeebe:` extensions supported

Under `http://camunda.org/schema/zeebe/1.0` (`zeebe:` prefix):

| Element | Where | Attributes |
|---|---|---|
| `zeebe:taskDefinition` | `serviceTask/extensionElements` | `type` (required), `retries` (default `"3"`) |
| `zeebe:ioMapping` | same | contains `zeebe:input` and `zeebe:output` |
| `zeebe:input` | inside `zeebe:ioMapping` | `source` (expression), `target` (key in job input) |
| `zeebe:output` | same | `source` (expression on `result` and/or `variables`), `target` (`variables.path`) |

## Expression language

All expressions start with `=`. Supported syntax:

- Literals: numbers, single- or double-quoted strings, `true`, `false`, `null`.
- Path lookups: `variables.foo.bar`. Bareword shorthand: `foo` resolves to `variables.foo`. In output mappings, `result.x` accesses the handler return value.
- Comparison: `==`, `!=`, `<`, `<=`, `>`, `>=`.
- Logical: `&&`, `||`, `!` (also `and`, `or`, `not`). Short-circuiting.
- Arithmetic: `+`, `-` on numbers; `+` for string concat.
- Parentheses for grouping.

Examples:
```
=variables.approved
=variables.amount > 100 && variables.status == "shipped"
=!variables.error
=(variables.subtotal + variables.tax) > 100
```

This is a small subset of Camunda's FEEL. The evaluator is isolated behind
the `ExpressionEvaluator` interface, so swapping in a real FEEL implementation
later is straightforward.

## Retry semantics

When a service-task handler throws:

1. `retries_remaining` is decremented.
2. If `retries_remaining > 0`, the job moves to state `failed` and is
   scheduled for retry at `now + min(retryMaxDelayMs, retryBaseDelayMs * 2^attempt)`.
3. If `retries_remaining == 0`, the job moves to state `incident`, the token
   moves to state `incident`, and an `incidents` row is created.

To recover from an incident, an operator typically:
1. Fixes the underlying issue (variables, environment, handler bug).
2. Calls `POST /incidents/:id/resolve` — this resets `retries_remaining = retries_total`,
   moves the job back to `pending`, moves the token back to `waiting`, and
   marks the incident `resolved`.
3. The scheduler picks the job up on its next tick and the process continues.

## Tests

```bash
npm run setup   # db:setup + migrate, if not already done
npm test
```

Coverage:
- `tests/parser.test.ts` — parsing, error cases.
- `tests/expressions.test.ts` — evaluator: literals, paths, comparisons, short-circuit, arithmetic, errors.
- `tests/execution.test.ts` — single + two-task happy paths, auto-versioning, retry-to-incident, runner auto-tick.
- `tests/gateways.test.ts` — XOR (first-match, default fallback, audit metadata), parallel split + join, batchSize=1 reveals the join waiting on the second branch.
- `tests/timers.test.ts` — ISO duration parser; intermediate timer wait → fire → resume.
- `tests/incidents.test.ts` — successful retry, retry exhaustion, listIncidents filters, resolve re-arms the job, backoff timing.
- `tests/restart-recovery.test.ts` — pending job survives restart, mid-process restart, stale `active` job reclaimed.

## Layout

```
src/
├── engine/
│   ├── engine.ts                 facade
│   ├── config.ts                 env-driven config
│   ├── parser/                   bpmn-moddle + zeebe descriptor + parser
│   ├── expressions/              tokenizer + parser + evaluator (FEEL subset)
│   ├── timer/                    ISO 8601 duration parser
│   ├── execution/                executor, scheduler, handler registry
│   ├── repository/               kysely repos per table
│   ├── variables/                input/output variable mapping
│   └── db/                       client, types, migrator
└── server/
    ├── app.ts                    Fastify app construction
    ├── index.ts                  entrypoint
    └── routes/                   definitions, instances, incidents, health

migrations/                       SQL migrations
examples/processes/               sample .bpmn
tests/                            vitest suite
```

## Honest limits (today)

- **No boundary timer events yet.** Service tasks cannot time out by way of a
  boundary timer; combine retries with `retryMaxDelayMs` as a coarse upper
  bound, or wait for the dedicated boundary-event phase.
- **No instance termination via API.** You can leave a process stuck with an
  incident, but you cannot administratively kill an active instance.
- **No interrupting cycles.** Cycle timers (`R3/PT10M`) are not parsed.
- **Single-process scheduler.** `FOR UPDATE SKIP LOCKED` makes the schema
  safe for multi-process operation, but no advisory-lock-based escalation
  detection is in place yet.
- **Definition cache is unbounded.** Old versions stay resident. Phase 5 will
  add bounded caching with refresh-from-DB on miss.
- **`listIncidents` has no pagination yet** — fine for hundreds, not for
  millions.
- **Resolving an incident always resets retries to the full count.** A more
  graduated model (e.g., "increment by 1, retry once") is straightforward to
  add but not implemented yet.
