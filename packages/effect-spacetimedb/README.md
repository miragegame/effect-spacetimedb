# effect-spacetimedb

Effect-native authoring and client wrappers for SpacetimeDB modules. The
authoring surface is a composable builder modeled on Effect's `HttpApi`:
**endpoints → groups → module → implement → build with the native
SpaceTimeDB CLI**.

```ts
import * as Stdb from "effect-spacetimedb"
import { build } from "effect-spacetimedb/server-compiler"
```

The library is namespace-first: prefer
`import * as Stdb from "effect-spacetimedb"` for the contract DSL and use
`Stdb.enum(...)` there. `enum` is a JavaScript reserved word and cannot be
named-imported, so use the namespace form or the named-import-safe `enumType`
alias.

Full documentation — getting started, core concepts, the Effect layer, and the
API reference — is at **https://effect-stdb.dev**.

## Installation

```sh
npm install effect-spacetimedb effect@4.0.0-beta.93 spacetimedb@2.6.1
```

`effect-spacetimedb` targets **Effect v4 (beta)** and **SpacetimeDB 2.6.x** as
required peer dependencies. Pin both explicitly. This repository locks the SDK
and CLI to exactly **2.6.1** for code generation and host compatibility; the
published peer range intentionally accepts compatible 2.6.x SDK patches.
This workspace also carries fixes for three published 2.6.1 SDK defects:
`Result.err` serialization, primitive `Prettify`, and native TableCache range
comparison. Bun applies those patches only inside this workspace; npm consumers
must carry equivalent fixes until upstream publishes them.
`@effect/atom-react` and `react` are
optional peers, needed only for the `effect-spacetimedb/client/atom` entrypoint.

The `effect-spacetimedb/server` and `/server-compiler` entrypoints are
**host-only**: they import `spacetimedb/server` and run inside the SpaceTimeDB
module host, not in app or client runtimes. The `/server-polyfills` side-effect
entrypoint is also host-only and remains available for standalone compatibility
shim loading.

## Quick start

The committed side-effect-free
[contract](../../examples/quickstart/src/contract.ts),
[server entry](../../examples/quickstart/src/index.ts), and
[client example](../../examples/quickstart/src/client.ts) are the source of
truth for this walkthrough. Repository checks typecheck all three and execute a
client-import smoke that cannot load the host-only compiler. Together they
declare a public table, implement a reducer and a read procedure, compile the
server module, call it over HTTP, and subscribe with a filtered native query.

```ts
import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"

export const MessageId = Schema.String.pipe(
  Schema.brand("EffectSpacetimeDbQuickstart/MessageId"),
)
export type MessageId = typeof MessageId.Type

export const MessageText = Schema.String.pipe(
  Schema.check(Schema.isMaxLength(280)),
)

export const message = Stdb.table("message", {
  public: true,
  columns: {
    id: Stdb.string(MessageId).primaryKey(),
    text: Stdb.string(MessageText),
  },
})

export const MessageRow = Stdb.struct({
  id: Stdb.string(MessageId),
  text: Stdb.string(MessageText),
}).named("MessageRow")

export const MessageFunctions = Stdb.StdbGroup.make("Messages").add(
  Stdb.StdbFn.reducer("messageSend", { params: MessageRow }),
  Stdb.StdbFn.procedure("messageList", {
    params: Stdb.struct({}),
    returns: Stdb.array(MessageRow),
  }),
)

export const QuickstartModule = Stdb.StdbModule.make(
  "effect_spacetimedb_quickstart",
  {},
)
  .addTables(message)
  .add(MessageFunctions)
```

The server entry imports that contract and performs the host-only build:

```ts
import * as Effect from "effect/Effect"
import * as Stdb from "effect-spacetimedb"
import { build } from "effect-spacetimedb/server-compiler"
import { QuickstartModule } from "./contract.ts"

const { Db, Tx } = QuickstartModule
const MessageFunctionsLive = Stdb.StdbBuilder.group(
  QuickstartModule,
  "Messages",
  {
    messageSend: Effect.fn(function* ({ id, text }) {
      const db = yield* Db
      yield* db.message.insert({ id, text })
    }),
    messageList: Effect.fn(function* () {
      const tx = yield* Tx
      return yield* tx.run(
        Effect.gen(function* () {
          const db = yield* Db
          return yield* db.message.toArray()
        }),
      )
    }),
  },
)

const compiled = build(QuickstartModule, [MessageFunctionsLive])
export const ModuleExports = compiled.exportGroup()
export default compiled.schema
```

Client code uses the same module spec:

```ts
import * as Stdb from "effect-spacetimedb"
import type * as StdbClient from "effect-spacetimedb/client"
import {
  type MessageId,
  QuickstartModule,
} from "./contract.ts"

const Quickstart = Stdb.project(QuickstartModule.spec)

const clientExample = (
  http: StdbClient.ProjectedHttpClient<typeof QuickstartModule.spec>,
  session: StdbClient.WsSession<typeof QuickstartModule.spec>,
  messageId: MessageId,
) => ({
  call: http.procedures.messageList({}),
  subscribe: session.subscribe(
    Quickstart.targets.tables.message.where((row) => row.id.eq(messageId)),
  ),
})
```

From `examples/quickstart`, run `bun run typecheck` and
`bun run smoke:client-import`; with the SpaceTimeDB CLI installed,
`bun run build` builds the server module.

## Builder Implementation Types

`StdbBuilder.group(...)`, `groupChecked(...)`, `groupPrechecked(...)`, and
`lifecycle(...)` return sealed `GroupImpl<Name, RuntimeR, ModuleName>` or
`LifecycleImpl<Hooks, RuntimeR, ModuleName>` values. These values intentionally
expose only the cheap build-time phantoms: group name, lifecycle hooks, runtime
requirements, module identity, and a runtime TypeId brand. The internal handler
definitions stay private to the builder pipeline, so consumers should pass impl
values directly to `build(...)` instead of reading implementation fields.

`AnyGroupImpl` and `AnyLifecycleImpl` were removed in `0.1.3`. Use the defaulted
`GroupImpl` and `LifecycleImpl` forms for broad annotations when an annotation
is unavoidable; the third module-name parameter defaults to `string`, so
existing two-argument annotations still compile but should not be used at
`build(...)` boundaries. Most modules should keep implementation arrays inferred
and readonly:

```ts
export const LiveGroups = [UsersLive, LifecycleLive] as const
export const compiled = build(Module, LiveGroups)
```

`groupPrechecked(...)` still returns `GroupImpl<Name, never>`, but the
`GroupCheckedHandlers<Module, Name>` annotation now proves that `never`: checked
handler records may use only the server-context services allowed for their
endpoint kind. Use `group(...)` for handlers that intentionally require custom
services, and pass a runtime layer to `build(...)`.

Run `bun run test` from this package to execute its colocated unit, integration,
and native-package safety tests. Live SpaceTimeDB tests are separate:
`bun run test:live`.

## Defaults, middleware, and reflection

Groups can declare one normalized error catalog for all members. Endpoint-level
errors are merged and deduplicated with the group default. Group middleware runs
inside each endpoint span before the handler body; use a per-kind record when
the reducer, procedure, and typed HTTP contexts differ.

```ts
const Errors = Stdb.errors(AuthError, NotFoundError)
const Users = Stdb.StdbGroup.make("Users", { errors: Errors }).add(
  Stdb.StdbFn.reducer("userUpsert", { params: UserRow }),
  Stdb.StdbFn.procedure("userGet", {
    params: UserIdParams,
    returns: Stdb.option(UserRow),
  }),
)

const UsersLive = Stdb.StdbBuilder.group(Module, "Users", handlers, {
  middleware: { reducers: requireSystemAuth },
})
```

`Stdb.reflect(module.spec, callbacks)` walks tables, reducers, procedures,
views, HTTP handlers, and lifecycle hooks with their authored group IDs. For
emit-safe module accessors, export one annotated bundle:

```ts
export const AppModuleExports: Stdb.ModuleExports<typeof Module> =
  Stdb.moduleExports(Module)
```

`Stdb.RowOf<typeof Module, "user">` provides a direct row lookup type.

## Indexed cache reads and live convergence

Public WebSocket cache tables expose native `count()`, unique/primary-key
`find(...)`, and btree `filter(...)` accessors. Inputs are encoded per indexed
column and only matching rows are decoded. SpacetimeDB 2.6.1 currently scans
inside these native accessors; this wrapper avoids decoding unrelated rows and
inherits future native index improvements automatically. Hash-indexed generated
clients are rejected with a typed artifact-shape error because the native cache
cannot construct them.

```ts
const count = session.cache.tables.user.count()
const user = yield* session.cache.tables.user.id.find(userId)
const recent = yield* session.cache.tables.audit.byOwnerTimestamp.filter([
  owner,
  new Range(
    { tag: "included", value: since },
    { tag: "unbounded" },
  ),
])

const [ready] = yield* session.waitUntil(
  "user",
  (row) => row.id === userId,
  { timeout: "5 seconds" },
)
```

Use `table.toArray()` for ordinary typed reads. `connectAndSubscribe(...)`
acquires a scoped session
and all requested targets in one Effect.

## Testing modules

`effect-spacetimedb/testing` exports `makeTestModuleHarness(module, { seed })`.
The harness owns one in-memory `DbShape`, runs it through the real Effect DB
wrapper, and supplies mutation, procedure, HTTP, sender-view, and anonymous-view
contexts. Transactions snapshot the shared store, roll back while preserving
original row identity, and reject nesting. Lifecycle handlers use
`makeMutationCtx()`; scheduled rows are stored without emulating the scheduler.

## Dev server

`effect-spacetimedb/dev-server` is a runtime orchestrator only. It starts a
local `spacetimedb-standalone`, waits for identity readiness, publishes a
prebuilt JavaScript bundle with `spacetime publish --js-path`, and returns
`{ baseUrl, databaseName, token }`. It does not build modules, generate clients,
transpile TypeScript, bundle code, or import generated clients.

Build and codegen stay in your normal build step:

```sh
spacetime build --module-path <dir>
spacetime generate --lang typescript --js-path <dir>/dist/bundle.js --out-dir <clientDir>
```

Import the generated client from `<clientDir>` in your app or test code, then
pass the exact prebuilt bundle to the dev server:

```ts
import { DbConnection } from "./module_bindings"
import { makeDevServer } from "effect-spacetimedb/dev-server"

const runtime = yield* makeDevServer({
  bundlePath: "<dir>/dist/bundle.js",
  dbNamePrefix: "my-module",
})

const builder = DbConnection.builder()
```

## Authoring at a glance

```ts
// 1. declare endpoints, group them
const Users = Stdb.StdbGroup.make("Users")
  .add(Stdb.StdbFn.reducer("user_upsert", { params: Stdb.struct({ userId: Stdb.string(UserId), name: Stdb.string(UserName) }) }))
  .add(Stdb.StdbFn.procedure("user_get", { params: Stdb.struct({ userId: Stdb.string(UserId) }), returns: Stdb.option(user.row) }))

// 2. declare tables once + assemble the module; destructure the typed accessors
const Module = Stdb.StdbModule.make("app", {}).addTables(user).add(Users)
const { Db, Tx } = Module

// 3. implement the group (record keys are endpoint names; handlers yield their deps)
const UsersLive = Stdb.StdbBuilder.group(Module, "Users", {
  user_upsert: (args) =>
    Effect.gen(function* () {
      const db = yield* Db
      yield* db.user.insert({ id: args.userId, name: args.name })
    }),
  user_get: (args) =>
    Effect.gen(function* () {
      const tx = yield* Tx
      return yield* tx.run(Effect.gen(function* () {
        const db = yield* Db
        return yield* db.user.id.find(args.userId)
      }))
    }),
})

// 4. build → native module export
export const compiled = build(Module, [UsersLive])
export const ModuleExports = compiled.exportGroup()
const moduleSchema = compiled.schema
export { moduleSchema as default }
```

## File layout (avoid import cycles)

Keep each group's **contract** and its **implementation** in separate files. The
typed accessors and `StdbBuilder.group(Module, …)` live on the assembled module,
so a single file that both defines a contract (imported by the module) and
implements it (imports the module) forms an eval-time cycle that throws on load.

```
tables/users.ts       variable-bound tables               imports schema only
schema.ts             shared value-types                  (leaf)
errors.ts             declared errors + HTTP schemas      (leaf)
<domain>/contract.ts  StdbGroup.make().add(StdbFn…)       imports schema + errors only
module.ts             StdbModule.make().addTables(…).add(…) exports the typed accessors
<domain>/live.ts      StdbBuilder.group(Module, …)        imports module (accessors + builder)
index.ts              build(Module, [..lives])            imports server-compiler
```

## Tables

Bind each table to a variable and pass its SpacetimeDB name once, as the first
argument. Use table-local builders for indexes/constraints so column names are
inferred:

```ts
export const user = Stdb.table("user", {
  public: true,
  columns: {
    id: Stdb.string(UserId).primaryKey(),
    name: Stdb.string(UserName),
  },
})

export const membership = Stdb.table("membership", {
  public: false,
  columns: {
    tenant_id: ShortString,
    email: ShortString,
  },
  indexes: (c) => [Stdb.index("membership_email_tenant_idx", [c.email, c.tenant_id])],
  constraints: (c) => [Stdb.unique("membership_tenant_email_unique", [c.tenant_id, c.email])],
})

// a scheduled table derives scheduled_id/scheduled_at and fires one typed target
export const reminder_schedule = Stdb.scheduledTable("reminder_schedule", {
  columns: {
    note: Stdb.string(),
  },
})

export const userTables = [user, membership, reminder_schedule] as const
```

Scheduled tables are private by default and reserve `scheduledId` /
`scheduledAt`. Declare the target with `StdbFn.scheduledReducer(...)` or
`StdbFn.scheduledProcedure(...)`; the handler receives `{ data: table.row }`.
Inside reducers/procedures, seed rows with `.schedule(...)`, which fills the
auto-increment sentinel:

```ts
export const Reminders = Stdb.StdbGroup.make("Reminders").add(
  Stdb.StdbFn.scheduledProcedure("reminder_fire", {
    table: reminder_schedule,
  }),
)

export const RemindersLive = Stdb.StdbBuilder.group(Module, "Reminders", {
  reminder_fire: Effect.fn(function* ({ data }) {
    void data.note
  }),
})

const scheduleReminder = Effect.fn(function* () {
  const db = yield* Db
  yield* db.reminder_schedule.schedule({
    scheduledAt: Stdb.ScheduleAt.interval("5 minutes"),
    note: "wake up",
  })
})
```

Scheduling lifecycle semantics are host-defined:

| Schedule form | Host behavior |
| --- | --- |
| `Stdb.ScheduleAt.at(...)` / `after(...)` (`Time`) | One-shot row. Reducers consume it after execution; procedures consume it before execution. Handler-side deletes are unnecessary. |
| `Stdb.ScheduleAt.interval(...)` (`Interval`) | Row persists and re-fires until deleted. |

Failed scheduled invocations are logged by SpacetimeDB and are not retried; catch
and insert a new schedule row inside the handler if retry is part of the domain
workflow. Schedule rows survive module republish, and deleting a schedule row
cancels future delivery. Scheduled calls run as the module's database identity
with a null connection id; effect-spacetimedb rejects other callers unless the
decl opts into `allowExternalCallers: true`. The host delay queue caps future
delivery at roughly 2.17 years.

For fixed wall-clock or tick alignment, prefer the self-rescheduling one-shot
pattern: handle a `Time` row, then insert the next `Time` row before returning.
Use `Interval` only when persistence with simple re-fire spacing is sufficient.

A branded domain type is a plain Effect schema — the single source of truth, e.g.
`const UserId = Schema.String.pipe(Schema.brand("App/UserId"))` — used directly in app
code (decode/encode, HTTP bodies) and wrapped with `Stdb.string(UserId)` inline at
STDB sites (struct fields, reducer/procedure params, view/procedure returns, and
`Stdb.error` fields). Generic non-branded SATS scalars are instead reusable
value-types — `const ShortString = Stdb.string(Schema.String.pipe(Schema.check(Schema.isMaxLength(255))))`
— used directly. Use `Stdb.custom(schema, { type })` when a custom Effect schema needs
explicit SpacetimeDB type lowering while preserving its own encode/decode behavior.

Tagged sums expose pure data constructors under `.make`, matching the exact
runtime `{ tag, value }` shape while keeping tags and payloads type-checked:

```ts
export const TurnEventContent = Stdb.sum({
  Prose: Stdb.struct({ text: Stdb.string() }),
  Done: Stdb.unit(),
})

const prose = TurnEventContent.make.Prose({ text: "hello" })
const done = TurnEventContent.make.Done

export const Phase = Stdb.enum("Lobby", "Running")
const lobby = Phase.make.Lobby
```

## Endpoints and groups

Endpoints are standalone declarations added to a group. A callable group may mix
reducers, procedures, and views (group by domain); HTTP routes use a separate
HTTP group.

```ts
export const Users = Stdb.StdbGroup.make("Users")
  .add(Stdb.StdbFn.reducer("user_upsert", { params: Stdb.struct({ userId: Stdb.string(UserId), name: Stdb.string(UserName) }) }))
  .add(Stdb.StdbFn.reducer("user_require", { params: Stdb.struct({ userId: Stdb.string(UserId) }), errors: AppErrors }))
  .add(Stdb.StdbFn.procedure("user_get", { params: Stdb.struct({ userId: Stdb.string(UserId) }), returns: Stdb.option(user.row), errors: AppErrors }))
  .add(Stdb.StdbFn.view("self_user", { returns: Stdb.option(user.row) }))          // sender view
  .add(Stdb.StdbFn.anonymousView("all_users", { returns: Stdb.array(user.row) }))  // anonymous view

// lifecycle hooks are fixed framework hooks; at most one of each per module
export const Lifecycle = {
  init: Stdb.StdbFn.init(),
  clientConnected: Stdb.StdbFn.clientConnected(),
  clientDisconnected: Stdb.StdbFn.clientDisconnected(),
}
```

## Module assembly and accessors

`StdbModule.make` takes the module name and optional settings. Add tables in
domain batches with `.addTables(...)`, then add groups. The assembled module
exposes the typed capability accessors — destructure them so handlers can
`yield* Db`:

```ts
export const Module = Stdb.StdbModule.make("app", {
  lifecycle: Lifecycle,
})
  .addTables(...userTables)
  .add(Users)
  .add(WebhookRoutes)

export const {
  Db,            // writable DB view (reducers, withTx bodies)
  ReadonlyDb,    // read-only DB view (views)
  From,          // query relations for views (e.g. `from.user`)
  Tx,            // procedure transaction runner — `tx.run(effect)`
  HttpTx,        // HTTP-handler transaction runner
  ReducerCtx,    // reducer/lifecycle request ctx
  ProcedureCtx,  // procedure request ctx
  ViewCtx,       // sender-view request ctx
  HttpHandlerCtx,// HTTP-handler ctx (no sender/identity)
  MutationCtx,   // shared mutation ctx — usable in reducers AND withTx bodies
} = Module

export const Example = Stdb.project(Module) // typed client projection
```

The accessors are typed against this module's tables (so `db.user.…` is typed)
and carry this module's identity in the Effect requirements channel. They are
global service tags under the hood, but the builder rejects yielding another
module's accessor inside a handler. The legacy `effect-spacetimedb/server`
`ServerInstance` section/single-handler validators remain module-blind for
compatibility, while transaction helpers keep branded residual runner
requirements for transaction-family coherence. Prefer module accessors with
`StdbBuilder` for new code.

## Implementing handlers

`StdbBuilder.group(Module, "GroupName", handlers)` takes a plain object whose
keys are the declared endpoint names. Raw HTTP routes use the same record form;
their handler receives a `Request` and returns a `SyncResponse`. Handlers pull
dependencies with `yield*`; the record must include every endpoint in the group.

```ts
const userIdFromSender = (ctx: { readonly sender: string }): UserId =>
  Schema.decodeSync(UserId)(ctx.sender)

export const UsersLive = Stdb.StdbBuilder.group(Module, "Users", {
  // reducer → writable Db
  user_upsert: (args) =>
    Effect.gen(function* () {
      const db = yield* Db
      yield* db.user.insert({ id: args.userId, name: args.name })
    }),
  user_require: (args) =>
    Effect.gen(function* () {
      const db = yield* Db
      yield* db.user.id.findOrFail(args.userId, (id) => new UserMissingError({ userId: id }))
    }),
  // procedure → Db only inside a transaction
  user_get: (args) =>
    Effect.gen(function* () {
      const tx = yield* Tx
      return yield* tx.run(Effect.gen(function* () {
        const db = yield* Db
        return yield* db.user.id.findOrFail(args.userId, (id) => new UserMissingError({ userId: id }))
      }))
    }),
  // sender view → read-only db + view ctx
  self_user: () =>
    Effect.gen(function* () {
      const ctx = yield* ViewCtx
      const db = yield* ReadonlyDb
      return (yield* db.user.id.find(userIdFromSender(ctx))) ?? undefined
    }),
  // anonymous view → read-only db (or a query relation via `From`)
  all_users: () =>
    Effect.gen(function* () { return yield* (yield* ReadonlyDb).user.toArray() }),
})

export const LifecycleLive = Stdb.StdbBuilder.lifecycle(Module, {
  init: () => Effect.void,
  clientConnected: () => Effect.void,
  clientDisconnected: () => Effect.void,
})
```

The native SpacetimeDB SDK may retry transaction bodies if commit fails, so keep
external side effects outside `tx.run(...)` bodies.

## Capability scoping

Each authoring scope may only `yield*` the accessors valid for it; anything else
is a compile error on that `.handle` line.

| Scope | Allowed `yield*` accessors |
|---|---|
| reducer, lifecycle | `Db`, `ReducerCtx`, `MutationCtx` |
| procedure (outside a tx) | `Http` (via the platform), `Tx`, `ProcedureCtx` |
| `Tx.run(...)` / `HttpTx.run(...)` body | `Db`, `ReducerCtx`-shape via `MutationCtx`, `TxCtx` |
| HTTP handler | `HttpTx`, `HttpHandlerCtx` |
| sender view | `ReadonlyDb`, `From`, `ViewCtx` |
| anonymous view | `ReadonlyDb`, `From`, `AnonymousViewCtx` |

`ReducerCtx`, `TxCtx`, and `MutationCtx` carry the same request metadata
(`sender`, `identity`, `timestamp`, `connectionId`, `senderAuth`, `random`, UUID
helpers). The difference is scope: `ReducerCtx` is reducer-only, `TxCtx` is
`Tx.run`-only, and **`MutationCtx` is valid in both** — use it in reusable helpers
that must run in a reducer and inside a transaction:

```ts
// works in a reducer body and inside a procedure's tx.run(...)
const replaceUser = (args: { userId: UserId; name: UserName }) =>
  Effect.gen(function* () {
    const db = yield* Db
    yield* db.user.id.delete(args.userId)
    yield* db.user.insert({ id: args.userId, name: args.name })
  })

const seedFromSender = (name: UserName) =>
  Effect.gen(function* () {
    const ctx = yield* MutationCtx
    yield* replaceUser({ userId: userIdFromSender(ctx), name })
  })
```

## Runtime model

Module code runs under SpaceTimeDB's strict contract — **synchronous,
run-to-completion, single-transaction, deterministic**. The headline constraints:

- **No async** — promises, timers, `queueMicrotask`, and `Effect.sleep` are rejected
  (`ReducerAsyncNotAllowedError`); keep handler bodies straight-line.
- **No `Math.random`** — use `Random.*` from `effect/Random` (wired to `ctx.random`); it is
  deterministic and **not** cryptographically secure.
- **No wall clock** — use `ctx.timestamp` / `Effect.Clock`, never `Date.now`.
- **Transactions** — reducers write `Db` directly; procedures/HTTP handlers must
  `tx.run(...)`; bodies may re-run on commit conflict, so keep them pure DB work.
- **Endpoint spans are automatic** — every handler is attributed to its endpoint
  key, including rendered failure frames; logs bridge to the host console.

The production module host has no task queue, so the host-only bootstrap installs
synchronous `setTimeout`/`setImmediate` drains when those globals are absent; Effect's
scheduler requires one of them during module evaluation. Dev-guarded handlers throw
on either timer instead. This deliberate bootstrap-only divergence does not make
user timers supported: handler code must remain synchronous in every mode.

For focused timing investigations, install `consoleTimerTracerLayer` from
`effect-spacetimedb/server`. It mirrors spans to `console.time`/`timeEnd`, which
the module host records in the database log. The layer is opt-in because it adds
two host syscalls per span; avoid leaving it enabled on reducer hot paths.

See [Runtime model and constraints](https://effect-stdb.dev/the-effect-layer/runtime-model)
for the full list, and
[Randomness and determinism](https://effect-stdb.dev/the-effect-layer/randomness-and-determinism)
for the randomness contract.

## HTTP routes

HTTP routes are server-to-server routes, not caller-authenticated reducers — the
HTTP handler context exposes `databaseIdentity`, `timestamp`, `http`, `random`,
UUID helpers, and transaction-scoped DB access, but **not** `sender`, caller
`identity`, or `connectionId`.

Declare routes in an `StdbHttpGroup` (with `.prefix`, and `.nest`/`.merge` to
compose). A **raw** route omits `request`/`response`; a **typed** route requires
both. Typed request, response, and declared-error bodies use Effect Schema JSON
codecs, so values like `bigint`, branded strings, and options must be
JSON-encodable through their schema. HTTP statuses for declared errors live on
the declared error definitions.

```ts
export const WebhookRoutes = Stdb.StdbHttpGroup.make("Webhooks")
  .prefix("/webhooks")
  .add(Stdb.StdbHttp.post("stripe_webhook", "/stripe"))                 // raw
  .merge(
    Stdb.StdbHttpGroup.make("ServerTokens").prefix("/server-tokens").add(
      Stdb.StdbHttp.post("rotate_token", "/rotate", {                   // typed
        request: RotateTokenInput,
        response: RotateTokenOutput,
        errors: AppErrors,
      })))
```

Implement raw routes as record keys whose handlers receive a `Request` and return
a `SyncResponse`; typed routes receive the decoded request and return the typed
response:

```ts
export const WebhookRoutesLive = Stdb.StdbBuilder.group(Module, "Webhooks", {
  stripe_webhook: (req) =>
    Effect.succeed(new Stdb.SyncResponse(req.text(), { status: 202 })),
  rotate_token: (args) =>
    Effect.gen(function* () {
      const tx = yield* HttpTx
      return yield* tx.run(Effect.gen(function* () {
        const db = yield* Db
        yield* db.user.id.findOrFail(args.userId, (id) => new UserMissingError({ userId: id }))
        return { token: "rotated" }
      }))
    }),
})
```

Use raw routes for GET/HEAD, query strings, custom auth headers, webhooks, and
non-JSON bodies. Keep external side effects outside HTTP transaction bodies too.
Unexpected HTTP handler failures remain bodyless 500 responses, but their full
cause and endpoint span are written to the database log. Request-decode 400s are
treated as client faults and are not error-logged.

## Build

`build(Module, impls)` from `effect-spacetimedb/server-compiler` checks at compile time that every declared
group is implemented exactly once, then produces the native module. If any
handler requires a custom service (anything beyond the built-in capabilities),
`build` requires a `runtime` that provides it — omitting it is a type error:

```ts
import { build } from "effect-spacetimedb/server-compiler"

export const compiled = build(Module, [UsersLive, LifecycleLive, WebhookRoutesLive])

// with custom services required by handlers:
const compiledWithRuntime = build(Module, [UsersLive], {
  runtime: Layer.succeed(MyService, myServiceImpl),
})

export const ModuleExports = compiled.exportGroup()
const moduleSchema = compiled.schema
export { moduleSchema as default }
```

## Declared errors

Declared errors are tagged errors with a namespace prefix that makes the tag
globally unique within the module — `Stdb.errors.namespace("App")(...)` generates
a class whose `_tag` is `App` + the key (e.g. `AppUserMissing`). The tag is what
crosses the wire and what clients decode by, so namespacing prevents
collisions across domains.

```ts
const AppErrors = Stdb.errors.namespace("App")({
  UserMissing: Stdb.error({ userId: Stdb.string(UserId) }, { status: 404 }),
})
```

The returned value is both the error definition (`.schema`, `.tags`, `.pick(...)`)
and the constructors. Attach it to a callable/route via `errors:`, and fail with
it directly. Declared errors are encoded on the wire with a versioned envelope, so
plain SpacetimeDB rejection strings are never mistaken for domain errors. Only
Effect failures are encoded as declared errors — defects (including
`Effect.die(new SomeError(...))`) stay defects.

```ts
return yield* new AppErrors.UserMissing({ userId })
```

Client calls fail with the declared tagged errors directly, so normal Effect
handling works:

```ts
yield* client.procedures.user_get({ userId }).pipe(
  Effect.catchTags({ AppUserMissing: () => Effect.succeed(undefined) }),
)
```

Use `.raw(...)` only when the caller needs remote rejection metadata:

```ts
yield* client.procedures.user_get.raw({ userId }).pipe(
  Effect.catchTag("DomainCallError", ({ error, remote }) =>
    Effect.logDebug("declared remote failure", remote).pipe(Effect.zipRight(Effect.fail(error)))),
)
```

## Client

`Stdb.project(Module)` yields a client-safe projection (no server runtime).
Provide a transport layer and call reducers/procedures/HTTP handlers:

Typed calls expose declared domain errors plus `RemoteRejectedError`,
`TransportError`, and `StdbDecodeError`. Reach for a callable's `.raw(...)`
variant only when the caller needs remote rejection metadata as well as the
decoded domain error.

```ts
const Example = Stdb.project(Module)

const HttpLive = Example.client.http.layer({ uri, databaseName, token })

const program = Effect.gen(function* () {
  const client = yield* Example.client.http.Tag
  yield* client.reducers.user_upsert({ userId, name })
  yield* client.httpHandlers.rotate_token({ userId })
}).pipe(Effect.provide(HttpLive))
```

### Group-scoped clients

HTTP clients also expose each authored `StdbGroup` / `StdbHttpGroup` as a
typed namespace. The flat call surface remains available, while group
namespaces prevent calls from accidentally crossing domain boundaries:

```ts
const client = Example.client.http.make({ uri, databaseName, token })

yield* client.Users.reducers.user_upsert({ userId, name })
yield* client.Webhooks.httpHandlers.rotate_token({ userId })

const users = Example.client.http.group("Users", {
  uri,
  databaseName,
  token,
})
yield* users.reducers.user_upsert({ userId, name })
```

Every grouped member is the same function object as its flat counterpart,
including `.raw`; grouping changes organization and inferred types, not wire
behavior. Group views are lazy and HTTP-only—WebSocket sessions retain their
flat reducer/procedure surface.

Group ids become JavaScript property keys. They must be valid identifiers and
must not collide with client/session framework keys such as `reducers`,
`subscribe`, or inherited object names such as `constructor`; module validation
rejects reserved ids.

Typed HTTP handlers are called with just the payload; `any`-method handlers take
an explicit method argument; raw handlers take the payload + request options:

```ts
yield* client.httpHandlers.rotate_token({ userId })
yield* client.httpHandlers.ping_any("patch", { value: "ok" })
yield* client.httpHandlers.stripe_webhook(payload, {
  contentType: "application/json",
  headers: { "stripe-signature": signature },
})
```

HTTP-handler calls decode status-matched declared-error envelopes into the
declared tagged error. Unknown or mismatched non-2xx responses fail with
`RemoteRejectedError`, whose `status` and `raw` fields preserve the response.

### Canonical Effect HttpApi client

Typed `post`, `put`, and `patch` HTTP routes can also be projected into a stock
Effect `HttpApi`. This lets callers use `HttpApiClient.make(...)` and its standard
endpoint/group composition instead of the bespoke `client.httpHandlers.*`
transport.

```ts
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as HttpApiClient from "effect/unstable/httpapi/HttpApiClient"

const api = Stdb.toHttpApi(Module)

const client = yield* HttpApiClient.make(api, {
  baseUrl: Stdb.httpApiBaseUrl({ uri, databaseName }),
  transformClient: HttpClient.mapRequest(HttpClientRequest.bearerToken(token)),
})

yield* client.Webhooks.rotate_token({ payload: { userId } })
```

`Stdb.toHttpApi(Module)` is pure and client-direction only; it does not
change the STDB server adapter or generated output. It preserves authored
`StdbHttpGroup` ids as `HttpApiClient` property keys. Group ids must be valid,
non-reserved JavaScript identifiers; module construction and validation reject
invalid or colliding ids.

The projection intentionally omits raw routes, typed `any` routes, and typed
`get`/`head`/`options`/`delete` routes. Raw routes have no schemas, `any` has no
canonical `HttpApiEndpoint` method, and no-body methods make `HttpApiClient`
encode payloads into the URL instead of the route body. Groups with no
projectable routes are omitted, so an HTTP-less module produces an empty
canonical client. Built modules always carry route-to-group projection metadata;
a malformed hand-authored spec with a projectable route missing that metadata
throws `StdbHttpProjectionError`.

The `httpGroups` field in `Module.spec` is projection-only metadata. Server
lowering and generated SATS/client output address module sections by explicit
field name and must not enumerate or serialize the whole spec object, so adding
projection metadata stays byte-identical for generated server artifacts.

### Scoped WebSocket sessions

```ts
import type { ErrorContext as ExampleErrorContext } from "./generated"

const WsLive = Example.client.ws.layerGenerated({
  DbConnection,
  uri,
  databaseName,
  token,
  connectTimeoutMillis: 10_000,
})

const program = Effect.gen(function* () {
  const session = yield* Example.client.ws.tag<ExampleErrorContext>()
  yield* session.reducers.user_upsert({ userId, name })

  yield* session.subscribe(Example.targets.allPublicTables())
}).pipe(Effect.provide(WsLive))
```

`client.ws.Session` is the `unknown`-context convenience tag. Generated layers
with a concrete error context should use `client.ws.tag<ErrorContext>()`; typed
tags share the same runtime key as `Session`, so do not mix mismatched
compile-time contexts for the same module/name pair.

`connectTimeoutMillis` is optional and has no library default. Set an
application-appropriate bound (10 seconds is a reasonable starting point) so a
native builder that never invokes a connect callback cannot strand acquisition.

Use named tags when a module needs multiple sessions in one environment
(`Example.client.ws.tag("main")` + `Example.client.ws.layerGenerated(..., { name: "main" })`).
Subscription handles are scoped native resources. Each `subscribe` call opens
one native SpacetimeDB subscription query set on the session connection, and the
handle is unsubscribed when its Effect scope closes or `handle.unsubscribe()` is
called. `allPublicTables()` remains a single native multi-query subscription.

Event-table streams use native delivery semantics: every live native query set
that covers an event can deliver that event. Subscribe once at an app state
boundary and fan out from the resulting stream when a domain needs one
event-processing path.

A native subscription rejection fails only the owning stream/ref/atom. Other and
future subscriptions on the same connection remain usable. `isInvalidated()` and
`observeInvalidation(...)` report connection-level death only, such as a native
disconnect; they do not report an individual query-set rejection.

Persistent-table change streams use a bounded callback queue by default
(`bufferSize: 1024`) and fail with `TableStreamOverflowError` rather than silently
losing deltas. Callers that intentionally use changes only as coalescible cache
signals can opt back into lossy `"sliding"` or `"dropping"` behavior. Snapshot
signal streams remain sliding. Event-table streams are raw event feeds and are
unbounded by default, so every queued event is retained unless the caller opts
into an explicit bounded buffer and accepts lossy overflow behavior:

```ts
yield* session.streamEventTable("presenceEvent", {
  buffer: { bufferSize: 4096, strategy: "dropping" },
}).pipe(Stream.runDrain)

yield* session.streamTable("message", {
  buffer: { bufferSize: 1024, strategy: "sliding" },
}).pipe(Stream.runDrain)
```

`streamRows(...)` and `tableGroup(keys).changes` emit their initial snapshot only
after the native subscription applies, then at most one snapshot per drained
callback batch. A synchronous dispatch burst therefore produces one
snapshot under normal native SDK pacing; if a consumer is behind, several bursts
may coalesce into one later snapshot. Each emission re-reads the authoritative
cache, so dropped queue signals converge to the current state rather than losing
snapshot data.

### Filtered subscriptions

Every public table target has a native `.where(...)` projection. Predicates
support scalar columns (`string`, number, `bigint`, `boolean`, `Identity`,
`ConnectionId`, and `Timestamp`) and the native comparison methods supported by
that column:

```ts
const activeMessages = Example.targets.tables.message.where((row) =>
  row.id.eq(messageId),
)

yield* session.subscribe(activeMessages)
```

The first filtered-query surface is intentionally narrow:

- optional columns are excluded until the native SDK exposes a sound optional
  comparison surface;
- comparisons between two columns are not exposed;
- native predicate `and`/`or` composition is not exposed; and
- bare boolean-column predicates are not exposed (use a comparison such as
  `.eq(true)`).

Each `.where(...)` callback therefore returns one scalar column-to-literal
comparison. A filtered subscription also restricts what the native client cache
contains: reads from `session.cache.tables.message` see only rows delivered by
the active query sets, not an authoritative copy of the complete server table.
Use private tables with procedures or views when the server must enforce access
policy.

### React and Atom

Install the optional peers before using the atom entrypoint:

```sh
npm install @effect/atom-react react
```

`tableGroupSnapshotAtom` accepts a connection atom and opens exactly one scoped
table-group subscription while the derived atom is observed. Equal connection
atoms and table-key arrays return the same memoized atom.

```tsx
import * as AtomReact from "@effect/atom-react"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import { tableGroupSnapshotAtom } from "effect-spacetimedb/client/atom"

const messages = tableGroupSnapshotAtom(connectionAtom, ["message"] as const)

function Messages() {
  const result = AtomReact.useAtomValue(messages)
  if (!AsyncResult.isSuccess(result)) return null
  return result.value.message.map((row) => <p key={row.id}>{row.text}</p>)
}
```

This is the implicit subscription model: React observation owns acquisition
and cleanup, preserves the previous successful snapshot while a replacement
connection is waiting, and surfaces both connection and subscription failures.
For non-React runtimes or when subscription lifetime is controlled elsewhere,
use the explicit model (`session.subscribe(...)` or
`session.tableGroup(keys).subscribe`) and read the session cache yourself. Do
not combine both models for the same query unless two native subscriptions are
intentional. The same cache-semantics warning applies to atoms: filtered query
sets produce filtered caches.

## Safe DB reads

The server DB views keep host and decode failures in typed Effect channels:

```ts
const rows = yield* db.user.toArray()

yield* db.user.stream().pipe(
  Stream.runForEach((row) => Effect.logDebug("synced user", row)),
)

const matching = yield* db.user.by_name.filterToArray(range)
const user = yield* db.user.id.findOrFail(userId, (id) => new AppErrors.UserMissing({ userId: id }))
const replaced = yield* db.user.id.replace({ ...user, name })
const deleted = yield* db.user.by_name.deleteAll(range)
const membership = yield* db.membership.membership_email_tenant_idx.find({ email, tenant_id })
```

Server btree accessors accept structural `{ from, to }` bounds; the compiler
converts them to the native host `Range` class after encoding each bound. Due to
a SpaceTimeDB 2.6.1 host bug, a composite tuple whose final range occupies the
full index width is routed as a point scan. The wrapper rejects that form at
compile time and runtime: use a shorter prefix range, or pass a full-width tuple
of scalar values for an exact point lookup.

Native-style lazy iterables are available only under `unsafe`:

```ts
const iterator = yield* db.user.unsafe.iter()
```

## Type helpers

Use the helper that matches where optionality lives:

```ts
Stdb.option(user.row)                           // value may be undefined
Stdb.optional(Stdb.string())                    // struct property may be absent
Stdb.string().optional()                        // table column is optional
Stdb.u32().default(0)                           // native column default
Stdb.string().name("display_name")              // native builder name metadata
Stdb.struct({ id: Stdb.string() }).named("UserView") // generated SATS/client type name
```

All three optionality spellings lower to the same SATS `option<T>` on the wire —
they differ only in TypeScript key-optionality. `Stdb.literal("A", "B")` with
string values is a SATS *enum* on the wire (unit-variant sum; DB/host and
HTTP/JSON tags preserve authored literal values verbatim when they are valid
SpaceTimeDB identifiers), not a string column. Literal values that are not valid
identifiers, such as `edit-action`, use the generated-client-safe PascalCase tag
in the SATS schema while still decoding to the authored value. Generated-client
WS calls still use SpaceTimeDB's PascalCase variant convention.

Nested options (`Stdb.option(Stdb.option(...))`, including an optional struct
field whose value is already an option) are rejected at construction because the
native wire representation cannot distinguish both absent states. Wrap the inner
option in a struct or sum when both layers are semantically required.

`name` mirrors SpacetimeDB's native builder metadata; it does not rename the
authored TypeScript row property in the emitted schema. `table.row` already
carries the table's PascalCase SATS/client type name, so returning or nesting
`user.row` references the generated `User` type. `named` is different: it
assigns the generated SATS/client type name for anonymous structs, sums, and
string-literal enums. Use it when an inline return type or nested payload would
otherwise generate a content-addressed name such as
`EffectSpacetimeDbStruct...`. The identifier is emitted verbatim, so prefer
PascalCase (`MembershipView`) and do not rely on automatic casing. JavaScript
keywords, generated-client helper names (`__*`), and callable-local bindings
such as `params` and `returnType` are reserved. When exporting an anonymous
value type as a top-level reusable contract type, keep `.named(...)` equal to
the exported `const` identifier, for example
`export const UserView = Stdb.struct(...).named("UserView")`. Nested inline
payloads can use their own semantic names.

## Error reference

| Operation | Typed failure surface | Export location |
|---|---|---|
| Connect a generated WebSocket client | `WsConnectError` (its `cause` may be `WsConnectTimeoutError` or `WsUnsupportedBuilderFeatureError`) | `WsConnectError` is root and `/client`; cause classes are `/client` |
| Subscribe or stream | `SubscriptionRejectedError`, `SubscriptionTransportError`, `SubscriptionInvalidatedError` | Classes are `/client`; root exports the `SubscriptionFailure` union |
| Typed reducer/procedure call | Declared error union, `RemoteRejectedError`, `TransportError`, `StdbDecodeError` via `CallFailure<E>` | Root and `/client` |
| Raw reducer/procedure call | `DomainCallError<E>`, `RemoteRejectedError`, `TransportError`, `StdbDecodeError` via `RawCallFailure<E>` | Root and `/client` |
| Generated-client validation | `GeneratedArtifactShapeError`, `WsUnsupportedBuilderFeatureError` | `/client` |
| Code generation | `CodegenCliVersionError`, `CodegenCliExecutionError`, `CodegenEsbuildMissingError`, `CodegenBundleError`, `CodegenFileSystemError`, `CodegenArtifactDirectoryError`, `ArtifactDriftError` | `/codegen` only |
| Server host/database access | `StdbHostCallError`, `StdbValueCodecError`, `StdbHostEncodeError`, and named host failures | Root types and `/server` |

## Scope

Row-level security and upstream `clientVisibilityFilter` behavior are
deliberately outside this library's contract; the upstream filter is
deprecated. Keep protected rows in private tables and expose them through
typed procedures or views. Reconnection and backoff policy remain the native
SDK's responsibility. This package exposes invalidation so applications can
decide how to replace a session.

## Entrypoints

- **`effect-spacetimedb`** (root) — contract builders (`StdbFn`, `StdbHttp`,
  `StdbGroup`, `StdbHttpGroup`, `StdbModule`, `StdbBuilder`), the type/codec
  helpers, declared errors, tables, and client projection (`Stdb.project`). This
  is all you need for normal authoring + client code.
- **`effect-spacetimedb/client`** — client transport helpers for HTTP and
  WebSocket projections.
- **`effect-spacetimedb/server-compiler`** — host-only compiler entrypoint for
  SpaceTimeDB module entries. Import `build` from here in `src/index.ts`; it
  installs the server compatibility polyfills before compiling.
- **`effect-spacetimedb/server-polyfills`** — side-effect entrypoint for module
  host compatibility shims. It is still exported for standalone loading, but
  normal module entries get it through `server-compiler`.
- **`effect-spacetimedb/server`** — advanced/internal server primitives; normal
  modules should use `server-compiler` instead.
- **`effect-spacetimedb/testing`** — curated internals for package tests and
  package-local tooling, including `spacetimeSysAlias` for off-host tests that
  import `spacetimedb/server`.
- **`effect-spacetimedb/testing/example-module`** and
  **`effect-spacetimedb/testing/example-client`** — repository-only fixture
  subpaths. They are intentionally absent from the published package.
