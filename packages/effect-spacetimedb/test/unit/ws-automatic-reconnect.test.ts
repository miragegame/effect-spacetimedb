import * as EffectVitest from "@effect/vitest"
import * as Data from "effect/Data"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Queue from "effect/Queue"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as TestClock from "effect/testing/TestClock"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import {
  CallNotSentError,
  ConnectionIdentityChangedError,
  ConnectionLostError,
  SubscriptionInvalidatedError,
  WsConnectError,
  WsUnsupportedBuilderFeatureError,
} from "effect-spacetimedb/client"
import * as StdbTesting from "effect-spacetimedb/testing"
import {
  DisconnectedError,
  IdentityChangedError,
  UnknownCallResultError,
} from "spacetimedb"
import { TestLayer } from "../helpers/test-layer"
import {
  awaitPhase,
  connectTimeoutMillis,
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

describe("ws automatic reconnect sessions", (it) => {
  it.effect(
    "keeps the session through a drop the SDK retries and refuses calls while it reconnects",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeReconnectHarness()
        const session = yield* StdbTesting.makeScopedFromModulePlan({
          plan,
          config: reconnectConfig(harness),
        })
        expect(harness.reconnectOptions()).toEqual([
          { minDelayMs: 500, maxDelayMs: 1_000 },
        ])
        yield* session.reducers.userUpsert(upsert)
        expect(harness.at(1).reducerCallCount()).toBe(1)

        harness.drop(1, recoveringReport)
        expect(session.isInvalidated()).toBe(false)
        const refused = yield* Effect.flip(session.reducers.userUpsert(upsert))
        expect(CallNotSentError.is(refused)).toBe(true)
        if (CallNotSentError.is(refused)) {
          expect(refused.raw).toContain("WebSocket closed (code 1006)")
        }
        expect(harness.at(1).reducerCallCount()).toBe(1)

        // A failed reconnect attempt with a successor keeps it recovering.
        harness.attemptFailed(1, {
          error: new Error("connection refused"),
          nextAttempt: 2,
          delayMs: 1_000,
        })
        expect(session.isInvalidated()).toBe(false)

        harness.reconnect(1)
        yield* session.reducers.userUpsert(upsert)
        expect(harness.at(1).reducerCallCount()).toBe(2)
        expect(harness.at(1).disconnectCount()).toBe(0)
      }).pipe(Effect.scoped),
  )

  it.effect("types the SDK's not-sent and outcome-unknown rejections", () =>
    Effect.gen(function* () {
      const harness = yield* makeReconnectHarness()
      const session = yield* StdbTesting.makeScopedFromModulePlan({
        plan,
        config: reconnectConfig(harness),
      })

      harness.at(1).rejectCallsWith(new DisconnectedError())
      const notSent = yield* Effect.flip(session.reducers.userUpsert(upsert))
      expect(CallNotSentError.is(notSent)).toBe(true)

      harness.at(1).rejectCallsWith(new UnknownCallResultError())
      const unknown = yield* Effect.flip(session.reducers.userUpsert(upsert))
      expect(ConnectionLostError.is(unknown)).toBe(true)
      if (ConnectionLostError.is(unknown)) {
        expect(unknown.raw).toContain("may or may not have run")
      }
      expect(session.isInvalidated()).toBe(false)
    }).pipe(Effect.scoped),
  )

  it.effect(
    "ends the session when the SDK reports a drop with no retry scheduled",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeReconnectHarness()
        const session = yield* StdbTesting.makeScopedFromModulePlan({
          plan,
          config: reconnectConfig(harness),
        })

        harness.drop(1, { error: new Error("WebSocket closed (code 1008)") })
        expect(session.isInvalidated()).toBe(true)
        const lost = yield* Effect.flip(session.reducers.userUpsert(upsert))
        expect(ConnectionLostError.is(lost)).toBe(true)
        if (ConnectionLostError.is(lost)) {
          expect(lost.raw).toBe("WebSocket closed (code 1008)")
        }
      }).pipe(Effect.scoped),
  )

  it.effect("ends the session when a reconnect changes its identity", () =>
    Effect.gen(function* () {
      const harness = yield* makeReconnectHarness()
      const session = yield* StdbTesting.makeScopedFromModulePlan({
        plan,
        config: reconnectConfig(harness),
      })

      harness.drop(1, recoveringReport)
      harness.attemptFailed(1, { error: new IdentityChangedError() })
      expect(session.isInvalidated()).toBe(true)
      const changed = yield* Effect.flip(session.reducers.userUpsert(upsert))
      expect(ConnectionIdentityChangedError.is(changed)).toBe(true)
    }).pipe(Effect.scoped),
  )

  it.effect(
    "ends a session whose reconnect attempt overruns the connect bound",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeReconnectHarness()
        const session = yield* StdbTesting.makeScopedFromModulePlan({
          plan,
          config: reconnectConfig(harness),
        })

        harness.drop(1, recoveringReport)
        // The attempt starts after its 500 ms delay and may take the 1 s
        // connect bound.
        yield* TestClock.adjust(Duration.millis(1_499))
        expect(session.isInvalidated()).toBe(false)
        // A failed attempt with a successor rearms the bound for that one.
        harness.attemptFailed(1, {
          error: new Error("connection refused"),
          nextAttempt: 2,
          delayMs: 1_000,
        })
        yield* TestClock.adjust(Duration.millis(1_999))
        expect(session.isInvalidated()).toBe(false)
        yield* TestClock.adjust(Duration.millis(1))
        expect(session.isInvalidated()).toBe(true)
        expect(harness.at(1).disconnectCount()).toBe(1)
        const lost = yield* Effect.flip(session.reducers.userUpsert(upsert))
        expect(ConnectionLostError.is(lost)).toBe(true)
        if (ConnectionLostError.is(lost)) {
          expect(lost.raw).toBe(
            "Automatic reconnect attempt 2 did not complete within 2000ms",
          )
        }
      }).pipe(Effect.scoped),
  )

  it.effect("does not bound a session the SDK has reconnected", () =>
    Effect.gen(function* () {
      const harness = yield* makeReconnectHarness()
      const session = yield* StdbTesting.makeScopedFromModulePlan({
        plan,
        config: reconnectConfig(harness),
      })

      harness.drop(1, recoveringReport)
      harness.reconnect(1)
      yield* TestClock.adjust(Duration.minutes(5))
      expect(session.isInvalidated()).toBe(false)
    }).pipe(Effect.scoped),
  )

  it.effect(
    "fails in-flight calls as outcome-unknown when the socket drops",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeReconnectHarness()
        const session = yield* StdbTesting.makeScopedFromModulePlan({
          plan,
          config: reconnectConfig(harness),
        })
        harness.at(1).holdCalls()
        const inFlight = yield* session.reducers
          .userUpsert(upsert)
          .pipe(Effect.flip, Effect.forkChild)
        expect(yield* harness.nextHeldCall).toBe(1)

        harness.drop(1, recoveringReport)
        const failure = yield* Fiber.join(inFlight)
        expect(ConnectionLostError.is(failure)).toBe(true)
        if (ConnectionLostError.is(failure)) {
          expect(failure.raw).toContain("may or may not have run")
        }
        expect(session.isInvalidated()).toBe(false)
      }).pipe(Effect.scoped),
  )

  it.effect("reports the token the SDK refreshed on a reconnect", () =>
    Effect.gen(function* () {
      const harness = yield* makeReconnectHarness()
      const session = yield* StdbTesting.makeScopedFromModulePlan({
        plan,
        config: reconnectConfig(harness, { token: "token-initial" }),
      })
      expect(session.token).toBe("token-initial")

      harness.drop(1, recoveringReport)
      harness.at(1).setToken("token-refreshed")
      harness.reconnect(1)
      expect(session.token).toBe("token-refreshed")
    }).pipe(Effect.scoped),
  )

  it.effect(
    "keeps table streams open through a drop and a replayed subscription",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeReconnectHarness()
        const session = yield* StdbTesting.makeScopedFromModulePlan({
          plan,
          config: reconnectConfig(harness),
        })
        const changes = yield* Queue.unbounded<unknown>()
        const stream = yield* session.streamTable("user").pipe(
          Stream.runForEach((change) => Queue.offer(changes, change)),
          Effect.forkChild,
        )
        const subscription = yield* harness.nextSubscription
        subscription.apply()

        harness.drop(1, recoveringReport)
        harness.reconnect(1)
        // The SDK replays every subscription and fires onApplied again.
        subscription.apply()
        harness.at(1).emitUserInsert({ id: "user-2", name: "Grace" })
        const change = yield* Queue.take(changes)
        expect(change).toMatchObject({
          _tag: "Insert",
          row: { id: "user-2", name: "Grace" },
        })

        harness.drop(1, { error: new Error("WebSocket closed (code 1008)") })
        const ended = yield* Fiber.join(stream).pipe(Effect.flip)
        expect(SubscriptionInvalidatedError.is(ended)).toBe(true)
      }).pipe(Effect.scoped),
  )
})

describe("ws per-attempt tokens", (it) => {
  it.effect(
    "evaluates a token Effect for every acquisition and hands the SDK a refresh",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeReconnectHarness()
        let evaluations = 0
        const token = Effect.suspend(() => {
          evaluations += 1
          return Effect.succeed(`token-${evaluations.toString()}`)
        })
        const config = reconnectConfig(harness, { token })

        yield* StdbTesting.makeScopedFromModulePlan({ plan, config }).pipe(
          Effect.scoped,
        )
        yield* StdbTesting.makeScopedFromModulePlan({ plan, config }).pipe(
          Effect.scoped,
        )
        expect(harness.tokens()).toEqual(["token-1", "token-2"])

        const [refresh] = harness.tokenProviders()
        expect(refresh).toBeDefined()
        if (refresh !== undefined) {
          expect(yield* Effect.promise(() => refresh())).toBe("token-3")
        }
      }),
  )

  it.effect(
    "evaluates a token Effect per acquisition without automatic reconnect",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeReconnectHarness({
          omit: [
            "withAutomaticReconnect",
            "withTokenProvider",
            "onAutomaticReconnect",
          ],
        })
        let evaluations = 0
        const config = reconnectConfig(harness, {
          automaticReconnect: undefined,
          token: Effect.suspend(() => {
            evaluations += 1
            return Effect.succeed(`token-${evaluations.toString()}`)
          }),
        })

        const session = yield* StdbTesting.makeScopedFromModulePlan({
          plan,
          config,
        }).pipe(Effect.scoped)
        expect(session.token).toBe("token-1")
        expect(harness.tokens()).toEqual(["token-1"])
        expect(harness.tokenProviders()).toEqual([])
      }),
  )

  it.effect("fails the attempt with the token Effect's failure", () =>
    Effect.gen(function* () {
      const harness = yield* makeReconnectHarness()
      const config = reconnectConfig(harness, {
        token: Effect.fail(new TokenUnavailable()),
      })

      const failure = yield* StdbTesting.makeScopedFromModulePlan({
        plan,
        config,
      }).pipe(Effect.scoped, Effect.flip)
      expect(WsConnectError.is(failure)).toBe(true)
      if (WsConnectError.is(failure)) {
        expect(failure.cause).toBeInstanceOf(TokenUnavailable)
      }
      expect(harness.buildCount()).toBe(0)
    }),
  )

  it.effect(
    "ends the session when the token Effect fails while the SDK refreshes it",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeReconnectHarness()
        let evaluations = 0
        const config = reconnectConfig(harness, {
          token: Effect.suspend(() => {
            evaluations += 1
            return evaluations === 1
              ? Effect.succeed("token-1")
              : Effect.fail(new TokenUnavailable())
          }),
        })
        const session = yield* StdbTesting.makeScopedFromModulePlan({
          plan,
          config,
        })
        const [refresh] = harness.tokenProviders()
        if (refresh === undefined) {
          return yield* Effect.die("the SDK received no token refresh")
        }
        harness.drop(1, recoveringReport)

        const failed = yield* Effect.promise(() =>
          refresh().then(
            () => undefined,
            (error: unknown) => error,
          ),
        )
        expect(WsConnectError.is(failed)).toBe(true)
        if (WsConnectError.is(failed)) {
          expect(failed.cause).toBeInstanceOf(TokenUnavailable)
        }
        // A permanently failing token would otherwise keep the SDK retrying
        // forever; the session ends so its owner decides.
        expect(session.isInvalidated()).toBe(true)
        expect(harness.at(1).disconnectCount()).toBe(1)
        const lost = yield* Effect.flip(session.reducers.userUpsert(upsert))
        expect(ConnectionLostError.is(lost)).toBe(true)
        if (ConnectionLostError.is(lost)) {
          expect(lost.raw).toBe("Token refresh failed: TokenUnavailable")
        }
      }).pipe(Effect.scoped),
  )

  it.effect(
    "ends the session when the token Effect overruns while the SDK refreshes it",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeReconnectHarness()
        let evaluations = 0
        const gate = yield* Deferred.make<void>()
        const config = reconnectConfig(harness, {
          token: Effect.suspend(() => {
            evaluations += 1
            return evaluations === 1
              ? Effect.succeed("token-1")
              : Deferred.await(gate).pipe(Effect.as("token-late"))
          }),
        })
        const session = yield* StdbTesting.makeScopedFromModulePlan({
          plan,
          config,
        })
        const [refresh] = harness.tokenProviders()
        if (refresh === undefined) {
          return yield* Effect.die("the SDK received no token refresh")
        }
        harness.drop(1, recoveringReport)

        // Like the SDK, refresh once the reported delay has elapsed. The
        // attempt's bound (delay + connect bound) then limits the refresh.
        yield* TestClock.adjust(Duration.millis(recoveringReport.delayMs))
        const overrun = refresh().then(
          () => undefined,
          (error: unknown) => error,
        )
        yield* TestClock.adjust(Duration.millis(connectTimeoutMillis - 1))
        expect(session.isInvalidated()).toBe(false)
        yield* TestClock.adjust(Duration.millis(1))
        expect(session.isInvalidated()).toBe(true)
        expect(harness.at(1).disconnectCount()).toBe(1)
        // The overrun is the token's: the session ended for its credentials.
        const lost = yield* Effect.flip(session.reducers.userUpsert(upsert))
        expect(ConnectionLostError.is(lost)).toBe(true)
        if (ConnectionLostError.is(lost)) {
          expect(lost.raw).toBe(
            "Token refresh did not complete: Automatic reconnect attempt 1 did not complete within 1500ms",
          )
        }
        // The refresh still running is dropped with the connection.
        const abandoned = yield* Effect.promise(() => overrun)
        expect(WsConnectError.is(abandoned)).toBe(true)
      }).pipe(Effect.scoped),
  )

  for (const feature of [
    "withAutomaticReconnect",
    "withTokenProvider",
    "onAutomaticReconnect",
  ] as const) {
    it.effect(`rejects a builder without ${feature}`, () =>
      Effect.gen(function* () {
        const harness = yield* makeReconnectHarness({ omit: [feature] })
        const failure = yield* StdbTesting.makeScopedFromModulePlan({
          plan,
          config: reconnectConfig(harness, {
            token: Effect.succeed("token"),
          }),
        }).pipe(Effect.scoped, Effect.flip)
        expect(WsConnectError.is(failure)).toBe(true)
        if (WsConnectError.is(failure)) {
          expect(WsUnsupportedBuilderFeatureError.is(failure.cause)).toBe(true)
          if (WsUnsupportedBuilderFeatureError.is(failure.cause)) {
            expect(failure.cause.feature).toBe(feature)
          }
        }
      }),
    )
  }
})

describe("ws session supervisor with automatic reconnect", (it) => {
  it.effect(
    "retains the live session while the SDK reconnects and reruns the reconnect hook",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeReconnectHarness()
        let hookRuns = 0
        let hookReleases = 0
        const supervisor =
          yield* StdbTesting.makeWsSessionSupervisorFromModulePlan({
            plan,
            config: reconnectConfig(harness),
            subscriptionTargets: [plan.targets.tables.user],
            onAutomaticReconnect: () =>
              Effect.acquireRelease(
                Effect.suspend(() => {
                  hookRuns += 1
                  return Effect.void
                }),
                () =>
                  Effect.suspend(() => {
                    hookReleases += 1
                    return Effect.void
                  }),
              ),
          })
        const subscription = yield* harness.nextSubscription
        subscription.apply()
        yield* awaitPhase(
          supervisor.phase,
          (phase) => phase.status === "live" && phase.attempt === 1,
        )
        const first = yield* SubscriptionRef.get(supervisor.session)
        expect(AsyncResult.isSuccess(first)).toBe(true)
        expect(hookRuns).toBe(0)

        harness.drop(1, recoveringReport)
        const recovering = yield* awaitPhase(
          supervisor.phase,
          (phase) => phase.status === "recovering",
        )
        expect(recovering).toEqual({
          status: "recovering",
          attempt: 1,
          reconnectAttempt: 1,
          reconnectDelayMillis: 500,
          reason: "WebSocket closed (code 1006)",
        })
        const retained = yield* SubscriptionRef.get(supervisor.session)
        expect(retained.waiting).toBe(true)
        if (AsyncResult.isSuccess(retained) && AsyncResult.isSuccess(first)) {
          expect(retained.value).toBe(first.value)
        }

        // Reconnected, but the replay has not re-applied the target yet: the
        // cache is still the outage's, so the session stays recovering.
        harness.reconnect(1)
        const replaying = yield* awaitPhase(
          supervisor.phase,
          (phase) =>
            phase.status === "recovering" &&
            phase.reason.startsWith("Replaying"),
        )
        expect(replaying).toMatchObject({
          reconnectAttempt: 1,
          reconnectDelayMillis: 0,
        })
        expect(hookRuns).toBe(0)
        subscription.apply()
        yield* awaitPhase(
          supervisor.phase,
          (phase) => phase.status === "live" && phase.attempt === 1,
        )
        const restored = yield* SubscriptionRef.get(supervisor.session)
        expect(restored.waiting).toBe(false)
        if (AsyncResult.isSuccess(restored) && AsyncResult.isSuccess(first)) {
          expect(restored.value).toBe(first.value)
        }
        expect(hookRuns).toBe(1)
        expect(hookReleases).toBe(0)

        // The hook's scope lasts until the next drop.
        harness.drop(1, recoveringReport)
        yield* awaitPhase(
          supervisor.phase,
          (phase) => phase.status === "recovering",
        )
        expect(hookReleases).toBe(1)
        harness.reconnect(1)
        subscription.apply()
        yield* awaitPhase(supervisor.phase, (phase) => phase.status === "live")
        expect(hookRuns).toBe(2)
        expect(harness.buildCount()).toBe(1)
        expect(harness.at(1).disconnectCount()).toBe(0)
      }).pipe(Effect.scoped),
  )

  it.effect("re-acquires after a drop with no retry scheduled", () =>
    Effect.gen(function* () {
      const harness = yield* makeReconnectHarness()
      const supervisor =
        yield* StdbTesting.makeWsSessionSupervisorFromModulePlan({
          plan,
          config: reconnectConfig(harness),
          policy: {
            reconnectDelayMillisFirst: 100,
            reconnectDelayMillisMax: 1_000,
            reconnectJitter: false,
          },
        })
      yield* awaitPhase(
        supervisor.phase,
        (phase) => phase.status === "live" && phase.attempt === 1,
      )

      harness.drop(1, recoveringReport)
      yield* awaitPhase(
        supervisor.phase,
        (phase) => phase.status === "recovering",
      )
      harness.attemptFailed(1, {
        error: new Error("WebSocket closed (code 1008)"),
      })
      const reconnecting = yield* awaitPhase(
        supervisor.phase,
        (phase) => phase.status === "reconnecting",
      )
      expect(
        reconnecting.status === "reconnecting" &&
          ConnectionLostError.is(reconnecting.failure),
      ).toBe(true)

      yield* TestClock.adjust(Duration.millis(100))
      yield* awaitPhase(
        supervisor.phase,
        (phase) => phase.status === "live" && phase.attempt === 2,
      )
      expect(harness.buildCount()).toBe(2)
    }).pipe(Effect.scoped),
  )

  it.effect("parks when a reconnect changes the session's identity", () =>
    Effect.gen(function* () {
      const harness = yield* makeReconnectHarness()
      const supervisor =
        yield* StdbTesting.makeWsSessionSupervisorFromModulePlan({
          plan,
          config: reconnectConfig(harness),
        })
      yield* awaitPhase(
        supervisor.phase,
        (phase) => phase.status === "live" && phase.attempt === 1,
      )

      harness.drop(1, recoveringReport)
      harness.attemptFailed(1, { error: new IdentityChangedError() })
      const fatal = yield* awaitPhase(
        supervisor.phase,
        (phase) => phase.status === "fatal",
      )
      expect(fatal.status === "fatal" && WsConnectError.is(fatal.failure)).toBe(
        true,
      )
      if (fatal.status === "fatal" && WsConnectError.is(fatal.failure)) {
        expect(ConnectionIdentityChangedError.is(fatal.failure.cause)).toBe(
          true,
        )
      }
      expect(harness.buildCount()).toBe(1)
    }).pipe(Effect.scoped),
  )

  it.effect("replaces the session when the reconnect hook fails", () =>
    Effect.gen(function* () {
      const harness = yield* makeReconnectHarness()
      const supervisor =
        yield* StdbTesting.makeWsSessionSupervisorFromModulePlan({
          plan,
          config: reconnectConfig(harness),
          onAutomaticReconnect: () => Effect.fail(new PresenceRefused()),
          policy: {
            reconnectDelayMillisFirst: 100,
            reconnectDelayMillisMax: 1_000,
            reconnectJitter: false,
          },
        })
      yield* awaitPhase(
        supervisor.phase,
        (phase) => phase.status === "live" && phase.attempt === 1,
      )

      harness.drop(1, recoveringReport)
      harness.reconnect(1)
      const reconnecting = yield* awaitPhase(
        supervisor.phase,
        (phase) => phase.status === "reconnecting",
      )
      expect(
        reconnecting.status === "reconnecting" &&
          reconnecting.failure instanceof PresenceRefused,
      ).toBe(true)
      expect(harness.at(1).disconnectCount()).toBe(1)

      yield* TestClock.adjust(Duration.millis(100))
      yield* awaitPhase(
        supervisor.phase,
        (phase) => phase.status === "live" && phase.attempt === 2,
      )
    }).pipe(Effect.scoped),
  )

  it.effect(
    "interrupts the reconnect hook when the socket drops again instead of ending the session",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeReconnectHarness()
        const hookStarted = yield* Queue.unbounded<number>()
        let hookRuns = 0
        let hookInterrupted = 0
        const supervisor =
          yield* StdbTesting.makeWsSessionSupervisorFromModulePlan({
            plan,
            config: reconnectConfig(harness),
            onAutomaticReconnect: () =>
              Effect.suspend(() => {
                hookRuns += 1
                Queue.offerUnsafe(hookStarted, hookRuns)
                return hookRuns === 1
                  ? Effect.never.pipe(
                      Effect.onInterrupt(() =>
                        Effect.suspend(() => {
                          hookInterrupted += 1
                          return Effect.void
                        }),
                      ),
                    )
                  : Effect.void
              }),
          })
        yield* awaitPhase(
          supervisor.phase,
          (phase) => phase.status === "live" && phase.attempt === 1,
        )

        harness.drop(1, recoveringReport)
        harness.reconnect(1)
        expect(yield* Queue.take(hookStarted)).toBe(1)
        harness.drop(1, { ...recoveringReport, nextAttempt: 2 })
        yield* awaitPhase(
          supervisor.phase,
          (phase) =>
            phase.status === "recovering" && phase.reconnectAttempt === 2,
        )
        expect(hookInterrupted).toBe(1)

        harness.reconnect(1)
        yield* awaitPhase(supervisor.phase, (phase) => phase.status === "live")
        expect(hookRuns).toBe(2)
        expect(harness.buildCount()).toBe(1)
      }).pipe(Effect.scoped),
  )

  it.effect("refuses a reconnect hook without automatic reconnect", () =>
    Effect.gen(function* () {
      const harness = yield* makeReconnectHarness()
      expect(() =>
        StdbTesting.makeWsSessionSupervisorFromModulePlan({
          plan,
          config: reconnectConfig(harness, { automaticReconnect: undefined }),
          onAutomaticReconnect: () => Effect.void,
        }),
      ).toThrow(
        "WebSocket session supervisor onAutomaticReconnect requires config.automaticReconnect",
      )
    }),
  )
})
