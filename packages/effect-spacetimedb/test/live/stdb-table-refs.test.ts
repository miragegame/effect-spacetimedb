/**
 * @module-tag local-only
 * @module-tag spacetimedb
 */

import * as EffectVitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"

const { describe, expect, live } = EffectVitest

import {
  CONVERGENCE_TIMEOUT_MS,
  decodeThingId,
  decodeUserId,
  decodeUserName,
  LIVE_TEST_TIMEOUT_MS,
  LiveModule,
  makeExampleSession,
  wireFunction,
} from "./helpers/example-live"
import {
  callLiveReducer,
  type LiveConnection,
  provideLiveTest,
} from "./helpers/live-harness"
import { waitForPredicate } from "./helpers/wait-for-predicate"

type LiveSubscriptionBuilder = ReturnType<
  LiveConnection<typeof LiveModule>["subscriptionBuilder"]
>

const observeSubscriptions = (
  connection: LiveConnection<typeof LiveModule>,
) => {
  let subscribeCount = 0
  let appliedCount = 0
  const originalSubscriptionBuilder =
    connection.subscriptionBuilder.bind(connection)

  Object.defineProperty(connection, "subscriptionBuilder", {
    configurable: true,
    value: (): LiveSubscriptionBuilder => {
      const nativeBuilder = originalSubscriptionBuilder()
      const wrapped: LiveSubscriptionBuilder = {
        onApplied: (callback) => {
          nativeBuilder.onApplied(() => {
            appliedCount = appliedCount + 1
            callback()
          })
          return wrapped
        },
        onError: (callback) => {
          nativeBuilder.onError(callback)
          return wrapped
        },
        subscribe: (query) => {
          subscribeCount = subscribeCount + 1
          return nativeBuilder.subscribe(query)
        },
      }
      return wrapped
    },
  })

  return {
    appliedCount: () => appliedCount,
    subscribeCount: () => subscribeCount,
  }
}

const successSomeValue = <A, E>(
  result: AsyncResult.AsyncResult<Option.Option<A>, E>,
) =>
  AsyncResult.isSuccess(result)
    ? Option.getOrUndefined(result.value)
    : undefined

const currentSomeValue = <A, E>(
  ref: SubscriptionRef.SubscriptionRef<
    AsyncResult.AsyncResult<Option.Option<A>, E>
  >,
) => successSomeValue(ref.pipe(SubscriptionRef.getUnsafe))

describe("effect-spacetimedb live table refs", () => {
  live(
    "updates a row ref from initial to Some, refreshed row, and None",
    () =>
      provideLiveTest(
        Effect.gen(function* () {
          const { session, connection } = yield* makeExampleSession
          const subscriptions = observeSubscriptions(connection)
          const thingId = decodeThingId("table-ref-thing")
          const ref = yield* session.subscribeRowRef("thing", thingId)

          expect(AsyncResult.isInitial(yield* SubscriptionRef.get(ref))).toBe(
            true,
          )
          yield* waitForPredicate(
            () => subscriptions.appliedCount() === 1,
            "row ref subscription did not apply",
            CONVERGENCE_TIMEOUT_MS,
          )
          yield* callLiveReducer(connection, wireFunction("thingSet"), {
            thingId,
            label: "First",
            count: 1n,
          })
          yield* waitForPredicate(
            () => currentSomeValue(ref)?.label === "First",
            "row ref did not converge to the inserted row",
            CONVERGENCE_TIMEOUT_MS,
          )

          yield* callLiveReducer(connection, wireFunction("thingSet"), {
            thingId,
            label: "Second",
            count: 2n,
          })
          yield* waitForPredicate(
            () => currentSomeValue(ref)?.label === "Second",
            "row ref did not converge to the updated row",
            CONVERGENCE_TIMEOUT_MS,
          )

          yield* callLiveReducer(connection, wireFunction("thingDelete"), {
            thingId,
          })
          yield* waitForPredicate(
            () => {
              const value = ref.pipe(SubscriptionRef.getUnsafe)
              return AsyncResult.isSuccess(value) && Option.isNone(value.value)
            },
            "row ref did not converge to None after delete",
            CONVERGENCE_TIMEOUT_MS,
          )

          expect(subscriptions.subscribeCount()).toBe(1)
        }),
      ),
    { timeout: LIVE_TEST_TIMEOUT_MS },
  )

  live(
    "shares one table subscription across same-table row refs",
    () =>
      provideLiveTest(
        Effect.gen(function* () {
          const { session, connection } = yield* makeExampleSession
          const subscriptions = observeSubscriptions(connection)
          const adaId = decodeUserId("table-ref-user-1")
          const graceId = decodeUserId("table-ref-user-2")
          const adaRef = yield* session.subscribeRowRef("user", adaId)
          const graceRef = yield* session.subscribeRowRef("user", graceId)

          yield* waitForPredicate(
            () => subscriptions.subscribeCount() === 1,
            "same-table row refs opened more than one subscription",
            CONVERGENCE_TIMEOUT_MS,
          )
          yield* callLiveReducer(connection, wireFunction("userUpsert"), {
            userId: adaId,
            name: decodeUserName("Ada"),
          })
          yield* callLiveReducer(connection, wireFunction("userUpsert"), {
            userId: graceId,
            name: decodeUserName("Grace"),
          })
          yield* waitForPredicate(
            () =>
              currentSomeValue(adaRef)?.name === "Ada" &&
              currentSomeValue(graceRef)?.name === "Grace",
            "row refs did not receive the shared table snapshot",
            CONVERGENCE_TIMEOUT_MS,
          )
          const graceRow = currentSomeValue(graceRef)

          yield* callLiveReducer(connection, wireFunction("userUpsert"), {
            userId: adaId,
            name: decodeUserName("Ada Updated"),
          })
          yield* waitForPredicate(
            () => currentSomeValue(adaRef)?.name === "Ada Updated",
            "row ref did not receive the sibling update",
            CONVERGENCE_TIMEOUT_MS,
          )

          expect(currentSomeValue(graceRef)).toEqual(graceRow)
          expect(subscriptions.subscribeCount()).toBe(1)
        }),
      ),
    { timeout: LIVE_TEST_TIMEOUT_MS },
  )

  live(
    "emits typed table group snapshots after all member table refs apply",
    () =>
      provideLiveTest(
        Effect.gen(function* () {
          const { session, connection } = yield* makeExampleSession
          const userId = decodeUserId("table-group-user")
          const groupRef = yield* session.subscribeTableGroupRef([
            "user",
          ] as const)

          yield* callLiveReducer(connection, wireFunction("userUpsert"), {
            userId,
            name: decodeUserName("Katherine"),
          })
          yield* waitForPredicate(
            () => {
              const value = SubscriptionRef.getUnsafe(groupRef)
              return (
                AsyncResult.isSuccess(value) &&
                value.value.user.some(
                  (row) => row.id === userId && row.name === "Katherine",
                )
              )
            },
            "table group ref did not publish the user snapshot",
            CONVERGENCE_TIMEOUT_MS,
          )

          const group = SubscriptionRef.getUnsafe(groupRef)
          expect(AsyncResult.isSuccess(group)).toBe(true)
          if (AsyncResult.isSuccess(group)) {
            expect(group.value.user).toContainEqual({
              id: userId,
              name: "Katherine",
            })
          }
        }),
      ),
    { timeout: LIVE_TEST_TIMEOUT_MS },
  )
})
