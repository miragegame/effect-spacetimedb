import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import type { AnyModuleSpec } from "../contract/module.ts"
import {
  type ConnectionRecoverySnapshot,
  connectionStateFor,
  type WsConnectionState,
} from "./connection-state.ts"
import {
  type GeneratedWsBuilderLike,
  WsUnsupportedBuilderFeatureError,
} from "./generated-ws-adapter.ts"
import { disconnectMessage } from "./ws-resource-lifecycle.ts"

/**
 * Puts a connection into recovery for a drop or a failed reconnect attempt
 * the SDK reported together with the attempt it scheduled next, and answers
 * whether it did: only a connection whose recovery is enabled (its session
 * went live) recovers. Any other report ends the connection.
 */
export const beginReportedRecovery = (
  connection: object,
  error: Error | undefined,
  reconnectAttempt: number,
  reconnectDelayMillis: number | undefined,
): boolean => {
  const state = connectionStateFor(connection)
  if (!state.isRecoverable()) {
    return false
  }
  state.beginRecovery({
    reason: disconnectMessage(error),
    reconnectAttempt,
    reconnectDelayMillis: reconnectDelayMillis ?? 0,
  })
  return true
}

/**
 * Registers the native `onAutomaticReconnect` callback. The SDK fires it on
 * the reconnect handshake, before it replays the connection's subscriptions,
 * so recovery waits for that replay to re-apply every tracked subscription
 * (a replay that stalls is ended by the reconnect bound). Throws
 * `WsUnsupportedBuilderFeatureError` for a builder without it (an older
 * generated artifact), which the acquisition reports as a connect failure.
 */
export const awaitReplayOnAutomaticReconnect = <
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext,
>(
  builder: GeneratedWsBuilderLike<Module, ErrorContext, RelationContext>,
): GeneratedWsBuilderLike<Module, ErrorContext, RelationContext> => {
  if (builder.onAutomaticReconnect == null) {
    throw new WsUnsupportedBuilderFeatureError({
      feature: "onAutomaticReconnect",
    })
  }
  return builder.onAutomaticReconnect((connection) => {
    connectionStateFor(connection).beginReplay()
  })
}

/**
 * Bounds every reconnect attempt the SDK schedules for a recoverable
 * connection. The SDK reports each scheduled attempt with its delay and has
 * no handshake timeout of its own, so an attempt whose token exchange or
 * handshake never finishes would hold the session in recovery forever. An
 * attempt still unresolved `connectTimeoutMillis` after its scheduled start
 * ends the connection: it is invalidated and disconnected, so its owner (a
 * session supervisor) replaces it.
 */
export const watchReconnectAttempts = (
  state: WsConnectionState,
  connectTimeoutMillis: number,
  endConnection: (message: string) => Effect.Effect<void>,
): Effect.Effect<void> => {
  const watch = (snapshot: ConnectionRecoverySnapshot): Effect.Effect<void> => {
    const { recovery } = snapshot
    if (recovery.status === "connected") {
      return state
        .awaitRecoveryAfter(snapshot.version)
        .pipe(Effect.flatMap(watch))
    }
    const boundMillis = recovery.reconnectDelayMillis + connectTimeoutMillis
    // Attempt 0 is a socket found closed that the SDK never noticed.
    const overrun =
      recovery.reconnectAttempt > 0
        ? `Automatic reconnect attempt ${recovery.reconnectAttempt.toString()} did not complete within ${boundMillis.toString()}ms`
        : `${recovery.reason}, and no reconnect followed within ${boundMillis.toString()}ms`
    return state.awaitRecoveryAfter(snapshot.version).pipe(
      Effect.timeoutOption(Duration.millis(boundMillis)),
      Effect.flatMap(
        Option.match({
          // Invalidating wakes the race below; the disconnect must still run.
          onNone: () => Effect.uninterruptible(endConnection(overrun)),
          onSome: watch,
        }),
      ),
    )
  }
  return Effect.raceFirst(
    Effect.suspend(() => watch(state.recovery())),
    state.awaitInvalidation().pipe(Effect.asVoid),
  )
}
