import * as Effect from "effect/Effect"
import * as Stdb from "effect-spacetimedb"
import { FullStdbModule } from "../fixtures/full-module"

const { From } = FullStdbModule

const lifecycleHandlers = {
  init: () => Effect.void,
  clientConnected: () => Effect.void,
  clientDisconnected: () => Effect.void,
}

const ViewsLive = Stdb.Builder.group(FullStdbModule, "FullCallables", {
  allUsers: Effect.fn(function* () {
    const from = yield* From
    return from.user
  }),
  ...lifecycleHandlers,
  userUpsert: () => Effect.void,
  userRequire: () => Effect.void,
  userGet: Effect.fn(function* () {
    return undefined
  }),
  reminderFire: () => Effect.void,
})

const InvalidQueryViewLive = Stdb.Builder.group(
  FullStdbModule,
  "FullCallables",
  {
    ...lifecycleHandlers,
    userUpsert: () => Effect.void,
    userRequire: () => Effect.void,
    userGet: Effect.fn(function* () {
      return undefined
    }),
    reminderFire: () => Effect.void,
    // @ts-expect-error query-returning views must use the module-aware query root
    allUsers: Effect.fn(function* () {
      return {
        toSql: () => "SELECT * FROM user",
      }
    }),
  },
)

void ViewsLive
void InvalidQueryViewLive
