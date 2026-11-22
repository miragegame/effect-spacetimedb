import type { WsProtocolError } from "./ws-resource-lifecycle.ts"
import * as Effect from "effect/Effect"
import * as Predicate from "effect/Predicate"
import type * as Scope from "effect/Scope"
import {
  invalidationRevokesRows,
  SubscriptionInvalidatedError,
  type SubscriptionFailure,
} from "./ws-subscription.ts"

/**
 * A connection's end, with what explains it: `credentialsFailed` is a token
 * Effect that failed (or overran its reconnect attempt) while refreshing the
 * token for a reconnect, with its failure as `cause`; `credentialsDefect` is one
 * that died or was interrupted, with the defect. `lost` also covers a reconnect
 * that overran its bound. The kinds are `ConnectionInvalidationKind`.
 */
export type ConnectionInvalidation =
  | {
      readonly kind: "lost"
      readonly message: string
    }
  | {
      readonly kind: "protocolError"
      readonly message: string
      readonly cause: WsProtocolError
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

/** What a token Effect that produced no token says of a connection. */
export type CredentialsInvalidation = Extract<
  ConnectionInvalidation,
  { readonly kind: "credentialsFailed" | "credentialsDefect" }
>

/** What takes a connection's rows, which an ordinary loss does not. */
export type RevokingInvalidation = Exclude<
  ConnectionInvalidation,
  { readonly kind: "lost" }
>

const isRevoking = (
  invalidation: ConnectionInvalidation,
): invalidation is RevokingInvalidation =>
  invalidationRevokesRows(invalidation.kind)

/**
 * Whether the rows of a run of connections may still be shown. A connection
 * starts its own, and a supervisor's sessions share one for as long as each
 * replaces the last under the same identity, because a reader can hold rows from
 * any of them: a lazy snapshot can name a session replaced long ago.
 *
 * It refers to no connection: connections refer to it, so a lineage costs the
 * same after a week of reconnects as after one. Its waiters are the refs still
 * open on those connections, each gone when its ref closes.
 */
export type RowLineage = {
  readonly revocation: () => RevokingInvalidation | undefined
  /**
   * Takes every connection's rows at once, however each of them ended. An owner
   * can learn that nobody vouches for an identity only after an ordinary loss,
   * when it cannot get a token for a replacement, or the replacement is someone
   * else.
   */
  readonly revoke: (invalidation: RevokingInvalidation) => void
  readonly waiters: Set<(invalidation: ConnectionInvalidation) => void>
}

export const subscriptionInvalidated = (
  invalidation: ConnectionInvalidation,
): SubscriptionInvalidatedError =>
  new SubscriptionInvalidatedError({
    raw: invalidation.message,
    kind: invalidation.kind,
  })

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
  readonly invalidateForProtocolError: (cause: WsProtocolError) => void
  readonly invalidateFromTransport: (message: string) => void
  readonly invalidateForIdentityChange: (message: string) => void
  readonly invalidateForCredentials: (
    invalidation: CredentialsInvalidation,
  ) => void
  readonly invalidation: () => ConnectionInvalidation | undefined
  readonly isInvalidated: () => boolean
  /** Whether the rows this connection read are revoked, however that happened. */
  readonly isRevoked: () => boolean
  /** Resolves once this connection's rows are revoked, at once if they are. */
  readonly awaitRevocation: () => Effect.Effect<ConnectionInvalidation>
  readonly rowLineage: () => RowLineage
  /**
   * Makes this connection answer to `lineage`. One that is already revoked has
   * nothing left to hand on, and a connection already revoked takes `lineage`
   * with it. For the owner of a new connection, before anyone else can hold it: a
   * ref already waiting would stay behind.
   */
  readonly joinRowLineage: (lineage: RowLineage) => void
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
  /**
   * Puts the connection in recovery for a drop or failed attempt the SDK reported
   * with a retry scheduled, and answers whether it did: a connection whose
   * recovery is not enabled, or that has ended, does not recover, so the report
   * is its end to handle.
   */
  readonly beginRecovery: (
    recovery: Omit<
      Extract<ConnectionRecovery, { readonly status: "recovering" }>,
      "status"
    >,
  ) => boolean
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

const makeRowLineage = (): RowLineage => {
  let revocation: RevokingInvalidation | undefined
  const waiters = new Set<(invalidation: ConnectionInvalidation) => void>()
  return {
    revocation: () => revocation,
    revoke: (invalidation) => {
      if (revocation === undefined) {
        revocation = invalidation
        notifyAll(waiters, invalidation)
      }
    },
    waiters,
  }
}

/**
 * Where a connection is, as one value, so a replay cannot outlive its recovery and
 * a connection that does not recover cannot be recovering.
 *
 * - `direct`: carrying traffic, and a drop ends it.
 * - `recoverable`: carrying traffic, and the SDK recovers a drop.
 * - `awaitingSdk`: no socket; the SDK holds the next attempt.
 * - `replaying`: the SDK reconnected, and `pending` have yet to re-apply.
 * - `ended`: over, and it stays that way whatever the SDK reports afterwards.
 */
type Liveness =
  | { readonly kind: "direct" }
  | { readonly kind: "recoverable" }
  | {
      readonly kind: "awaitingSdk"
      readonly reason: string
      readonly reconnectAttempt: number
      readonly reconnectDelayMillis: number
    }
  | {
      readonly kind: "replaying"
      readonly reason: string
      readonly reconnectAttempt: number
      readonly pending: Set<TrackedSubscription>
    }
  | { readonly kind: "ended"; readonly invalidation: ConnectionInvalidation }

const recoveryOf = (
  liveness: Exclude<Liveness, { readonly kind: "ended" | "direct" }>,
): ConnectionRecovery => {
  switch (liveness.kind) {
    case "recoverable":
      return connected
    case "awaitingSdk":
      return {
        status: "recovering",
        reason: liveness.reason,
        reconnectAttempt: liveness.reconnectAttempt,
        reconnectDelayMillis: liveness.reconnectDelayMillis,
      }
    case "replaying":
      return {
        status: "recovering",
        reason: liveness.reason,
        reconnectAttempt: liveness.reconnectAttempt,
        reconnectDelayMillis: 0,
      }
  }
}

const invalidationOf = (
  liveness: Liveness,
): ConnectionInvalidation | undefined =>
  liveness.kind === "ended" ? liveness.invalidation : undefined

const makeWsConnectionState = (
  socketClosed: () => boolean,
): WsConnectionState => {
  let liveness: Liveness = { kind: "direct" }
  let rowLineage = makeRowLineage()
  let recovery: ConnectionRecoverySnapshot = { version: 0, recovery: connected }
  const tracked = new Set<TrackedSubscription>()
  const listeners = new Set<(invalidation: ConnectionInvalidation) => void>()
  const recoveryListeners = new Set<
    (snapshot: ConnectionRecoverySnapshot) => void
  >()

  const invalidate = (next: ConnectionInvalidation) => {
    if (liveness.kind === "ended") {
      return
    }

    liveness = { kind: "ended", invalidation: next }
    // Before anyone is told, so that an observer asking `isRevoked` hears the truth:
    // it gets no second notification to correct a stale answer.
    if (isRevoking(next)) {
      rowLineage.revoke(next)
    }
    notifyAll(listeners, next)
  }

  const invalidateFromTransport = (message: string) =>
    invalidate({ kind: "lost", message })

  // Every step of a recovery goes through here; only callers that are in one
  // reach it, so a connection that ended meanwhile has already been ruled out.
  const transition = (
    next: Exclude<Liveness, { readonly kind: "ended" | "direct" }>,
  ) => {
    liveness = next
    recovery = { version: recovery.version + 1, recovery: recoveryOf(next) }
    notifyAll(recoveryListeners, recovery)
  }

  const settleReplay = () => {
    if (liveness.kind === "replaying" && liveness.pending.size === 0) {
      transition({ kind: "recoverable" })
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
    if (liveness.kind !== "ended" && socketClosed()) {
      if (liveness.kind === "direct") {
        invalidateFromTransport(socketClosedWithoutCloseEventMessage)
      } else if (liveness.kind === "recoverable") {
        transition({
          kind: "awaitingSdk",
          reason: socketClosedWithoutCloseEventMessage,
          reconnectAttempt: 0,
          reconnectDelayMillis: 0,
        })
      }
    }
    return invalidationOf(liveness)
  }

  const awaitNotified = (
    current: () => ConnectionInvalidation | undefined,
    notified: Set<(invalidation: ConnectionInvalidation) => void>,
  ) =>
    Effect.callback<ConnectionInvalidation>((resume) => {
      const settled = current()
      if (settled != null) {
        resume(Effect.succeed(settled))
        return
      }

      const listener = (next: ConnectionInvalidation) => {
        resume(Effect.succeed(next))
      }
      notified.add(listener)
      return Effect.suspend(() => {
        notified.delete(listener)
        return Effect.void
      })
    })

  return {
    assertActive: () => {
      const current = currentInvalidation()
      return current != null
        ? Effect.fail(subscriptionInvalidated(current))
        : Effect.void
    },
    awaitInvalidation: () => awaitNotified(currentInvalidation, listeners),
    invalidateFromTransport,
    invalidateForProtocolError: (cause) =>
      invalidate({ kind: "protocolError", message: cause.message, cause }),
    invalidateForIdentityChange: (message) =>
      invalidate({ kind: "identityChanged", message }),
    invalidateForCredentials: invalidate,
    invalidation: currentInvalidation,
    isInvalidated: () => currentInvalidation() !== undefined,
    isRevoked: () => rowLineage.revocation() !== undefined,
    awaitRevocation: () =>
      Effect.suspend(() =>
        awaitNotified(rowLineage.revocation, rowLineage.waiters),
      ),
    rowLineage: () => rowLineage,
    joinRowLineage: (lineage) => {
      const revocation = rowLineage.revocation()
      if (revocation !== undefined) {
        lineage.revoke(revocation)
      } else if (lineage.revocation() === undefined) {
        rowLineage = lineage
      }
    },
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
      if (liveness.kind === "direct") {
        liveness = { kind: "recoverable" }
      }
    },
    beginRecovery: (report) => {
      if (liveness.kind === "direct" || liveness.kind === "ended") {
        return false
      }
      // A new drop discards the socket a replay was running on.
      transition({ kind: "awaitingSdk", ...report })
      return true
    },
    beginReplay: () => {
      if (liveness.kind !== "awaitingSdk" && liveness.kind !== "replaying") {
        return
      }
      // A subscription unsubscribed through its own handle has ended by now:
      // the drop ended every unsubscribe the server had not confirmed.
      for (const handle of tracked) {
        if (handle.isEnded()) {
          tracked.delete(handle)
        }
      }
      const pending = new Set(tracked)
      if (pending.size === 0) {
        transition({ kind: "recoverable" })
        return
      }
      transition({
        kind: "replaying",
        reason: `Replaying ${pending.size.toString()} subscription(s) after reconnecting`,
        reconnectAttempt: liveness.reconnectAttempt,
        pending,
      })
    },
    trackSubscription: (handle) => {
      tracked.add(handle)
    },
    untrackSubscription: (handle) => {
      tracked.delete(handle)
      if (liveness.kind === "replaying") {
        liveness.pending.delete(handle)
      }
      settleReplay()
    },
    subscriptionReapplied: (handle) => {
      if (liveness.kind === "replaying") {
        liveness.pending.delete(handle)
      }
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
