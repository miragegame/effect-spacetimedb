import * as Stdb from "effect-spacetimedb"
import { ExampleErrors } from "../errors"
import { U64, UserId, UserName, user } from "../schema"

export const UserFunctions = Stdb.Group.make("Users")
  .add(
    Stdb.Fn.reducer("userUpsert", {
      params: Stdb.struct({
        userId: Stdb.string(UserId),
        name: Stdb.string(UserName),
      }),
    }),
  )
  .add(
    Stdb.Fn.reducer("userRequire", {
      params: Stdb.struct({
        userId: Stdb.string(UserId),
      }),
      errors: ExampleErrors,
    }),
  )
  .add(
    Stdb.Fn.reducer("seedSelfUser", {
      params: Stdb.struct({
        name: Stdb.string(UserName),
      }),
    }),
  )
  .add(
    Stdb.Fn.reducer("emitPresence", {
      params: Stdb.struct({
        userId: Stdb.string(UserId),
        kind: Stdb.literal("joined", "left"),
      }),
    }),
  )
  .add(
    Stdb.Fn.procedure("userGet", {
      params: Stdb.struct({
        userId: Stdb.string(UserId),
      }),
      returns: Stdb.option(user.row),
      errors: ExampleErrors,
    }),
  )
  .add(
    Stdb.Fn.procedure("presenceEventCount", {
      returns: U64,
    }),
  )
  .add(
    Stdb.Fn.anonymousView("allUsers", {
      returns: Stdb.array(user.row),
    }),
  )
  .add(
    Stdb.Fn.anonymousView("allUsersQuery", {
      returns: Stdb.array(user.row),
    }),
  )
  .add(
    Stdb.Fn.view("selfUser", {
      returns: Stdb.option(user.row),
    }),
  )
  .add(
    // Called as `SELECT * FROM "users_named"('Grace')`, one shared answer per
    // name; a view with params returns its rows without the primary key.
    Stdb.Fn.anonymousView("usersNamed", {
      params: Stdb.struct({
        name: Stdb.string(UserName),
      }),
      returns: Stdb.array(user.row),
    }),
  )
  .add(
    Stdb.Fn.anonymousView("userOfIdentity", {
      params: Stdb.struct({
        identity: Stdb.identity(),
      }),
      returns: Stdb.option(user.row),
    }),
  )

export const AuditNote = Stdb.struct({
  note: Stdb.string(),
})
