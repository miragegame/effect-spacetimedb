import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"
import { UserMissingError } from "../errors"
import {
  Db,
  ExampleModule,
  From,
  MutationCtx,
  ReadonlyDb,
  Tx,
  ViewCtx,
} from "../module"
import { UserId, UserName, type UserName as UserNameType } from "../schema"

const decodeUserId = Schema.decodeUnknownSync(UserId)
const decodeUserName = Schema.decodeUnknownSync(UserName)

const toHexString = (value: unknown): string => {
  if (typeof value === "string") {
    return value
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "toHexString" in value &&
    typeof (value as { readonly toHexString: unknown }).toHexString ===
      "function"
  ) {
    return (value as { readonly toHexString: () => string }).toHexString()
  }

  throw new Error("Expected a SpacetimeDB identity-like value")
}

const replaceUser = Effect.fn(function* (args: {
  readonly userId: UserId
  readonly name: UserNameType
}) {
  const db = yield* Db
  yield* db.user.id.delete(args.userId)
  yield* db.user.insert({
    id: args.userId,
    name: args.name,
  })
})

const seedMutationSender = Effect.fn(function* (name: UserName) {
  const ctx = yield* MutationCtx
  const userId = decodeUserId(toHexString(ctx.sender))
  yield* replaceUser({ userId, name })
})

export const UserFunctionsLive = Stdb.StdbBuilder.group(
  ExampleModule,
  "Users",
  {
    userUpsert: ({ userId, name }) => replaceUser({ userId, name }),
    userRequire: Effect.fn(function* ({ userId }) {
      const db = yield* Db
      yield* db.user.id.findOrFail(userId, (missingUserId) =>
        UserMissingError.make({
          userId: missingUserId,
        }),
      )
    }),
    seedSelfUser: ({ name }) => seedMutationSender(name),
    emitPresence: Effect.fn(function* ({ userId, kind }) {
      const db = yield* Db
      yield* db.presenceEvent.insert({
        userId,
        kind,
      })
    }),
    userGet: Effect.fn(function* ({ userId }) {
      const tx = yield* Tx
      return yield* tx.run(
        Effect.gen(function* () {
          const db = yield* Db
          return yield* db.user.id.findOrFail(userId, (missingUserId) =>
            UserMissingError.make({
              userId: missingUserId,
            }),
          )
        }),
      )
    }),
    allUsers: () =>
      Effect.gen(function* () {
        const db = yield* ReadonlyDb
        return yield* db.user.toArray()
      }),
    allUsersQuery: () =>
      Effect.gen(function* () {
        const from = yield* From
        return from.user.where((row) => row.name.ne(decodeUserName("")))
      }),
    selfUser: () =>
      Effect.gen(function* () {
        const ctx = yield* ViewCtx
        const db = yield* ReadonlyDb
        const row = yield* db.user.id.find(
          decodeUserId(toHexString(ctx.sender)),
        )
        return row ?? undefined
      }),
    privateAuditLog: () => Effect.succeed([]),
  },
)
