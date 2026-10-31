import * as Effect from "effect/Effect"
import * as Queue from "effect/Queue"
import { type LiveWebSocketArgs, makeLiveWebSocket } from "./live-websocket"

type LiveSocket = Awaited<ReturnType<typeof makeLiveWebSocket>>

type ControlledSocket = {
  readonly index: number
  readonly socket: LiveSocket
  closeHandler: ((event: CloseEvent) => void) | undefined
  swallowSends: boolean
}

/** 1008 (policy violation) is a close the SDK never retries. */
const protocolErrorCloseCode = 1008

/**
 * A WebSocket factory for the native builder (`createWebSocket`) whose sockets
 * a live test controls: it can drop the current socket, deliver a close the
 * SDK treats as terminal, swallow the current socket's sends so a call stays
 * in flight, and hold the next socket's opening until released. Every control
 * has a handshake (`nextOpened`, `nextSwallowed`) so tests never wait on time.
 */
export const makeDroppableSockets = Effect.gen(function* () {
  const opened = yield* Queue.unbounded<number>()
  const swallowed = yield* Queue.unbounded<number>()
  let current: ControlledSocket | undefined
  let openedCount = 0
  let gate: Promise<void> | undefined

  const adapterFor = (controlled: ControlledSocket) => ({
    get protocol() {
      return controlled.socket.protocol
    },
    send(message: Uint8Array<ArrayBuffer>) {
      if (controlled.swallowSends) {
        Queue.offerUnsafe(swallowed, controlled.index)
        return
      }
      controlled.socket.send(message)
    },
    close() {
      controlled.socket.close()
    },
    set onclose(handler: (event: CloseEvent) => void) {
      controlled.closeHandler = handler
      controlled.socket.onclose = handler
    },
    set onopen(handler: () => void) {
      controlled.socket.onopen = handler
    },
    set onerror(handler: (event: ErrorEvent) => void) {
      controlled.socket.onerror = handler
    },
    set onmessage(handler: (message: { data: Uint8Array }) => void) {
      controlled.socket.onmessage = handler
    },
  })

  const createWebSocket = async (args: LiveWebSocketArgs) => {
    const held = gate
    gate = undefined
    if (held !== undefined) {
      await held
    }
    const socket = await makeLiveWebSocket(args)
    openedCount += 1
    const controlled: ControlledSocket = {
      index: openedCount,
      socket,
      closeHandler: undefined,
      swallowSends: false,
    }
    current = controlled
    Queue.offerUnsafe(opened, controlled.index)
    return adapterFor(controlled)
  }

  const withCurrent = (use: (controlled: ControlledSocket) => void) =>
    Effect.suspend(() => {
      if (current === undefined) {
        return Effect.die("no live socket has been opened yet")
      }
      use(current)
      return Effect.void
    })

  return {
    createWebSocket,
    openedCount: () => openedCount,
    /** Resolves with each opened socket's 1-based index, in order. */
    nextOpened: Queue.take(opened),
    /** Resolves when the current socket swallows a send. */
    nextSwallowed: Queue.take(swallowed),
    /** Closes the current socket from the client: a drop the SDK retries. */
    dropCurrent: withCurrent((controlled) => {
      controlled.socket.close()
    }),
    /**
     * Reports a protocol-error close (1008) to the SDK for the current
     * socket, then closes it: a drop the SDK never retries.
     */
    closeCurrentWithProtocolError: withCurrent((controlled) => {
      controlled.closeHandler?.(
        new CloseEvent("close", {
          code: protocolErrorCloseCode,
          reason: "closed by the test as a protocol error",
        }),
      )
      controlled.socket.close()
    }),
    /** The current socket stops transmitting what the SDK sends. */
    swallowCurrentSends: withCurrent((controlled) => {
      controlled.swallowSends = true
    }),
    /**
     * Holds the next socket's opening until the returned Effect runs, so the
     * SDK stays reconnecting for exactly as long as the test needs.
     */
    holdNextOpen: Effect.suspend(() => {
      const release = Promise.withResolvers<void>()
      gate = release.promise
      return Effect.succeed(
        Effect.suspend(() => {
          release.resolve()
          return Effect.void
        }),
      )
    }),
  }
})

export type DroppableSockets = Effect.Success<typeof makeDroppableSockets>
