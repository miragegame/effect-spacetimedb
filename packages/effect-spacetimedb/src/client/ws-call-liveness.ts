import { withDeadline } from "./call-duration.ts"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import {
  DisconnectedError,
  IdentityChangedError,
  UnknownCallResultError,
} from "spacetimedb"
import {
  CallNotSentError,
  ConnectionIdentityChangedError,
  ConnectionLostError,
  type TransportError,
  type WsConnectionFailure,
  WsRpcInvokeError,
} from "./call-errors.ts"
import type {
  ConnectionInvalidation,
  WsConnectionState,
} from "./connection-state.ts"
import {
  missingWsRpcTransport,
  type WsCallableTransport,
} from "./websocket-contract.ts"

type WsInvokeFailure = WsConnectionFailure | TransportError | WsRpcInvokeError

/**
 * Whether `cause` is the SDK error class named `name`. A generated client
 * bundle may carry its own copy of the SDK, so an `instanceof` against this
 * package's import is not enough; the SDK's error classes name themselves.
 */
const isSdkError = (
  cause: unknown,
  sdkClass: abstract new (...args: never) => Error,
  name: string,
): cause is Error =>
  cause instanceof sdkClass || (cause instanceof Error && cause.name === name)

export const isSdkIdentityChangedError = (cause: unknown): boolean =>
  isSdkError(cause, IdentityChangedError, "IdentityChangedError")

/**
 * Types an SDK call rejection. With automatic reconnect the SDK refuses a
 * call made while it reconnects (`DisconnectedError`: never sent) and fails
 * calls in flight when the socket drops (`UnknownCallResultError`: may have
 * run). Every other rejection is the call's own answer, classified later. An
 * identity change never rejects a call: it ends the connection, and calls
 * then fail from its invalidation.
 */
export const classifyWsInvokeRejection = (
  cause: unknown,
): CallNotSentError | ConnectionLostError | WsRpcInvokeError =>
  isSdkError(cause, DisconnectedError, "DisconnectedError")
    ? new CallNotSentError({ raw: cause.message })
    : isSdkError(cause, UnknownCallResultError, "UnknownCallResultError")
      ? new ConnectionLostError({ raw: cause.message })
      : new WsRpcInvokeError({ cause })

export const invalidationCallFailure = (
  invalidation: ConnectionInvalidation,
): ConnectionLostError | ConnectionIdentityChangedError =>
  invalidation.kind === "identityChanged"
    ? new ConnectionIdentityChangedError({ raw: invalidation.message })
    : new ConnectionLostError({ raw: invalidation.message })

/**
 * Why a call on a recoverable connection cannot be sent right now, if it
 * cannot: it is recovering (the SDK is reconnecting or replaying, or its
 * socket was found closed before the SDK noticed; the liveness read made just
 * before this one records that).
 */
const unsendableReason = (
  connectionState: WsConnectionState,
): string | undefined => {
  const { recovery } = connectionState.recovery()
  return recovery.status === "recovering"
    ? `Not sent: reconnecting (${recovery.reason})`
    : undefined
}

export const makeWsConnectionAwareCalls = (options: {
  readonly connectionState: WsConnectionState
  readonly transport: WsCallableTransport | undefined
  readonly callDurationMax: Duration.Input
  /** Ends the connection a call overran on. It must invalidate it. */
  readonly endConnection: (message: string) => Effect.Effect<void>
}): {
  readonly invokeProcedure: (
    name: string,
    params: object,
  ) => Effect.Effect<unknown, WsInvokeFailure>
  readonly invokeReducer: (
    name: string,
    params: object,
  ) => Effect.Effect<void, WsInvokeFailure>
} => {
  const connectionLost = options.connectionState
    .awaitInvalidation()
    .pipe(
      Effect.flatMap((invalidation) =>
        Effect.fail(invalidationCallFailure(invalidation)),
      ),
    )

  // The socket reports `open` for a peer that has gone, so the SDK neither
  // answers nor rejects, and nothing else would ever settle the call. An
  // unanswered call is the evidence of that, so the connection ends with it,
  // and the disconnect must run although invalidating already woke the race.
  const overrunCall = (name: string) =>
    Effect.suspend(() => {
      const message = `${name} got no answer within ${Duration.format(Duration.fromInputUnsafe(options.callDurationMax))}`
      return options
        .endConnection(message)
        .pipe(
          Effect.uninterruptible,
          Effect.andThen(
            Effect.fail(new ConnectionLostError({ raw: message })),
          ),
        )
    })

  const invokeWithConnection = <A>(
    name: string,
    invoke: () => Promise<A>,
  ): Effect.Effect<A, WsConnectionFailure | WsRpcInvokeError> =>
    Effect.suspend<A, WsConnectionFailure | WsRpcInvokeError, never>(() => {
      const invalidation = options.connectionState.invalidation()
      if (invalidation != null) {
        return Effect.fail(invalidationCallFailure(invalidation))
      }
      const unsendable = unsendableReason(options.connectionState)
      if (unsendable !== undefined) {
        return Effect.fail(new CallNotSentError({ raw: unsendable }))
      }

      return Effect.tryPromise({
        try: invoke,
        catch: classifyWsInvokeRejection,
      })
    }).pipe(
      Effect.raceFirst(connectionLost),
      withDeadline({
        duration: options.callDurationMax,
        orElse: () => overrunCall(name),
      }),
    )

  const transport = options.transport

  return {
    invokeProcedure: (name, params) =>
      transport != null
        ? invokeWithConnection(name, () =>
            transport.callProcedureWithParams(
              name,
              undefined,
              params,
              undefined,
            ),
          )
        : missingWsRpcTransport,
    invokeReducer: (name, params) =>
      transport != null
        ? invokeWithConnection(name, () =>
            transport.callReducerWithParams(name, undefined, params),
          )
        : missingWsRpcTransport,
  }
}
