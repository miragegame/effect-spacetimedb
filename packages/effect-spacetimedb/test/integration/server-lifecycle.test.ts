import * as Effect from "effect/Effect"
import * as EffectVitest from "@effect/vitest"
const { expect } = EffectVitest
import { FullModule } from "../fixtures/full-module"
import * as StdbTesting from "effect-spacetimedb/testing"
import {
  type CapturedLog,
  logWithCapturedLogger,
} from "../helpers/server-runtime"
import { TestSyncRunner } from "../helpers/sync-runner"
import { TestLayer } from "../helpers/test-layer"

const describe = EffectVitest.layer(TestLayer)

const random = Object.assign(() => 0.5, {
  fill: <T>(array: T): T => array,
  uint32: () => 1,
  integerInRange: (min: number) => min,
  bigintInRange: (min: bigint) => min,
})

const makeCtx = () => ({
  sender: "sender",
  identity: "identity",
  timestamp: {
    microsSinceUnixEpoch: 1_000n,
  },
  connectionId: "connection",
  senderAuth: {
    isInternal: false,
    hasJWT: false,
    jwt: null,
  },
  newUuidV4: () => "uuid-v4",
  newUuidV7: () => "uuid-v7",
  random,
  db: {
    user: {
      count: () => 0n,
      iter: () => ([] as ReadonlyArray<unknown>).values(),
      insert: () => undefined,
      delete: () => undefined,
      update: () => undefined,
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
    presenceEvent: {
      count: () => 0n,
      iter: () => ([] as ReadonlyArray<unknown>).values(),
      insert: () => undefined,
      delete: () => undefined,
      update: () => undefined,
      onInsert: () => undefined,
      removeOnInsert: () => undefined,
      onDelete: () => undefined,
      removeOnDelete: () => undefined,
      onUpdate: () => undefined,
      removeOnUpdate: () => undefined,
    },
    reminder: {
      count: () => 0n,
      iter: () => ([] as ReadonlyArray<unknown>).values(),
      insert: () => undefined,
      delete: () => undefined,
      update: () => undefined,
      id: {
        find: () => undefined,
        delete: () => undefined,
        upsert: () => undefined,
      },
    },
  },
})

describe("server lifecycle", (it) => {
  it.effect(
    "binds init and connection lifecycle handlers through reducer context",
    () =>
      Effect.gen(function* () {
        const server = StdbTesting.makeServer({
          module: FullModule,
          runtime: TestSyncRunner,
        })

        const seen = [] as Array<string>

        const lifecycle = server.lifecycle({
          init: server.init(
            Effect.fn(function* () {
              const ctx = yield* server.reducerCtx
              seen.push(`init:${String(ctx.connectionId)}`)
            }),
          ) as never,
          clientConnected: server.clientConnected(
            Effect.fn(function* () {
              const ctx = yield* server.reducerCtx
              seen.push(`connected:${String(ctx.connectionId)}`)
            }),
          ) as never,
          clientDisconnected: server.clientDisconnected(
            Effect.fn(function* () {
              const ctx = yield* server.reducerCtx
              seen.push(`disconnected:${String(ctx.connectionId)}`)
            }),
          ) as never,
        })

        const ctx = makeCtx()
        lifecycle.init.invoke(ctx as never)
        lifecycle.clientConnected.invoke(ctx as never)
        lifecycle.clientDisconnected.invoke(ctx as never)

        expect(seen).toEqual([
          "init:connection",
          "connected:connection",
          "disconnected:connection",
        ])
      }),
  )

  it.effect(
    "annotates lifecycle logs with module, handler, kind, and sender",
    () =>
      Effect.gen(function* () {
        const server = StdbTesting.makeServer({
          module: FullModule,
          runtime: TestSyncRunner,
        })
        const records: Array<CapturedLog> = []
        const lifecycle = server.lifecycle({
          init: server.init(
            Effect.fn(function* () {
              yield* logWithCapturedLogger(records, "lifecycle log")
            }),
          ) as never,
        })

        lifecycle.init.invoke(makeCtx() as never)

        expect(records).toHaveLength(1)
        expect(records[0]?.annotations).toEqual({
          module: "example",
          handler: "init",
          kind: "lifecycle",
          sender: "sender",
        })
      }),
  )
})
