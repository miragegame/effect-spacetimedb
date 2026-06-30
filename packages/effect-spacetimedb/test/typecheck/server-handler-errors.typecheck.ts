import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"
import * as StdbTesting from "effect-spacetimedb/testing"
import type { Handlers } from "effect-spacetimedb/server"
import {
  FullModule,
  FullModuleHttpHandlers,
  MissingAuth,
  UserId,
  UserMissing,
  UserName,
} from "../fixtures/full-module"
import { TestSyncRunner } from "../helpers/sync-runner"

class UndeclaredProcedureError extends Schema.TaggedErrorClass<UndeclaredProcedureError>()(
  "UndeclaredProcedureError",
  {},
) {}

const server = StdbTesting.makeServer({
  module: FullModule,
  runtime: TestSyncRunner,
})
type UserGetArgs = StdbTesting.TypeOf<
  typeof FullModule.procedures.userGet.params
>
type UserRequireArgs = StdbTesting.TypeOf<
  typeof FullModule.reducers.userRequire.params
>
type UserUpsertArgs = StdbTesting.TypeOf<
  typeof FullModule.reducers.userUpsert.params
>
type ReminderFireArgs = StdbTesting.TypeOf<
  typeof FullModule.procedures.reminderFire.params
>

const validHandlers = server.handlers({
  reducers: {
    userUpsert: Effect.fn(function* ({ userId, name }: UserUpsertArgs) {
      const db = yield* server.db
      yield* db.user.insert({ id: userId, name }).pipe(
        Effect.catchTags({
          StdbUniqueAlreadyExistsError: (error) => {
            const op: string = error.op
            const cause: unknown = error.cause
            void op
            void cause
            return Effect.void
          },
        }),
      )
    }),
    userRequire: Effect.fn(function* ({ userId }: UserRequireArgs) {
      return yield* UserMissing.make({ userId })
    }),
  },
  procedures: {
    userGet: Effect.fn(function* ({ userId }: UserGetArgs) {
      return yield* UserMissing.make({ userId })
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

void validHandlers

const directCatchUniqueHostFailure = Effect.gen(function* () {
  const db = yield* server.db
  yield* db.user
    .insert({
      id: "user_1" as UserId,
      name: "Ada" as UserName,
    })
    .pipe(
      Effect.catchTags({
        StdbUniqueAlreadyExistsError: (error) => {
          const op: string = error.op
          const cause: unknown = error.cause
          void op
          void cause
          return Effect.void
        },
      }),
    )
})

void directCatchUniqueHostFailure

const ArrayErrorModule = Stdb.StdbModule.make("server_array_errors", {}).add(
  Stdb.StdbGroup.make("Reducers").add(
    Stdb.StdbFn.reducer("arrayErrorReducer", {
      errors: [Stdb.errors(MissingAuth), UserMissing],
    }),
  ),
).spec
const arrayErrorServer = StdbTesting.makeServer({
  module: ArrayErrorModule,
  runtime: TestSyncRunner,
})
const validArrayErrorHandlers = arrayErrorServer.handlers({
  reducers: {
    arrayErrorReducer: Effect.fn(function* () {
      return yield* UserMissing.make({ userId: "user_1" as UserId })
    }),
  },
})
void validArrayErrorHandlers

const invalidReducer = server.handlers({
  // @ts-expect-error undeclared recoverable reducer error must fail typecheck
  reducers: {
    userUpsert: Effect.fn(function* (_args: UserUpsertArgs) {}),
    userRequire: Effect.fn(function* () {
      return yield* UndeclaredProcedureError.make({})
    }),
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

const invalidProcedure = server.handlers({
  // @ts-expect-error undeclared recoverable procedure error must fail typecheck
  reducers: {
    userUpsert: Effect.fn(function* (_args: UserUpsertArgs) {}),
    userRequire: Effect.fn(function* (_args: UserRequireArgs) {}),
  },
  procedures: {
    userGet: Effect.fn(function* () {
      return yield* UndeclaredProcedureError.make({})
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

void invalidReducer
void invalidProcedure
