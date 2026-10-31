import * as EffectVitest from "@effect/vitest"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as StdbTesting from "effect-spacetimedb/testing"
import {
  connectionStateFor,
  socketClosedWithoutCloseEventMessage,
} from "../../src/client/connection-state.ts"
import { FullModule, UserId, UserName } from "../fixtures/full-module"
import { TestLayer } from "../helpers/test-layer"
import {
  type FullModuleSubscriptionBuilder,
  makeFullModuleWsConnection,
} from "../helpers/ws-fixtures"

const { expect } = EffectVitest
const describe = EffectVitest.layer(TestLayer)

const plan = StdbTesting.makeModulePlan(FullModule)

/**
 * A connection whose socket can be closed the way a browser tears one down
 * while the tab is frozen: the SDK's `isSocketClosed` turns true and no close
 * event is ever delivered.
 */
const makeSilentlyClosableConnection = (
  subscriptionBuilder?: () => FullModuleSubscriptionBuilder,
) => {
  let socketClosed = false
  let reducerCallCount = 0
  const connection = Object.defineProperty(
    {
      ...makeFullModuleWsConnection(
        subscriptionBuilder === undefined ? {} : { subscriptionBuilder },
      ),
      callReducerWithParams: () => {
        reducerCallCount += 1
        return Promise.resolve()
      },
      callProcedureWithParams: () => Promise.resolve(undefined),
    },
    "isSocketClosed",
    { get: () => socketClosed },
  )
  return {
    connection,
    closeSocketSilently: () => {
      socketClosed = true
    },
    reducerCallCount: () => reducerCallCount,
  }
}

const upsertAda = {
  userId: UserId.make("user-1"),
  name: UserName.make("Ada"),
}

describe("ws socket closed without a close event", (it) => {
  it.effect(
    "fails later calls with ConnectionLostError without sending them",
    () =>
      Effect.gen(function* () {
        const fixture = makeSilentlyClosableConnection()
        const session = StdbTesting.ClientWs.make({
          module: FullModule,
          connection: fixture.connection,
        })
        yield* session.reducers.userUpsert(upsertAda)
        expect(session.isInvalidated()).toBe(false)

        fixture.closeSocketSilently()

        const error = yield* session.reducers
          .userUpsert(upsertAda)
          .pipe(Effect.flip)
        expect(StdbTesting.ConnectionLostError.is(error)).toBe(true)
        expect(fixture.reducerCallCount()).toBe(1)
        expect(session.isInvalidated()).toBe(true)
        const invalidation = yield* session.awaitInvalidation()
        expect(invalidation.message).toBe(socketClosedWithoutCloseEventMessage)
      }),
  )

  it.effect("fails a subscribe without sending it", () =>
    Effect.gen(function* () {
      const fixture = makeSilentlyClosableConnection()
      const session = StdbTesting.ClientWs.make({
        module: FullModule,
        connection: fixture.connection,
      })
      fixture.closeSocketSilently()

      const error = yield* session
        .subscribe(plan.targets.tables.user)
        .pipe(Effect.flip, Effect.scoped)
      expect(StdbTesting.SubscriptionInvalidatedError.is(error)).toBe(true)
    }),
  )

  it.effect(
    "wakes a waiter on the invalidation once a read sees the socket closed",
    () =>
      Effect.gen(function* () {
        const fixture = makeSilentlyClosableConnection()
        const session = StdbTesting.ClientWs.make({
          module: FullModule,
          connection: fixture.connection,
        })
        const waiter = yield* session
          .awaitInvalidation()
          .pipe(Effect.forkScoped)
        yield* Effect.yieldNow
        expect(waiter.pollUnsafe()).toBeUndefined()

        fixture.closeSocketSilently()
        expect(session.isInvalidated()).toBe(true)

        const invalidation = yield* Fiber.join(waiter)
        expect(invalidation.message).toBe(socketClosedWithoutCloseEventMessage)
      }).pipe(Effect.scoped),
  )
})

describe("ws unsubscribe completion on connection loss", (it) => {
  const makeNeverEndingSubscription = () => {
    const applied = Deferred.makeUnsafe<() => void>()
    let nativeUnsubscribeCount = 0
    const nativeHandle: StdbTesting.NativeSubscriptionHandleLike = {
      isEnded: () => false,
      isActive: () => true,
      unsubscribe: () => undefined,
      // The SDK never runs `onEnd` once its socket is gone.
      unsubscribeThen: () => {
        nativeUnsubscribeCount += 1
      },
    }
    const builder: FullModuleSubscriptionBuilder = {
      onApplied: (callback) => {
        Deferred.doneUnsafe(applied, Effect.succeed(callback))
        return builder
      },
      onError: () => builder,
      subscribe: () => nativeHandle,
    }
    return {
      applied,
      builder,
      nativeUnsubscribeCount: () => nativeUnsubscribeCount,
    }
  }

  it.effect("settles a waiting unsubscribe when the connection is lost", () =>
    Effect.gen(function* () {
      const subscription = makeNeverEndingSubscription()
      const fixture = makeSilentlyClosableConnection(() => subscription.builder)
      const session = StdbTesting.ClientWs.make({
        module: FullModule,
        connection: fixture.connection,
      })
      const acquired = yield* session
        .subscribe(plan.targets.tables.user)
        .pipe(Effect.forkScoped)
      const onApplied = yield* Deferred.await(subscription.applied)
      yield* Effect.yieldNow
      onApplied()
      const handle = yield* Fiber.join(acquired)

      const completion = yield* StdbTesting.unsubscribeThen(handle).pipe(
        Effect.forkScoped,
      )
      yield* Effect.yieldNow
      expect(completion.pollUnsafe()).toBeUndefined()
      expect(subscription.nativeUnsubscribeCount()).toBe(1)

      connectionStateFor(fixture.connection).invalidateFromTransport(
        "server rebooted",
      )
      yield* Fiber.join(completion)
    }).pipe(Effect.scoped),
  )

  it.effect("settles at once on a connection already lost", () =>
    Effect.gen(function* () {
      const subscription = makeNeverEndingSubscription()
      const fixture = makeSilentlyClosableConnection(() => subscription.builder)
      const session = StdbTesting.ClientWs.make({
        module: FullModule,
        connection: fixture.connection,
      })
      const acquired = yield* session
        .subscribe(plan.targets.tables.user)
        .pipe(Effect.forkScoped)
      const onApplied = yield* Deferred.await(subscription.applied)
      yield* Effect.yieldNow
      onApplied()
      const handle = yield* Fiber.join(acquired)

      fixture.closeSocketSilently()
      yield* StdbTesting.unsubscribeThen(handle)
      expect(subscription.nativeUnsubscribeCount()).toBe(0)
    }).pipe(Effect.scoped),
  )
})
