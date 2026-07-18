import { make as makeServer } from "../../src/server/bind.ts"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { fromLayer } from "effect-spacetimedb/server"
import * as StdbTesting from "effect-spacetimedb/testing"
import { CallableOnlyModule } from "../fixtures/callable-only-module"

class ExtraService extends Context.Service<
  ExtraService,
  {
    readonly value: string
  }
>()(
  "effect-spacetimedb/test/typecheck/server-runtime-requirements.typecheck/ExtraService",
) {}

type EchoArgs = StdbTesting.TypeOf<
  typeof CallableOnlyModule.procedures.echo.params
>

const useExtraService: Effect.Effect<void, never, ExtraService> = Effect.gen(
  function* () {
    const extra = yield* ExtraService
    void extra.value
  },
)

const defaultServer = makeServer({ module: CallableOnlyModule })

const missingRuntimeService = defaultServer.handlers({
  // @ts-expect-error ExtraService must be provided by the server runtime.
  reducers: {
    ping: () => useExtraService,
  },
  procedures: {
    echo: Effect.fn(function* (_args: EchoArgs) {
      return "ok"
    }),
  },
})

void missingRuntimeService

const missingSectionRuntimeService = defaultServer.reducers({
  // @ts-expect-error section records reject services absent from the server runtime; @effect-diagnostics-next-line missingEffectContext:off
  ping: defaultServer.reducer(
    Effect.fn(function* () {
      const extra = yield* ExtraService
      void extra.value
    }),
  ),
})
void missingSectionRuntimeService

const serverWithRuntime = makeServer({
  module: CallableOnlyModule,
  runtime: fromLayer(Layer.succeed(ExtraService, { value: "ok" })),
})

const handlersWithRuntime = serverWithRuntime.handlers({
  reducers: {
    ping: Effect.fn(function* () {
      const extra = yield* ExtraService
      void extra.value
    }),
  },
  procedures: {
    echo: Effect.fn(function* (_args: EchoArgs) {
      const extra = yield* ExtraService
      return extra.value
    }),
  },
})

void handlersWithRuntime

const sectionHandlersWithRuntime = serverWithRuntime.reducers({
  ping: serverWithRuntime.reducer(
    Effect.fn(function* () {
      const extra = yield* ExtraService
      const db = yield* serverWithRuntime.db
      void extra.value
      void db
    }),
  ),
})
void sectionHandlersWithRuntime
