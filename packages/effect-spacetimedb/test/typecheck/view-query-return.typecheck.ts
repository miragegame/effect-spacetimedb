import { make as makeServer } from "../../src/server/bind.ts"
import * as Effect from "effect/Effect"
import * as StdbTesting from "effect-spacetimedb/testing"
import { FullModule, FullModuleHttpHandlers } from "../fixtures/full-module"
import { TestSyncRunner } from "../helpers/sync-runner"

const server = makeServer({
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

const queryView = server.anonymousView(
  Effect.fn(function* () {
    const from = yield* server.from
    return from.user
  }),
)

const invalidQueryView = server.handlers({
  // @ts-expect-error query-returning views must use the module-aware query root
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
        toSql: () => "SELECT * FROM user",
      }
    }),
  },
  lifecycle: {
    init: () => Effect.void,
    clientConnected: () => Effect.void,
    clientDisconnected: () => Effect.void,
  },
})

void queryView
void invalidQueryView
