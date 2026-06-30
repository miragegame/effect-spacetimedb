import {
  testEffectCallbackError,
  unwrapTestEffectCallbackError,
} from "../helpers/effect-errors"

import * as Effect from "effect/Effect"
import * as EffectVitest from "@effect/vitest"
const { expect } = EffectVitest
import * as Stdb from "effect-spacetimedb"
import * as StdbTesting from "effect-spacetimedb/testing"
import {
  StdbDecodeError,
  StdbUniqueAlreadyExistsError,
} from "effect-spacetimedb/server"
import { makeQueryRelation } from "../helpers/query"
import { assertHostBoundaryThrow, hostCause } from "../helpers/server-runtime"
import { TestSyncRunner } from "../helpers/sync-runner"
import { TestLayer } from "../helpers/test-layer"

const describe = EffectVitest.layer(TestLayer)

type UserRow = {
  readonly id: string
  readonly name: string
}

const makeDb = () => {
  const users = [{ id: "user-1", name: "Ada" }] as Array<UserRow>
  return {
    user: {
      count: () => BigInt(users.length),
      iter: () => users.values(),
      insert: (_row: UserRow) => undefined,
      delete: (_row: UserRow) => undefined,
      update: (_oldRow: UserRow, _newRow: UserRow) => undefined,
      onInsert: () => undefined,
      removeOnInsert: () => undefined,
      onDelete: () => undefined,
      removeOnDelete: () => undefined,
      onUpdate: () => undefined,
      removeOnUpdate: () => undefined,
      id: {
        find: (id: string) => users.find((user) => user.id === id),
        delete: () => undefined,
        upsert: () => undefined,
      },
    },
  }
}

const userTable = Stdb.table("user", {
  public: true,
  columns: {
    id: Stdb.string().primaryKey(),
    name: Stdb.string(),
  },
})

const ViewModule = Stdb.StdbModule.make("view_module", {})
  .addTables(userTable)
  .add(
    Stdb.StdbGroup.make("Views")
      .add(
        Stdb.StdbFn.anonymousView("allUsers", {
          returns: Stdb.array(
            Stdb.struct({
              id: Stdb.string(),
              name: Stdb.string(),
            }),
          ),
        }),
      )
      .add(
        Stdb.StdbFn.view("me", {
          public: false,
          returns: Stdb.option(
            Stdb.struct({
              id: Stdb.string(),
              name: Stdb.string(),
            }),
          ),
        }),
      ),
  ).spec

describe("server views", (it) => {
  it.effect(
    "binds anonymous and sender views with Effect-native context access",
    () =>
      Effect.gen(function* () {
        const server = StdbTesting.makeServer({
          module: ViewModule,
          runtime: TestSyncRunner,
        })
        const from = {
          user: makeQueryRelation<UserRow>(),
        }

        const views = server.views({
          allUsers: server.anonymousView(
            Effect.fn(function* () {
              const db = yield* server.readonlyDb
              return yield* db.user.toArray()
            }),
          ),
          me: server.view(
            Effect.fn(function* () {
              const ctx = yield* server.viewCtx
              const queryRoot = yield* server.from
              const db = yield* server.readonlyDb

              expect(ctx.sender).toBe("sender-1")
              expect(queryRoot).toEqual(from)

              return yield* db.user.id.find("user-1")
            }),
          ),
        })

        const db = makeDb()

        expect(
          views.allUsers!.invoke(
            {
              db: db as never,
              from,
            },
            {},
          ),
        ).toEqual([{ id: "user-1", name: "Ada" }])

        expect(
          views.me!.invoke(
            {
              sender: "sender-1" as never,
              db: db as never,
              from,
            },
            {},
          ),
        ).toEqual({ id: "user-1", name: "Ada" })
      }),
  )

  it.effect(
    "surfaces row decode failures from iterating readonly db rows",
    () =>
      Effect.gen(function* () {
        const server = StdbTesting.makeServer({
          module: ViewModule,
          runtime: TestSyncRunner,
        })
        const from = {
          user: makeQueryRelation<UserRow>(),
        }
        const views = server.views({
          allUsers: server.anonymousView(
            Effect.fn(function* () {
              const db = yield* server.readonlyDb
              return yield* db.user.toArray()
            }),
          ),
        })

        const malformedDb = {
          user: {
            count: () => 1n,
            iter: () =>
              [
                {
                  id: "user-1",
                },
              ].values(),
            insert: (_row: UserRow) => undefined,
            delete: (_row: UserRow) => undefined,
            update: (_oldRow: UserRow, _newRow: UserRow) => undefined,
            onInsert: () => undefined,
            removeOnInsert: () => undefined,
            onDelete: () => undefined,
            removeOnDelete: () => undefined,
            onUpdate: () => undefined,
            removeOnUpdate: () => undefined,
            id: {
              find: () => undefined,
              delete: () => undefined,
              upsert: () => undefined,
            },
          },
        }

        const failure = yield* Effect.flip(
          Effect.try({
            try: () =>
              views.allUsers!.invoke(
                {
                  db: malformedDb as never,
                  from,
                },
                {},
              ),
            catch: testEffectCallbackError(
              "interop/effect-spacetimedb/integration/server-view",
            ),
          }),
        )
        const cause = unwrapTestEffectCallbackError(failure)

        expect(cause).toBeInstanceOf(StdbDecodeError)
        if (cause instanceof StdbDecodeError) {
          expect(cause.phase).toBe("row")
          expect(cause.table).toBe("user")
          expect(cause.op).toBe("db.user.iter")
        }
      }),
  )

  it.effect("wraps host call failures from views with operation context", () =>
    Effect.gen(function* () {
      const server = StdbTesting.makeServer({
        module: ViewModule,
        runtime: TestSyncRunner,
      })
      const from = {
        user: makeQueryRelation<UserRow>(),
      }
      const views = server.views({
        allUsers: server.anonymousView(
          Effect.fn(function* () {
            const db = yield* server.readonlyDb
            yield* db.user.count()
            return []
          }),
        ),
      })
      const db = {
        ...makeDb(),
        user: {
          ...makeDb().user,
          count: () => {
            throw new Error("count exploded")
          },
        },
      }

      const failure = yield* Effect.flip(
        Effect.try({
          try: () =>
            views.allUsers!.invoke(
              {
                db: db as never,
                from,
              },
              {},
            ),
          catch: testEffectCallbackError(
            "interop/effect-spacetimedb/integration/server-view",
          ),
        }),
      )
      const cause = unwrapTestEffectCallbackError(failure)

      expect(cause).toBeInstanceOf(Error)
      if (cause instanceof Error) {
        expect(cause.message).toContain(
          "SpaceTimeDB host call failed at db.user.count",
        )
        expect(cause.message).toContain("count exploded")
      }
    }),
  )

  it.effect("formats widened view host failures at the host boundary", () =>
    Effect.gen(function* () {
      const server = StdbTesting.makeServer({
        module: ViewModule,
        runtime: TestSyncRunner,
      })
      const cause = hostCause("UniqueAlreadyExists")
      const from = {
        user: makeQueryRelation<UserRow>(),
      }
      const views = server.views({
        allUsers: server.anonymousView(
          Effect.fn(function* () {
            return yield* new StdbUniqueAlreadyExistsError({
              op: "db.user.insert",
              cause,
            })
          }),
        ),
      })

      const failure = yield* Effect.flip(
        Effect.try({
          try: () =>
            views.allUsers!.invoke(
              {
                db: makeDb() as never,
                from,
              },
              {},
            ),
          catch: testEffectCallbackError(
            "interop/effect-spacetimedb/integration/server-view",
          ),
        }),
      )

      assertHostBoundaryThrow(
        unwrapTestEffectCallbackError(failure),
        "db.user.insert",
        cause,
      )
    }),
  )
})
