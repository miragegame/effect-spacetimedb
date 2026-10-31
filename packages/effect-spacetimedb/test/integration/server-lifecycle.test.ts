import { make as makeServer } from "../../src/server/bind.ts"
import { StdbSenderFailure } from "../../src/server/services.ts"
import * as Effect from "effect/Effect"
import * as EffectVitest from "@effect/vitest"
const { expect } = EffectVitest
import { FullModule } from "../fixtures/full-module"
import * as Stdb from "effect-spacetimedb"
import * as StdbTesting from "effect-spacetimedb/testing"
import {
  type CapturedLog,
  logWithCapturedLogger,
} from "../helpers/server-runtime"
import { compileModule } from "../helpers/compile-module"
import {
  testEffectCallbackError,
  unwrapTestEffectCallbackError,
} from "../helpers/effect-errors"
import * as SpacetimeServerStub from "../helpers/spacetimedb-server"
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

  it.effect(
    "hands the host a lifecycle hook's sender failure as the host's SenderError",
    () =>
      Effect.gen(function* () {
        // A refusing `clientConnected` must reach the host as its own
        // `SenderError`: SpacetimeDB refuses the connection with the message
        // only for that class, and reads anything else as a module fault.
        const RefusingModule = Stdb.StdbModule.make("lifecycle_refusal", {
          lifecycle: { clientConnected: Stdb.StdbFn.clientConnected() },
        }).spec
        const server = makeServer({
          module: RefusingModule,
          runtime: TestSyncRunner,
        })
        const compiled = compileModule({
          server,
          handlers: server.handlers({
            lifecycle: {
              clientConnected: () =>
                Effect.fail(
                  new StdbSenderFailure({ value: "connection refused" }),
                ),
            },
          }),
        })
        const ctx =
          StdbTesting.makeTestModuleHarness(RefusingModule).makeMutationCtx()
        const refusal = yield* Effect.try({
          try: () =>
            SpacetimeServerStub.invokeModuleExport(
              compiled.exports.clientConnected,
              ctx,
              undefined,
            ),
          catch: testEffectCallbackError(
            "effect-spacetimedb/integration/server-lifecycle",
          ),
        }).pipe(
          Effect.asVoid,
          Effect.flip,
          Effect.map(unwrapTestEffectCallbackError),
        )
        expect(refusal).toBeInstanceOf(SpacetimeServerStub.SenderError)
        expect(refusal).toMatchObject({ message: "connection refused" })
      }),
  )
})
