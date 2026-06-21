import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as EffectVitest from "@effect/vitest"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as StdbTesting from "effect-spacetimedb/testing"
import { TestLayer } from "../helpers/test-layer"
import { waitForPredicate } from "../helpers/wait-for-predicate"

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
    } satisfies StdbTesting.SubscriptionHandleLike,
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
  it.effect("succeeds when apply fires after subscribe returns", () =>
    Effect.gen(function* () {
      let onApplied: (() => void) | undefined
      const { handle } = makeHandle()

      const builder: StdbTesting.SubscriptionBuilderLike<string, string> = {
        onApplied: (callback) => {
          onApplied = callback
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

      yield* waitForPredicate(
        () => typeof onApplied === "function",
        "apply callback not registered yet",
        20,
      )
      expect(fiber.pollUnsafe() === undefined).toBe(true)

      onApplied?.()

      expect(yield* Fiber.join(fiber)).toBe(handle)
    }).pipe(Effect.scoped),
  )

  it.effect("fails and unsubscribes when rejection fires before apply", () =>
    Effect.gen(function* () {
      let onError:
        | ((context: string, error?: Error | undefined) => void)
        | undefined
      const { handle, unsubscribed } = makeHandle()

      const builder: StdbTesting.SubscriptionBuilderLike<string, string> = {
        onApplied: () => builder,
        onError: (callback) => {
          onError = callback
          return builder
        },
        subscribe: () => handle,
      }

      const adapter = StdbTesting.fromBuilder({
        build: () => builder,
        messageFromError: subscriptionErrorMessage,
      })

      const fiber = yield* Effect.forkScoped(adapter.subscribe(testQuery))
      yield* waitForPredicate(
        () => typeof onError === "function",
        "error callback not registered yet",
        20,
      )
      expect(fiber.pollUnsafe() === undefined).toBe(true)

      onError?.("rejected")

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
      let onError:
        | ((
            context: { readonly event?: Error },
            error?: Error | undefined,
          ) => void)
        | undefined
      const { handle } = makeHandle()

      const builder: StdbTesting.SubscriptionBuilderLike<
        { readonly event?: Error },
        string
      > = {
        onApplied: () => builder,
        onError: (callback) => {
          onError = callback
          return builder
        },
        subscribe: () => handle,
      }

      const adapter = StdbTesting.fromBuilder({
        build: () => builder,
        messageFromError: subscriptionErrorMessage,
      })

      const fiber = yield* Effect.forkScoped(adapter.subscribe(testQuery))
      yield* waitForPredicate(
        () => typeof onError === "function",
        "SDK error-context callback not registered yet",
        20,
      )

      onError?.(
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
        let onApplied: (() => void) | undefined
        let unsubscribeCalls = 0
        const handle: StdbTesting.SubscriptionHandleLike = {
          isEnded: () => false,
          unsubscribe: () => {
            unsubscribeCalls = unsubscribeCalls + 1
            throw new Error("unsubscribe lagged")
          },
        }

        const builder: StdbTesting.SubscriptionBuilderLike<string, string> = {
          onApplied: (callback) => {
            onApplied = callback
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
            yield* waitForPredicate(
              () => typeof onApplied === "function",
              "lagging-handle apply callback not registered yet",
              20,
            )
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
        let onApplied: (() => void) | undefined
        let onError:
          | ((context: string, error?: Error | undefined) => void)
          | undefined
        const messages: Array<string> = []
        const { handle } = makeHandle()

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
          messageFromError: subscriptionErrorMessage,
          onAppliedError: (message) => {
            messages.push(message)
          },
        })

        const fiber = yield* Effect.forkScoped(adapter.subscribe(testQuery))
        yield* waitForPredicate(
          () =>
            typeof onApplied === "function" && typeof onError === "function",
          "callbacks not registered yet",
          20,
        )

        onApplied?.()

        expect(yield* Fiber.join(fiber)).toBe(handle)

        onError?.("fatal")

        expect(messages).toEqual(["fatal"])
      }).pipe(Effect.scoped),
  )
})
