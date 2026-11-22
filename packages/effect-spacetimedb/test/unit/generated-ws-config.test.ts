import * as Effect from "effect/Effect"
import * as EffectVitest from "@effect/vitest"
import { fixtureConnectTimeoutMillis } from "../helpers/transport-bounds"
const { expect } = EffectVitest
import * as StdbInternal from "effect-spacetimedb/testing/internal"
import { FullModule } from "../fixtures/full-module"
import { TestLayer } from "../helpers/test-layer"
import { makeFullModuleWsConnection } from "../helpers/ws-fixtures"

const describe = EffectVitest.layer(TestLayer)

describe("generated ws config", (it) => {
  it.effect(
    "accepts a generated DbConnection class without consumer casts",
    () =>
      Effect.gen(function* () {
        const calls: Array<string> = []

        const builder: StdbInternal.GeneratedWsBuilderLike<
          typeof FullModule,
          unknown
        > = {
          withUri: (uri) => {
            calls.push(`uri:${uri}`)
            return builder
          },
          withDatabaseName: (name) => {
            calls.push(`db:${name}`)
            return builder
          },
          withToken: () => builder,
          withCompression: () => builder,
          onConnect: () => builder,
          onDisconnect: () => builder,
          onConnectError: () => builder,
          build: () => {
            calls.push("build")
            return {
              ...makeFullModuleWsConnection(),
              disconnect: () => {},
            }
          },
        }

        // Shaped exactly like native codegen output: a class with a static builder.
        class DbConnection {
          static builder = () => builder
        }

        const config = StdbInternal.ClientGeneratedWsAdapter.generatedConfig({
          DbConnection,
          uri: "ws://localhost:3000",
          databaseName: "generated-config-test",
          connectDurationMax: 1_234,
          callDurationMax: "12 seconds",
        })

        expect(config.connectDurationMax).toBe(1_234)
        expect(config.callDurationMax).toBe("12 seconds")

        const configured =
          StdbInternal.ClientGeneratedWsAdapter.configureGeneratedWsBuilder(
            config,
            { token: undefined, refreshToken: undefined },
          )
        configured.build()

        expect(calls).toEqual([
          "uri:ws://localhost:3000",
          "db:generated-config-test",
          "build",
        ])
      }),
  )
  it.effect("passes brotli compression through to the native builder", () =>
    Effect.gen(function* () {
      const calls: Array<string> = []

      const builder: StdbInternal.GeneratedWsBuilderLike<
        typeof FullModule,
        unknown
      > = {
        withUri: (uri) => {
          calls.push(`uri:${uri}`)
          return builder
        },
        withDatabaseName: (name) => {
          calls.push(`db:${name}`)
          return builder
        },
        withToken: () => builder,
        withCompression: (compression) => {
          calls.push(`compression:${compression}`)
          return builder
        },
        onConnect: () => builder,
        onDisconnect: () => builder,
        onConnectError: () => builder,
        build: () => ({
          ...makeFullModuleWsConnection(),
          disconnect: () => {},
        }),
      }

      class DbConnection {
        static builder = () => builder
      }

      const config = StdbInternal.ClientGeneratedWsAdapter.generatedConfig({
        DbConnection,
        uri: "ws://localhost:3000",
        databaseName: "brotli-test",
        connectDurationMax: fixtureConnectTimeoutMillis,
        compression: "brotli",
      })

      StdbInternal.ClientGeneratedWsAdapter.configureGeneratedWsBuilder(
        config,
        {
          token: undefined,
          refreshToken: undefined,
        },
      )

      expect(calls).toEqual([
        "uri:ws://localhost:3000",
        "db:brotli-test",
        "compression:brotli",
      ])
    }),
  )
})
