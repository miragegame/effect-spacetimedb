import * as EffectVitest from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import { WsUnsupportedBuilderFeatureError } from "effect-spacetimedb/client"
import * as StdbTesting from "effect-spacetimedb/testing"
import { WsConnectError } from "effect-spacetimedb/testing"
import { Identity } from "spacetimedb"
import { FullModule } from "../fixtures/full-module"
import { TestLayer } from "../helpers/test-layer"
import { makeFullModuleWsConnection } from "../helpers/ws-fixtures"

const { expect } = EffectVitest
const describe = EffectVitest.layer(TestLayer)

const plan = StdbTesting.makeModulePlan(FullModule)
const uri = "ws://localhost:3000"
const databaseName = "test"

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
