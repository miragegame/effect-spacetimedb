import * as Effect from "effect/Effect"
import * as StdbTesting from "effect-spacetimedb/testing"
import type { Handlers } from "effect-spacetimedb/server"
import { FullModule, FullModuleHttpHandlers } from "../fixtures/full-module"
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

const canonicalHandlers = server.handlers({
  reducers: {
    userUpsert: Effect.fn(function* ({ userId, name }: UserUpsertArgs) {
      void userId
      void name
    }),
    userRequire: Effect.fn(function* ({ userId }: UserRequireArgs) {
      void userId
    }),
  },
  procedures: {
    userGet: Effect.fn(function* ({ userId }: UserGetArgs) {
      void userId
      return undefined
    }),
    reminderFire: Effect.fn(function* ({ data }: ReminderFireArgs) {
      void data.id
      return undefined
    }),
  },
  httpHandlers: FullModuleHttpHandlers,
  views: {
    allUsers: Effect.fn(function* () {
      return []
    }),
  },
  lifecycle: {
    init: () => Effect.void,
    clientConnected: () => Effect.void,
    clientDisconnected: () => Effect.void,
  },
})

declare const brandedHandlers: Handlers<typeof FullModule>
void brandedHandlers

const invalidReducerArgs = server.handlers({
  reducers: {
    // @ts-expect-error handler params must match reducer contract
    userUpsert: Effect.fn(function* ({ missing }) {
      void missing
    }),
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
      return []
    }),
  },
  lifecycle: {
    init: () => Effect.void,
    clientConnected: () => Effect.void,
    clientDisconnected: () => Effect.void,
  },
})

const invalidReducerFrom = server.handlers({
  // @ts-expect-error reducers must not depend on the view query root
  reducers: {
    userUpsert: Effect.fn(function* ({ userId, name }: UserUpsertArgs) {
      void userId
      void name
      const from = yield* server.from
      void from
    }),
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
      return []
    }),
  },
  lifecycle: {
    init: () => Effect.void,
    clientConnected: () => Effect.void,
    clientDisconnected: () => Effect.void,
  },
})

const missingSections = server.handlers({
  // @ts-expect-error modules with reducers/procedures/views/lifecycle require those sections
  reducers: {
    userUpsert: Effect.fn(function* (_args: UserUpsertArgs) {}),
    userRequire: Effect.fn(function* (_args: UserRequireArgs) {}),
  },
})

const extraReducerKey = server.handlers({
  // @ts-expect-error handler maps must not accept unknown reducer keys
  reducers: {
    userUpsert: Effect.fn(function* (_args: UserUpsertArgs) {}),
    userRequire: Effect.fn(function* (_args: UserRequireArgs) {}),
    user_delete: Effect.fn(function* () {}),
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
      return []
    }),
  },
  lifecycle: {
    init: () => Effect.void,
    clientConnected: () => Effect.void,
    clientDisconnected: () => Effect.void,
  },
})

const oldKeyedReducerHelper = server.reducer(
  "userUpsert",
  // @ts-expect-error reducer helper no longer accepts a repeated key argument
  Effect.fn(function* (_args: UserUpsertArgs) {}),
)

void canonicalHandlers
void invalidReducerArgs
void invalidReducerFrom
void missingSections
void extraReducerKey
void oldKeyedReducerHelper
