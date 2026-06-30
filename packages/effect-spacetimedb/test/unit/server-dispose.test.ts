import * as EffectVitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Ref from "effect/Ref"

const { expect } = EffectVitest

import {
  fromLayer,
  Request,
  StdbServerDisposedError,
  SyncResponse,
} from "effect-spacetimedb/server"
import * as StdbTesting from "effect-spacetimedb/testing"
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

const procedureCtx = {
  ...reducerCtx,
  http: {
    fetch: () => new SyncResponse(""),
  },
  withTx: <A>(body: (ctx: typeof reducerCtx) => A): A => body(reducerCtx),
}

const anonymousViewCtx = {
  db: {} as never,
  from: {} as never,
}

const httpDb = {} as never

// Keep this shape valid so the guard-removed HTTP bite flips to 200, not an incidental 500.
const httpCtx = {
  timestamp: {
    microsSinceUnixEpoch: 1n,
  },
  databaseIdentity: "identity",
  http: {
    fetch: () => new SyncResponse(""),
  },
  random,
  withTx: <A>(body: (ctx: { readonly db: typeof httpDb }) => A): A =>
    body({ db: httpDb }),
  newUuidV4: () => "uuid-v4",
  newUuidV7: () => "uuid-v7",
}

const catchInvokeFailure = (invoke: () => unknown): unknown => {
  try {
    invoke()
    return undefined
  } catch (cause) {
    return cause
  }
}

const expectDisposedError = (
  caught: unknown,
  payload: {
    readonly handler: string
    readonly kind: StdbServerDisposedError["kind"]
  },
) => {
  expect(StdbServerDisposedError.is(caught)).toBe(true)
  if (StdbServerDisposedError.is(caught)) {
    expect(caught).toMatchObject({
      module: FullModule.name,
      ...payload,
    })
  }
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

  it.effect("rejects reducer invokes after dispose before handler entry", () =>
    Effect.gen(function* () {
      const entered: Array<string> = []
      const server = StdbTesting.makeServer({
        module: FullModule,
        runtime: TestSyncRunner,
      })

      const recordingReducer = () => {
        entered.push("reducer")
        return Effect.void
      }

      const reducers = server.reducers({
        userUpsert: server.reducer(recordingReducer) as never,
      })

      yield* server.dispose

      const caught = catchInvokeFailure(() =>
        reducers.userUpsert!.invoke(reducerCtx as never, {
          userId: "user-1" as never,
          name: "Ada" as never,
        }),
      )

      expect({
        disposedError: StdbServerDisposedError.is(caught),
        entered,
      }).toEqual({
        disposedError: true,
        entered: [],
      })
      expectDisposedError(caught, {
        handler: "userUpsert",
        kind: "reducer",
      })
    }),
  )

  it.effect(
    "rejects procedure invokes after dispose before handler entry",
    () =>
      Effect.gen(function* () {
        const entered: Array<string> = []
        const server = StdbTesting.makeServer({
          module: FullModule,
          runtime: TestSyncRunner,
        })

        const recordingProcedure = () => {
          entered.push("procedure")
          return Effect.void
        }

        const procedures = server.procedures({
          userGet: server.procedure(recordingProcedure) as never,
        })

        yield* server.dispose

        const caught = catchInvokeFailure(() =>
          procedures.userGet!.invoke(procedureCtx as never, {
            userId: "user-1" as never,
          }),
        )

        expect({
          disposedError: StdbServerDisposedError.is(caught),
          entered,
        }).toEqual({
          disposedError: true,
          entered: [],
        })
        expectDisposedError(caught, {
          handler: "userGet",
          kind: "procedure",
        })
      }),
  )

  it.effect("rejects view invokes after dispose before handler entry", () =>
    Effect.gen(function* () {
      const entered: Array<string> = []
      const server = StdbTesting.makeServer({
        module: FullModule,
        runtime: TestSyncRunner,
      })

      const recordingView = () => {
        entered.push("view")
        return Effect.succeed([])
      }

      const views = server.views({
        allUsers: server.anonymousView(recordingView) as never,
      })

      yield* server.dispose

      const caught = catchInvokeFailure(() =>
        views.allUsers!.invoke(anonymousViewCtx as never, {}),
      )

      expect({
        disposedError: StdbServerDisposedError.is(caught),
        entered,
      }).toEqual({
        disposedError: true,
        entered: [],
      })
      expectDisposedError(caught, {
        handler: "allUsers",
        kind: "view",
      })
    }),
  )

  it.effect(
    "rejects lifecycle invokes after dispose before handler entry",
    () =>
      Effect.gen(function* () {
        const entered: Array<string> = []
        const server = StdbTesting.makeServer({
          module: FullModule,
          runtime: TestSyncRunner,
        })

        const recordingLifecycle = () => {
          entered.push("lifecycle")
          return Effect.void
        }

        const lifecycle = server.lifecycle({
          init: server.init(recordingLifecycle),
        })

        yield* server.dispose

        const caught = catchInvokeFailure(() =>
          lifecycle.init!.invoke(reducerCtx as never),
        )

        expect({
          disposedError: StdbServerDisposedError.is(caught),
          entered,
        }).toEqual({
          disposedError: true,
          entered: [],
        })
        expectDisposedError(caught, {
          handler: "init",
          kind: "lifecycle",
        })
      }),
  )

  it.effect(
    "returns 500 for HTTP handler invokes after dispose before entry",
    () =>
      Effect.gen(function* () {
        const entered: Array<string> = []
        const server = StdbTesting.makeServer({
          module: FullModule,
          runtime: TestSyncRunner,
        })

        const recordingHttpHandler = () => {
          entered.push("httpHandler")
          return Effect.succeed(new SyncResponse("ok"))
        }

        const httpHandlers = server.httpHandlers({
          stripeWebhook: server.httpHandler(recordingHttpHandler) as never,
        })

        yield* server.dispose

        const response = httpHandlers.stripeWebhook!.invoke(
          httpCtx as never,
          new Request("/webhooks/stripe", { method: "POST" }),
        )

        expect({
          status: response.status,
          statusText: response.statusText,
          body: response.text(),
          headers: Array.from(response.headers.entries()),
          entered,
        }).toEqual({
          status: 500,
          statusText: "",
          body: "",
          headers: [],
          entered: [],
        })
      }),
  )

  it.effect(
    "replaces disposed layer-backed runtime defects with the typed reducer error",
    () =>
      Effect.gen(function* () {
        const runtimeLayer = Layer.empty
        const entered: Array<string> = []
        const server = StdbTesting.makeServer({
          module: FullModule,
          runtime: fromLayer(runtimeLayer),
        })

        const recordingReducer = () => {
          entered.push("reducer")
          return Effect.void
        }

        const reducers = server.reducers({
          userUpsert: server.reducer(recordingReducer) as never,
        })

        reducers.userUpsert!.invoke(reducerCtx as never, {
          userId: "user-1" as never,
          name: "Ada" as never,
        })
        expect(entered).toEqual(["reducer"])
        entered.length = 0

        yield* server.dispose

        const caught = catchInvokeFailure(() =>
          reducers.userUpsert!.invoke(reducerCtx as never, {
            userId: "user-1" as never,
            name: "Ada" as never,
          }),
        )

        expect({
          disposedError: StdbServerDisposedError.is(caught),
          entered,
        }).toEqual({
          disposedError: true,
          entered: [],
        })
        expectDisposedError(caught, {
          handler: "userUpsert",
          kind: "reducer",
        })
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
