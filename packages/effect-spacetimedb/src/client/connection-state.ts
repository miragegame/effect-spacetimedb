import * as Effect from "effect/Effect"
import * as Predicate from "effect/Predicate"
import type * as Scope from "effect/Scope"
import {
  SubscriptionInvalidatedError,
  type SubscriptionFailure,
} from "./ws-subscription.ts"

/**
 * Why a connection ended for good. `identityChanged` is an automatic
 * reconnect that came back under a different identity; `credentialsFailed`
 * is a token Effect that failed (or overran its reconnect attempt) while
 * refreshing the token for a reconnect, with its failure as `cause`;
 * `credentialsDefect` is one that died or was interrupted, with the defect;
 * every other terminal end (a close, a socket error, a release, a reconnect
 * the SDK gave up on or that overran its bound) is `lost`.
 */
export type ConnectionInvalidation =
  | {
      readonly kind: "lost"
      readonly message: string
    }
  | {
      readonly kind: "identityChanged"
      readonly message: string
    }
  | {
      readonly kind: "credentialsFailed"
      readonly message: string
      readonly cause: unknown
    }
  | {
      readonly kind: "credentialsDefect"
      readonly message: string
      readonly defect: unknown
    }

/** A tracked subscription; an ended one is never replayed. */
export type TrackedSubscription = { readonly isEnded: () => boolean }

/**
 * Whether an established connection is currently carrying traffic. Only a
 * connection with automatic reconnect ever leaves `connected`: after a drop
 * the SDK schedules `reconnectAttempt` after `reconnectDelayMillis`, and the
 * connection stays `recovering` (reporting each failed attempt's successor)
 * until the SDK reconnects and every tracked subscription has re-applied, or
 * until it ends instead. Two `recovering` states carry no SDK schedule: a
 * socket found closed without its close event (`reconnectAttempt` 0, until
 * the SDK notices) and the subscription replay after a reconnect; both have a
 * zero delay, so their bound is the connect bound alone.
 */
export type ConnectionRecovery =
  | {
      readonly status: "connected"
    }
  | {
      readonly status: "recovering"
      readonly reason: string
      readonly reconnectAttempt: number
      readonly reconnectDelayMillis: number
    }

/** A recovery state and the count of transitions that produced it. */
export type ConnectionRecoverySnapshot = {
  readonly version: number
  readonly recovery: ConnectionRecovery
}

export type WsConnectionState = {
  readonly assertActive: () => Effect.Effect<void, SubscriptionFailure>
  readonly awaitInvalidation: () => Effect.Effect<ConnectionInvalidation>
  readonly invalidateFromTransport: (message: string) => void
  readonly invalidateForIdentityChange: (message: string) => void
  readonly invalidateForFailedCredentials: (
    message: string,
    cause: unknown,
  ) => void
  readonly invalidateForCredentialsDefect: (
    message: string,
    defect: unknown,
  ) => void
  readonly invalidation: () => ConnectionInvalidation | undefined
  readonly isInvalidated: () => boolean
  readonly observeInvalidation: (
    listener: (invalidation: ConnectionInvalidation) => void,
  ) => Effect.Effect<void, never, Scope.Scope>
  /**
   * Marks the connection as one the SDK reconnects on its own. From then on a
   * drop the SDK will retry, or a socket found closed without its close event,
   * puts it in recovery rather than ending it. Enabled once its session is
   * live, so a drop before that ends a session that never served anyone.
   */
  readonly enableRecovery: () => void
  readonly isRecoverable: () => boolean
  readonly beginRecovery: (
    recovery: Omit<
      Extract<ConnectionRecovery, { readonly status: "recovering" }>,
      "status"
    >,
  ) => void
  /**
   * The SDK re-established the connection and is replaying its
   * subscriptions. Recovery completes once every tracked subscription has
   * re-applied (at once when none is tracked).
   */
  readonly beginReplay: () => void
  /**
   * An applied library subscription the replay must restore, until it is
   * untracked or ends (an unsubscribe through any path: the SDK ends it before
   * it would replay it).
   */
  readonly trackSubscription: (handle: TrackedSubscription) => void
  /** The subscription ended (unsubscribed, failed); the replay stops waiting on it. */
  readonly untrackSubscription: (handle: TrackedSubscription) => void
  readonly subscriptionReapplied: (handle: TrackedSubscription) => void
  readonly recovery: () => ConnectionRecoverySnapshot
  /**
   * Resolves with the first recovery snapshot newer than `version`, at once
   * when one already exists.
   */
  readonly awaitRecoveryAfter: (
    version: number,
  ) => Effect.Effect<ConnectionRecoverySnapshot>
}

export const socketClosedWithoutCloseEventMessage =
  "WebSocket closed without a close event"

/**
 * Whether the SDK reports the connection's socket as closing or closed. A
 * browser can tear a socket down (a frozen tab, a sleeping machine, a network
 * change) without ever delivering `onclose`, so the SDK's disconnect callback
 * never runs and calls sent afterwards are silently dropped. The SDK exposes
 * the socket's own state as `isSocketClosed` for exactly this; connections
 * without it (test doubles, older SDKs) never report a closed socket.
 */
const socketClosedProbe =
  (connection: object): (() => boolean) =>
  () =>
    Predicate.hasProperty(connection, "isSocketClosed") &&
    connection.isSocketClosed === true

const connected: ConnectionRecovery = { status: "connected" }

const notifyAll = <A>(listeners: Set<(value: A) => void>, value: A): void => {
  const pending = [...listeners]
  listeners.clear()
  for (const listener of pending) {
    try {
      listener(value)
    } catch {
      // Public observers must not prevent the remaining session streams
      // from receiving the transport's state change.
    }
  }
}

const makeWsConnectionState = (
  socketClosed: () => boolean,
): WsConnectionState => {
  let invalidation: ConnectionInvalidation | undefined
  let recoverable = false
  let recovery: ConnectionRecoverySnapshot = { version: 0, recovery: connected }
  let reconnectAttemptLast = 0
  const tracked = new Set<TrackedSubscription>()
  let replayPending: Set<TrackedSubscription> | undefined
  const listeners = new Set<(invalidation: ConnectionInvalidation) => void>()
  const recoveryListeners = new Set<
    (snapshot: ConnectionRecoverySnapshot) => void
  >()

  const invalidate = (next: ConnectionInvalidation) => {
    if (invalidation != null) {
      return
    }

    invalidation = next
    notifyAll(listeners, next)
  }

  const invalidateFromTransport = (message: string) =>
    invalidate({ kind: "lost", message })

  const transition = (next: ConnectionRecovery) => {
    if (invalidation != null) {
      return
    }
    recovery = { version: recovery.version + 1, recovery: next }
    notifyAll(recoveryListeners, recovery)
  }

  const settleReplay = () => {
    if (replayPending !== undefined && replayPending.size === 0) {
      replayPending = undefined
      transition(connected)
    }
  }

  // Every liveness read first checks the socket itself, so a socket that
  // closed without its close event is acted on at the next call, subscribe
  // or check, and everything awaiting the connection learns of it then. It
  // ends a connection that does not recover by itself; a recoverable one
  // enters recovery, which the SDK resolves if it notices (a page resume)
  // and the reconnect bound ends if it never does (a host without resume
  // events).
  const currentInvalidation = (): ConnectionInvalidation | undefined => {
    if (invalidation == null && socketClosed()) {
      if (!recoverable) {
        invalidateFromTransport(socketClosedWithoutCloseEventMessage)
      } else if (recovery.recovery.status === "connected") {
        transition({
          status: "recovering",
          reason: socketClosedWithoutCloseEventMessage,
          reconnectAttempt: 0,
          reconnectDelayMillis: 0,
        })
      }
    }
    return invalidation
  }

  return {
    assertActive: () => {
      const current = currentInvalidation()
      return current != null
        ? Effect.fail(
            new SubscriptionInvalidatedError({
              raw: current.message,
            }),
          )
        : Effect.void
    },
    awaitInvalidation: () =>
      Effect.callback<ConnectionInvalidation>((resume) => {
        const current = currentInvalidation()
        if (current != null) {
          resume(Effect.succeed(current))
          return
        }

        const listener = (next: ConnectionInvalidation) => {
          resume(Effect.succeed(next))
        }
        listeners.add(listener)
        return Effect.suspend(() => {
          listeners.delete(listener)
          return Effect.void
        })
      }),
    invalidateFromTransport,
    invalidateForIdentityChange: (message) =>
      invalidate({ kind: "identityChanged", message }),
    invalidateForFailedCredentials: (message, cause) =>
      invalidate({ kind: "credentialsFailed", message, cause }),
    invalidateForCredentialsDefect: (message, defect) =>
      invalidate({ kind: "credentialsDefect", message, defect }),
    invalidation: currentInvalidation,
    isInvalidated: () => currentInvalidation() !== undefined,
    observeInvalidation: (listener) =>
      Effect.acquireRelease(
        Effect.suspend(() => {
          const current = currentInvalidation()
          if (current != null) {
            listener(current)
            return Effect.void
          }

          listeners.add(listener)
          return Effect.void
        }),
        () =>
          Effect.suspend(() => {
            listeners.delete(listener)
            return Effect.void
          }),
      ),
    enableRecovery: () => {
      recoverable = true
    },
    isRecoverable: () => recoverable,
    beginRecovery: (report) => {
      // A new drop discards the socket a replay was running on.
      replayPending = undefined
      reconnectAttemptLast = report.reconnectAttempt
      transition({ status: "recovering", ...report })
    },
    beginReplay: () => {
      if (recovery.recovery.status !== "recovering") {
        return
      }
      // A subscription unsubscribed through its own handle has ended by now:
      // the drop ended every unsubscribe the server had not confirmed.
      for (const handle of tracked) {
        if (handle.isEnded()) {
          tracked.delete(handle)
        }
      }
      replayPending = new Set(tracked)
      if (replayPending.size === 0) {
        settleReplay()
        return
      }
      transition({
        status: "recovering",
        reason: `Replaying ${replayPending.size.toString()} subscription(s) after reconnecting`,
        reconnectAttempt: reconnectAttemptLast,
        reconnectDelayMillis: 0,
      })
    },
    trackSubscription: (handle) => {
      tracked.add(handle)
    },
    untrackSubscription: (handle) => {
      tracked.delete(handle)
      replayPending?.delete(handle)
      settleReplay()
    },
    subscriptionReapplied: (handle) => {
      replayPending?.delete(handle)
      settleReplay()
    },
    recovery: () => recovery,
    awaitRecoveryAfter: (version) =>
      Effect.callback<ConnectionRecoverySnapshot>((resume) => {
        if (recovery.version > version) {
          resume(Effect.succeed(recovery))
          return
        }

        const listener = (next: ConnectionRecoverySnapshot) => {
          resume(Effect.succeed(next))
        }
        recoveryListeners.add(listener)
        return Effect.suspend(() => {
          recoveryListeners.delete(listener)
          return Effect.void
        })
      }),
  }
}

const stateRegistry = new WeakMap<object, WsConnectionState>()

export const connectionStateFor = <Connection extends object>(
  connection: Connection,
): WsConnectionState => {
  const existing = stateRegistry.get(connection)
  if (existing != null) {
    return existing
  }

  const created = makeWsConnectionState(socketClosedProbe(connection))
  stateRegistry.set(connection, created)
  return created
}
