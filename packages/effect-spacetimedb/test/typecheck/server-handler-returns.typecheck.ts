import * as Effect from "effect/Effect"
import type * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"
import * as StdbTesting from "effect-spacetimedb/testing"
import type { Handlers } from "effect-spacetimedb/server"
import { FullModule } from "../fixtures/full-module"
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
type RotateTokenInput = Schema.Schema.Type<
  typeof FullModule.httpHandlers.rotateToken.request
>

const validHandlers = server.handlers({
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
  httpHandlers: {
    stripeWebhook: Effect.fn(function* (_req: Stdb.Request) {
      return new Stdb.SyncResponse("ok")
    }),
    rotateToken: Effect.fn(function* (_input: RotateTokenInput) {
      return { token: "ok" }
    }),
  },
  views: {
    allUsers: Effect.fn(function* () {
      const from = yield* server.from
      return from.user
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

void validHandlers

const invalidProcedure = server.handlers({
  // @ts-expect-error wrong procedure success return must fail typecheck
  reducers: {
    userUpsert: Effect.fn(function* (_args: UserUpsertArgs) {}),
    userRequire: Effect.fn(function* (_args: UserRequireArgs) {}),
  },
  procedures: {
    userGet: Effect.fn(function* () {
      return { nope: true }
    }),
    reminderFire: Effect.fn(function* (_args: ReminderFireArgs) {
      return undefined
    }),
  },
  httpHandlers: {
    stripeWebhook: Effect.fn(function* (_req: Stdb.Request) {
      return new Stdb.SyncResponse("ok")
    }),
    rotateToken: Effect.fn(function* (_input: RotateTokenInput) {
      return { token: "ok" }
    }),
  },
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

void invalidProcedure

const invalidView = server.handlers({
  // @ts-expect-error wrong view success return must fail typecheck
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
  httpHandlers: {
    stripeWebhook: Effect.fn(function* (_req: Stdb.Request) {
      return new Stdb.SyncResponse("ok")
    }),
    rotateToken: Effect.fn(function* (_input: RotateTokenInput) {
      return { token: "ok" }
    }),
  },
  views: {
    allUsers: Effect.fn(function* () {
      return 123
    }),
  },
  lifecycle: {
    init: () => Effect.void,
    clientConnected: () => Effect.void,
    clientDisconnected: () => Effect.void,
  },
})

void invalidView
