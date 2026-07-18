import { make as makeServer } from "../../src/server/bind.ts"
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

const makeCtx = () =>
  StdbTesting.makeTestModuleHarness(FullModule).makeMutationCtx()

describe("server lifecycle", (it) => {
  it.effect(
    "binds init and connection lifecycle handlers through reducer context",
    () =>
      Effect.gen(function* () {
        const server = makeServer({
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
        lifecycle.init.invoke(ctx)
        lifecycle.clientConnected.invoke(ctx)
        lifecycle.clientDisconnected.invoke(ctx)

        expect(seen).toEqual([
          `init:${String(ctx.connectionId)}`,
          `connected:${String(ctx.connectionId)}`,
          `disconnected:${String(ctx.connectionId)}`,
        ])
      }),
  )

  it.effect(
    "annotates lifecycle logs with module, handler, kind, and sender",
    () =>
      Effect.gen(function* () {
        const server = makeServer({
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

        const ctx = makeCtx()
        lifecycle.init.invoke(ctx)

        expect(records).toHaveLength(1)
        expect(records[0]?.annotations).toEqual({
          module: "example",
          handler: "init",
          kind: "lifecycle",
          sender: String(ctx.sender),
        })
      }),
  )
})
