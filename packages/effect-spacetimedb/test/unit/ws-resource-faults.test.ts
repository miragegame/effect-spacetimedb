import * as EffectVitest from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Duration from "effect/Duration"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as TestClock from "effect/testing/TestClock"
import * as Stdb from "effect-spacetimedb"
import { WsUnsupportedBuilderFeatureError } from "effect-spacetimedb/client"
import * as StdbTesting from "effect-spacetimedb/testing"
import {
  WsConnectError,
  WsConnectTimeoutError,
} from "effect-spacetimedb/testing"
import { Identity } from "spacetimedb"
import { FullModule } from "../fixtures/full-module"
import { TestLayer } from "../helpers/test-layer"
import { makeFullModuleWsConnection } from "../helpers/ws-fixtures"

const { expect } = EffectVitest
const describe = EffectVitest.layer(TestLayer)

const plan = StdbTesting.makeModulePlan(FullModule)
const uri = "ws://localhost:3000"
const databaseName = "test"
const EmptyModule = Stdb.StdbModule.make("empty", {}).spec

type FullBuilder = StdbTesting.GeneratedWsBuilderLike<
  typeof FullModule,
  unknown
>
type FullConnection = StdbTesting.ManagedWsConnection<
  typeof FullModule,
  unknown
>
type FullOnConnect = Parameters<FullBuilder["onConnect"]>[0]
type FullOnConnectError = Parameters<FullBuilder["onConnectError"]>[0]

type FaultBuilderCallbacks = {
  readonly onConnect: FullOnConnect | undefined
  readonly onConnectError: FullOnConnectError | undefined
  readonly makeConnection: () => FullConnection
}

const makeFaultBuilder = (options: {
  readonly build: (callbacks: FaultBuilderCallbacks) => FullConnection
}) => {
  let disconnectCount = 0
  let onConnect: FullOnConnect | undefined
  let onConnectError: FullOnConnectError | undefined

  const makeConnection = (): FullConnection => ({
    ...makeFullModuleWsConnection(),
    disconnect: () => {
      disconnectCount = disconnectCount + 1
    },
  })

  const builder: FullBuilder = {
    withUri: () => builder,
    withDatabaseName: () => builder,
    withToken: () => builder,
    withCompression: () => builder,
    onConnect: (callback) => {
      onConnect = callback
      return builder
    },
    onDisconnect: () => builder,
    onConnectError: (callback) => {
      onConnectError = callback
      return builder
    },
    build: () =>
      options.build({
        onConnect,
        onConnectError,
        makeConnection,
      }),
  }

  return {
    builder,
    disconnectCount: () => disconnectCount,
  }
}

describe("ws resource fault injection", (it) => {
  it.effect(
    "generated acquisition rejects a missing public table and disconnects once",
    () =>
      Effect.gen(function* () {
        const fault = makeFaultBuilder({
          build: ({ onConnect, makeConnection }) => {
            const connection = makeConnection()
            Reflect.deleteProperty(connection.db, "user")

            onConnect?.(connection, Identity.zero(), "token")
            return connection
          },
        })

        const error = yield* Effect.flip(
          StdbTesting.project(FullModule)
            .client.ws.scopedGenerated({
              DbConnection: { builder: () => fault.builder },
              uri,
              databaseName,
            })
            .pipe(Effect.scoped),
        )

        expect(StdbTesting.GeneratedArtifactShapeError.is(error)).toBe(true)
        if (StdbTesting.GeneratedArtifactShapeError.is(error)) {
          expect(error.missingKeys).toEqual(["user"])
          expect(error.moduleName).toBe(FullModule.name)
        }
        expect(fault.disconnectCount()).toBe(1)
      }),
  )

  it.effect(
    "generated acquisition rejects a stale table without its native index accessor",
    () =>
      Effect.gen(function* () {
        const fault = makeFaultBuilder({
          build: ({ onConnect, makeConnection }) => {
            const connection = makeConnection()
            Reflect.deleteProperty(connection.db.user, "id")
            onConnect?.(connection, Identity.zero(), "token")
            return connection
          },
        })

        const error = yield* Effect.flip(
          StdbTesting.project(FullModule)
            .client.ws.scopedGenerated({
              DbConnection: { builder: () => fault.builder },
              uri,
              databaseName,
            })
            .pipe(Effect.scoped),
        )

        expect(StdbTesting.GeneratedArtifactShapeError.is(error)).toBe(true)
        if (StdbTesting.GeneratedArtifactShapeError.is(error)) {
          expect(error.missingKeys).toEqual(["user.id.find"])
          expect(error.unsupportedIndexes).toEqual([])
        }
        expect(fault.disconnectCount()).toBe(1)
      }),
  )

  it.effect("generated acquisition rejects a missing public event table", () =>
    Effect.gen(function* () {
      const fault = makeFaultBuilder({
        build: ({ onConnect, makeConnection }) => {
          const connection = makeConnection()
          Reflect.deleteProperty(connection.db, "presenceEvent")

          onConnect?.(connection, Identity.zero(), "token")
          return connection
        },
      })

      const error = yield* Effect.flip(
        StdbTesting.project(FullModule)
          .client.ws.scopedGenerated({
            DbConnection: { builder: () => fault.builder },
            uri,
            databaseName,
          })
          .pipe(Effect.scoped),
      )

      expect(StdbTesting.GeneratedArtifactShapeError.is(error)).toBe(true)
      if (StdbTesting.GeneratedArtifactShapeError.is(error)) {
        expect(error.missingKeys).toEqual(["presenceEvent"])
      }
    }),
  )

  it.effect(
    "disconnects when generated shape inspection throws after build",
    () =>
      Effect.gen(function* () {
        const fault = makeFaultBuilder({
          build: ({ makeConnection }) => {
            const connection = makeConnection()
            Object.defineProperty(connection.db, "user", {
              enumerable: true,
              get: () => {
                throw new Error("lazy relation construction failed")
              },
            })
            return connection
          },
        })

        const error = yield* Effect.flip(
          StdbTesting.project(FullModule)
            .client.ws.scopedGenerated({
              DbConnection: { builder: () => fault.builder },
              uri,
              databaseName,
            })
            .pipe(Effect.scoped),
        )

        expect(WsConnectError.is(error)).toBe(true)
        expect(fault.disconnectCount()).toBe(1)
      }),
  )

  it.effect(
    "generated acquisition reports a missing db object without throwing",
    () =>
      Effect.gen(function* () {
        const fault = makeFaultBuilder({
          build: ({ makeConnection }) => {
            const connection = makeConnection()
            Reflect.deleteProperty(connection, "db")
            return connection
          },
        })

        const error = yield* Effect.flip(
          StdbTesting.project(FullModule)
            .client.ws.scopedGenerated({
              DbConnection: { builder: () => fault.builder },
              uri,
              databaseName,
            })
            .pipe(Effect.scoped),
        )

        expect(StdbTesting.GeneratedArtifactShapeError.is(error)).toBe(true)
        if (StdbTesting.GeneratedArtifactShapeError.is(error)) {
          expect(error.missingKeys).toEqual(["user", "presenceEvent"])
        }
      }),
  )

  it.effect("generated acquisition requires db for a table-free module", () =>
    Effect.gen(function* () {
      type EmptyConnection = StdbTesting.ManagedWsConnection<
        typeof EmptyModule,
        unknown
      >
      type EmptyBuilder = StdbTesting.GeneratedWsBuilderLike<
        typeof EmptyModule,
        unknown
      >
      type EmptyQueryRoot = StdbTesting.ClientQueryRoot<typeof EmptyModule>

      const subscriptionBuilder: StdbTesting.SubscriptionBuilderLike<
        unknown,
        EmptyQueryRoot
      > = {
        onApplied: () => subscriptionBuilder,
        onError: () => subscriptionBuilder,
        subscribe: () => ({
          isEnded: () => true,
          unsubscribe: () => undefined,
        }),
      }
      const connection: EmptyConnection = {
        db: {},
        disconnect: () => undefined,
        subscriptionBuilder: () => subscriptionBuilder,
      }
      Reflect.deleteProperty(connection, "db")

      const builder: EmptyBuilder = {
        withUri: () => builder,
        withDatabaseName: () => builder,
        withToken: () => builder,
        withCompression: () => builder,
        onConnect: () => builder,
        onDisconnect: () => builder,
        onConnectError: () => builder,
        build: () => connection,
      }

      const error = yield* Effect.flip(
        StdbTesting.project(EmptyModule)
          .client.ws.scopedGenerated({
            DbConnection: { builder: () => builder },
            uri,
            databaseName,
          })
          .pipe(Effect.scoped),
      )

      expect(StdbTesting.GeneratedArtifactShapeError.is(error)).toBe(true)
      if (StdbTesting.GeneratedArtifactShapeError.is(error)) {
        expect(error.missingKeys).toEqual([])
      }
    }),
  )

  it.effect("onConnectError fails acquisition with WsConnectError", () =>
    Effect.gen(function* () {
      const fault = makeFaultBuilder({
        build: ({ onConnectError, makeConnection }) => {
          const connection = makeConnection()

          onConnectError?.(undefined, new Error("boom"))
          return connection
        },
      })

      const error = yield* Effect.flip(
        StdbTesting.makeScopedFromModulePlan({
          plan,
          config: {
            builder: () => fault.builder,
            uri,
            databaseName,
          },
        }).pipe(Effect.scoped),
      )

      expect(WsConnectError.is(error)).toBe(true)
      expect(
        error.cause instanceof Error && error.cause.message.includes("boom"),
      ).toBe(true)
    }),
  )

  it.effect("failed acquisition disconnects built connection once", () =>
    Effect.gen(function* () {
      const fault = makeFaultBuilder({
        build: ({ onConnectError, makeConnection }) => {
          const connection = makeConnection()

          onConnectError?.(undefined, new Error("boom"))
          return connection
        },
      })

      const error = yield* Effect.flip(
        StdbTesting.makeScopedFromModulePlan({
          plan,
          config: {
            builder: () => fault.builder,
            uri,
            databaseName,
          },
        }).pipe(Effect.scoped),
      )

      expect(WsConnectError.is(error)).toBe(true)
      expect(fault.disconnectCount()).toBe(1)
    }),
  )

  it.effect(
    "fails and closes a connection that never settles before timeout",
    () =>
      Effect.gen(function* () {
        const fault = makeFaultBuilder({
          build: ({ makeConnection }) => makeConnection(),
        })

        const fiber = yield* StdbTesting.makeScopedFromModulePlan({
          plan,
          config: {
            builder: () => fault.builder,
            uri,
            databaseName,
            connectTimeoutMillis: 10,
          },
        }).pipe(Effect.scoped, Effect.forkChild)
        yield* Effect.yieldNow
        yield* TestClock.adjust(Duration.millis(10))
        const error = yield* Fiber.join(fiber).pipe(Effect.flip)

        expect(WsConnectError.is(error)).toBe(true)
        if (WsConnectError.is(error)) {
          expect(WsConnectTimeoutError.is(error.cause)).toBe(true)
        }
        expect(fault.disconnectCount()).toBe(1)
      }),
  )

  it.effect("keeps a late onConnect terminal after timeout", () =>
    Effect.gen(function* () {
      let lateOnConnect: FullOnConnect | undefined
      let makeLateConnection: (() => FullConnection) | undefined
      let connection: FullConnection | undefined
      const fault = makeFaultBuilder({
        build: ({ onConnect, makeConnection }) => {
          lateOnConnect = onConnect
          makeLateConnection = makeConnection
          connection = makeConnection()
          return connection
        },
      })

      const fiber = yield* StdbTesting.makeScopedFromModulePlan({
        plan,
        config: {
          builder: () => fault.builder,
          uri,
          databaseName,
          connectTimeoutMillis: 10,
        },
      }).pipe(Effect.scoped, Effect.forkChild)
      yield* Effect.yieldNow
      yield* TestClock.adjust(Duration.millis(10))

      const error = yield* Fiber.join(fiber).pipe(Effect.flip)
      expect(WsConnectError.is(error)).toBe(true)
      expect(fault.disconnectCount()).toBe(1)

      expect(lateOnConnect).toBeDefined()
      expect(connection).toBeDefined()
      if (lateOnConnect != null && connection != null) {
        lateOnConnect(connection, Identity.zero(), "late-token")
      }

      expect(fault.disconnectCount()).toBe(1)

      const differentConnection = makeLateConnection?.()
      expect(differentConnection).toBeDefined()
      if (lateOnConnect != null && differentConnection != null) {
        lateOnConnect(differentConnection, Identity.zero(), "other-late-token")
      }

      expect(fault.disconnectCount()).toBe(2)
    }),
  )

  it.effect("settles acquisition when an onConnect callback body defects", () =>
    Effect.gen(function* () {
      const fault = makeFaultBuilder({
        build: ({ onConnect, makeConnection }) => {
          const connection = makeConnection()
          Object.defineProperty(connection, "db", {
            get: () => {
              throw new Error("callback body defect")
            },
          })
          onConnect?.(connection, Identity.zero(), "token")
          return connection
        },
      })

      const error = yield* Effect.flip(
        StdbTesting.makeScopedFromModulePlan({
          plan,
          config: {
            builder: () => fault.builder,
            uri,
            databaseName,
            connectTimeoutMillis: 100,
          },
        }).pipe(Effect.scoped),
      )

      expect(WsConnectError.is(error)).toBe(true)
      if (WsConnectError.is(error)) {
        expect(String(error.cause)).toContain("callback body defect")
      }
      expect(fault.disconnectCount()).toBe(1)
    }),
  )

  it.effect("interruption during a live session disconnects once", () =>
    Effect.gen(function* () {
      const fault = makeFaultBuilder({
        build: ({ onConnect, makeConnection }) => {
          const connection = makeConnection()

          onConnect?.(connection, Identity.zero(), "token")
          return connection
        },
      })

      const exit = yield* StdbTesting.makeScopedFromModulePlan({
        plan,
        config: {
          builder: () => fault.builder,
          uri,
          databaseName,
        },
      }).pipe(Effect.andThen(Effect.interrupt), Effect.scoped, Effect.exit)

      expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(
        true,
      )
      expect(fault.disconnectCount()).toBe(1)
    }),
  )

  it.effect(
    "createWebSocket without withWSFn is wrapped as a connect error",
    () =>
      Effect.gen(function* () {
        const fault = makeFaultBuilder({
          build: ({ makeConnection }) => makeConnection(),
        })

        const error = yield* Effect.flip(
          StdbTesting.makeScopedFromModulePlan({
            plan,
            config: {
              builder: () => fault.builder,
              uri,
              databaseName,
              createWebSocket: () => ({}),
            },
          }).pipe(Effect.scoped),
        )

        expect(WsConnectError.is(error)).toBe(true)
        expect(WsUnsupportedBuilderFeatureError.is(error.cause)).toBe(true)
      }),
  )
})
