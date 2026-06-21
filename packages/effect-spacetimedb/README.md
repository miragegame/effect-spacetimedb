# effect-spacetimedb

Effect-native authoring and client wrappers for SpacetimeDB modules. The
authoring surface is a composable builder modeled on Effect's `HttpApi`:
**endpoints → groups → module → implement → build with the native
SpaceTimeDB CLI**.

```ts
import * as Stdb from "effect-spacetimedb"
import { build } from "effect-spacetimedb/server-compiler"
import "effect-spacetimedb/server-polyfills"
```

The library is namespace-first: prefer
`import * as Stdb from "effect-spacetimedb"` for the contract DSL and use
`Stdb.enum(...)` there. `enum` is a JavaScript reserved word and cannot be
named-imported, so use the namespace form or the named-import-safe `enumType`
alias.

Run `bun run test` from this package to execute its colocated unit, integration,
and real-server safety tests. Live SpaceTimeDB tests are separate:
`bun run test:live`.

## Build Requirements

Standalone package development requires:

- Bun, for package scripts and Vitest.
- The SpaceTimeDB 2.5.0 CLI tools, including `spacetime` and
  `spacetimedb-standalone`, available on `PATH` or through
  `SPACETIME_CLI_BIN`.

SpacetimeDB TypeScript modules must be built with TypeScript 5.9.3 or newer.
This matches the compiler range used by the SpacetimeDB SDK package's own
development build and by this package's publishable-example regression gate.
The repository's root TypeScript pin is also 5.9.3, so `spacetime build`,
and any `spacetime publish --module-path` flow should resolve a module-local
`node_modules/.bin/tsc` at that floor or newer. The dev-server flow below uses
`spacetime generate --js-path` and `spacetime publish --js-path` after that
build step, so those commands reuse the prebuilt bundle instead of invoking
`tsc` again.

## Repository Example Client Fixture

`examples/publishable-module/generated/` is a committed generated client
fixture used by this repository's regression tests. It is generated from
`examples/publishable-module` and guarded by the root
`bun run check:stdb-client-drift` drift check in CI. The fixture and its
`effect-spacetimedb/testing/example-client` repository export are not included
in the published npm package.

When the example module schema changes, regenerate the fixture from this package
with `bun run codegen` and commit the generated output. `bun run codegen:check`
performs the same regeneration into a temporary directory and fails if the
committed fixture is out of date. The codegen entrypoint itself is a plain Node
script (`node scripts/codegen.mjs`) so the generated-client drift check does not
depend on this repository.

The documentation website under the mirror root `website/` is not part of this
package-local standalone guarantee; it has its own Astro build wiring.

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
index.ts              build(Module, [..lives])            imports server-compiler + server-polyfills
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
  init: Stdb.StdbFn.init().spec,
  clientConnected: Stdb.StdbFn.clientConnected().spec,
  clientDisconnected: Stdb.StdbFn.clientDisconnected().spec,
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

export const Example = Stdb.project(Module.spec) // typed client projection
```

The accessors are typed against this module's tables (so `db.user.…` is typed).
They are global service tags under the hood; do not `yield*` another module's
accessor inside a handler.

## Implementing handlers

`StdbBuilder.group(Module, "GroupName", handlers)` takes a plain object whose
keys are the declared endpoint names. Raw HTTP routes use the same record form;
their handler receives a `Request` and returns a `SyncResponse`. Handlers pull
dependencies with `yield*`; the record must include every endpoint in the group.

```ts
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
      return (yield* db.user.id.find(senderId(ctx))) ?? undefined
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
    yield* replaceUser({ userId: senderId(ctx), name })
  })
```

## Runtime model

Module code runs under SpaceTimeDB's strict contract — **synchronous,
run-to-completion, single-transaction, deterministic**. The headline constraints:

- **No async** — promises, timers, `queueMicrotask`, and `Effect.sleep` are rejected
  (`ReducerAsyncNotAllowedError`); keep handler bodies straight-line.
- **No `Math.random`** — use `Effect.Random.*` (wired to `ctx.random`); it is
  deterministic and **not** cryptographically secure.
- **No wall clock** — use `ctx.timestamp` / `Effect.Clock`, never `Date.now`.
- **Transactions** — reducers write `Db` directly; procedures/HTTP handlers must
  `tx.run(...)`; bodies may re-run on commit conflict, so keep them pure DB work.
- **Tracing is disabled** server-side, and logs bridge to the host console.

See [Runtime model and constraints](./docs/runtime-model.md) for the full list, and
[Randomness and determinism](./docs/randomness-and-determinism.md) for the
randomness contract.

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

## Build

`build(Module, impls)` from `effect-spacetimedb/server-compiler` checks at compile time that every declared
group is implemented exactly once, then produces the native module. If any
handler requires a custom service (anything beyond the built-in capabilities),
`build` requires a `runtime` that provides it — omitting it is a type error:

```ts
import { build } from "effect-spacetimedb/server-compiler"
import "effect-spacetimedb/server-polyfills"

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

`Stdb.project(Module.spec)` yields a client-safe projection (no server runtime).
Provide a transport layer and call reducers/procedures/HTTP handlers:

```ts
const Example = Stdb.project(Module.spec)

const HttpLive = Example.client.http.layerFetch({ uri, databaseName, token })

const program = Effect.gen(function* () {
  const client = yield* Example.client.http.Tag
  yield* client.reducers.user_upsert({ userId, name })
  yield* client.httpHandlers.rotate_token({ userId })
}).pipe(Effect.provide(HttpLive))
```

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

### Canonical Effect HttpApi client

Typed `post`, `put`, and `patch` HTTP routes can also be projected into a stock
Effect `HttpApi`. This lets callers use `HttpApiClient.make(...)`, including its
status-based declared-error decoding, instead of the bespoke
`client.httpHandlers.*` transport that surfaces non-2xx route responses as opaque
bodies.

```ts
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as HttpApiClient from "effect/unstable/httpapi/HttpApiClient"

const api = Stdb.toHttpApi(Module.spec)

const client = yield* HttpApiClient.make(api, {
  baseUrl: Stdb.httpApiBaseUrl({ uri, databaseName }),
  transformClient: HttpClient.mapRequest(HttpClientRequest.bearerToken(token)),
})

yield* client.Webhooks.rotate_token({ payload: { userId } })
```

`Stdb.toHttpApi(Module.spec)` is pure and client-direction only; it does not
change the STDB server adapter or generated output. It preserves authored
`StdbHttpGroup` ids as `HttpApiClient` property keys, so those ids should be
valid JavaScript identifiers for ergonomic dot access. `Stdb.validate` emits a
warning for awkward group ids; `StdbModule.make(...).spec` and `Stdb.assertValid`
do not reject them.

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
import * as StdbClient from "effect-spacetimedb/client"

const WsLive = Example.client.ws.layer(
  StdbClient.GeneratedWs.adapter({ DbConnection, uri, databaseName, token }),
)

const program = Effect.gen(function* () {
  const session = yield* Example.client.ws.Session
  yield* session.reducers.user_upsert({ userId, name })

  yield* session.subscribe(Example.targets.allPublicTables())
}).pipe(Effect.provide(WsLive))
```

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

Persistent-table change streams use a bounded callback queue by default
(`bufferSize: 1024`, `strategy: "sliding"`), so extreme producer bursts drop the
oldest queued deltas instead of growing memory without limit. The intended
consumer pattern is to treat a table-change event as a signal to re-read the
authoritative session cache. Event-table streams are raw event feeds and are
unbounded by default, so every queued event is retained unless the caller opts
into an explicit bounded buffer and accepts lossy overflow behavior:

```ts
yield* session.streamEventTable("presenceEvent", {
  buffer: { bufferSize: 4096, strategy: "dropping" },
}).pipe(Stream.runDrain)
```

`tableGroup(keys).changes` emits an initial snapshot, then at most one snapshot
per drained callback batch. A synchronous dispatch burst therefore produces one
snapshot under normal native SDK pacing; if a consumer is behind, several bursts
may coalesce into one later snapshot. Each emission re-reads the authoritative
cache, so dropped queue signals converge to the current state rather than losing
snapshot data.

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
```

All three optionality spellings lower to the same SATS `option<T>` on the wire —
they differ only in TypeScript key-optionality. `Stdb.literal("A", "B")` with
string values is a SATS *enum* on the wire (unit-variant sum; DB/host and
HTTP/JSON tags preserve authored literal values verbatim when they are valid
SpaceTimeDB identifiers), not a string column. Literal values that are not valid
identifiers, such as `edit-action`, use the generated-client-safe PascalCase tag
in the SATS schema while still decoding to the authored value. Generated-client
WS calls still use SpaceTimeDB's PascalCase variant convention.

`name` mirrors SpacetimeDB's native builder metadata; it does not rename the
authored TypeScript row property in the emitted schema.

## Entrypoints

- **`effect-spacetimedb`** (root) — contract builders (`StdbFn`, `StdbHttp`,
  `StdbGroup`, `StdbHttpGroup`, `StdbModule`, `StdbBuilder`), the type/codec
  helpers, declared errors, tables, and client projection (`Stdb.project`). This
  is all you need for normal authoring + client code.
- **`effect-spacetimedb/client`** — client transport adapters (e.g.
  `GeneratedWs`).
- **`effect-spacetimedb/server-compiler`** — host-only compiler entrypoint for
  SpaceTimeDB module entries. Import `build` from here in `src/index.ts`.
- **`effect-spacetimedb/server-polyfills`** — side-effect entrypoint for module
  entries; import it once next to `server-compiler` so native bundles keep the
  deterministic compatibility backstops.
- **`effect-spacetimedb/server`** — advanced/internal server primitives; normal
  modules should use `server-compiler` instead.
- **`effect-spacetimedb/testing`** — curated internals for package tests and
  package-local tooling, including `spacetimeSysAlias` for off-host tests that
  import `spacetimedb/server`.
