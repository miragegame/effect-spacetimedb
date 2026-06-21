import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Stdb from "effect-spacetimedb"
import { fromLayer } from "effect-spacetimedb/server"
import * as StdbTesting from "effect-spacetimedb/testing"
import { CallableOnlyModule } from "../fixtures/callable-only-module"

class ExtraService extends Context.Service<
  ExtraService,
  {
    readonly value: string
  }
>()(Stdb.prefixId("ExtraService")) {}

type EchoArgs = StdbTesting.TypeOf<
  typeof CallableOnlyModule.procedures.echo.params
>

const useExtraService: Effect.Effect<void, never, ExtraService> = Effect.gen(
  function* () {
    const extra = yield* ExtraService
    void extra.value
  },
)

const defaultServer = StdbTesting.makeServer({ module: CallableOnlyModule })

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

const serverWithRuntime = StdbTesting.makeServer({
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
