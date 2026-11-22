import * as EffectVitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import { makeServer } from "../helpers/module-server"
import {
  testEffectCallbackError,
  unwrapTestEffectCallbackError,
} from "../helpers/effect-errors"

const { expect } = EffectVitest

import * as Stdb from "effect-spacetimedb"
import * as StdbTesting from "effect-spacetimedb/testing"
import { StdbTableOperationDefect } from "effect-spacetimedb/server"
import { compileModule } from "../helpers/compile-module"
import { makeUserQuery } from "../helpers/query"
import { invokeModuleExport } from "../helpers/spacetimedb-server"
import { TestSyncRunner } from "../helpers/sync-runner"
import { TestLayer } from "../helpers/test-layer"
import { testViewRowsLength } from "../helpers/array-bounds"

const describe = EffectVitest.layer(TestLayer)

type UserRow = {
  readonly id: string
  readonly name: string
}

const userTable = Stdb.table("user", {
  public: true,
  columns: {
    id: Stdb.string().primaryKey(),
    name: Stdb.string(),
  },
})

const ViewModule = Stdb.Module.make("view_module", {})
  .addTables(userTable)
  .add(
    Stdb.Group.make("Views")
      .add(
        Stdb.Fn.anonymousView("allUsers", {
          returns: Stdb.array(
            Stdb.struct({
              id: Stdb.string(),
              name: Stdb.string(),
            }),
            testViewRowsLength,
          ),
        }),
      )
      .add(
        Stdb.Fn.view("me", {
          returns: Stdb.option(
            Stdb.struct({
              id: Stdb.string(),
              name: Stdb.string(),
            }),
          ),
        }),
      ),
  ).spec

const makeHarness = () => {
  const harness = StdbTesting.makeTestModuleHarness(ViewModule)
  harness.db.user.insert({ id: "user-1", name: "Ada" })
  return harness
}

const makeDb = () => makeHarness().db

describe("server views", (it) => {
  it.effect(
    "returns a native where relation directly from a compiled view",
    () =>
      Effect.gen(function* () {
        const filtered = makeUserQuery<typeof ViewModule>().where((row) =>
          row.id.eq("user-1"),
        )
        const server = makeServer({
          module: ViewModule,
          runtime: TestSyncRunner,
        })
        const compiled = compileModule({
          server,
          handlers: server.handlers({
            views: {
              allUsers: Effect.fn(function* () {
                return filtered
              }),
              me: Effect.fn(function* () {
                return undefined
              }),
            },
          }),
        })

        const result = invokeModuleExport(
          compiled.exports.all_users,
          {
            db: makeDb(),
            from: { user: makeUserQuery<typeof ViewModule>() },
          },
          {},
        )

        expect(result).toBe(filtered)
        yield* Effect.void
      }),
  )

  it.effect(
    "binds anonymous and sender views with Effect-native context access",
    () =>
      Effect.gen(function* () {
        const server = makeServer({
          module: ViewModule,
          runtime: TestSyncRunner,
        })
        const from = {
          user: makeUserQuery<typeof ViewModule>(),
        }

        const views = server.views({
          allUsers: Effect.fn(function* () {
            const db = yield* server.ReadonlyDb
            return yield* db.user.toArray()
          }),
          me: Effect.fn(function* () {
            const ctx = yield* server.ViewCtx
            const queryRoot = yield* server.From
            const db = yield* server.ReadonlyDb

            expect(ctx.sender).toBe("sender-1")
            expect(queryRoot).toEqual(from)

            return yield* db.user.id.find("user-1")
          }),
        })

        const harness = makeHarness()
        const anonymousCtx = {
          ...harness.makeAnonymousViewCtx(),
          from,
        }
        const senderCtx = {
          ...harness.makeViewCtx(),
          sender: "sender-1" as never,
          from,
        }

        expect(views.allUsers!.invoke(anonymousCtx, {})).toEqual([
          { id: "user-1", name: "Ada" },
        ])

        expect(views.me!.invoke(senderCtx, {})).toEqual({
          id: "user-1",
          name: "Ada",
        })
      }),
  )

  it.effect(
    "surfaces row decode failures from iterating readonly db rows",
    () =>
      Effect.gen(function* () {
        const server = makeServer({
          module: ViewModule,
          runtime: TestSyncRunner,
        })
        const from = {
          user: makeUserQuery<typeof ViewModule>(),
        }
        const views = server.views({
          allUsers: Effect.fn(function* () {
            const db = yield* server.ReadonlyDb
            return yield* db.user.toArray()
          }),
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
                  env: { get: () => null },
                  db: malformedDb as never,
                  from,
                },
                {},
              ),
            catch: testEffectCallbackError(
              "effect-spacetimedb/integration/server-view",
            ),
          }),
        )
        const cause = unwrapTestEffectCallbackError(failure)

        expect(cause).toBeInstanceOf(StdbTableOperationDefect)
        expect(cause).toMatchObject({
          table: "user",
          op: "db.user.iter.next",
          cause: expect.anything(),
        })
      }),
  )

  it.effect("wraps host call failures from views with operation context", () =>
    Effect.gen(function* () {
      const server = makeServer({
        module: ViewModule,
        runtime: TestSyncRunner,
      })
      const from = {
        user: makeUserQuery<typeof ViewModule>(),
      }
      const views = server.views({
        allUsers: Effect.fn(function* () {
          const db = yield* server.ReadonlyDb
          yield* db.user.count()
          return []
        }),
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
                env: { get: () => null },
                db: db as never,
                from,
              },
              {},
            ),
          catch: testEffectCallbackError(
            "effect-spacetimedb/integration/server-view",
          ),
        }),
      )
      const cause = unwrapTestEffectCallbackError(failure)

      expect(cause).toBeInstanceOf(StdbTableOperationDefect)
      expect(cause).toMatchObject({
        table: "user",
        op: "db.user.count",
        cause: new Error("count exploded"),
      })
    }),
  )
})
