import * as Stdb from "effect-spacetimedb"
import { ExampleErrors } from "../errors"
import { String255, UserId, UserName, user } from "../schema"

export const UserFunctions = Stdb.StdbGroup.make("Users")
  .add(
    Stdb.StdbFn.reducer("userUpsert", {
      params: Stdb.struct({
        userId: Stdb.string(UserId),
        name: Stdb.string(UserName),
      }),
    }),
  )
  .add(
    Stdb.StdbFn.reducer("userRequire", {
      params: Stdb.struct({
        userId: Stdb.string(UserId),
      }),
      errors: ExampleErrors,
    }),
  )
  .add(
    Stdb.StdbFn.reducer("seedSelfUser", {
      params: Stdb.struct({
        name: Stdb.string(UserName),
      }),
    }),
  )
  .add(
    Stdb.StdbFn.reducer("emitPresence", {
      params: Stdb.struct({
        userId: Stdb.string(UserId),
        kind: Stdb.literal("joined", "left"),
      }),
    }),
  )
  .add(
    Stdb.StdbFn.procedure("userGet", {
      params: Stdb.struct({
        userId: Stdb.string(UserId),
      }),
      returns: Stdb.option(user.row),
      errors: ExampleErrors,
    }),
  )
  .add(
    Stdb.StdbFn.anonymousView("allUsers", {
      returns: Stdb.array(user.row),
    }),
  )
  .add(
    Stdb.StdbFn.anonymousView("allUsersQuery", {
      returns: Stdb.array(user.row),
    }),
  )
  .add(
    Stdb.StdbFn.view("selfUser", {
      returns: Stdb.option(user.row),
    }),
  )
  .add(
    Stdb.StdbFn.anonymousView("privateAuditLog", {
      public: false,
      returns: Stdb.array(user.row),
    }),
  )

export const AuditNote = Stdb.struct({
  note: String255,
})
