// lint-ignore: no-unnecessary-type-assertion - casts model host and type-level test boundaries intentionally.
import * as EffectVitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Ref from "effect/Ref"
const { expect } = EffectVitest
import * as StdbTesting from "effect-spacetimedb/testing"
import { fromLayer } from "effect-spacetimedb/server"
import { FullModule } from "../fixtures/full-module"
import { TestSyncRunner } from "../helpers/sync-runner"
import { TestLayer } from "../helpers/test-layer"

const describe = EffectVitest.layer(TestLayer)

const random = Object.assign(() => 0.5, {
  fill: <T>(array: T): T => array,
  uint32: () => 1,
  integerInRange: (min: number) => min,
  bigintInRange: (min: bigint) => min,
})

const reducerCtx = {
  sender: "sender",
  identity: "identity",
  timestamp: {
    microsSinceUnixEpoch: 1n,
  },
  connectionId: "connection-1",
  senderAuth: {
    isInternal: false,
    hasJWT: false,
    jwt: null,
  },
  newUuidV4: () => "uuid-v4",
  newUuidV7: () => "uuid-v7",
  random,
  db: {} as never,
}

const useLayerBackedRuntime = (
  server: StdbTesting.ServerInstance<typeof FullModule>,
) => {
  const reducers = server.reducers({
    userUpsert: server.reducer(
      Effect.fn(function* () {
        return undefined
      }),
    ) as never,
  })

  reducers.userUpsert!.invoke(reducerCtx as never, {
    userId: "user-1" as never,
    name: "Ada" as never,
  })
}

describe("server dispose", (it) => {
  it.effect(
    "runs layer-backed runtime finalizers through the server dispose effect",
    () =>
      Effect.gen(function* () {
        const finalizers = yield* Ref.make(0)
        const runtimeLayer = Layer.effectDiscard(
          Effect.acquireRelease(Effect.void, () =>
            Ref.update(finalizers, (count) => count + 1),
          ),
        )

        const server = StdbTesting.makeServer({
          module: FullModule,
          runtime: fromLayer(runtimeLayer),
        })

        useLayerBackedRuntime(server)
        yield* server.dispose

        expect(yield* Ref.get(finalizers)).toBe(1)
      }),
  )

  it.effect("treats dispose as a no-op for non-disposable runtimes", () =>
    Effect.gen(function* () {
      const server = StdbTesting.makeServer({
        module: FullModule,
        runtime: TestSyncRunner,
      })

      const exit = yield* Effect.exit(server.dispose)

      expect(Exit.isSuccess(exit)).toBe(true)
    }),
  )

  it.effect("keeps repeated dispose calls idempotent", () =>
    Effect.gen(function* () {
      const finalizers = yield* Ref.make(0)
      const runtimeLayer = Layer.effectDiscard(
        Effect.acquireRelease(Effect.void, () =>
          Ref.update(finalizers, (count) => count + 1),
        ),
      )

      const server = StdbTesting.makeServer({
        module: FullModule,
        runtime: fromLayer(runtimeLayer),
      })

      useLayerBackedRuntime(server)
      yield* server.dispose
      yield* server.dispose

      expect(yield* Ref.get(finalizers)).toBe(1)
    }),
  )
})
