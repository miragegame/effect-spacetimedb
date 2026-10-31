import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Scope from "effect/Scope"
import type {
  ConnectionRecovery,
  ConnectionRecoverySnapshot,
  WsConnectionState,
} from "./connection-state.ts"

export type RecoveringConnection = Extract<
  ConnectionRecovery,
  { readonly status: "recovering" }
>

/**
 * Follows a live supervised session that reconnects on its own (automatic
 * reconnect) until it ends, completing with the failure that ended it.
 *
 * Each drop publishes `recovering`. Each completed recovery (the SDK
 * reconnected and every subscription re-applied) runs the reconnect hook in a
 * scope that lasts until the next drop, then publishes `live` again. The
 * session ends when `ended` fails (its terminal invalidation) or the hook
 * fails for a reason other than a drop.
 */
export const followRecoveringSession = <Failure, R>(options: {
  readonly connectionState: WsConnectionState
  /** The reconnect hook, already applied to the session. */
  readonly reconnectHook:
    | (() => Effect.Effect<void, Failure, R | Scope.Scope>)
    | undefined
  readonly hookTimeoutMillis: number
  readonly hookTimeoutFailure: () => Failure
  readonly ended: Effect.Effect<never, Failure>
  readonly publishLive: Effect.Effect<void>
  readonly publishRecovering: (
    recovery: RecoveringConnection,
  ) => Effect.Effect<void>
}): Effect.Effect<Failure, never, R | Scope.Scope> => {
  const state = options.connectionState
  const hook = options.reconnectHook

  // Whether the connection observably dropped since `version`. Reading its
  // liveness first records a socket that closed before the SDK signalled it.
  const droppedSince = (version: number): boolean =>
    state.isInvalidated() || state.recovery().version !== version

  // Succeeds with whether the period may be published live: `false` when the
  // connection dropped while the hook ran, which interrupts it or explains
  // its failure (a refused call); a drop is the SDK's to recover.
  const runReconnectHook = (
    reconnectHook: NonNullable<typeof hook>,
    period: Scope.Scope,
    version: number,
  ): Effect.Effect<boolean, Failure, R> =>
    reconnectHook().pipe(
      Effect.provideService(Scope.Scope, period),
      Effect.timeoutOrElse({
        duration: Duration.millis(options.hookTimeoutMillis),
        orElse: () => Effect.fail(options.hookTimeoutFailure()),
      }),
      Effect.as(true),
      Effect.raceFirst(
        state.awaitRecoveryAfter(version).pipe(Effect.as(false)),
      ),
      Effect.catchIf(
        () => droppedSince(version),
        () => Effect.succeed(false),
      ),
    )

  const step = Effect.fnUntraced(function* (
    snapshot: ConnectionRecoverySnapshot,
  ) {
    const { recovery } = snapshot
    if (recovery.status === "recovering") {
      yield* options.publishRecovering(recovery)
      return yield* state.awaitRecoveryAfter(snapshot.version)
    }
    const period = yield* Scope.fork(yield* Scope.Scope)
    const ready =
      hook === undefined
        ? true
        : yield* runReconnectHook(hook, period, snapshot.version)
    // A drop between the hook and the publish would show a dead socket live.
    if (ready && !droppedSince(snapshot.version)) {
      yield* options.publishLive
    }
    return yield* state
      .awaitRecoveryAfter(snapshot.version)
      .pipe(Effect.ensuring(Scope.close(period, Exit.void)))
  })
  const follow = (
    snapshot: ConnectionRecoverySnapshot,
  ): Effect.Effect<never, Failure, R | Scope.Scope> =>
    step(snapshot).pipe(Effect.flatMap(follow))

  // The session was published live with recovery at version 0 (nothing can
  // transition a connection before its recovery is enabled), so every later
  // snapshot is a drop or a recovery.
  return Effect.raceFirst(
    state.awaitRecoveryAfter(0).pipe(Effect.flatMap(follow)),
    options.ended,
  ).pipe(Effect.flip)
}
