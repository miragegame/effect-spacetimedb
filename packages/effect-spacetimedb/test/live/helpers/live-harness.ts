// lint-ignore: no-unnecessary-type-assertion - casts model host and type-level test boundaries intentionally.
import * as NodeChildProcessSpawner from "@effect/platform-node/NodeChildProcessSpawner"
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem"
import * as NodePath from "@effect/platform-node/NodePath"
import { liveTestEffectCallbackError } from "./effect-errors"
import * as Data from "effect/Data"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import type * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as Scope from "effect/Scope"
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient"
import type * as HttpClient from "effect/unstable/http/HttpClient"
import type * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"
import {
  DevServerBinaryError,
  makeDevServer,
  type DevServerError,
  type PublishedModuleRuntime,
} from "effect-spacetimedb/dev-server"
import type { RelationHandle } from "effect-spacetimedb/testing"
import type {
  GeneratedWsBuilderLike,
  WsBuilderConfig,
} from "effect-spacetimedb/testing"
import type { AnyModuleSpec } from "effect-spacetimedb/testing"
import type {
  WsCallableTransport,
  WsConnectionLike,
} from "effect-spacetimedb/testing"
import { project } from "effect-spacetimedb/testing"
import * as ExampleGeneratedClient from "effect-spacetimedb/testing/example-client"
import {
  type GeneratedClientModule,
  type LiveDbConnection,
} from "./connection-types"
import {
  buildModuleWithSpacetime,
  exampleBundlePath,
  exampleModuleProject,
  packageRoot,
  requiredSpacetimeCliVersion,
} from "../../../scripts/standalone-helpers.mjs"

class RowsNotReady extends Data.TaggedError("RowsNotReady") {}

class LiveHarnessConnectionError extends Data.TaggedError(
  "LiveHarnessConnectionError",
)<{
  readonly cause: unknown
}> {}

export class CaptureFixtureWriteError extends Data.TaggedError(
  "CaptureFixtureWriteError",
)<{
  readonly cause: unknown
}> {}

type CaptureFixtureCategory = "event-contexts" | "transport-values"

const capturedFixtureRoot = new URL("../../fixtures/captured/", import.meta.url)

const capturedCodecUrl = new URL(
  "../../helpers/captured-event-codec.ts",
  import.meta.url,
)

const captureFixturesEnabled = (): boolean =>
  globalThis.process.env.UPDATE_CAPTURES === "1"

export const captureLiveFixture = (
  category: CaptureFixtureCategory,
  name: string,
  value: unknown,
  options: {
    readonly normalizeVolatileLeaves?: boolean
  } = {},
): Effect.Effect<void, CaptureFixtureWriteError> => {
  if (!captureFixturesEnabled()) {
    return Effect.void
  }

  return Effect.tryPromise({
    try: async () => {
      const codec = (await import(capturedCodecUrl.href)) as {
        readonly writeCapturedJson: (
          url: URL,
          value: unknown,
          options?: { readonly normalizeVolatileLeaves?: boolean },
        ) => Promise<void>
      }
      await codec.writeCapturedJson(
        new URL(`${category}/${name}.json`, capturedFixtureRoot),
        value,
        options,
      )
    },
    catch: (cause) => new CaptureFixtureWriteError({ cause }),
  })
}

const capturedEventContextInput = (
  value: unknown,
): { readonly event: unknown } =>
  typeof value === "object" && value !== null && "event" in value
    ? {
        event: (value as { readonly event: unknown }).event,
      }
    : {
        event: undefined,
      }

export const captureLiveEventContext = (
  name: string,
  value: unknown,
): Effect.Effect<void, CaptureFixtureWriteError> =>
  captureLiveFixture("event-contexts", name, capturedEventContextInput(value), {
    normalizeVolatileLeaves: true,
  })

export const captureLiveTransportValue = (
  name: string,
  value: unknown,
): Effect.Effect<void, CaptureFixtureWriteError> =>
  captureLiveFixture("transport-values", name, value)

export type TypedLiveConnection<Module extends AnyModuleSpec> =
  WsConnectionLike<Module, unknown> &
    WsCallableTransport & {
      readonly disconnect: () => void
    }

export type LiveHarness = {
  readonly baseUrl: string
  readonly databaseName: string
  readonly token: string
  readonly generatedClient: GeneratedClientModule
  readonly makeWsConfig: <Module extends AnyModuleSpec>(
    module: Module,
  ) => WsBuilderConfig<Module, unknown>
  readonly makeConnection: <Module extends AnyModuleSpec>(
    module: Module,
  ) => Effect.Effect<
    TypedLiveConnection<Module>,
    LiveHarnessConnectionError,
    Scope.Scope
  >
}

type LiveWebSocketArgs = {
  readonly url: URL
  readonly wsProtocol: ReadonlyArray<string>
  readonly nameOrAddress: string
  readonly authToken?: string
  readonly compression: "gzip" | "brotli" | "none"
  readonly lightMode: boolean
  readonly confirmedReads?: boolean
}

const toBinaryMessage = async (data: unknown): Promise<Uint8Array> => {
  if (data instanceof Uint8Array) {
    return data
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data)
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  }
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    return new Uint8Array(await data.arrayBuffer())
  }

  throw new Error("Unsupported SpacetimeDB WebSocket message payload")
}

const makeLiveWebSocket = async ({
  url,
  nameOrAddress,
  wsProtocol,
  authToken,
  compression,
  lightMode,
  confirmedReads,
}: LiveWebSocketArgs) => {
  const { WebSocket } = await import("undici")
  const headers = new Headers()
  let temporaryAuthToken: string | undefined

  if (authToken !== undefined) {
    headers.set("Authorization", `Bearer ${authToken}`)
    const tokenUrl = new URL("v1/identity/websocket-token", url)
    tokenUrl.protocol = url.protocol === "wss:" ? "https:" : "http:"
    const response = await fetch(tokenUrl, { method: "POST", headers })
    if (!response.ok) {
      throw new Error(`Failed to verify token: ${response.statusText}`)
    }
    const body = (await response.json()) as { readonly token?: string }
    temporaryAuthToken = body.token
  }

  const databaseUrl = new URL(`v1/database/${nameOrAddress}/subscribe`, url)
  if (temporaryAuthToken !== undefined) {
    databaseUrl.searchParams.set("token", temporaryAuthToken)
  }
  databaseUrl.searchParams.set(
    "compression",
    { gzip: "Gzip", brotli: "Brotli", none: "None" }[compression],
  )
  if (lightMode) {
    databaseUrl.searchParams.set("light", "true")
  }
  if (confirmedReads !== undefined) {
    databaseUrl.searchParams.set("confirmed", confirmedReads.toString())
  }

  let openHandler: (() => void) | undefined
  let closeHandler: ((event: CloseEvent) => void) | undefined
  let errorHandler: ((event: ErrorEvent) => void) | undefined
  let messageHandler: ((message: { data: Uint8Array }) => void) | undefined
  let ws: InstanceType<typeof WebSocket> | undefined
  let openQueued = false
  const closeQueue: Array<CloseEvent> = []
  const errorQueue: Array<ErrorEvent> = []
  const messageQueue: Array<Uint8Array> = []

  const replayOpen = () => {
    const handler = openHandler
    if (handler === undefined || !openQueued) {
      return
    }

    openQueued = false
    queueMicrotask(handler)
  }
  const replayMessages = () => {
    const handler = messageHandler
    if (handler === undefined || messageQueue.length === 0) {
      return
    }

    const messages = messageQueue.splice(0)
    queueMicrotask(() => {
      for (const data of messages) {
        handler({ data })
      }
    })
  }
  const replayErrors = () => {
    const handler = errorHandler
    if (handler === undefined || errorQueue.length === 0) {
      return
    }

    const errors = errorQueue.splice(0)
    queueMicrotask(() => {
      for (const event of errors) {
        handler(event)
      }
    })
  }
  const replayCloses = () => {
    const handler = closeHandler
    if (handler === undefined || closeQueue.length === 0) {
      return
    }

    const closes = closeQueue.splice(0)
    queueMicrotask(() => {
      for (const event of closes) {
        handler(event)
      }
    })
  }

  const start = () => {
    if (ws !== undefined) {
      return ws
    }

    const next = new WebSocket(databaseUrl.toString(), [...wsProtocol])
    next.binaryType = "arraybuffer"
    next.onopen = () => {
      openQueued = true
      replayOpen()
    }
    next.onclose = (event) => {
      closeQueue.push(event)
      replayCloses()
    }
    next.onerror = (event) => {
      errorQueue.push(event)
      replayErrors()
    }
    next.onmessage = (event) => {
      void toBinaryMessage(event.data)
        .then((compressed) => {
          const tag = compressed[0]
          const data = compressed.subarray(1)
          if (tag !== 0) {
            throw new Error(
              "Live tests use uncompressed SpacetimeDB WebSocket messages",
            )
          }
          messageQueue.push(data)
          replayMessages()
        })
        .catch((cause) => {
          const error =
            cause instanceof Error ? cause : new Error(String(cause))
          errorQueue.push(
            typeof ErrorEvent === "function"
              ? new ErrorEvent("error", {
                  error,
                  message: error.message,
                })
              : ({
                  error,
                  message: error.message,
                  type: "error",
                } as ErrorEvent),
          )
          replayErrors()
        })
    }
    ws = next
    return next
  }

  const maybeStart = () => {
    if (
      closeHandler !== undefined &&
      errorHandler !== undefined &&
      openHandler !== undefined &&
      messageHandler !== undefined
    ) {
      start()
    }
  }

  return {
    get protocol() {
      return ws?.protocol || wsProtocol[0] || ""
    },
    send(message: Uint8Array<ArrayBuffer>) {
      start().send(message)
    },
    close() {
      ws?.close()
    },
    set onclose(handler: (event: CloseEvent) => void) {
      closeHandler = handler
      replayCloses()
      maybeStart()
    },
    set onopen(handler: () => void) {
      openHandler = handler
      replayOpen()
      maybeStart()
    },
    set onerror(handler: (event: ErrorEvent) => void) {
      errorHandler = handler
      replayErrors()
      maybeStart()
    },
    set onmessage(handler: (message: { data: Uint8Array }) => void) {
      messageHandler = handler
      replayMessages()
      maybeStart()
    },
  }
}

const asTypedLiveConnection = <Module extends AnyModuleSpec>(
  _module: Module,
  connection: LiveDbConnection,
): TypedLiveConnection<Module> =>
  connection as unknown as TypedLiveConnection<Module>

type LiveTestLayerRequirements =
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | HttpClient.HttpClient
  | Path.Path

type LiveTestRequirements = LiveTestLayerRequirements | Scope.Scope

const buildExampleModuleBundle = Effect.try({
  try: () => {
    buildModuleWithSpacetime(exampleModuleProject)
  },
  catch: (cause) =>
    new DevServerBinaryError({
      command: "build SpaceTimeDB module bundle",
      cause,
    }),
})

const makeTempResetExampleRuntime: () => Effect.Effect<
  PublishedModuleRuntime,
  DevServerError,
  LiveTestRequirements
> = Effect.fn(function* () {
  const path = yield* Path.Path

  yield* buildExampleModuleBundle
  return yield* makeDevServer({
    bundlePath: exampleBundlePath,
    cwd: packageRoot,
    dbNamePrefix: exampleModuleProject.databaseNamePrefix,
    logDir: path.join(
      packageRoot,
      "node_modules",
      ".cache",
      "effect-spacetimedb-live",
    ),
    versionRequirement: requiredSpacetimeCliVersion,
  })
})

const makeLiveHarness = Effect.fn(function* () {
  const runtime = yield* makeTempResetExampleRuntime()
  const generatedClient =
    ExampleGeneratedClient as unknown as GeneratedClientModule

  const makeWsConfig = <Module extends AnyModuleSpec>(
    _module: Module,
  ): WsBuilderConfig<Module, unknown> => ({
    builder: () =>
      generatedClient.DbConnection.builder() as unknown as GeneratedWsBuilderLike<
        Module,
        unknown
      >,
    uri: runtime.baseUrl,
    databaseName: runtime.databaseName,
    token: runtime.token,
    compression: "none",
    createWebSocket: makeLiveWebSocket,
  })

  const makeConnection = <Module extends AnyModuleSpec>(module: Module) =>
    project(module)
      .client.ws.scoped(makeWsConfig(module))
      .pipe(
        Effect.map((session) =>
          asTypedLiveConnection(
            module,
            session.connection as unknown as LiveDbConnection,
          ),
        ),
        Effect.mapError((cause) => new LiveHarnessConnectionError({ cause })),
      )

  return {
    baseUrl: runtime.baseUrl,
    databaseName: runtime.databaseName,
    token: runtime.token,
    generatedClient,
    makeWsConfig,
    makeConnection,
  } satisfies LiveHarness
})

export const liveHarness = makeLiveHarness()

export const callLiveReducer = (
  connection: Pick<LiveDbConnection, "callReducerWithParams">,
  name: string,
  args: object,
) =>
  Effect.tryPromise({
    try: () => connection.callReducerWithParams(name, undefined, args),
    catch: liveTestEffectCallbackError(
      "interop/effect-spacetimedb/helpers/live-harness",
    ),
  })

export const sendLiveReducer = (
  connection: Pick<LiveDbConnection, "callReducerWithParams">,
  name: string,
  args: object,
) =>
  Effect.try({
    try: () => {
      // SpaceTimeDB 2.5 reducer promises can lag behind cache updates here; the
      // schedule tests assert the observable rows instead of awaiting this call.
      void connection
        .callReducerWithParams(name, undefined, args)
        .catch(() => undefined)
    },
    catch: liveTestEffectCallbackError(
      "interop/effect-spacetimedb/helpers/live-harness",
    ),
  })

export const callLiveProcedure = <A = unknown>(
  connection: Pick<LiveDbConnection, "callProcedureWithParams">,
  name: string,
  args: object,
) =>
  Effect.tryPromise({
    try: async () =>
      (await connection.callProcedureWithParams(
        name,
        undefined,
        args,
        undefined,
      )) as A,
    catch: liveTestEffectCallbackError(
      "interop/effect-spacetimedb/helpers/live-harness",
    ),
  })

export const liveFunctionName = (
  module: Pick<AnyModuleSpec, "wireNames">,
  name: string,
) => {
  const wireName = module.wireNames.functions[name]
  if (wireName === undefined) {
    throw new Error(`Missing live function wire name for ${name}`)
  }
  return wireName
}

export const waitForRows = <Row, E>(
  rows: () => Effect.Effect<ReadonlyArray<Row>, E>,
  predicate: (rows: ReadonlyArray<Row>) => boolean,
) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 100; attempt = attempt + 1) {
      const value = yield* rows()
      if (!predicate(value)) {
        yield* Effect.sleep(Duration.millis(100))
        continue
      }
      return value
    }

    return yield* new RowsNotReady()
  })

const PlatformLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const CommandLayer = NodeChildProcessSpawner.layer.pipe(
  Layer.provide(PlatformLayer),
)

export const LiveTestLayer = Layer.mergeAll(
  PlatformLayer,
  CommandLayer,
  FetchHttpClient.layer,
)

export const provideLiveTest = <A, E>(
  effect: Effect.Effect<A, E, LiveTestRequirements>,
) => effect.pipe(Effect.scoped, Effect.provide(LiveTestLayer))

export type { LiveDbConnection, RelationHandle }
