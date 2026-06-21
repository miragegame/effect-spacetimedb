# Runtime Model And Constraints

SpaceTimeDB runs module code (reducers, procedures, views, HTTP handlers) inside a
single V8 isolate under a strict contract: each call is **synchronous**,
**run-to-completion**, **single-transaction**, and **deterministic**. The host
deliberately removes the non-deterministic and asynchronous capabilities a normal
JS runtime provides.

`effect-spacetimedb` runs your Effect programs *inside* that contract. This page
collects the resulting quirks and restrictions in one place — what the runtime
forbids, why, and what to use instead. For the authoring API (builders, tables,
groups, capability scoping) see [the README](../README.md); for the randomness
details see [Randomness And Determinism](./randomness-and-determinism.md).

## Execution Model: Synchronous, Run-To-Completion

Each reducer/procedure/handler is executed at the boundary with the sync runner's
`runSyncExit` (`src/server/bind.ts`), with `Scheduler.PreventSchedulerYield` set so
the fiber cannot yield to a later tick. The whole Effect must complete in one
synchronous pass.

Consequences:

- **No async.** Promises, `async` functions, `setTimeout`/`setInterval`,
  `queueMicrotask`, `Effect.sleep`, and anything that suspends the fiber are not
  allowed. They surface as `ReducerAsyncNotAllowedError`. In `dev-guarded` mode the
  timer globals are replaced with stubs that throw immediately so accidental use
  fails loudly in tests/CI; `Clock.sleep` fails with the same error in all modes.
- **Finalizers run synchronously** before SpaceTimeDB commits or rolls back, so
  `Effect.acquireRelease` / scoped resources are safe within a single call.
- Effect's scheduler optimizations that assume a microtask queue do not apply; keep
  handler bodies straight-line and synchronous.

If you need work that is genuinely async (network I/O, timers, queues), it belongs
**outside** the reducer — on the host, an edge worker, a Durable Object, or a
client — not inside module code.

## Determinism: No Ambient Entropy Or Clock

Every replica must reproduce the same state from the same logged inputs, so the
host strips or guards some non-deterministic globals and the runtime provides
deterministic substitutes from the call context. Host-source verification matters:
`Math.random` throws, while `Date` remains live unless the constrained runtime's
dev guards are installed.

- **No `Math.random`.** SpaceTimeDB replaces it with a throwing getter. Use
  `Effect.Random.*`, which the runtime wires to `ctx.random` via `makeServerRandom`.
  `dev-guarded` mode replaces `Math.random` with a throwing guard
  (`ReducerGlobalRandomNotAllowedError`); `runtime` mode keeps a deterministic
  `mulberry32` fallback as a non-semantic backstop. **`ctx.random` is gameplay-grade,
  not cryptographically secure** — see
  [Randomness And Determinism](./randomness-and-determinism.md).
- **No wall clock.** The host leaves `Date.now()` and no-argument `new Date()`
  live, so they are a determinism hazard. `dev-guarded` mode replaces them with
  throwing guards (`ReducerWallClockNotAllowedError`). The runtime provides
  `Clock` from `ctx.timestamp` (`makeServerClock`), so `Effect.Clock` and
  `DateTime.now` reflect the transaction timestamp. Use `ctx.timestamp` for time.
- **Determinism is for replication, not secrecy.** Anything reproducible from logged
  inputs is predictable to anyone who can reconstruct them; you cannot mint secrets
  or unpredictable values inside a reducer.

## Transactions

- **Reducers run inside one ambient host transaction.** The writable `Db` view is
  available directly; all writes commit or roll back together when the reducer
  returns.
- **Procedures and HTTP handlers have no ambient transaction.** They must open one
  explicitly with `Tx.run(...)` / `HttpTx.run(...)` (i.e. the module's `withTx`).
  `Db` is only reachable inside that body — the type system forbids it elsewhere.
- **Only mutable transactions exist.** SpaceTimeDB exposes no read-only transaction
  for procedures; a "read-only tx" would be a type-level convention, not a host
  feature.
- **Optimistic concurrency may re-run a transaction body.** On a commit conflict the
  native SDK re-executes the `withTx` body. Keep transaction bodies pure database
  work — **no external side effects, no non-idempotent logic** inside `tx.run(...)`.
- **No cross-transaction atomicity.** A procedure that opens several transactions has
  no automatic rollback across them; multi-step sagas are developer-managed (status
  rows + a reaper, as in matchmaking).

Which accessors are legal in which scope is enforced at compile time — see the
**Capability scoping** table in [the README](../README.md).

## Host Call Failures

Host ABI calls can fail before user code gets a normal return value. Generic or
unrecognized host failures surface as `StdbHostCallError` with the operation label
and original cause. Four native SpaceTimeDB host errors are split out so handlers
can branch without string-sniffing causes:

- `StdbUniqueAlreadyExistsError`
- `StdbAutoIncOverflowError`
- `StdbNoSuchRowError`
- `StdbScheduleDelayTooLongError`

Each carries `{ op, cause }`, matching `StdbHostCallError`. Branch on the specific
tag when the handler has a real recovery path, such as translating a unique
constraint collision into a declared domain error. Otherwise let the error
propagate so the host-boundary throw keeps the operation label and original cause.

The classifier uses the native error class `name`, not `instanceof`, because
ordinary server runtime files cannot value-import `spacetimedb/server`: that module
loads the `spacetime:sys` host surface at import time. The pinned SpaceTimeDB
bindings freeze those error names, so dependency bumps should re-check the native
`bindings-typescript/src/server/errors.ts` name surface.

## Observability

- **Tracing is disabled on the server.** Effect's default tracer builds a span (with
  a `Math.random`-derived id) on every `Effect.fn`/`withSpan`, but those spans are
  never exported from a reducer, so the runtime runs server effects with
  `Effect.withTracerEnabled(false)`. `Effect.fn` still works (it produces a noop
  span); it just costs nothing and pulls in no entropy. If a real trace exporter is
  ever wired into reducers, re-enable tracing deliberately at that point.
- **Logging bridges to the host console.** `Effect.log*` is routed through a host
  logger (`hostLogger`) that writes to `globalThis.console` at the matching level,
  since the module runtime has no other sink.
- **Handler logs are annotated at the bind seam.** Logs emitted while a reducer,
  procedure, HTTP handler, view, or lifecycle handler runs carry `module`,
  `handler`, and `kind`. Reducers, procedures, sender views, and lifecycle handlers
  also carry `sender` as the caller identity hex string. Anonymous views and HTTP
  handlers omit `sender`; an HTTP handler's `databaseIdentity` is the module
  identity, not the caller.

## Polyfills

SpaceTimeDB's module runtime is a minimal JS environment. The server compat layer
(`src/compat/polyfills.ts`) installs small shims only when they are missing:

- a deterministic `Math.random` fallback (described above),
- immediate-execution `setTimeout`/`setImmediate` (and no-op `clear*`).

These are compatibility backstops for library code, not capabilities to build on —
application logic should not depend on their behavior.

Module entrypoints import `effect-spacetimedb/server-polyfills` explicitly next
to `effect-spacetimedb/server-compiler`. Native `spacetime build` preserves that
side-effect import; the package no longer injects a generated bundle prelude.

## Dev-Guarded Mode

The runtime has two modes (`ConstrainedServerRuntimeMode`). `dev-guarded` is
selected automatically under tests (`VITEST` / `NODE_ENV=test`) and adds scoped
guards that make forbidden operations throw loudly: timer/microtask globals and
`Math.random` are swapped for throwing stubs, and `Date.now()` / no-argument
`new Date()` are blocked, for the duration of each call and restored afterward.
`runtime` (production) keeps the non-throwing deterministic fallbacks. Write code
that passes in `dev-guarded` mode and it will behave deterministically in
production.

## Quick Rules

- Keep handler bodies synchronous; no promises, timers, or `Effect.sleep`.
- Randomness: `Effect.Random.*` (never `Math.random`); treat it as deterministic and
  non-secure.
- Time: `ctx.timestamp` / `Effect.Clock` (never `Date.now`).
- `Db` writes in reducers directly; in procedures/HTTP handlers only inside
  `tx.run(...)`.
- Keep transaction bodies pure DB work — they may run more than once.
- Do async/network/secret work outside the reducer and pass results in as arguments.
