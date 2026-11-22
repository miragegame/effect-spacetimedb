import * as Effect from "effect/Effect"
import * as Stdb from "effect-spacetimedb"
import {
  FullStdbModule,
  type UserId,
  type UserName,
} from "../fixtures/full-module"

const { From } = FullStdbModule

const callableHandlers = {
  userUpsert: () => Effect.void,
  init: () => Effect.void,
  clientConnected: () => Effect.void,
  clientDisconnected: () => Effect.void,
  userRequire: () => Effect.void,
  userGet: Effect.fn(function* () {
    return undefined
  }),
  reminderFire: () => Effect.void,
}

const ValidRowViewLive = Stdb.Builder.group(FullStdbModule, "FullCallables", {
  ...callableHandlers,
  allUsers: Effect.fn(function* () {
    return [
      {
        id: "user-1" as UserId,
        name: "Ada" as UserName,
      },
    ]
  }),
})

const ValidQueryViewLive = Stdb.Builder.group(FullStdbModule, "FullCallables", {
  ...callableHandlers,
  allUsers: Effect.fn(function* () {
    const from = yield* From
    return from.user
  }),
})

const InvalidViewLive = Stdb.Builder.group(FullStdbModule, "FullCallables", {
  ...callableHandlers,
  // @ts-expect-error allUsers must return rows or a compatible typed query
  allUsers: Effect.fn(function* () {
    return {
      nope: true,
    }
  }),
})

void ValidRowViewLive
void ValidQueryViewLive
void InvalidViewLive
