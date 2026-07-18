import * as Effect from "effect/Effect"
import type * as Scope from "effect/Scope"
import {
  SubscriptionInvalidatedError,
  type SubscriptionFailure,
} from "./ws-subscription.ts"

export type ConnectionInvalidation = {
  readonly message: string
}

export type WsConnectionState = {
  readonly assertActive: () => Effect.Effect<void, SubscriptionFailure>
  readonly invalidateFromTransport: (message: string) => void
  readonly invalidation: () => ConnectionInvalidation | undefined
  readonly isInvalidated: () => boolean
  readonly observeInvalidation: (
    listener: (invalidation: ConnectionInvalidation) => void,
  ) => Effect.Effect<void, never, Scope.Scope>
}

const makeWsConnectionState = (): WsConnectionState => {
  let invalidation: ConnectionInvalidation | undefined
  const listeners = new Set<(invalidation: ConnectionInvalidation) => void>()

  return {
    assertActive: () =>
      invalidation != null
        ? Effect.fail(
            new SubscriptionInvalidatedError({
              raw: invalidation.message,
            }),
          )
        : Effect.void,
    invalidateFromTransport: (message) => {
      if (invalidation != null) {
        return
      }

      invalidation = {
        message,
      }

      const pendingListeners = [...listeners]
      listeners.clear()
      for (const listener of pendingListeners) {
        try {
          listener(invalidation)
        } catch {
          // Public observers must not prevent the remaining session streams
          // from receiving the transport's terminal invalidation.
        }
      }
    },
    invalidation: () => invalidation,
    isInvalidated: () => invalidation !== undefined,
    observeInvalidation: (listener) =>
      Effect.acquireRelease(
        Effect.suspend(() => {
          if (invalidation != null) {
            listener(invalidation)
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

  const created = makeWsConnectionState()
  stateRegistry.set(connection, created)
  return created
}
