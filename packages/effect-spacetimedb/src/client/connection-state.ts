import * as Effect from "effect/Effect"
import type * as Scope from "effect/Scope"
import {
  SubscriptionInvalidatedError,
  type SubscriptionFailure,
} from "./ws-subscription.ts"

export type ConnectionInvalidation = {
  readonly message: string
  readonly connectionFatal: boolean
}

export type WsConnectionState = {
  readonly assertActive: () => Effect.Effect<void, SubscriptionFailure>
  readonly invalidateFromTransport: (
    message: string,
    connectionFatal?: boolean,
  ) => void
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
              connectionFatal: invalidation.connectionFatal,
            }),
          )
        : Effect.void,
    invalidateFromTransport: (message, connectionFatal = true) => {
      if (invalidation != null) {
        return
      }

      invalidation = {
        message,
        connectionFatal,
      }

      for (const listener of listeners) {
        listener(invalidation)
      }
      listeners.clear()
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
