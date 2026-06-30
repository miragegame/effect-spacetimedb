import * as Effect from "effect/Effect"
import * as StdbTesting from "effect-spacetimedb/testing"
import {
  FullModule,
  FullModuleHttpHandlers,
  type UserId,
  type UserName,
} from "../fixtures/full-module"
import { TestSyncRunner } from "../helpers/sync-runner"

const server = StdbTesting.makeServer({
  module: FullModule,
  runtime: TestSyncRunner,
})
type UserUpsertArgs = StdbTesting.TypeOf<
  typeof FullModule.reducers.userUpsert.params
>
type UserRequireArgs = StdbTesting.TypeOf<
  typeof FullModule.reducers.userRequire.params
>
type UserGetArgs = StdbTesting.TypeOf<
  typeof FullModule.procedures.userGet.params
>
type ReminderFireArgs = StdbTesting.TypeOf<
  typeof FullModule.procedures.reminderFire.params
>

const validRowView = server.anonymousView(
  Effect.fn(function* () {
    return [
      {
        id: "user-1" as UserId,
        name: "Ada" as UserName,
      },
    ]
  }),
)

const validQueryView = server.anonymousView(
  Effect.fn(function* () {
    const from = yield* server.from
    return from.user
  }),
)

const invalidView = server.handlers({
  // @ts-expect-error allUsers must return rows or a compatible typed query
  reducers: {
    userUpsert: Effect.fn(function* (_args: UserUpsertArgs) {}),
    userRequire: Effect.fn(function* (_args: UserRequireArgs) {}),
  },
  procedures: {
    userGet: Effect.fn(function* (_args: UserGetArgs) {
      return undefined
    }),
    reminderFire: Effect.fn(function* (_args: ReminderFireArgs) {
      return undefined
    }),
  },
  httpHandlers: FullModuleHttpHandlers,
  views: {
    allUsers: Effect.fn(function* () {
      return {
        nope: true,
      }
    }),
  },
  lifecycle: {
    init: () => Effect.void,
    clientConnected: () => Effect.void,
    clientDisconnected: () => Effect.void,
  },
})

void validRowView
void validQueryView
void invalidView
