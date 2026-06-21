// lint-ignore: runtime-metadata-heuristics - Node smoke entry validates effect-spacetimedb/dev-server under plain Node.
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as Config from "effect/Config"
import * as Data from "effect/Data"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient"
import {
  makeDevServer,
  type DevServerBinaryError,
} from "effect-spacetimedb/dev-server"
import {
  project,
  type GeneratedWsBuilderLike,
} from "effect-spacetimedb/testing"
import * as ExampleGeneratedClient from "effect-spacetimedb/testing/example-client"
import {
  ExampleModule,
  UserId,
  UserName,
} from "effect-spacetimedb/testing/example-module"

class NodeSmokeUnsupportedPayload extends Data.TaggedError(
  "NodeSmokeUnsupportedPayload",
)<{
  readonly cause: unknown
}> {
  override get message(): string {
    return "Unsupported SpaceTimeDB WebSocket message payload"
  }
}

class NodeSmokeTokenVerificationError extends Data.TaggedError(
  "NodeSmokeTokenVerificationError",
)<{
  readonly statusText: string
}> {
  override get message(): string {
    return `Failed to verify token: ${this.statusText}`
  }
}

class NodeSmokeCompressedMessageError extends Data.TaggedError(
  "NodeSmokeCompressedMessageError",
)<{
  readonly tag: number | undefined
}> {
  override get message(): string {
    return "Node smoke uses uncompressed SpaceTimeDB WebSocket messages"
  }
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

  return Promise.reject(new NodeSmokeUnsupportedPayload({ cause: data }))
}

const errorEventFromCause = (cause: unknown): ErrorEvent => {
  const error = cause instanceof Error ? cause : new Error(String(cause))
  if (typeof ErrorEvent === "function") {
    return new ErrorEvent("error", {
      error,
      message: error.message,
    })
  }

  return {
    error,
    message: error.message,
    type: "error",
  } as ErrorEvent
}

type SmokeWebSocketArgs = {
  readonly authToken?: string
  readonly compression: "gzip" | "brotli" | "none"
  readonly confirmedReads?: boolean
  readonly lightMode: boolean
  readonly nameOrAddress: string
  readonly url: URL
  readonly wsProtocol: ReadonlyArray<string>
}

const makeSmokeWebSocket = async ({
  url,
  nameOrAddress,
  wsProtocol,
  authToken,
  compression,
  lightMode,
  confirmedReads,
}: SmokeWebSocketArgs) => {
  const headers = new Headers()
  let temporaryAuthToken: string | undefined

  if (authToken !== undefined) {
    headers.set("Authorization", `Bearer ${authToken}`)
    const tokenUrl = new URL("v1/identity/websocket-token", url)
    tokenUrl.protocol = url.protocol === "wss:" ? "https:" : "http:"
    const response = await fetch(tokenUrl, { method: "POST", headers })
    if (!response.ok) {
      return Promise.reject(
        new NodeSmokeTokenVerificationError({
          statusText: response.statusText,
        }),
      )
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
  let ws: WebSocket | undefined
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
      errorQueue.push(errorEventFromCause(event))
      replayErrors()
    }
    next.onmessage = (event) => {
      void toBinaryMessage(event.data)
        .then((compressed) => {
          const tag = compressed[0]
          const data = compressed.subarray(1)
          if (tag !== 0) {
            return Promise.reject(new NodeSmokeCompressedMessageError({ tag }))
          }
          messageQueue.push(data)
          replayMessages()
        })
        .catch((cause) => {
          errorQueue.push(errorEventFromCause(cause))
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

const decodeUserId = Schema.decodeUnknownSync(UserId)
const decodeUserName = Schema.decodeUnknownSync(UserName)

class NodeSmokeRoundTripMismatch extends Data.TaggedError(
  "NodeSmokeRoundTripMismatch",
)<{
  readonly observed: string
}> {
  override get message(): string {
    return `Unexpected userGet result after reducer round-trip: ${this.observed}`
  }
}

const requiredSpacetimeVersion = "2.5.0"
const spacetimeVersionRequirement =
  `spacetimedb tool version ${requiredSpacetimeVersion}` as const

const program = Effect.gen(function* () {
  const path = yield* Path.Path
  const packageRoot = yield* Config.string(
    "EFFECT_SPACETIMEDB_PACKAGE_ROOT",
  ).pipe(Effect.orElseSucceed(() => process.cwd()))
  const runtime = yield* makeDevServer({
    bundlePath: path.join(
      packageRoot,
      "examples",
      "publishable-module",
      "dist",
      "bundle.js",
    ),
    dbNamePrefix: "effect-spacetimedb-example",
    versionRequirement: spacetimeVersionRequirement,
  })
  const session = yield* project(ExampleModule).client.ws.scoped({
    builder: () =>
      ExampleGeneratedClient.DbConnection.builder() as unknown as GeneratedWsBuilderLike<
        typeof ExampleModule,
        unknown
      >,
    compression: "none",
    createWebSocket: makeSmokeWebSocket,
    databaseName: runtime.databaseName,
    token: runtime.token,
    uri: runtime.baseUrl,
  })
  const userId = decodeUserId("node-smoke-user")
  const name = decodeUserName("Node Smoke")

  yield* session.reducers.userUpsert({
    name,
    userId,
  })

  const user = yield* session.procedures.userGet({ userId })
  if (user?.id !== userId || user.name !== name) {
    return yield* new NodeSmokeRoundTripMismatch({
      observed: String(user),
    })
  }

  yield* Effect.log(
    `effect-spacetimedb/dev-server Node smoke passed for ${runtime.databaseName}`,
  )
}).pipe(
  Effect.scoped,
  Effect.timeout(Duration.seconds(120)),
  Effect.catchTags({
    DevServerBinaryError: (cause: DevServerBinaryError) =>
      Effect.log(
        `Skipping effect-spacetimedb/dev-server Node smoke: ${cause.message}`,
      ),
  }),
)

// lint-ignore: effect-no-runsync-at-module-init - Node smoke entry: tsc-compiled and executed directly as the main module by dev-server-node-smoke.mjs (never imported), so the top-level run is the intended edge. import.meta.main is unreliable on the supported Node range (<24.2).
await Effect.runPromise(
  program.pipe(
    Effect.provide(Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer)),
  ),
)
