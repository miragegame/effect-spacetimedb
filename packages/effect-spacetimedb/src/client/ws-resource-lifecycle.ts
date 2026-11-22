import * as Data from "effect/Data"
import * as Duration from "effect/Duration"
import type { Identity } from "spacetimedb"
import type { AnyModuleSpec } from "../contract/module.ts"
import {
  errorTypeId,
  hasErrorTypeId,
  readTaggedErrorTag,
} from "../error-identity.ts"
import { boundedCallDurationMax, durationMillis } from "./call-duration.ts"
import { messageFromUnknown } from "./call-errors.ts"
import { connectionStateFor } from "./connection-state.ts"
import {
  type ManagedWsConnection,
  type WsAutomaticReconnect,
  nativeAutomaticReconnectOptions,
} from "./generated-ws-adapter.ts"
import { isSdkIdentityChangedError } from "./ws-call-liveness.ts"

/** Connection acquisition failure. Specific causes retain their own identity. */
const WsConnectErrorTypeId = errorTypeId("WsConnectError")
export class WsConnectError extends Data.TaggedError("WsConnectError")<{
  readonly cause: unknown
  readonly context?: unknown
}> {
  readonly [WsConnectErrorTypeId] = WsConnectErrorTypeId
  static is = hasErrorTypeId<WsConnectError>(WsConnectErrorTypeId)
}

const WsProtocolErrorTypeId = errorTypeId("WsProtocolError")
/** The SDK could not decode or apply a server message. Supervisors park by default so callers can replace incompatible bindings. */
export class WsProtocolError extends Data.TaggedError("WsProtocolError")<{
  readonly cause: Error
}> {
  readonly [WsProtocolErrorTypeId] = WsProtocolErrorTypeId
  static is = hasErrorTypeId<WsProtocolError>(WsProtocolErrorTypeId)
  override get message(): string {
    return this.cause.message
  }
}

const WsConnectTimeoutErrorTypeId = errorTypeId("WsConnectTimeoutError")
export class WsConnectTimeoutError extends Data.TaggedError(
  "WsConnectTimeoutError",
)<{
  readonly timeoutMillis: number
}> {
  readonly [WsConnectTimeoutErrorTypeId] = WsConnectTimeoutErrorTypeId
  static is = hasErrorTypeId<WsConnectTimeoutError>(WsConnectTimeoutErrorTypeId)

  override get message(): string {
    return `WebSocket connection did not complete within ${this.timeoutMillis.toString()}ms`
  }
}

export class WsDisconnectError extends Data.TaggedError("WsDisconnectError")<{
  readonly cause: unknown
}> {}

export const connectError = (cause: unknown, context?: unknown) =>
  new WsConnectError({
    cause,
    ...(context === undefined ? {} : { context }),
  })

/**
 * The `WsConnectError` an SDK report stands for. A report can already carry
 * one (a token refresh rejects with it), which is kept rather than wrapped
 * again.
 */
export const connectErrorOfReport = (error: unknown, context?: unknown) =>
  WsConnectError.is(error)
    ? error
    : connectError(
        // 2.16.1 keeps WebSocketProtocolError private, with name "Error".
        // Only a failed message identifies a potentially incompatible binding.
        // Close codes 1002, 1003, 1007 and 1008 use the same SDK class, but a
        // fresh session can succeed. Treat them as lost and retry with backoff.
        error instanceof Error &&
          error.message === "Invalid server message" &&
          "cause" in error
          ? new WsProtocolError({ cause: error })
          : error,
        context,
      )

// The native disconnect context is the connection object itself, never a
// carrier of human-readable text, so only the cause can name the reason. A
// terminal close with no socket error (a clean close, or the decompress
// failure that closes the socket) legitimately has no cause and gets the
// stable fallback. A `WsConnectError` names its own cause.
export const disconnectMessage = (cause: unknown): string => {
  if (WsConnectError.is(cause) && cause.cause !== undefined) {
    return disconnectMessage(cause.cause)
  }
  const message = messageFromUnknown(cause)
  return message !== undefined && message.length > 0
    ? message
    : (readTaggedErrorTag(cause) ?? "WebSocket connection disconnected")
}

/**
 * Invalidates a connection whose end was reported as `error`: an automatic
 * reconnect that changed identity ends it as `identityChanged`, a failed
 * message as `protocolError`, and an ordinary socket loss as `lost`.
 */
export const invalidateDisconnected = (
  connection: object,
  error: WsConnectError,
): void => {
  const state = connectionStateFor(connection)
  const message = disconnectMessage(error.cause)
  if (WsProtocolError.is(error.cause)) {
    state.invalidateForProtocolError(error.cause)
  } else if (isSdkIdentityChangedError(error.cause)) {
    state.invalidateForIdentityChange(message)
  } else {
    state.invalidateFromTransport(message)
  }
}

/**
 * The bound on connection acquisition when a config does not set
 * `connectDurationMax`.
 */
export const connectDurationMaxDefault = Duration.seconds(30)

/**
 * How far one acquisition got. The native builder and its `onConnect` report a
 * connection in either order, so an acquisition goes `idle -> built -> acquired`
 * or `idle -> connectedEarly -> acquired`, and from any of those to `failed`.
 * `released` is terminal and reachable from anywhere. Past `acquired`, a stage
 * only remembers the connection, so a late report can still be matched to it.
 */
export type AcquisitionState<
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext,
> =
  | { readonly stage: "idle" }
  | {
      readonly stage: "built"
      readonly connection: ManagedWsConnection<
        Module,
        ErrorContext,
        RelationContext
      >
    }
  | {
      readonly stage: "connectedEarly"
      readonly connection: ManagedWsConnection<
        Module,
        ErrorContext,
        RelationContext
      >
      readonly identity: Identity
      readonly token: string
    }
  | {
      readonly stage: "acquired"
      readonly connection: ManagedWsConnection<
        Module,
        ErrorContext,
        RelationContext
      >
    }
  | {
      readonly stage: "failed" | "released"
      readonly connection:
        | ManagedWsConnection<Module, ErrorContext, RelationContext>
        | undefined
    }

/** The connection an acquisition holds, at whichever stage it reached. */
export const knownConnection = <
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext,
>(
  state: AcquisitionState<Module, ErrorContext, RelationContext>,
): ManagedWsConnection<Module, ErrorContext, RelationContext> | undefined =>
  state.stage === "idle" ? undefined : state.connection

/**
 * A config's connect bound, after throwing the `TypeError` of any of its bounds
 * that is not one. Every WebSocket client (scoped, layered, supervised) is built
 * through this, before any Effect runs.
 */
export const wsTimeBounds = (config: {
  readonly connectDurationMax?: Duration.Input | undefined
  readonly callDurationMax?: Duration.Input | undefined
  readonly automaticReconnect?: WsAutomaticReconnect | undefined
}) => {
  const duration = config.connectDurationMax ?? connectDurationMaxDefault
  const connectMillis = durationMillis(duration)
  if (!(connectMillis > 0)) {
    throw new TypeError(
      `WebSocket connectDurationMax must be a positive duration; received ${String(duration)}`,
    )
  }
  boundedCallDurationMax("WebSocket", config.callDurationMax)
  return {
    connectMillis,
    automaticReconnect: nativeAutomaticReconnectOptions(
      config.automaticReconnect,
    ),
  }
}
