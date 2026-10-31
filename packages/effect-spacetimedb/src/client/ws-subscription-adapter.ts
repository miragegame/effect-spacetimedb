import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Result from "effect/Result"
import * as Scope from "effect/Scope"
import type { TypedQuery } from "../query/types.ts"
import type { WsConnectionState } from "./connection-state.ts"
import {
  SubscriptionRejectedError,
  SubscriptionTransportError,
} from "./ws-subscription.ts"

export type SubscriptionHandleLike = {
  readonly isEnded: () => boolean
  readonly isActive: () => boolean
  readonly unsubscribe: () => void
  readonly unsubscribeThen: (onEnd: () => void) => void
}

export type NativeSubscriptionHandleLike = {
  readonly isEnded: () => boolean
  readonly isActive?: (() => boolean) | undefined
  readonly unsubscribe: () => void
  readonly unsubscribeThen?: ((onEnd: () => void) => void) | undefined
}

const isCompleteNativeHandle = (
  handle: NativeSubscriptionHandleLike,
): handle is NativeSubscriptionHandleLike & SubscriptionHandleLike =>
  handle.isActive !== undefined && handle.unsubscribeThen !== undefined

const handleDeactivators = new WeakMap<object, () => void>()
const handleFailureSignals = new WeakMap<
  object,
  Deferred.Deferred<never, SubscriptionRejectedError>
>()
const handleConnectionStates = new WeakMap<object, WsConnectionState>()

/**
 * Ties an applied subscription handle to the connection that carries it. The
 * SDK never ends a subscription or runs its `onEnd` callbacks when the socket
 * closes, so {@link unsubscribeThen} needs the connection's invalidation to
 * know that the subscription ended with it; and an automatic reconnect's
 * replay must re-apply it before the connection counts as recovered.
 */
export const bindHandleToConnection = (
  handle: SubscriptionHandleLike,
  connectionState: WsConnectionState,
): void => {
  handleConnectionStates.set(handle, connectionState)
  connectionState.trackSubscription(handle)
}

export type SubscriptionQuerySource<Root> =
  | string
  | TypedQuery
  | ReadonlyArray<TypedQuery>
  | ((root: Root) => TypedQuery | ReadonlyArray<TypedQuery>)

export interface SubscriptionBuilderLike<ErrorContext, QueryRoot> {
  onApplied(
    callback: () => void,
  ): SubscriptionBuilderLike<ErrorContext, QueryRoot>
  onError(
    callback: (context: ErrorContext, error?: Error) => void,
  ): SubscriptionBuilderLike<ErrorContext, QueryRoot>
  subscribe(
    query: SubscriptionQuerySource<QueryRoot>,
  ): NativeSubscriptionHandleLike
}

const normalizeHandle = (
  nativeHandle: NativeSubscriptionHandleLike,
  adapterIsActive: () => boolean,
): SubscriptionHandleLike => {
  if (isCompleteNativeHandle(nativeHandle)) {
    return nativeHandle
  }

  return {
    isEnded: () => nativeHandle.isEnded(),
    isActive: () => adapterIsActive() && !nativeHandle.isEnded(),
    unsubscribe: () => nativeHandle.unsubscribe(),
    unsubscribeThen: (onEnd) => {
      if (!nativeHandle.isEnded()) {
        nativeHandle.unsubscribe()
      }
      onEnd()
    },
  }
}

export type SubscriptionAdapter<QueryRoot> = {
  readonly subscribe: (
    query: SubscriptionQuerySource<QueryRoot>,
    onAppliedError?: (error: SubscriptionRejectedError) => void,
  ) => Effect.Effect<
    SubscriptionHandleLike,
    SubscriptionRejectedError | SubscriptionTransportError,
    Scope.Scope
  >
}

export const unsubscribeHandle = (handle: SubscriptionHandleLike) =>
  Effect.try({
    try: () => {
      handleConnectionStates.get(handle)?.untrackSubscription(handle)
      handleDeactivators.get(handle)?.()
      if (!handle.isEnded()) {
        handle.unsubscribe()
      }
    },
    catch: (cause) =>
      new SubscriptionTransportError({
        cause,
      }),
  }).pipe(Effect.catchTag("SubscriptionTransportError", () => Effect.void))

/**
 * Unsubscribes and waits until the subscription has ended: the server
 * confirmed it, the subscription failed, or the connection carrying it was
 * lost (a lost connection ends every subscription on it, and no confirmation
 * would ever arrive).
 */
export const unsubscribeThen = (
  handle: SubscriptionHandleLike,
): Effect.Effect<
  void,
  SubscriptionRejectedError | SubscriptionTransportError
> =>
  Effect.suspend(() => {
    const connectionState = handleConnectionStates.get(handle)
    if (connectionState === undefined) {
      return unsubscribeThenOnLiveConnection(handle)
    }
    // An automatic reconnect's replay must not wait for it any more.
    connectionState.untrackSubscription(handle)
    if (connectionState.isInvalidated()) {
      return Effect.void
    }
    return Effect.raceFirst(
      unsubscribeThenOnLiveConnection(handle),
      connectionState.awaitInvalidation().pipe(Effect.asVoid),
    )
  })

const unsubscribeThenOnLiveConnection = (
  handle: SubscriptionHandleLike,
): Effect.Effect<
  void,
  SubscriptionRejectedError | SubscriptionTransportError
> => {
  const completion = Effect.callback<void, SubscriptionTransportError>(
    (resume) => {
      Result.match(
        Result.try(() => handle.unsubscribeThen(() => resume(Effect.void))),
        {
          onFailure: (cause) =>
            resume(Effect.fail(new SubscriptionTransportError({ cause }))),
          onSuccess: () => undefined,
        },
      )
      // Interruption stops waiting; the native unsubscribe request remains in
      // flight and the owning scope's finalizer stays best-effort.
      return Effect.void
    },
  )
  const failureSignal = handleFailureSignals.get(handle)
  return failureSignal === undefined
    ? completion
    : Effect.raceFirst(completion, Deferred.await(failureSignal))
}

export const fromBuilder = <ErrorContext, QueryRoot>(options: {
  readonly build: () => SubscriptionBuilderLike<ErrorContext, QueryRoot>
  readonly messageFromError: (context: ErrorContext, error?: Error) => string
}): SubscriptionAdapter<QueryRoot> => ({
  subscribe: (query, onAppliedError) =>
    Effect.gen(function* () {
      let active = true
      const failureSignal = Deferred.makeUnsafe<
        never,
        SubscriptionRejectedError
      >()
      yield* Effect.addFinalizer(() =>
        Effect.suspend(() => {
          active = false
          return Effect.void
        }),
      )

      return yield* Effect.callback<
        SubscriptionHandleLike,
        SubscriptionRejectedError | SubscriptionTransportError
      >((resume) => {
        let settled = false
        let handle: SubscriptionHandleLike | undefined
        let applied = false
        let terminalBeforeHandle = false

        const finish = (
          effect: Effect.Effect<
            SubscriptionHandleLike,
            SubscriptionRejectedError | SubscriptionTransportError
          >,
        ) => {
          if (settled) {
            return
          }

          settled = true
          resume(effect)
        }

        const callbackBeforeHandle = (callback: "onApplied" | "onError") =>
          Effect.fail(
            new SubscriptionTransportError({
              cause: new Error(
                `Subscription builder ${callback} fired before subscribe() returned a handle`,
              ),
            }),
          )

        Result.match(
          Result.try(() => {
            const builder = options
              .build()
              .onApplied(() => {
                const currentHandle = handle
                if (currentHandle == null) {
                  terminalBeforeHandle = true
                  finish(callbackBeforeHandle("onApplied"))
                  return
                }
                if (applied) {
                  // An automatic reconnect replayed it.
                  handleConnectionStates
                    .get(currentHandle)
                    ?.subscriptionReapplied(currentHandle)
                  return
                }

                applied = true
                finish(Effect.succeed(currentHandle))
              })
              .onError((context, error) => {
                if (!active) {
                  return
                }

                const rejection = new SubscriptionRejectedError({
                  raw: options.messageFromError(context, error),
                })
                Deferred.doneUnsafe(failureSignal, Effect.fail(rejection))

                if (applied) {
                  // Ended by the server after it applied (an automatic
                  // reconnect's replay): no replay waits on it any more.
                  active = false
                  if (handle != null) {
                    handleConnectionStates
                      .get(handle)
                      ?.untrackSubscription(handle)
                  }
                  onAppliedError?.(rejection)
                  return
                }

                const message = rejection.raw
                const currentHandle = handle
                if (currentHandle == null) {
                  terminalBeforeHandle = true
                }
                finish(
                  currentHandle != null
                    ? unsubscribeHandle(currentHandle).pipe(
                        Effect.andThen(
                          Effect.fail(
                            new SubscriptionRejectedError({
                              raw: message,
                            }),
                          ),
                        ),
                      )
                    : callbackBeforeHandle("onError"),
                )
              })

            const nativeHandle = builder.subscribe(query)
            handle = normalizeHandle(nativeHandle, () => active)
            handleFailureSignals.set(handle, failureSignal)
            handleDeactivators.set(handle, () => {
              active = false
            })
            if (terminalBeforeHandle && !nativeHandle.isEnded()) {
              active = false
              nativeHandle.unsubscribe()
            }
          }),
          {
            onFailure: (cause) =>
              Effect.fail(
                new SubscriptionTransportError({
                  cause,
                }),
              ).pipe(finish),
            onSuccess: () => undefined,
          },
        )

        return Effect.suspend(() =>
          handle != null ? unsubscribeHandle(handle) : Effect.void,
        )
      })
    }),
})
