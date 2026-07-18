import {
  make as makeServer,
  type InternalServerInstance,
} from "../../src/server/bind.ts"
import {
  assertOwnedHandlerBundle,
  ServerOwnerSymbol,
} from "../../src/server/handler-ownership.ts"
import * as Effect from "effect/Effect"
import * as EffectVitest from "@effect/vitest"
const { expect } = EffectVitest
import { compileModule } from "../helpers/compile-module"
import * as StdbTesting from "effect-spacetimedb/testing"
import { FullModule, FullModuleHttpHandlers } from "../fixtures/full-module"
import { TestSyncRunner } from "../helpers/sync-runner"
import { TestLayer } from "../helpers/test-layer"

const describe = EffectVitest.layer(TestLayer)
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

const makeHandlers = (server: InternalServerInstance<typeof FullModule>) =>
  server.handlers({
    reducers: {
      userUpsert: Effect.fn(function* ({ userId, name }: UserUpsertArgs) {
        void userId
        void name
        return undefined
      }),
      userRequire: Effect.fn(function* ({ userId }: UserRequireArgs) {
        void userId
        return undefined
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
    httpHandlers: FullModuleHttpHandlers,
  })

describe("server handler ownership", (it) => {
  it.effect("accepts same-instance handler bundles", () =>
    Effect.gen(function* () {
      const server = makeServer({
        module: FullModule,
        runtime: TestSyncRunner,
      })

      const handlers = makeHandlers(server)

      expect(() =>
        assertOwnedHandlerBundle(server[ServerOwnerSymbol], handlers),
      ).not.toThrow()
    }),
  )

  it.effect(
    "rejects handler bundles assembled by a different server instance",
    () =>
      Effect.gen(function* () {
        const firstServer = makeServer({
          module: FullModule,
          runtime: TestSyncRunner,
        })
        const secondServer = makeServer({
          module: FullModule,
          runtime: TestSyncRunner,
        })

        const mismatchedHandlers = makeHandlers(secondServer)

        expect(() => firstServer.handlers(mismatchedHandlers)).toThrow(
          "Server handlers must be assembled by the same internal server instance as the compiled module",
        )

        expect(() =>
          assertOwnedHandlerBundle(
            firstServer[ServerOwnerSymbol],
            mismatchedHandlers,
          ),
        ).toThrow(
          "Server handlers must be assembled by the same internal server instance as the compiled module",
        )
      }),
  )

  it.effect("rejects unknown lifecycle keys while wrapping raw handlers", () =>
    Effect.gen(function* () {
      const server = makeServer({
        module: FullModule,
        runtime: TestSyncRunner,
      })

      expect(() =>
        server.handlers({
          lifecycle: {
            bogus: () => Effect.void,
          },
        } as never),
      ).toThrow("Unknown lifecycle handler key bogus")
    }),
  )

  it.effect("rejects unknown raw handler keys while wrapping records", () =>
    Effect.gen(function* () {
      const server = makeServer({
        module: FullModule,
        runtime: TestSyncRunner,
      })

      expect(() =>
        server.handlers({
          reducers: {
            bogus: () => Effect.void,
          },
        } as never),
      ).toThrow("Unknown reducer handler key bogus")

      expect(() =>
        server.handlers({
          views: {
            bogus: () => Effect.succeed([]),
          },
        } as never),
      ).toThrow("Unknown view handler key bogus")

      expect(() =>
        server.handlers({
          procedures: {
            bogus: () => Effect.void,
          },
        } as never),
      ).toThrow("Unknown procedure handler key bogus")

      expect(() =>
        server.handlers({
          httpHandlers: {
            bogus: () => Effect.void,
          },
        } as never),
      ).toThrow("Unknown HTTP handler key bogus")
    }),
  )

  it.effect(
    "reports missing required handlers with aggregate diagnostics",
    () =>
      Effect.gen(function* () {
        const server = makeServer({
          module: FullModule,
          runtime: TestSyncRunner,
        })

        expect(() =>
          compileModule({
            server,
            handlers: server.handlers({
              reducers: {
                userUpsert: Effect.fn(function* ({
                  userId,
                  name,
                }: UserUpsertArgs) {
                  void userId
                  void name
                  return undefined
                }),
                userRequire: Effect.fn(function* ({ userId }: UserRequireArgs) {
                  void userId
                  return undefined
                }),
              },
            } as never),
          }),
        ).toThrow("Missing server procedure handler for userGet")
        expect(() =>
          compileModule({
            server,
            handlers: server.handlers({
              reducers: {
                userUpsert: Effect.fn(function* ({
                  userId,
                  name,
                }: UserUpsertArgs) {
                  void userId
                  void name
                  return undefined
                }),
                userRequire: Effect.fn(function* ({ userId }: UserRequireArgs) {
                  void userId
                  return undefined
                }),
              },
            } as never),
          }),
        ).toThrow("Missing server lifecycle handler for init")
      }),
  )
})
