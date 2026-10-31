import * as EffectVitest from "@effect/vitest"
import * as Data from "effect/Data"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Queue from "effect/Queue"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as TestClock from "effect/testing/TestClock"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import {
  CallNotSentError,
  ConnectionLostError,
  SubscriptionRejectedError,
  unsubscribeThen,
  WsConnectError,
  WsConnectTimeoutError,
  WsSessionSupervisorDefectError,
} from "effect-spacetimedb/client"
import * as StdbTesting from "effect-spacetimedb/testing"
import { TestLayer } from "../helpers/test-layer"
import {
  awaitPhase,
  makeReconnectHarness,
  plan,
  reconnectConfig,
  recoveringReport,
  upsert,
} from "../helpers/ws-reconnect-harness"

const { expect } = EffectVitest
const describe = EffectVitest.layer(TestLayer)

class TokenUnavailable extends Data.TaggedError("TokenUnavailable") {}
class PresenceRefused extends Data.TaggedError("PresenceRefused") {}

const fastPolicy = {
  reconnectDelayMillisFirst: 100,
  reconnectDelayMillisMax: 1_000,
  reconnectJitter: false,
}

const closedWithoutCloseEvent = "WebSocket closed without a close event"

describe("ws automatic reconnect replay", (it) => {
  it.effect(
    "recovers only once the replay has re-applied the session's subscriptions",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeReconnectHarness()
        const session = yield* StdbTesting.makeScopedFromModulePlan({
          plan,
          config: reconnectConfig(harness),
        })
        yield* session
          .streamTable("user")
          .pipe(Stream.runDrain, Effect.forkChild)
        const subscription = yield* harness.nextSubscription
        subscription.apply()

        harness.drop(1, recoveringReport)
        harness.reconnect(1)
        // Reconnected, but its cache is still the outage's.
        const refused = yield* Effect.flip(session.reducers.userUpsert(upsert))
        expect(CallNotSentError.is(refused)).toBe(true)
        if (CallNotSentError.is(refused)) {
          expect(refused.raw).toContain("Replaying 1 subscription(s)")
        }

        subscription.apply()
        yield* session.reducers.userUpsert(upsert)
        expect(harness.at(1).reducerCallCount()).toBe(1)
      }).pipe(Effect.scoped),
  )

  it.effect(
    "ends the session when the replay stalls past the connect bound",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeReconnectHarness()
        const session = yield* StdbTesting.makeScopedFromModulePlan({
          plan,
          config: reconnectConfig(harness),
        })
        yield* session
          .streamTable("user")
          .pipe(Stream.runDrain, Effect.forkChild)
        ;(yield* harness.nextSubscription).apply()

        harness.drop(1, recoveringReport)
        harness.reconnect(1)
        yield* TestClock.adjust(Duration.millis(999))
        expect(session.isInvalidated()).toBe(false)
        yield* TestClock.adjust(Duration.millis(1))
        expect(session.isInvalidated()).toBe(true)
        expect(harness.at(1).disconnectCount()).toBe(1)
        const lost = yield* Effect.flip(session.reducers.userUpsert(upsert))
        expect(ConnectionLostError.is(lost)).toBe(true)
        if (ConnectionLostError.is(lost)) {
          expect(lost.raw).toBe(
            "Automatic reconnect attempt 1 did not complete within 1000ms",
          )
        }
      }).pipe(Effect.scoped),
  )

  it.effect(
    "ends only a consumer stream whose subscription fails to replay",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeReconnectHarness()
        const session = yield* StdbTesting.makeScopedFromModulePlan({
          plan,
          config: reconnectConfig(harness),
        })
        const stream = yield* session
          .streamTable("user")
          .pipe(Stream.runDrain, Effect.flip, Effect.forkChild)
        const subscription = yield* harness.nextSubscription
        subscription.apply()

        harness.drop(1, recoveringReport)
        harness.reconnect(1)
        subscription.fail("table user is no longer visible")
        const ended = yield* Fiber.join(stream)
        expect(SubscriptionRejectedError.is(ended)).toBe(true)
        // Nothing else waits on the replay, so the session recovered.
        expect(session.isInvalidated()).toBe(false)
        yield* session.reducers.userUpsert(upsert)
      }).pipe(Effect.scoped),
  )

  it.effect(
    "replaces a supervised session whose subscription target fails to replay",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeReconnectHarness()
        const supervisor =
          yield* StdbTesting.makeWsSessionSupervisorFromModulePlan({
            plan,
            config: reconnectConfig(harness),
            subscriptionTargets: [plan.targets.tables.user],
            policy: fastPolicy,
          })
        const subscription = yield* harness.nextSubscription
        subscription.apply()
        yield* awaitPhase(supervisor.phase, (phase) => phase.status === "live")

        harness.drop(1, recoveringReport)
        harness.reconnect(1)
        subscription.fail("table user is no longer visible")
        const reconnecting = yield* awaitPhase(
          supervisor.phase,
          (phase) => phase.status === "reconnecting",
        )
        expect(
          reconnecting.status === "reconnecting" &&
            SubscriptionRejectedError.is(reconnecting.failure),
        ).toBe(true)
        expect(harness.at(1).disconnectCount()).toBe(1)

        yield* TestClock.adjust(Duration.millis(100))
        ;(yield* harness.nextSubscription).apply()
        yield* awaitPhase(
          supervisor.phase,
          (phase) => phase.status === "live" && phase.attempt === 2,
        )
      }).pipe(Effect.scoped),
  )
})

describe("ws supervised sessions before they are live", (it) => {
  it.effect(
    "fails the attempt on a drop during setup and keeps backing off",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeReconnectHarness()
        const setupStarted = yield* Queue.unbounded<void>()
        const supervisor =
          yield* StdbTesting.makeWsSessionSupervisorFromModulePlan({
            plan,
            config: reconnectConfig(harness),
            setup: () =>
              Queue.offer(setupStarted, undefined).pipe(
                Effect.andThen(Effect.never),
              ),
            policy: fastPolicy,
          })

        yield* Queue.take(setupStarted)
        harness.drop(1, recoveringReport)
        const first = yield* awaitPhase(
          supervisor.phase,
          (phase) => phase.status === "reconnecting" && phase.attempt === 1,
        )
        expect(
          first.status === "reconnecting" &&
            ConnectionLostError.is(first.failure),
        ).toBe(true)
        // Never published, never recovering: it was not live.
        expect(
          AsyncResult.isSuccess(yield* SubscriptionRef.get(supervisor.session)),
        ).toBe(false)
        expect(harness.at(1).disconnectCount()).toBe(1)

        yield* TestClock.adjust(Duration.millis(100))
        yield* Queue.take(setupStarted)
        harness.drop(2, recoveringReport)
        yield* awaitPhase(
          supervisor.phase,
          (phase) => phase.status === "reconnecting" && phase.attempt === 2,
        )
        // A failed attempt doubles the delay; a reset would retry at 100 ms.
        yield* TestClock.adjust(Duration.millis(199))
        expect(harness.buildCount()).toBe(2)
        yield* TestClock.adjust(Duration.millis(1))
        yield* Queue.take(setupStarted)
        expect(harness.buildCount()).toBe(3)
      }).pipe(Effect.scoped),
  )
})

describe("ws recoverable sockets that close silently", (it) => {
  it.effect(
    "ends a session whose socket closed silently when no recovery follows",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeReconnectHarness()
        const session = yield* StdbTesting.makeScopedFromModulePlan({
          plan,
          config: reconnectConfig(harness),
        })

        // No resume event ever tells the SDK (a WebView, Bun, Node).
        harness.at(1).setSocketClosed(true)
        const refused = yield* Effect.flip(session.reducers.userUpsert(upsert))
        expect(CallNotSentError.is(refused)).toBe(true)
        if (CallNotSentError.is(refused)) {
          expect(refused.raw).toContain(closedWithoutCloseEvent)
        }
        expect(session.isInvalidated()).toBe(false)
        expect(harness.at(1).reducerCallCount()).toBe(0)

        yield* TestClock.adjust(Duration.millis(999))
        expect(session.isInvalidated()).toBe(false)
        yield* TestClock.adjust(Duration.millis(1))
        expect(session.isInvalidated()).toBe(true)
        expect(harness.at(1).disconnectCount()).toBe(1)
      }).pipe(Effect.scoped),
  )

  it.effect(
    "treats a reconnect hook refused by a silently closed socket as a drop",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeReconnectHarness()
        let hookRuns = 0
        const supervisor =
          yield* StdbTesting.makeWsSessionSupervisorFromModulePlan({
            plan,
            config: reconnectConfig(harness),
            onAutomaticReconnect: (session) =>
              Effect.suspend(() => {
                hookRuns += 1
                return session.reducers
                  .userUpsert(upsert)
                  .pipe(Effect.mapError(() => new PresenceRefused()))
              }),
          })
        yield* awaitPhase(supervisor.phase, (phase) => phase.status === "live")

        harness.drop(1, recoveringReport)
        harness.at(1).setSocketClosed(true)
        harness.reconnect(1)
        const silent = yield* awaitPhase(
          supervisor.phase,
          (phase) =>
            phase.status === "recovering" &&
            phase.reason === closedWithoutCloseEvent,
        )
        expect(silent).toMatchObject({ reconnectAttempt: 0 })
        expect(hookRuns).toBe(1)

        // The SDK notices and reconnects; the hook then succeeds.
        harness.at(1).setSocketClosed(false)
        harness.drop(1, { ...recoveringReport, nextAttempt: 2 })
        harness.reconnect(1)
        yield* awaitPhase(supervisor.phase, (phase) => phase.status === "live")
        expect(hookRuns).toBe(2)
        expect(harness.at(1).reducerCallCount()).toBe(1)
        expect(harness.buildCount()).toBe(1)
      }).pipe(Effect.scoped),
  )
})

describe("ws token refresh during automatic reconnect", (it) => {
  const scriptedToken = () => {
    let evaluations = 0
    return Effect.suspend(() => {
      evaluations += 1
      return evaluations === 2
        ? Effect.fail(new TokenUnavailable())
        : Effect.succeed(`token-${evaluations.toString()}`)
    })
  }

  it.effect("hands a failed refresh to the supervisor's retry policy", () =>
    Effect.gen(function* () {
      const harness = yield* makeReconnectHarness()
      const supervisor =
        yield* StdbTesting.makeWsSessionSupervisorFromModulePlan({
          plan,
          config: reconnectConfig(harness, { token: scriptedToken() }),
          policy: fastPolicy,
        })
      yield* awaitPhase(supervisor.phase, (phase) => phase.status === "live")
      const [refresh] = harness.tokenProviders()
      if (refresh === undefined) {
        return yield* Effect.die("the SDK received no token refresh")
      }

      harness.drop(1, recoveringReport)
      yield* Effect.promise(() => refresh().catch(() => undefined))
      const reconnecting = yield* awaitPhase(
        supervisor.phase,
        (phase) => phase.status === "reconnecting",
      )
      expect(
        reconnecting.status === "reconnecting" &&
          WsConnectError.is(reconnecting.failure) &&
          reconnecting.failure.cause instanceof TokenUnavailable,
      ).toBe(true)

      yield* TestClock.adjust(Duration.millis(100))
      yield* awaitPhase(
        supervisor.phase,
        (phase) => phase.status === "live" && phase.attempt === 2,
      )
      expect(harness.tokens()).toEqual(["token-1", "token-3"])
    }).pipe(Effect.scoped),
  )

  it.effect("parks when the retry policy refuses a failed refresh", () =>
    Effect.gen(function* () {
      const harness = yield* makeReconnectHarness()
      const supervisor =
        yield* StdbTesting.makeWsSessionSupervisorFromModulePlan({
          plan,
          config: reconnectConfig(harness, { token: scriptedToken() }),
          policy: {
            ...fastPolicy,
            isRetryable: (failure) =>
              !(
                WsConnectError.is(failure) &&
                failure.cause instanceof TokenUnavailable
              ),
          },
        })
      yield* awaitPhase(supervisor.phase, (phase) => phase.status === "live")
      const [refresh] = harness.tokenProviders()
      if (refresh === undefined) {
        return yield* Effect.die("the SDK received no token refresh")
      }

      harness.drop(1, recoveringReport)
      yield* Effect.promise(() => refresh().catch(() => undefined))
      yield* awaitPhase(supervisor.phase, (phase) => phase.status === "fatal")
      expect(harness.buildCount()).toBe(1)
    }).pipe(Effect.scoped),
  )

  it.effect("reports the cause a connect error carries as the reason", () =>
    Effect.gen(function* () {
      const harness = yield* makeReconnectHarness()
      const supervisor =
        yield* StdbTesting.makeWsSessionSupervisorFromModulePlan({
          plan,
          config: reconnectConfig(harness),
          policy: fastPolicy,
        })
      yield* awaitPhase(supervisor.phase, (phase) => phase.status === "live")
      const tokenMint = new WsConnectError({
        cause: new Error("token mint 503"),
      })

      harness.drop(1, recoveringReport)
      harness.attemptFailed(1, {
        error: tokenMint,
        nextAttempt: 2,
        delayMs: 1_000,
      })
      yield* awaitPhase(
        supervisor.phase,
        (phase) =>
          phase.status === "recovering" && phase.reason === "token mint 503",
      )

      harness.attemptFailed(1, { error: tokenMint })
      const reconnecting = yield* awaitPhase(
        supervisor.phase,
        (phase) => phase.status === "reconnecting",
      )
      expect(
        reconnecting.status === "reconnecting" &&
          ConnectionLostError.is(reconnecting.failure) &&
          reconnecting.failure.raw === "token mint 503",
      ).toBe(true)
    }).pipe(Effect.scoped),
  )
})

describe("ws subscriptions unsubscribed before a reconnect", (it) => {
  // Subscribes and lets the server apply it, in the caller's open scope.
  const subscribedUser = Effect.fn(function* (
    harness: {
      readonly nextSubscription: Effect.Effect<{ readonly apply: () => void }>
    },
    subscribe: Effect.Effect<
      StdbTesting.SubscriptionHandleLike,
      StdbTesting.SubscriptionFailure,
      Scope.Scope
    >,
  ) {
    const subscribing = yield* subscribe.pipe(Effect.forkChild)
    ;(yield* harness.nextSubscription).apply()
    return yield* Fiber.join(subscribing)
  })

  it.effect("does not wait for one ended through unsubscribeThen", () =>
    Effect.gen(function* () {
      const harness = yield* makeReconnectHarness()
      const session = yield* StdbTesting.makeScopedFromModulePlan({
        plan,
        config: reconnectConfig(harness),
      })
      // The owning scope (this test's) stays open throughout.
      const handle = yield* subscribedUser(
        harness,
        session.subscribe(plan.targets.tables.user),
      )
      yield* unsubscribeThen(handle)

      harness.drop(1, recoveringReport)
      harness.reconnect(1)
      yield* session.reducers.userUpsert(upsert)
      expect(harness.at(1).reducerCallCount()).toBe(1)
    }).pipe(Effect.scoped),
  )

  it.effect("does not wait for one ended through its own handle", () =>
    Effect.gen(function* () {
      const harness = yield* makeReconnectHarness()
      const session = yield* StdbTesting.makeScopedFromModulePlan({
        plan,
        config: reconnectConfig(harness),
      })
      const handle = yield* subscribedUser(
        harness,
        session.subscribe(plan.targets.tables.user),
      )
      handle.unsubscribe()

      harness.drop(1, recoveringReport)
      harness.reconnect(1)
      yield* session.reducers.userUpsert(upsert)
      expect(harness.at(1).reducerCallCount()).toBe(1)
    }).pipe(Effect.scoped),
  )
})

describe("ws token refreshes that do not succeed", (it) => {
  const tokenThen = (refreshed: Effect.Effect<string, Error>) => {
    let evaluations = 0
    return Effect.suspend(() => {
      evaluations += 1
      return evaluations === 1 ? Effect.succeed("token-1") : refreshed
    })
  }
  const storageCorrupt = new Error("storage corrupt")

  it.effect("ends the session when the refresh dies", () =>
    Effect.gen(function* () {
      const harness = yield* makeReconnectHarness()
      const session = yield* StdbTesting.makeScopedFromModulePlan({
        plan,
        config: reconnectConfig(harness, {
          token: tokenThen(Effect.die(storageCorrupt)),
        }),
      })
      const [refresh] = harness.tokenProviders()
      if (refresh === undefined) {
        return yield* Effect.die("the SDK received no token refresh")
      }

      harness.drop(1, recoveringReport)
      yield* TestClock.adjust(Duration.millis(recoveringReport.delayMs))
      const rejected = yield* Effect.promise(() =>
        refresh().then(
          () => undefined,
          (error: unknown) => error,
        ),
      )
      expect(rejected).toBe(storageCorrupt)
      expect(session.isInvalidated()).toBe(true)
      expect(harness.at(1).disconnectCount()).toBe(1)
      const lost = yield* Effect.flip(session.reducers.userUpsert(upsert))
      expect(ConnectionLostError.is(lost)).toBe(true)
      if (ConnectionLostError.is(lost)) {
        expect(lost.raw).toBe("Token refresh died: storage corrupt")
      }
    }).pipe(Effect.scoped),
  )

  it.effect("parks the supervisor as fatal when the refresh dies", () =>
    Effect.gen(function* () {
      const harness = yield* makeReconnectHarness()
      const supervisor =
        yield* StdbTesting.makeWsSessionSupervisorFromModulePlan({
          plan,
          config: reconnectConfig(harness, {
            token: tokenThen(Effect.die(storageCorrupt)),
          }),
          policy: fastPolicy,
        })
      yield* awaitPhase(supervisor.phase, (phase) => phase.status === "live")
      const [refresh] = harness.tokenProviders()
      if (refresh === undefined) {
        return yield* Effect.die("the SDK received no token refresh")
      }

      harness.drop(1, recoveringReport)
      yield* TestClock.adjust(Duration.millis(recoveringReport.delayMs))
      yield* Effect.promise(() => refresh().catch(() => undefined))
      const fatal = yield* awaitPhase(
        supervisor.phase,
        (phase) => phase.status === "fatal",
      )
      expect(
        fatal.status === "fatal" &&
          WsSessionSupervisorDefectError.is(fatal.failure),
      ).toBe(true)
      expect(harness.buildCount()).toBe(1)
    }).pipe(Effect.scoped),
  )

  it.effect(
    "reports a refresh that overruns its reconnect attempt as a credentials failure",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeReconnectHarness()
        const gate = yield* Deferred.make<void>()
        const supervisor =
          yield* StdbTesting.makeWsSessionSupervisorFromModulePlan({
            plan,
            config: reconnectConfig(harness, {
              token: tokenThen(gate.pipe(Deferred.await, Effect.as("late"))),
            }),
            policy: fastPolicy,
          })
        yield* awaitPhase(supervisor.phase, (phase) => phase.status === "live")
        const [refresh] = harness.tokenProviders()
        if (refresh === undefined) {
          return yield* Effect.die("the SDK received no token refresh")
        }

        harness.drop(1, recoveringReport)
        yield* TestClock.adjust(Duration.millis(recoveringReport.delayMs))
        const overrun = refresh().catch(() => undefined)
        yield* TestClock.adjust(Duration.millis(1_000))
        const reconnecting = yield* awaitPhase(
          supervisor.phase,
          (phase) => phase.status === "reconnecting",
        )
        expect(
          reconnecting.status === "reconnecting" &&
            WsConnectError.is(reconnecting.failure) &&
            WsConnectTimeoutError.is(reconnecting.failure.cause),
        ).toBe(true)
        yield* Effect.promise(() => overrun)
      }).pipe(Effect.scoped),
  )
})

describe("ws supervised sessions whose socket died during activation", (it) => {
  it.effect(
    "fails the attempt instead of publishing it live, and keeps backing off",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeReconnectHarness()
        const supervisor =
          yield* StdbTesting.makeWsSessionSupervisorFromModulePlan({
            plan,
            config: reconnectConfig(harness),
            // The socket closes without a close event while setup runs.
            setup: () =>
              Effect.suspend(() => {
                harness.at(harness.buildCount()).setSocketClosed(true)
                return Effect.void
              }),
            policy: fastPolicy,
          })

        const first = yield* awaitPhase(
          supervisor.phase,
          (phase) => phase.status === "reconnecting" && phase.attempt === 1,
        )
        expect(
          first.status === "reconnecting" &&
            ConnectionLostError.is(first.failure) &&
            first.failure.raw === closedWithoutCloseEvent,
        ).toBe(true)
        expect(
          AsyncResult.isSuccess(yield* SubscriptionRef.get(supervisor.session)),
        ).toBe(false)

        yield* TestClock.adjust(Duration.millis(100))
        yield* awaitPhase(
          supervisor.phase,
          (phase) => phase.status === "reconnecting" && phase.attempt === 2,
        )
        yield* TestClock.adjust(Duration.millis(199))
        expect(harness.buildCount()).toBe(2)
        yield* TestClock.adjust(Duration.millis(1))
        yield* awaitPhase(
          supervisor.phase,
          (phase) => phase.status === "reconnecting" && phase.attempt === 3,
        )
        expect(harness.buildCount()).toBe(3)
      }).pipe(Effect.scoped),
  )
})

describe("ws automatic reconnect delay bounds", (it) => {
  const invalidDelays = [
    ["delayMillisMin", Number.POSITIVE_INFINITY],
    ["delayMillisMax", Number.POSITIVE_INFINITY],
    ["delayMillisMin", Number.NaN],
    ["delayMillisMax", -1],
  ] as const

  for (const [name, delayMillis] of invalidDelays) {
    it.effect(
      `rejects ${name} ${String(delayMillis)} when the client is built`,
      () =>
        Effect.gen(function* () {
          const harness = yield* makeReconnectHarness()
          const config = reconnectConfig(harness, {
            automaticReconnect: { [name]: delayMillis },
          })
          const message = `WebSocket automaticReconnect.${name} must be a finite, non-negative number of milliseconds; received ${String(delayMillis)}`
          expect(() =>
            StdbTesting.makeScopedFromModulePlan({ plan, config }),
          ).toThrow(new TypeError(message))
          expect(() =>
            StdbTesting.makeWsSessionSupervisorFromModulePlan({ plan, config }),
          ).toThrow(new TypeError(message))
          expect(harness.buildCount()).toBe(0)
        }),
    )
  }

  it.effect(
    "accepts the boundary delays and bounds an attempt at its delay plus the connect bound",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeReconnectHarness()
        const session = yield* StdbTesting.makeScopedFromModulePlan({
          plan,
          config: reconnectConfig(harness, {
            automaticReconnect: { delayMillisMin: 0, delayMillisMax: 30_000 },
          }),
        })
        expect(harness.reconnectOptions()).toEqual([
          { minDelayMs: 0, maxDelayMs: 30_000 },
        ])

        // The longest delay the SDK can schedule under this policy.
        harness.drop(1, { ...recoveringReport, delayMs: 30_000 })
        yield* TestClock.adjust(Duration.millis(30_999))
        expect(session.isInvalidated()).toBe(false)
        yield* TestClock.adjust(Duration.millis(1))
        expect(session.isInvalidated()).toBe(true)
      }).pipe(Effect.scoped),
  )
})
