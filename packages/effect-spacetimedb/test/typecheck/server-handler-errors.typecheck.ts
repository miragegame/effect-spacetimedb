import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"
import {
  FullStdbModule,
  MissingAuth,
  type UserId,
  UserMissing,
  type UserName,
} from "../fixtures/full-module"

class UndeclaredProcedureError extends Schema.TaggedError<UndeclaredProcedureError>()(
  "UndeclaredProcedureError",
  {},
) {}

const { Db } = FullStdbModule

const lifecycleHandlers = {
  init: () => Effect.void,
  clientConnected: () => Effect.void,
  clientDisconnected: () => Effect.void,
}

const ValidLive = Stdb.Builder.group(FullStdbModule, "FullCallables", {
  ...lifecycleHandlers,
  userUpsert: Effect.fn(function* ({ userId, name }) {
    const db = yield* Db
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
  userRequire: Effect.fn(function* ({ userId }) {
    return yield* UserMissing.make({ userId })
  }),
  userGet: Effect.fn(function* ({ userId }) {
    return yield* UserMissing.make({ userId })
  }),
  reminderFire: Effect.fn(function* ({ data }) {
    void data.id
    return undefined
  }),
  allUsers: () => Effect.succeed([]),
})

void ValidLive

const directCatchUniqueHostFailure = Effect.gen(function* () {
  const db = yield* Db
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

const ArrayErrorModule = Stdb.Module.make("server_array_errors", {}).add(
  Stdb.Group.make("Reducers").add(
    Stdb.Fn.reducer("arrayErrorReducer", {
      errors: [Stdb.errors(MissingAuth), UserMissing],
    }),
  ),
)
const ValidArrayErrorLive = Stdb.Builder.group(ArrayErrorModule, "Reducers", {
  arrayErrorReducer: Effect.fn(function* () {
    return yield* UserMissing.make({ userId: "user_1" as UserId })
  }),
})
void ValidArrayErrorLive

const InvalidReducerLive = Stdb.Builder.group(
  FullStdbModule,
  "FullCallables",
  // @ts-expect-error undeclared recoverable reducer error must fail typecheck
  {
    ...lifecycleHandlers,
    userUpsert: () => Effect.void,
    userRequire: Effect.fn(function* () {
      return yield* UndeclaredProcedureError.make({})
    }),
    userGet: Effect.fn(function* () {
      return undefined
    }),
    reminderFire: () => Effect.void,
    allUsers: () => Effect.succeed([]),
  },
)

const InvalidProcedureLive = Stdb.Builder.group(
  FullStdbModule,
  "FullCallables",
  // @ts-expect-error undeclared recoverable procedure error must fail typecheck
  {
    ...lifecycleHandlers,
    userUpsert: () => Effect.void,
    userRequire: () => Effect.void,
    userGet: Effect.fn(function* () {
      return yield* UndeclaredProcedureError.make({})
    }),
    reminderFire: () => Effect.void,
    allUsers: () => Effect.succeed([]),
  },
)

void InvalidReducerLive
void InvalidProcedureLive
