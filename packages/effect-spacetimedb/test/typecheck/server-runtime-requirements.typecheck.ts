import * as StdbInternal from "effect-spacetimedb/testing/internal"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Stdb from "effect-spacetimedb"
import { CallableOnlyBuilder } from "../fixtures/callable-only-module"

class ExtraService extends Context.Service<
  ExtraService,
  {
    readonly value: string
  }
>()(
  "effect-spacetimedb/test/typecheck/server-runtime-requirements.typecheck/ExtraService",
) {}

const useExtraService: Effect.Effect<void, never, ExtraService> = Effect.gen(
  function* () {
    const extra = yield* ExtraService
    void extra.value
  },
)

const ExtraServiceLive = Stdb.Builder.group(
  CallableOnlyBuilder,
  "CallableOnly",
  {
    ping: () => useExtraService,
    echo: Effect.fn(function* () {
      const extra = yield* ExtraService
      return extra.value
    }),
  },
)

// @ts-expect-error ExtraService must be provided by the plan runtime.
void StdbInternal.planModule(CallableOnlyBuilder, [ExtraServiceLive] as const)

void StdbInternal.planModule(CallableOnlyBuilder, [ExtraServiceLive] as const, {
  runtime: Layer.succeed(ExtraService, { value: "ok" }),
})

const DbOnlyLive = Stdb.Builder.group(CallableOnlyBuilder, "CallableOnly", {
  ping: Effect.fn(function* () {
    const db = yield* CallableOnlyBuilder.Db
    void db
  }),
  echo: Effect.fn(function* () {
    return "ok"
  }),
})

void StdbInternal.planModule(CallableOnlyBuilder, [DbOnlyLive] as const)

// `onDefect` alone needs no runtime options beside it.
void StdbInternal.planModule(CallableOnlyBuilder, [DbOnlyLive] as const, {
  onDefect: (cause) => {
    void cause
  },
})
