# Runtime Model Implementation Notes

> **Implementation notes.** The user-facing version of this topic lives at
> <https://effect-spacetimedb.dev/the-effect-layer/runtime-model>.
> This file documents implementation detail, rationale, and
> native behavior not covered on the public docs site. Keep user-facing
> conceptual prose on the website to avoid drift between the two surfaces.

For the authoring API (builders, tables, groups, capability scoping) see
[the README](../README.md). For internal random/entropy notes see
[Randomness And Determinism](./randomness-and-determinism.md).

## Execution Internals

Each reducer, procedure, view, HTTP handler, and lifecycle handler is executed at
the boundary with the sync runner's `runSyncExit` (`src/server/bind.ts`), with
`Scheduler.PreventSchedulerYield` set so the fiber cannot yield to a later tick.
Anything that suspends the fiber surfaces as `ReducerAsyncNotAllowedError`.

`Clock.sleep` fails with the same error in all modes. In `dev-guarded` mode the
timer and microtask globals are also replaced with stubs that throw immediately
so accidental use fails loudly in tests/CI. Finalizers still run synchronously
before SpaceTimeDB commits or rolls back, so `Effect.acquireRelease` and scoped
resources are safe when the resource is bounded to the current call.

Effect scheduler optimizations that assume a microtask queue do not apply in the
module host. Handler bodies should stay straight-line and synchronous.

## Determinism Wiring

Host-source verification matters: SpaceTimeDB replaces `Math.random` with a
throwing getter, while `Date` remains live unless this package's constrained
runtime guards are installed.

The server runtime wires `Random.*` from `effect/Random` to `ctx.random` via
`makeServerRandom`. `dev-guarded` mode replaces `Math.random` with a throwing
guard (`ReducerGlobalRandomNotAllowedError`); `runtime` mode keeps a deterministic
`mulberry32` fallback as a non-semantic backstop for stray library paths.

The runtime provides `Clock` from `ctx.timestamp` through `makeServerClock`, so
`Effect.Clock` and `DateTime.now` reflect the transaction timestamp. In
`dev-guarded` mode, `Date.now()` and no-argument `new Date()` throw
`ReducerWallClockNotAllowedError`; explicit conversions such as `new Date(123)`,
`new Date(value)`, `Date.parse`, and `Date.UTC` remain available.

## Transaction Internals

- Reducers run inside one ambient host transaction. The writable `Db` view is
  available directly, and all writes commit or roll back together when the
  reducer returns.
- Procedures and HTTP handlers have no ambient transaction. They must open one
  explicitly with `Tx.run(...)` / `HttpTx.run(...)` (the module's `withTx`).
  `Db` is only reachable inside that body; the type system forbids it elsewhere.
- Only mutable transactions exist. SpaceTimeDB exposes no read-only transaction
  for procedures; a "read-only tx" would be a type-level convention, not a host
  feature.
- On a commit conflict, the native SDK may re-execute the `withTx` body. Keep
  transaction bodies pure database work, with no external side effects or
  non-idempotent logic inside `tx.run(...)`.
- A procedure that opens several transactions has no automatic rollback across
  them. Multi-step sagas are developer-managed with status rows and a reaper, as
  in matchmaking.

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
