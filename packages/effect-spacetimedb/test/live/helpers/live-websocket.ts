import * as Data from "effect/Data"

class LiveWebSocketUnsupportedPayload extends Data.TaggedError(
  "LiveWebSocketUnsupportedPayload",
)<{
  readonly payload: unknown
}> {}

class LiveWebSocketTokenVerificationError extends Data.TaggedError(
  "LiveWebSocketTokenVerificationError",
)<{
  readonly statusText: string
}> {}

class LiveWebSocketCompressedMessageError extends Data.TaggedError(
  "LiveWebSocketCompressedMessageError",
)<{
  readonly tag: number | undefined
}> {}

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

  return Promise.reject(new LiveWebSocketUnsupportedPayload({ payload: data }))
}

export const makeLiveWebSocket = async ({
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
      return Promise.reject(
        new LiveWebSocketTokenVerificationError({
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
            return Promise.reject(
              new LiveWebSocketCompressedMessageError({ tag }),
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
