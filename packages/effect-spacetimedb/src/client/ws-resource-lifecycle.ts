import * as Data from "effect/Data"
import type { Identity } from "spacetimedb"
import type { AnyModuleSpec } from "../contract/module.ts"
import {
  errorTypeId,
  hasErrorTypeId,
  readTaggedErrorTag,
} from "../error-identity.ts"
import { messageFromUnknown } from "./call-errors.ts"
import { connectionStateFor } from "./connection-state.ts"
import type {
  ManagedWsConnection,
  WsAutomaticReconnect,
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
  WsConnectError.is(error) ? error : connectError(error, context)

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
 * reconnect that changed identity ends it as `identityChanged`, every other
 * end as `lost`.
 */
export const invalidateDisconnected = (
  connection: object,
  error: WsConnectError,
): void => {
  const state = connectionStateFor(connection)
  const message = disconnectMessage(error.cause)
  if (isSdkIdentityChangedError(error.cause)) {
    state.invalidateForIdentityChange(message)
  } else {
    state.invalidateFromTransport(message)
  }
}

/**
 * Throws a `TypeError` unless `connectTimeoutMillis` is a positive, finite
 * number of milliseconds, the way `Stdb.array(...)` rejects bad length bounds. `Infinity` never fires, `0` fires before any
 * connect can finish, and `NaN` reads as zero, so none of them is a bound.
 */
export const assertConnectTimeoutBounded = (
  connectTimeoutMillis: number,
): void => {
  if (!(Number.isFinite(connectTimeoutMillis) && connectTimeoutMillis > 0)) {
    throw new TypeError(
      `WebSocket connectTimeoutMillis must be a positive, finite number of milliseconds; received ${String(connectTimeoutMillis)}`,
    )
  }
}

/**
 * Throws a `TypeError` unless every configured automatic-reconnect delay is a
 * finite, non-negative number of milliseconds. The SDK raises a delay below
 * its floor (and a cap below the first delay) on its own, but accepts
 * `Infinity`, which would schedule a reconnect that never comes and make the
 * attempt's bound (delay plus `connectTimeoutMillis`) unbounded.
 */
export const assertAutomaticReconnectBounded = (
  automaticReconnect: WsAutomaticReconnect | undefined,
): void => {
  for (const [name, delayMillis] of [
    ["delayMillisMin", automaticReconnect?.delayMillisMin],
    ["delayMillisMax", automaticReconnect?.delayMillisMax],
  ] as const) {
    if (
      delayMillis !== undefined &&
      !(Number.isFinite(delayMillis) && delayMillis >= 0)
    ) {
      throw new TypeError(
        `WebSocket automaticReconnect.${name} must be a finite, non-negative number of milliseconds; received ${String(delayMillis)}`,
      )
    }
  }
}

export type PendingConnect<
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext,
> = {
  readonly connection: ManagedWsConnection<
    Module,
    ErrorContext,
    RelationContext
  >
  readonly identity: Identity
  readonly token: string
}

// Acquisition lifecycle:
// initial -> pending connection -> connected session -> scoped release.
export type AcquisitionState<
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext,
  ValidationError,
> = {
  readonly built:
    | ManagedWsConnection<Module, ErrorContext, RelationContext>
    | undefined
  readonly connected:
    | PendingConnect<Module, ErrorContext, RelationContext>
    | undefined
  readonly acquired:
    | ManagedWsConnection<Module, ErrorContext, RelationContext>
    | undefined
  readonly failed: WsConnectError | ValidationError | undefined
  readonly released: boolean
}

/** The connection an acquisition holds, at whichever stage it reached. */
export const knownConnection = <
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext,
  ValidationError,
>(
  state: AcquisitionState<
    Module,
    ErrorContext,
    RelationContext,
    ValidationError
  >,
): ManagedWsConnection<Module, ErrorContext, RelationContext> | undefined =>
  state.acquired ?? state.built ?? state.connected?.connection
