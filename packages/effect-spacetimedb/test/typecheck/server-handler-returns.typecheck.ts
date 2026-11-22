import * as Effect from "effect/Effect"
import * as Stdb from "effect-spacetimedb"
import { FullStdbModule } from "../fixtures/full-module"

const { From } = FullStdbModule

const lifecycleHandlers = {
  init: () => Effect.void,
  clientConnected: () => Effect.void,
  clientDisconnected: () => Effect.void,
}

const ValidLive = Stdb.Builder.group(FullStdbModule, "FullCallables", {
  ...lifecycleHandlers,
  userUpsert: () => Effect.void,
  userRequire: () => Effect.void,
  userGet: Effect.fn(function* () {
    return undefined
  }),
  reminderFire: () => Effect.void,
  allUsers: Effect.fn(function* () {
    const from = yield* From
    return from.user
  }),
})

const InvalidProcedureLive = Stdb.Builder.group(
  FullStdbModule,
  "FullCallables",
  {
    ...lifecycleHandlers,
    userUpsert: () => Effect.void,
    userRequire: () => Effect.void,
    // @ts-expect-error wrong procedure success return must fail typecheck
    userGet: Effect.fn(function* () {
      return { nope: true }
    }),
    reminderFire: () => Effect.void,
    allUsers: () => Effect.succeed([]),
  },
)

const InvalidViewLive = Stdb.Builder.group(FullStdbModule, "FullCallables", {
  ...lifecycleHandlers,
  userUpsert: () => Effect.void,
  userRequire: () => Effect.void,
  userGet: Effect.fn(function* () {
    return undefined
  }),
  reminderFire: () => Effect.void,
  // @ts-expect-error wrong view success return must fail typecheck
  allUsers: Effect.fn(function* () {
    return 123
  }),
})

void ValidLive
void InvalidProcedureLive
void InvalidViewLive
