import * as Effect from "effect/Effect"
import * as Result from "effect/Result"
import * as Scope from "effect/Scope"
import type { TypedQuery } from "../query/types.ts"
import {
  SubscriptionRejectedError,
  SubscriptionTransportError,
} from "./ws-subscription.ts"

export type SubscriptionHandleLike = {
  readonly isEnded: () => boolean
  readonly unsubscribe: () => void
}

export type SubscriptionQuerySource<Root> =
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
  subscribe(query: SubscriptionQuerySource<QueryRoot>): SubscriptionHandleLike
}

export type SubscriptionAdapter<QueryRoot> = {
  readonly subscribe: (
    query: SubscriptionQuerySource<QueryRoot>,
  ) => Effect.Effect<
    SubscriptionHandleLike,
    SubscriptionRejectedError | SubscriptionTransportError,
    Scope.Scope
  >
}

export const unsubscribeHandle = (handle: SubscriptionHandleLike) =>
  Effect.try({
    try: () => {
      if (!handle.isEnded()) {
        handle.unsubscribe()
      }
    },
    catch: (cause) =>
      new SubscriptionTransportError({
        cause,
      }),
  }).pipe(Effect.catchTag("SubscriptionTransportError", () => Effect.void))

export const fromBuilder = <ErrorContext, QueryRoot>(options: {
  readonly build: () => SubscriptionBuilderLike<ErrorContext, QueryRoot>
  readonly messageFromError: (context: ErrorContext, error?: Error) => string
  readonly onAppliedError?: (message: string) => void
}): SubscriptionAdapter<QueryRoot> => ({
  subscribe: (query) =>
    Effect.callback<
      SubscriptionHandleLike,
      SubscriptionRejectedError | SubscriptionTransportError
    >((resume) => {
      let settled = false
      let handle: SubscriptionHandleLike | undefined
      let appliedErrorSink: ((message: string) => void) | undefined

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
                finish(callbackBeforeHandle("onApplied"))
                return
              }

              appliedErrorSink = options.onAppliedError
              finish(Effect.succeed(currentHandle))
            })
            .onError((context, error) => {
              const message = options.messageFromError(context, error)
              if (appliedErrorSink != null) {
                appliedErrorSink(message)
                return
              }

              const currentHandle = handle
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

          handle = builder.subscribe(query)
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
    }),
})
