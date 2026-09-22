import * as EffectVitest from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as TestClock from "effect/testing/TestClock"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import { WsUnsupportedBuilderFeatureError } from "effect-spacetimedb/client"
import * as StdbTesting from "effect-spacetimedb/testing"
import { Identity } from "spacetimedb"
import { FullModule, UserId, UserName } from "../fixtures/full-module"
import { TestLayer } from "../helpers/test-layer"
import { makeFullModuleWsConnection } from "../helpers/ws-fixtures"

const { expect } = EffectVitest
const describe = EffectVitest.layer(TestLayer)

const plan = StdbTesting.makeModulePlan(FullModule)
const uri = "ws://localhost:3000"
const databaseName = "test"

type FullBuilder = StdbTesting.GeneratedWsBuilderLike<
  typeof FullModule,
  unknown
>
type FullConnection = StdbTesting.ManagedWsConnection<
  typeof FullModule,
  unknown
>
type FullOnConnect = Parameters<FullBuilder["onConnect"]>[0]
type FullOnConnectError = Parameters<FullBuilder["onConnectError"]>[0]
type FullOnDisconnect = Parameters<FullBuilder["onDisconnect"]>[0]

type PendingSubscription = {
  readonly attempt: number
  readonly apply: () => void
}

const makeSupervisorHarness = Effect.fn(function* (
  connectFailureAttempts: ReadonlySet<number> = new Set(),
) {
  const subscriptions = yield* Queue.unbounded<PendingSubscription>()
  const builds = yield* Queue.unbounded<number>()
  let buildCount = 0
  const disconnectCounts: Array<number> = []
  const unsubscribeCounts: Array<number> = []
  const disconnectCallbacks: Array<FullOnDisconnect | undefined> = []
  const reducerCallAttempts: Array<number> = []

  const builder = (): FullBuilder => {
    let onConnect: FullOnConnect | undefined
    let onConnectError: FullOnConnectError | undefined
    let onDisconnect: FullOnDisconnect | undefined

    const current: FullBuilder = {
      withUri: () => current,
      withDatabaseName: () => current,
      withToken: () => current,
      withCompression: () => current,
      onConnect: (callback) => {
        onConnect = callback
        return current
      },
      onDisconnect: (callback) => {
        onDisconnect = callback
        return current
      },
      onConnectError: (callback) => {
        onConnectError = callback
        return current
      },
      build: () => {
        buildCount += 1
        const attempt = buildCount
        Queue.offerUnsafe(builds, attempt)
        let onApplied: (() => void) | undefined
        let onError: ((context: unknown, error?: Error) => void) | undefined
        const subscriptionBuilder: StdbTesting.SubscriptionBuilderLike<
          unknown,
          StdbTesting.ClientQueryRoot<typeof FullModule>
        > = {
          onApplied: (callback) => {
            onApplied = callback
            return subscriptionBuilder
          },
          onError: (callback) => {
            onError = callback
            return subscriptionBuilder
          },
          subscribe: () => {
            let ended = false
            const offered = Queue.offerUnsafe(subscriptions, {
              attempt,
              apply: () => onApplied?.(),
            })
            if (!offered) {
              onError?.(
                { attempt },
                new Error("subscription test queue is unavailable"),
              )
            }
            return {
              isEnded: () => ended,
              unsubscribe: () => {
                if (ended) return
                ended = true
                unsubscribeCounts[attempt - 1] =
                  (unsubscribeCounts[attempt - 1] ?? 0) + 1
              },
            }
          },
        }
        const connection: FullConnection = {
          ...makeFullModuleWsConnection({
            subscriptionBuilder: () => subscriptionBuilder,
          }),
          callReducerWithParams: () => {
            reducerCallAttempts.push(attempt)
            return Promise.resolve()
          },
          callProcedureWithParams: () => Promise.resolve(undefined),
          disconnect: () => {
            disconnectCounts[attempt - 1] =
              (disconnectCounts[attempt - 1] ?? 0) + 1
          },
        }
        disconnectCallbacks[attempt - 1] = onDisconnect

        if (connectFailureAttempts.has(attempt)) {
          onConnectError?.(
            { attempt },
            new Error(`connect attempt ${attempt.toString()} failed`),
          )
        } else {
          onConnect?.(
            connection,
            Identity.zero(),
            `token-${attempt.toString()}`,
          )
        }
        return connection
      },
    }
    return current
  }

  return {
    builder,
    buildCount: () => buildCount,
    disconnectCount: (attempt: number) => disconnectCounts[attempt - 1] ?? 0,
    unsubscribeCount: (attempt: number) => unsubscribeCounts[attempt - 1] ?? 0,
    reducerCallAttempts: () => [...reducerCallAttempts],
    disconnect: (attempt: number, message: string) =>
      disconnectCallbacks[attempt - 1]?.({ attempt }, new Error(message)),
    // A socket close the SDK reports with no error at all: a clean close, or
    // the close it performs when a frame fails to decompress.
    disconnectWithoutError: (attempt: number) =>
      disconnectCallbacks[attempt - 1]?.({ attempt }, undefined),
    nextBuild: Queue.take(builds),
    nextSubscription: Queue.take(subscriptions),
  }
})

const awaitPhase = <Failure>(
  phase: SubscriptionRef.SubscriptionRef<
    StdbTesting.WsSessionSupervisorPhase<Failure>
  >,
  predicate: (value: StdbTesting.WsSessionSupervisorPhase<Failure>) => boolean,
) =>
  SubscriptionRef.changes(phase).pipe(
    Stream.filter(predicate),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
  )

describe("ws session supervisor", (it) => {
  it.effect("publishes a retrying cold-start failure and later recovers", () =>
    Effect.gen(function* () {
      const harness = yield* makeSupervisorHarness(new Set([1]))

      yield* Effect.gen(function* () {
        const supervisor =
          yield* StdbTesting.makeWsSessionSupervisorFromModulePlan({
            plan,
            config: {
              builder: harness.builder,
              uri,
              databaseName,
              connectTimeoutMillis: 1_000,
            },
            policy: {
              reconnectDelayMillisFirst: 100,
              reconnectDelayMillisMax: 1_000,
              reconnectJitter: false,
            },
          })

        yield* awaitPhase(
          supervisor.phase,
          (phase) => phase.status === "reconnecting" && phase.attempt === 1,
        )
        const retrying = yield* SubscriptionRef.get(supervisor.session)
        expect(AsyncResult.isFailure(retrying)).toBe(true)
        expect(retrying.waiting).toBe(true)

        yield* TestClock.adjust(Duration.millis(100))
        yield* awaitPhase(
          supervisor.phase,
          (phase) => phase.status === "live" && phase.attempt === 2,
        )
        expect(
          AsyncResult.isSuccess(yield* SubscriptionRef.get(supervisor.session)),
        ).toBe(true)
      }).pipe(Effect.scoped)
    }),
  )

  it.effect("caps the configured exponential reconnect delays", () =>
    Effect.gen(function* () {
      const harness = yield* makeSupervisorHarness(new Set([1, 2, 3]))

      yield* Effect.gen(function* () {
        const supervisor =
          yield* StdbTesting.makeWsSessionSupervisorFromModulePlan({
            plan,
            config: {
              builder: harness.builder,
              uri,
              databaseName,
              connectTimeoutMillis: 1_000,
            },
            policy: {
              reconnectDelayMillisFirst: 100,
              reconnectDelayMillisMax: 150,
              reconnectJitter: false,
            },
          })

        yield* awaitPhase(
          supervisor.phase,
          (phase) => phase.status === "reconnecting" && phase.attempt === 1,
        )
        expect(harness.buildCount()).toBe(1)

        yield* TestClock.adjust(Duration.millis(99))
        expect(harness.buildCount()).toBe(1)
        yield* TestClock.adjust(Duration.millis(1))
        yield* awaitPhase(
          supervisor.phase,
          (phase) => phase.status === "reconnecting" && phase.attempt === 2,
        )
        expect(harness.buildCount()).toBe(2)

        yield* TestClock.adjust(Duration.millis(149))
        expect(harness.buildCount()).toBe(2)
        yield* TestClock.adjust(Duration.millis(1))
        yield* awaitPhase(
          supervisor.phase,
          (phase) => phase.status === "reconnecting" && phase.attempt === 3,
        )
        expect(harness.buildCount()).toBe(3)

        yield* TestClock.adjust(Duration.millis(149))
        expect(harness.buildCount()).toBe(3)
        yield* TestClock.adjust(Duration.millis(1))
        yield* awaitPhase(
          supervisor.phase,
          (phase) => phase.status === "live" && phase.attempt === 4,
        )
        expect(harness.buildCount()).toBe(4)
      }).pipe(Effect.scoped)
    }),
  )

  it.effect("uses the first reconnect delay after a live session ends", () =>
    Effect.gen(function* () {
      const harness = yield* makeSupervisorHarness(new Set([1, 2]))

      yield* Effect.gen(function* () {
        const supervisor =
          yield* StdbTesting.makeWsSessionSupervisorFromModulePlan({
            plan,
            config: {
              builder: harness.builder,
              uri,
              databaseName,
              connectTimeoutMillis: 1_000,
            },
            policy: {
              reconnectDelayMillisFirst: 100,
              reconnectDelayMillisMax: 1_000,
              reconnectJitter: false,
            },
          })

        yield* awaitPhase(
          supervisor.phase,
          (phase) => phase.status === "reconnecting" && phase.attempt === 1,
        )
        yield* TestClock.adjust(Duration.millis(100))
        yield* awaitPhase(
          supervisor.phase,
          (phase) => phase.status === "reconnecting" && phase.attempt === 2,
        )
        yield* TestClock.adjust(Duration.millis(200))
        yield* awaitPhase(
          supervisor.phase,
          (phase) => phase.status === "live" && phase.attempt === 3,
        )
        expect(harness.buildCount()).toBe(3)

        harness.disconnect(3, "server rebooted after a stable session")
        yield* awaitPhase(
          supervisor.phase,
          (phase) => phase.status === "reconnecting" && phase.attempt === 3,
        )

        yield* TestClock.adjust(Duration.millis(99))
        expect(harness.buildCount()).toBe(3)
        yield* TestClock.adjust(Duration.millis(1))
        yield* awaitPhase(
          supervisor.phase,
          (phase) => phase.status === "live" && phase.attempt === 4,
        )
        expect(harness.buildCount()).toBe(4)
      }).pipe(Effect.scoped)
    }),
  )

  it.effect(
    "reconnects, resubscribes, preserves a waiting session, and cleans each attempt",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeSupervisorHarness()
        let setupCount = 0
        let setupCleanupCount = 0

        yield* Effect.gen(function* () {
          const supervisor =
            yield* StdbTesting.makeWsSessionSupervisorFromModulePlan({
              plan,
              config: {
                builder: harness.builder,
                uri,
                databaseName,
                connectTimeoutMillis: 1_000,
              },
              subscriptionTargets: [plan.targets.tables.user],
              setup: () =>
                Effect.acquireRelease(
                  Effect.suspend(() => {
                    setupCount += 1
                    return Effect.void
                  }),
                  () =>
                    Effect.suspend(() => {
                      setupCleanupCount += 1
                      return Effect.void
                    }),
                ),
              policy: {
                reconnectDelayMillisFirst: 100,
                reconnectDelayMillisMax: 1_000,
                reconnectJitter: false,
              },
            })

          const firstSubscription = yield* harness.nextSubscription
          expect(firstSubscription.attempt).toBe(1)
          firstSubscription.apply()
          yield* awaitPhase(
            supervisor.phase,
            (phase) => phase.status === "live" && phase.attempt === 1,
          )
          const firstSession = yield* SubscriptionRef.get(supervisor.session)
          expect(AsyncResult.isSuccess(firstSession)).toBe(true)
          expect(setupCount).toBe(1)

          harness.disconnect(1, "server rebooted")
          yield* awaitPhase(
            supervisor.phase,
            (phase) => phase.status === "reconnecting" && phase.attempt === 1,
          )
          const waitingSession = yield* SubscriptionRef.get(supervisor.session)
          expect(AsyncResult.isSuccess(waitingSession)).toBe(true)
          if (AsyncResult.isSuccess(waitingSession)) {
            expect(waitingSession.waiting).toBe(true)
            if (AsyncResult.isSuccess(firstSession)) {
              expect(waitingSession.value).toBe(firstSession.value)
            }
          }
          expect(harness.disconnectCount(1)).toBe(1)
          expect(harness.unsubscribeCount(1)).toBe(1)
          expect(setupCleanupCount).toBe(1)

          yield* TestClock.adjust(Duration.millis(100))
          const secondSubscription = yield* harness.nextSubscription
          expect(secondSubscription.attempt).toBe(2)
          secondSubscription.apply()
          yield* awaitPhase(
            supervisor.phase,
            (phase) => phase.status === "live" && phase.attempt === 2,
          )
          const secondSession = yield* SubscriptionRef.get(supervisor.session)
          expect(AsyncResult.isSuccess(secondSession)).toBe(true)
          if (
            AsyncResult.isSuccess(firstSession) &&
            AsyncResult.isSuccess(secondSession)
          ) {
            expect(secondSession.value).not.toBe(firstSession.value)
            expect(secondSession.waiting).toBe(false)
            yield* secondSession.value.reducers.userUpsert({
              userId: UserId.make("user-1"),
              name: UserName.make("Ada"),
            })
          }
          expect(harness.reducerCallAttempts()).toEqual([2])
          expect(setupCount).toBe(2)
        }).pipe(Effect.scoped)

        expect(harness.disconnectCount(2)).toBe(1)
        expect(harness.unsubscribeCount(2)).toBe(1)
        expect(setupCleanupCount).toBe(2)
      }),
  )

  it.effect("retries when a pending subscription is invalidated", () =>
    Effect.gen(function* () {
      const harness = yield* makeSupervisorHarness()

      yield* Effect.gen(function* () {
        const supervisor =
          yield* StdbTesting.makeWsSessionSupervisorFromModulePlan({
            plan,
            config: {
              builder: harness.builder,
              uri,
              databaseName,
              connectTimeoutMillis: 1_000,
            },
            subscriptionTargets: [plan.targets.tables.user],
            policy: {
              reconnectDelayMillisFirst: 100,
              reconnectDelayMillisMax: 1_000,
              reconnectJitter: false,
            },
          })

        const firstSubscription = yield* harness.nextSubscription
        expect(firstSubscription.attempt).toBe(1)
        harness.disconnect(1, "server rebooted before subscription applied")
        yield* awaitPhase(
          supervisor.phase,
          (phase) => phase.status === "reconnecting" && phase.attempt === 1,
        )
        expect(harness.unsubscribeCount(1)).toBe(1)

        yield* TestClock.adjust(Duration.millis(100))
        const secondSubscription = yield* harness.nextSubscription
        expect(secondSubscription.attempt).toBe(2)
        secondSubscription.apply()
        yield* awaitPhase(
          supervisor.phase,
          (phase) => phase.status === "live" && phase.attempt === 2,
        )
      }).pipe(Effect.scoped)
    }),
  )

  it.effect("bounds setup before publishing a live session", () =>
    Effect.gen(function* () {
      const harness = yield* makeSupervisorHarness()

      yield* Effect.gen(function* () {
        const supervisor =
          yield* StdbTesting.makeWsSessionSupervisorFromModulePlan({
            plan,
            config: {
              builder: harness.builder,
              uri,
              databaseName,
              connectTimeoutMillis: 100,
            },
            setup: () => Effect.never,
            policy: {
              reconnectDelayMillisFirst: 100,
              reconnectDelayMillisMax: 1_000,
              reconnectJitter: false,
            },
          })

        expect(yield* harness.nextBuild).toBe(1)
        yield* TestClock.adjust(Duration.millis(100))
        yield* awaitPhase(
          supervisor.phase,
          (phase) => phase.status === "reconnecting" && phase.attempt === 1,
        )
        expect(harness.disconnectCount(1)).toBe(1)
      }).pipe(Effect.scoped)
    }),
  )

  it.effect("retries when the session disconnects during setup", () =>
    Effect.gen(function* () {
      const harness = yield* makeSupervisorHarness()
      const setupStarted = yield* Deferred.make<void>()

      yield* Effect.gen(function* () {
        const supervisor =
          yield* StdbTesting.makeWsSessionSupervisorFromModulePlan({
            plan,
            config: {
              builder: harness.builder,
              uri,
              databaseName,
              connectTimeoutMillis: 1_000,
            },
            setup: () =>
              Deferred.succeed(setupStarted, undefined).pipe(
                Effect.andThen(Effect.never),
              ),
            policy: {
              reconnectDelayMillisFirst: 100,
              reconnectDelayMillisMax: 1_000,
              reconnectJitter: false,
            },
          })

        expect(yield* harness.nextBuild).toBe(1)
        yield* Deferred.await(setupStarted)
        harness.disconnect(1, "closed during setup")
        yield* awaitPhase(
          supervisor.phase,
          (phase) => phase.status === "reconnecting" && phase.attempt === 1,
        )
        expect(harness.disconnectCount(1)).toBe(1)
        expect(
          AsyncResult.isSuccess(yield* SubscriptionRef.get(supervisor.session)),
        ).toBe(false)
      }).pipe(Effect.scoped)
    }),
  )

  it.effect("does not publish a disconnected session as live", () =>
    Effect.gen(function* () {
      const harness = yield* makeSupervisorHarness()

      yield* Effect.gen(function* () {
        const supervisor =
          yield* StdbTesting.makeWsSessionSupervisorFromModulePlan({
            plan,
            config: {
              builder: harness.builder,
              uri,
              databaseName,
              connectTimeoutMillis: 1_000,
            },
            setup: () =>
              Effect.succeed(
                harness.disconnect(1, "closed as setup completed"),
              ),
            policy: {
              reconnectDelayMillisFirst: 100,
              reconnectDelayMillisMax: 1_000,
              reconnectJitter: false,
            },
          })

        yield* awaitPhase(
          supervisor.phase,
          (phase) => phase.status === "reconnecting" && phase.attempt === 1,
        )
        expect(
          AsyncResult.isSuccess(yield* SubscriptionRef.get(supervisor.session)),
        ).toBe(false)
      }).pipe(Effect.scoped)
    }),
  )

  it.effect("publishes a fatal phase when setup defects", () =>
    Effect.gen(function* () {
      const harness = yield* makeSupervisorHarness()

      yield* Effect.gen(function* () {
        const supervisor =
          yield* StdbTesting.makeWsSessionSupervisorFromModulePlan({
            plan,
            config: {
              builder: harness.builder,
              uri,
              databaseName,
              connectTimeoutMillis: 1_000,
            },
            setup: () => Effect.die("setup defect"),
          })

        const fatal = yield* awaitPhase(
          supervisor.phase,
          (phase) => phase.status === "fatal",
        )
        expect(fatal.attempt).toBe(1)
        expect(fatal.status).toBe("fatal")
        if (fatal.status === "fatal") {
          expect(
            StdbTesting.WsSessionSupervisorDefectError.is(fatal.failure),
          ).toBe(true)
          if (StdbTesting.WsSessionSupervisorDefectError.is(fatal.failure)) {
            expect(Cause.hasDies(fatal.failure.cause)).toBe(true)
          }
        }
        expect(harness.disconnectCount(1)).toBe(1)
      }).pipe(Effect.scoped)
    }),
  )

  it.effect("publishes a fatal phase when retry policy rejects a failure", () =>
    Effect.gen(function* () {
      const harness = yield* makeSupervisorHarness(new Set([1]))

      yield* Effect.gen(function* () {
        const supervisor =
          yield* StdbTesting.makeWsSessionSupervisorFromModulePlan({
            plan,
            config: {
              builder: harness.builder,
              uri,
              databaseName,
              connectTimeoutMillis: 1_000,
            },
            policy: {
              isRetryable: () => false,
            },
          })
        const fatal = yield* awaitPhase(
          supervisor.phase,
          (phase) => phase.status === "fatal",
        )
        expect(fatal.attempt).toBe(1)
        expect(harness.buildCount()).toBe(1)
        expect(
          AsyncResult.isFailure(yield* SubscriptionRef.get(supervisor.session)),
        ).toBe(true)
      }).pipe(Effect.scoped)
    }),
  )

  it.effect("parks unsupported generated builder capabilities", () =>
    Effect.gen(function* () {
      const harness = yield* makeSupervisorHarness()

      yield* Effect.gen(function* () {
        const supervisor = yield* StdbTesting.makeWsSessionSupervisorGenerated({
          module: FullModule,
          config: {
            DbConnection: { builder: harness.builder },
            uri,
            databaseName,
            createWebSocket: () => ({}),
            connectTimeoutMillis: 1_000,
          },
        })

        const fatal = yield* awaitPhase(
          supervisor.phase,
          (phase) => phase.status === "fatal",
        )
        expect(fatal.attempt).toBe(1)
        expect(fatal.status).toBe("fatal")
        if (fatal.status === "fatal") {
          expect(StdbTesting.WsConnectError.is(fatal.failure)).toBe(true)
          if (StdbTesting.WsConnectError.is(fatal.failure)) {
            expect(
              WsUnsupportedBuilderFeatureError.is(fatal.failure.cause),
            ).toBe(true)
          }
        }
        expect(harness.buildCount()).toBe(0)
      }).pipe(Effect.scoped)
    }),
  )

  it.effect("parks unsupported module-plan builder capabilities", () =>
    Effect.gen(function* () {
      const harness = yield* makeSupervisorHarness()

      yield* Effect.gen(function* () {
        const supervisor =
          yield* StdbTesting.makeWsSessionSupervisorFromModulePlan({
            plan,
            config: {
              builder: harness.builder,
              uri,
              databaseName,
              createWebSocket: () => ({}),
              connectTimeoutMillis: 1_000,
            },
            policy: { isRetryable: undefined },
          })

        const fatal = yield* awaitPhase(
          supervisor.phase,
          (phase) => phase.status === "fatal",
        )
        expect(fatal.attempt).toBe(1)
        expect(fatal.status).toBe("fatal")
        if (fatal.status === "fatal") {
          expect(StdbTesting.WsConnectError.is(fatal.failure)).toBe(true)
          if (StdbTesting.WsConnectError.is(fatal.failure)) {
            expect(
              WsUnsupportedBuilderFeatureError.is(fatal.failure.cause),
            ).toBe(true)
          }
        }
        expect(harness.buildCount()).toBe(0)
      }).pipe(Effect.scoped)
    }),
  )

  it.effect("parks when retry policy rejects a live session failure", () =>
    Effect.gen(function* () {
      const harness = yield* makeSupervisorHarness()

      yield* Effect.gen(function* () {
        const supervisor =
          yield* StdbTesting.makeWsSessionSupervisorFromModulePlan({
            plan,
            config: {
              builder: harness.builder,
              uri,
              databaseName,
              connectTimeoutMillis: 1_000,
            },
            policy: {
              isRetryable: () => false,
            },
          })
        yield* awaitPhase(
          supervisor.phase,
          (phase) => phase.status === "live" && phase.attempt === 1,
        )

        harness.disconnect(1, "non-retryable disconnect")
        const fatal = yield* awaitPhase(
          supervisor.phase,
          (phase) => phase.status === "fatal",
        )

        expect(fatal.attempt).toBe(1)
        expect(harness.buildCount()).toBe(1)
        expect(
          AsyncResult.isFailure(yield* SubscriptionRef.get(supervisor.session)),
        ).toBe(true)
      }).pipe(Effect.scoped)
    }),
  )

  it.effect(
    "reconnects a live session lost to a close that reports no socket error",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeSupervisorHarness()

        yield* Effect.gen(function* () {
          const supervisor =
            yield* StdbTesting.makeWsSessionSupervisorFromModulePlan({
              plan,
              config: {
                builder: harness.builder,
                uri,
                databaseName,
                connectTimeoutMillis: 1_000,
              },
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

          harness.disconnectWithoutError(1)
          const reconnecting = yield* awaitPhase(
            supervisor.phase,
            (phase) => phase.status === "reconnecting" && phase.attempt === 1,
          )

          expect(
            reconnecting.status === "reconnecting" &&
              StdbTesting.ConnectionLostError.is(reconnecting.failure),
          ).toBe(true)
          if (
            reconnecting.status === "reconnecting" &&
            StdbTesting.ConnectionLostError.is(reconnecting.failure)
          ) {
            expect(reconnecting.failure.raw).toBe(
              "WebSocket connection disconnected",
            )
          }

          yield* TestClock.adjust(Duration.millis(100))
          yield* awaitPhase(
            supervisor.phase,
            (phase) => phase.status === "live" && phase.attempt === 2,
          )
          expect(harness.buildCount()).toBe(2)
        }).pipe(Effect.scoped)
      }),
  )
})
