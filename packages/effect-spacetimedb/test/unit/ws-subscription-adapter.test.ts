import * as EffectVitest from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as StdbTesting from "effect-spacetimedb/testing"
import { unsubscribeHandle } from "../../src/client/ws-subscription-adapter.ts"
import { TestLayer } from "../helpers/test-layer"

const { expect } = EffectVitest
const describe = EffectVitest.layer(TestLayer)
const testQuery = [] satisfies ReadonlyArray<StdbTesting.TypedQuery>

const subscriptionErrorMessage = (context: unknown, error?: Error): string =>
  error?.message ?? String(context)

const makeHandle = () => {
  let unsubscribed = false

  return {
    handle: {
      isEnded: () => unsubscribed,
      unsubscribe: () => {
        unsubscribed = true
      },
    } satisfies StdbTesting.NativeSubscriptionHandleLike,
    unsubscribed: () => unsubscribed,
  }
}

const failureFromExit = (exit: Exit.Exit<unknown, unknown>): unknown => {
  expect(Exit.isFailure(exit)).toBe(true)

  if (!Exit.isFailure(exit)) {
    throw new Error("Expected failure exit")
  }

  const failure = Cause.findErrorOption(exit.cause)
  expect(Option.isSome(failure)).toBe(true)

  if (!Option.isSome(failure)) {
    throw new Error("Expected failure cause")
  }

  return failure.value
}

describe("ws subscription adapter", (it) => {
  it.effect(
    "forwards function query sources to the native builder unchanged",
    () =>
      Effect.gen(function* () {
        const { handle } = makeHandle()
        const querySource = (_root: string) => testQuery
        let received: unknown
        let onApplied: (() => void) | undefined

        const builder: StdbTesting.SubscriptionBuilderLike<string, string> = {
          onApplied: (callback) => {
            onApplied = callback
            return builder
          },
          onError: () => builder,
          subscribe: (query) => {
            received = query
            return handle
          },
        }
        const adapter = StdbTesting.fromBuilder({
          build: () => builder,
          messageFromError: subscriptionErrorMessage,
        })

        const fiber = yield* Effect.forkScoped(adapter.subscribe(querySource))
        yield* Effect.yieldNow

        expect(received).toBe(querySource)
        onApplied?.()
        yield* Fiber.join(fiber)
      }).pipe(Effect.scoped),
  )

  it.effect("succeeds when apply fires after subscribe returns", () =>
    Effect.gen(function* () {
      const onAppliedRegistered = Deferred.makeUnsafe<() => void>()
      const { handle } = makeHandle()

      const builder: StdbTesting.SubscriptionBuilderLike<string, string> = {
        onApplied: (callback) => {
          Deferred.doneUnsafe(onAppliedRegistered, Effect.succeed(callback))
          return builder
        },
        onError: () => builder,
        subscribe: () => handle,
      }

      const adapter = StdbTesting.fromBuilder({
        build: () => builder,
        messageFromError: subscriptionErrorMessage,
      })

      const fiber = yield* Effect.forkScoped(adapter.subscribe(testQuery))

      const onApplied = yield* Deferred.await(onAppliedRegistered)
      yield* Effect.yieldNow
      expect(fiber.pollUnsafe()).toBeUndefined()

      onApplied()

      expect((yield* Fiber.join(fiber)).isEnded()).toBe(false)
    }).pipe(Effect.scoped),
  )

  for (const callback of ["onApplied", "onError"] as const) {
    it.effect(
      `unsubscribes when ${callback} fires before a handle returns`,
      () =>
        Effect.gen(function* () {
          const { handle, unsubscribed } = makeHandle()
          let applied: (() => void) | undefined
          let rejected: ((context: string, error?: Error) => void) | undefined
          const builder: StdbTesting.SubscriptionBuilderLike<string, string> = {
            onApplied: (registered) => {
              applied = registered
              return builder
            },
            onError: (registered) => {
              rejected = registered
              return builder
            },
            subscribe: () => {
              Match.value(callback).pipe(
                Match.when("onApplied", () => applied?.()),
                Match.when("onError", () => rejected?.("rejected")),
                Match.exhaustive,
              )
              return handle
            },
          }
          const adapter = StdbTesting.fromBuilder({
            build: () => builder,
            messageFromError: subscriptionErrorMessage,
          })

          const failure = yield* Effect.flip(
            adapter.subscribe(testQuery).pipe(Effect.scoped),
          )
          expect(failure).toBeInstanceOf(StdbTesting.SubscriptionTransportError)
          expect(unsubscribed()).toBe(true)
        }),
    )
  }

  it.effect("fails and unsubscribes when rejection fires before apply", () =>
    Effect.gen(function* () {
      const onErrorRegistered =
        Deferred.makeUnsafe<
          (context: string, error?: Error | undefined) => void
        >()
      const { handle, unsubscribed } = makeHandle()

      const builder: StdbTesting.SubscriptionBuilderLike<string, string> = {
        onApplied: () => builder,
        onError: (callback) => {
          Deferred.doneUnsafe(onErrorRegistered, Effect.succeed(callback))
          return builder
        },
        subscribe: () => handle,
      }

      const adapter = StdbTesting.fromBuilder({
        build: () => builder,
        messageFromError: subscriptionErrorMessage,
      })

      const fiber = yield* Effect.forkScoped(adapter.subscribe(testQuery))
      const onError = yield* Deferred.await(onErrorRegistered)
      yield* Effect.yieldNow
      expect(fiber.pollUnsafe()).toBeUndefined()

      onError("rejected")

      const failure = failureFromExit(yield* Fiber.await(fiber))

      expect(failure).toBeInstanceOf(StdbTesting.SubscriptionRejectedError)
      expect(failure).toMatchObject({
        raw: "rejected",
      })
      expect(unsubscribed()).toBe(true)
    }).pipe(Effect.scoped),
  )

  it.effect("uses the native Error argument for SDK error contexts", () =>
    Effect.gen(function* () {
      const onErrorRegistered =
        Deferred.makeUnsafe<
          (
            context: { readonly event?: Error },
            error?: Error | undefined,
          ) => void
        >()
      const { handle } = makeHandle()

      const builder: StdbTesting.SubscriptionBuilderLike<
        { readonly event?: Error },
        string
      > = {
        onApplied: () => builder,
        onError: (callback) => {
          Deferred.doneUnsafe(onErrorRegistered, Effect.succeed(callback))
          return builder
        },
        subscribe: () => handle,
      }

      const adapter = StdbTesting.fromBuilder({
        build: () => builder,
        messageFromError: subscriptionErrorMessage,
      })

      const fiber = yield* Effect.forkScoped(adapter.subscribe(testQuery))
      const onError = yield* Deferred.await(onErrorRegistered)
      yield* Effect.yieldNow

      onError(
        { event: new Error("context rejected") },
        new Error("native rejected"),
      )

      const failure = failureFromExit(yield* Fiber.await(fiber))

      expect(failure).toBeInstanceOf(StdbTesting.SubscriptionRejectedError)
      expect(failure).toMatchObject({
        raw: "native rejected",
      })
    }).pipe(Effect.scoped),
  )

  it.effect("fails when subscribe throws synchronously", () =>
    Effect.gen(function* () {
      const builder: StdbTesting.SubscriptionBuilderLike<string, string> = {
        onApplied: () => builder,
        onError: () => builder,
        subscribe: () => {
          throw new Error("boom")
        },
      }

      const adapter = StdbTesting.fromBuilder({
        build: () => builder,
        messageFromError: subscriptionErrorMessage,
      })

      const failure = failureFromExit(
        yield* Effect.exit(adapter.subscribe(testQuery).pipe(Effect.scoped)),
      )

      expect(failure).toBeInstanceOf(StdbTesting.SubscriptionTransportError)
    }),
  )

  it.effect(
    "ignores lagging active handles when pending unsubscribe throws",
    () =>
      Effect.gen(function* () {
        const onAppliedRegistered = Deferred.makeUnsafe<() => void>()
        let unsubscribeCalls = 0
        const handle: StdbTesting.NativeSubscriptionHandleLike = {
          isEnded: () => false,
          unsubscribe: () => {
            unsubscribeCalls = unsubscribeCalls + 1
            throw new Error("unsubscribe lagged")
          },
        }

        const builder: StdbTesting.SubscriptionBuilderLike<string, string> = {
          onApplied: (callback) => {
            Deferred.doneUnsafe(onAppliedRegistered, Effect.succeed(callback))
            return builder
          },
          onError: () => builder,
          subscribe: () => handle,
        }

        const adapter = StdbTesting.fromBuilder({
          build: () => builder,
          messageFromError: subscriptionErrorMessage,
        })

        const exit = yield* Effect.exit(
          Effect.gen(function* () {
            const fiber = yield* Effect.forkScoped(adapter.subscribe(testQuery))
            yield* Deferred.await(onAppliedRegistered)
            yield* Effect.yieldNow
            yield* Fiber.interrupt(fiber)
          }).pipe(Effect.scoped),
        )

        expect(Exit.isSuccess(exit)).toBe(true)
        expect(unsubscribeCalls).toBe(1)
      }),
  )

  it.effect(
    "reports post-apply errors through the applied-error hook without converting success to rejection",
    () =>
      Effect.gen(function* () {
        const onAppliedRegistered = Deferred.makeUnsafe<() => void>()
        const onErrorRegistered =
          Deferred.makeUnsafe<
            (context: string, error?: Error | undefined) => void
          >()
        const messages: Array<string> = []
        const { handle } = makeHandle()

        const builder: StdbTesting.SubscriptionBuilderLike<string, string> = {
          onApplied: (callback) => {
            Deferred.doneUnsafe(onAppliedRegistered, Effect.succeed(callback))
            return builder
          },
          onError: (callback) => {
            Deferred.doneUnsafe(onErrorRegistered, Effect.succeed(callback))
            return builder
          },
          subscribe: () => handle,
        }

        const adapter = StdbTesting.fromBuilder({
          build: () => builder,
          messageFromError: subscriptionErrorMessage,
        })

        const fiber = yield* Effect.forkScoped(
          adapter.subscribe(testQuery, (error) => {
            messages.push(error.raw)
          }),
        )
        const [onApplied, onError] = yield* Effect.all([
          Deferred.await(onAppliedRegistered),
          Deferred.await(onErrorRegistered),
        ])
        yield* Effect.yieldNow

        onApplied()

        const acquired = yield* Fiber.join(fiber)
        expect(acquired).not.toBe(handle)
        expect(acquired.isActive()).toBe(true)

        onError("fatal")

        expect(messages).toEqual(["fatal"])
      }).pipe(Effect.scoped),
  )

  it.effect(
    "deactivates error callbacks before unsubscribe and ignores callbacks after release",
    () =>
      Effect.gen(function* () {
        let onApplied: (() => void) | undefined
        let onError: ((context: string, error?: Error) => void) | undefined
        let ended = false
        let renderedErrors = 0
        const messages: Array<string> = []
        const handle: StdbTesting.NativeSubscriptionHandleLike = {
          isEnded: () => ended,
          unsubscribe: () => {
            ended = true
            onError?.("unsubscribe rejection")
          },
        }
        const builder: StdbTesting.SubscriptionBuilderLike<string, string> = {
          onApplied: (callback) => {
            onApplied = callback
            return builder
          },
          onError: (callback) => {
            onError = callback
            return builder
          },
          subscribe: () => handle,
        }
        const adapter = StdbTesting.fromBuilder({
          build: () => builder,
          messageFromError: (context) => {
            renderedErrors = renderedErrors + 1
            return context
          },
        })

        yield* Effect.gen(function* () {
          const fiber = yield* Effect.forkScoped(
            adapter.subscribe(testQuery, (error) => {
              messages.push(error.raw)
            }),
          )
          yield* Effect.yieldNow
          onApplied?.()
          const acquired = yield* Fiber.join(fiber)
          yield* unsubscribeHandle(acquired)
        }).pipe(Effect.scoped)

        expect(messages).toEqual([])
        expect(renderedErrors).toBe(0)
        expect(() => onError?.("late rejection")).not.toThrow()
        expect(messages).toEqual([])
        expect(renderedErrors).toBe(0)
      }),
  )

  it.effect("tracks native liveness and resolves unsubscribe completion", () =>
    Effect.gen(function* () {
      const applied = Deferred.makeUnsafe<() => void>()
      const endRegistered = Deferred.makeUnsafe<() => void>()
      let active = false
      let ended = false
      const nativeHandle: StdbTesting.NativeSubscriptionHandleLike = {
        isEnded: () => ended,
        isActive: () => active,
        unsubscribe: () => {
          ended = true
          active = false
        },
        unsubscribeThen: (onEnd) => {
          Deferred.doneUnsafe(endRegistered, Effect.succeed(onEnd))
        },
      }
      const builder: StdbTesting.SubscriptionBuilderLike<string, string> = {
        onApplied: (callback) => {
          Deferred.doneUnsafe(applied, Effect.succeed(callback))
          return builder
        },
        onError: () => builder,
        subscribe: () => nativeHandle,
      }
      const adapter = StdbTesting.fromBuilder({
        build: () => builder,
        messageFromError: subscriptionErrorMessage,
      })

      yield* Effect.gen(function* () {
        const acquireFiber = yield* Effect.forkScoped(
          adapter.subscribe(testQuery),
        )
        const onApplied = yield* Deferred.await(applied)
        yield* Effect.yieldNow
        active = true
        onApplied()
        const handle = yield* Fiber.join(acquireFiber)
        expect(handle).toBe(nativeHandle)
        expect(handle.isActive()).toBe(true)

        const completion = yield* StdbTesting.unsubscribeThen(handle).pipe(
          Effect.forkScoped,
        )
        const onEnd = yield* Deferred.await(endRegistered)
        expect(completion.pollUnsafe()).toBeUndefined()
        ended = true
        active = false
        onEnd()
        yield* Fiber.join(completion)
        expect(handle.isActive()).toBe(false)
        expect(handle.isEnded()).toBe(true)
      }).pipe(Effect.scoped)
    }),
  )

  it.effect("normalizes legacy handles without optional SDK methods", () =>
    Effect.gen(function* () {
      let onApplied: (() => void) | undefined
      let ended = false
      const nativeHandle: StdbTesting.NativeSubscriptionHandleLike = {
        isEnded: () => ended,
        unsubscribe: () => {
          ended = true
        },
      }
      const builder: StdbTesting.SubscriptionBuilderLike<string, string> = {
        onApplied: (callback) => {
          onApplied = callback
          return builder
        },
        onError: () => builder,
        subscribe: () => nativeHandle,
      }
      const adapter = StdbTesting.fromBuilder({
        build: () => builder,
        messageFromError: subscriptionErrorMessage,
      })

      yield* Effect.gen(function* () {
        const fiber = yield* Effect.forkScoped(adapter.subscribe(testQuery))
        yield* Effect.yieldNow
        onApplied?.()
        const handle = yield* Fiber.join(fiber)
        expect(handle.isActive()).toBe(true)
        yield* StdbTesting.unsubscribeThen(handle)
        expect(handle.isActive()).toBe(false)
        expect(handle.isEnded()).toBe(true)
      }).pipe(Effect.scoped)
    }),
  )

  it.effect("fails unsubscribe completion when subscription error wins", () =>
    Effect.gen(function* () {
      const applied = Deferred.makeUnsafe<() => void>()
      const errorRegistered =
        Deferred.makeUnsafe<(context: string, error?: Error) => void>()
      const endRegistered = Deferred.makeUnsafe<() => void>()
      const nativeHandle: StdbTesting.NativeSubscriptionHandleLike = {
        isEnded: () => false,
        isActive: () => true,
        unsubscribe: () => undefined,
        unsubscribeThen: (onEnd) => {
          Deferred.doneUnsafe(endRegistered, Effect.succeed(onEnd))
        },
      }
      const builder: StdbTesting.SubscriptionBuilderLike<string, string> = {
        onApplied: (callback) => {
          Deferred.doneUnsafe(applied, Effect.succeed(callback))
          return builder
        },
        onError: (callback) => {
          Deferred.doneUnsafe(errorRegistered, Effect.succeed(callback))
          return builder
        },
        subscribe: () => nativeHandle,
      }
      const adapter = StdbTesting.fromBuilder({
        build: () => builder,
        messageFromError: subscriptionErrorMessage,
      })

      yield* Effect.gen(function* () {
        const acquireFiber = yield* Effect.forkScoped(
          adapter.subscribe(testQuery, () => undefined),
        )
        const [onApplied, onError] = yield* Effect.all([
          Deferred.await(applied),
          Deferred.await(errorRegistered),
        ])
        yield* Effect.yieldNow
        onApplied()
        const handle = yield* Fiber.join(acquireFiber)
        const completion = yield* StdbTesting.unsubscribeThen(handle).pipe(
          Effect.forkScoped,
        )
        yield* Deferred.await(endRegistered)
        onError("subscription failed")
        const failure = failureFromExit(
          yield* completion.pipe(Fiber.join, Effect.exit),
        )
        expect(failure).toBeInstanceOf(StdbTesting.SubscriptionRejectedError)
      }).pipe(Effect.scoped)
    }),
  )
})
