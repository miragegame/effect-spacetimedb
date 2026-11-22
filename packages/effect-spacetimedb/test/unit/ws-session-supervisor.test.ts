import * as EffectVitest from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Random from "effect/Random"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as TestClock from "effect/testing/TestClock"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import {
  connectDurationMaxDefault,
  WsUnsupportedBuilderFeatureError,
  type WsSessionSupervisorPolicy,
} from "effect-spacetimedb/client"
import * as StdbInternal from "effect-spacetimedb/testing/internal"
import { Identity } from "spacetimedb"
import { FullModule, UserId, UserName } from "../fixtures/full-module"
import { TestLayer } from "../helpers/test-layer"
import { makeFullModuleWsConnection } from "../helpers/ws-fixtures"

const { expect } = EffectVitest
const describe = EffectVitest.layer(TestLayer)

const plan = StdbInternal.makeModulePlan(FullModule)
const uri = "ws://localhost:3000"
const databaseName = "test"

type FullBuilder = StdbInternal.GeneratedWsBuilderLike<
  typeof FullModule,
  unknown
>
type FullConnection = StdbInternal.ManagedWsConnection<
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

const stabilityPolicy = {
  reconnectDelayFirst: Duration.millis(100),
  reconnectDelayMax: { seconds: 1 },
  reconnectJitter: false,
  stabilityWindow: Duration.seconds(5),
}

/** Every draw is `draw`: `0` is jitter's lowest factor, `0.5` multiplies by one. */
const constantDraw = (draw: number): Random.Random => ({
  nextDoubleUnsafe: () => draw,
  nextIntUnsafe: () => 0,
})

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
  const silentlyClosedAttempts = new Set<number>()

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
        const subscriptionBuilder: StdbInternal.SubscriptionBuilderLike<
          unknown,
          StdbInternal.ClientQueryRoot<typeof FullModule>
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
        const connection = Object.defineProperty<FullConnection>(
          {
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
          },
          "isSocketClosed",
          { get: () => silentlyClosedAttempts.has(attempt) },
        )
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
    // A socket a browser tore down without delivering its close event: the
    // SDK reports it closed, and no disconnect callback ever runs.
    closeSocketSilently: (attempt: number) => {
      silentlyClosedAttempts.add(attempt)
    },
    nextBuild: Queue.take(builds),
    nextSubscription: Queue.take(subscriptions),
  }
})

const awaitPhase = <Failure>(
  phase: SubscriptionRef.SubscriptionRef<
    StdbInternal.WsSessionSupervisorPhase<Failure>
  >,
  predicate: (value: StdbInternal.WsSessionSupervisorPhase<Failure>) => boolean,
) =>
  SubscriptionRef.changes(phase).pipe(
    Stream.filter(predicate),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
  )

/**
 * The server ends the live session `index + 1`, and its replacement is built
 * exactly `delayMillis` later, which is what these suites mean by a delay.
 */
const expectReplacementAfter =
  <Failure>(
    harness: {
      readonly buildCount: () => number
      readonly disconnect: (attempt: number, message: string) => void
    },
    phase: SubscriptionRef.SubscriptionRef<
      StdbInternal.WsSessionSupervisorPhase<Failure>
    >,
  ) =>
  (delayMillis: number, index: number) =>
    Effect.gen(function* () {
      const attempt = index + 1
      harness.disconnect(attempt, "server ended the session")
      yield* awaitPhase(
        phase,
        (value) => value.status === "reconnecting" && value.attempt === attempt,
      )
      yield* TestClock.adjust(Duration.millis(delayMillis - 1))
      expect(harness.buildCount()).toBe(attempt)
      yield* TestClock.adjust(Duration.millis(1))
      yield* awaitPhase(
        phase,
        (value) => value.status === "live" && value.attempt === attempt + 1,
      )
    })

/**
 * Gives `globalThis` a page-like event target for the enclosing scope, then
 * restores the previous listeners API (absent outside a page).
 */
const installPageEventTarget = Effect.acquireRelease(
  Effect.suspend(() => {
    const target = new EventTarget()
    const previous = {
      addEventListener: Object.getOwnPropertyDescriptor(
        globalThis,
        "addEventListener",
      ),
      removeEventListener: Object.getOwnPropertyDescriptor(
        globalThis,
        "removeEventListener",
      ),
    }
    Object.defineProperty(globalThis, "addEventListener", {
      configurable: true,
      writable: true,
      value: target.addEventListener.bind(target),
    })
    Object.defineProperty(globalThis, "removeEventListener", {
      configurable: true,
      writable: true,
      value: target.removeEventListener.bind(target),
    })
    return Effect.succeed({ target, previous })
  }),
  ({ previous }) =>
    Effect.suspend(() => {
      for (const name of ["addEventListener", "removeEventListener"] as const) {
        const descriptor = previous[name]
        if (descriptor === undefined) {
          Reflect.deleteProperty(globalThis, name)
        } else {
          Object.defineProperty(globalThis, name, descriptor)
        }
      }
      return Effect.void
    }),
).pipe(Effect.map(({ target }) => target))

describe("ws session supervisor", (it) => {
  it.effect("publishes a retrying cold-start failure and later recovers", () =>
    Effect.gen(function* () {
      const harness = yield* makeSupervisorHarness(new Set([1]))

      yield* Effect.gen(function* () {
        const supervisor =
          yield* StdbInternal.makeWsSessionSupervisorFromModulePlan({
            plan,
            config: {
              builder: harness.builder,
              uri,
              databaseName,
              connectDurationMax: 1_000,
            },
            policy: {
              reconnectDelayFirst: 100,
              reconnectDelayMax: 1_000,
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
          yield* StdbInternal.makeWsSessionSupervisorFromModulePlan({
            plan,
            config: {
              builder: harness.builder,
              uri,
              databaseName,
              connectDurationMax: 1_000,
            },
            policy: {
              reconnectDelayFirst: 100,
              reconnectDelayMax: 150,
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

  it.effect(
    "starts the reconnect delay over once a session outlives the stability window",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeSupervisorHarness(new Set([1, 2]))

        yield* Effect.gen(function* () {
          const supervisor =
            yield* StdbInternal.makeWsSessionSupervisorFromModulePlan({
              plan,
              config: {
                builder: harness.builder,
                uri,
                databaseName,
                connectDurationMax: 1_000,
              },
              policy: stabilityPolicy,
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

          yield* TestClock.adjust(stabilityPolicy.stabilityWindow)
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
    "keeps the reconnect delay growing past a session just short of the window",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeSupervisorHarness(new Set([1, 2]))

        yield* Effect.gen(function* () {
          const supervisor =
            yield* StdbInternal.makeWsSessionSupervisorFromModulePlan({
              plan,
              config: {
                builder: harness.builder,
                uri,
                databaseName,
                connectDurationMax: 1_000,
              },
              policy: stabilityPolicy,
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

          yield* TestClock.adjust(
            Duration.subtract(
              stabilityPolicy.stabilityWindow,
              Duration.millis(1),
            ),
          )
          harness.disconnect(3, "server dropped the session again")
          yield* awaitPhase(
            supervisor.phase,
            (phase) => phase.status === "reconnecting" && phase.attempt === 3,
          )

          // The third delay of the run, not the first of a new one.
          yield* TestClock.adjust(Duration.millis(399))
          expect(harness.buildCount()).toBe(3)
          yield* TestClock.adjust(Duration.millis(1))
          yield* awaitPhase(
            supervisor.phase,
            (phase) => phase.status === "live" && phase.attempt === 4,
          )
        }).pipe(Effect.scoped)
      }),
  )

  it.effect(
    "backs off a server that ends every session as soon as it goes live",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeSupervisorHarness()

        yield* Effect.gen(function* () {
          const supervisor =
            yield* StdbInternal.makeWsSessionSupervisorFromModulePlan({
              plan,
              config: {
                builder: harness.builder,
                uri,
                databaseName,
                connectDurationMax: 1_000,
              },
              policy: stabilityPolicy,
            })

          yield* awaitPhase(
            supervisor.phase,
            (phase) => phase.status === "live" && phase.attempt === 1,
          )
          yield* Effect.forEach(
            [100, 200, 400, 800, 1_000, 1_000],
            expectReplacementAfter(harness, supervisor.phase),
            { discard: true },
          )
        }).pipe(Effect.scoped)
      }),
  )

  it.effect("spreads its jitter below the delay ceiling", () =>
    Effect.gen(function* () {
      const harness = yield* makeSupervisorHarness()

      yield* Effect.gen(function* () {
        const supervisor =
          yield* StdbInternal.makeWsSessionSupervisorFromModulePlan({
            plan,
            config: {
              builder: harness.builder,
              uri,
              databaseName,
              connectDurationMax: 1_000,
            },
            policy: { ...stabilityPolicy, reconnectJitter: true },
          })

        yield* awaitPhase(
          supervisor.phase,
          (phase) => phase.status === "live" && phase.attempt === 1,
        )
        // A middle draw at the ceiling lands short of it: a cap on the drawn delay
        // would put every draw from here up on exactly the ceiling.
        yield* Effect.forEach(
          [100, 200, 400, 800, 834, 834],
          expectReplacementAfter(harness, supervisor.phase),
          { discard: true },
        )
      }).pipe(Effect.scoped)
    }).pipe(Effect.provideService(Random.Random, constantDraw(0.5))),
  )

  it.effect("keeps a low jitter draw at two thirds of the ceiling", () =>
    Effect.gen(function* () {
      const harness = yield* makeSupervisorHarness()

      yield* Effect.gen(function* () {
        const supervisor =
          yield* StdbInternal.makeWsSessionSupervisorFromModulePlan({
            plan,
            config: {
              builder: harness.builder,
              uri,
              databaseName,
              connectDurationMax: 1_000,
            },
            policy: { ...stabilityPolicy, reconnectJitter: true },
          })

        yield* awaitPhase(
          supervisor.phase,
          (phase) => phase.status === "live" && phase.attempt === 1,
        )
        yield* Effect.forEach(
          [80, 160, 320, 640, 667, 667],
          expectReplacementAfter(harness, supervisor.phase),
          { discard: true },
        )
      }).pipe(Effect.scoped)
    }).pipe(Effect.provideService(Random.Random, constantDraw(0))),
  )

  it.effect("refuses a backoff that does not bound anything", () =>
    Effect.gen(function* () {
      const harness = yield* makeSupervisorHarness()
      const supervising =
        (policy: Omit<WsSessionSupervisorPolicy<unknown>, "isRetryable">) =>
        () =>
          StdbInternal.makeWsSessionSupervisorFromModulePlan({
            plan,
            config: {
              builder: harness.builder,
              uri,
              databaseName,
              connectDurationMax: 1_000,
            },
            policy,
          })

      expect(supervising({ stabilityWindow: 0 })).toThrow(TypeError)
      expect(supervising({ stabilityWindow: -1 })).toThrow(TypeError)
      expect(supervising({ stabilityWindow: Number.NaN })).toThrow(TypeError)
      expect(supervising({ stabilityWindow: Infinity })).toThrow(TypeError)
      expect(supervising({ reconnectDelayMax: Number.NaN })).toThrow(TypeError)
      expect(supervising({ reconnectDelayFirst: Infinity })).toThrow(TypeError)
      expect(supervising({ reconnectDelayFirst: -1 })).toThrow(TypeError)
      expect(harness.buildCount()).toBe(0)
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
            yield* StdbInternal.makeWsSessionSupervisorFromModulePlan({
              plan,
              config: {
                builder: harness.builder,
                uri,
                databaseName,
                connectDurationMax: 1_000,
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
                reconnectDelayFirst: 100,
                reconnectDelayMax: 1_000,
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

  it.effect(
    "reconnects when the page resumes on a socket closed without a close event",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeSupervisorHarness()

        yield* Effect.gen(function* () {
          // Node and the test pool have no page event target, so the test
          // installs one for its own scope and puts back whatever was there.
          const page = yield* installPageEventTarget
          const supervisor =
            yield* StdbInternal.makeWsSessionSupervisorFromModulePlan({
              plan,
              config: {
                builder: harness.builder,
                uri,
                databaseName,
                connectDurationMax: 1_000,
              },
              subscriptionTargets: [plan.targets.tables.user],
              policy: {
                reconnectDelayFirst: 100,
                reconnectDelayMax: 1_000,
                reconnectJitter: false,
              },
            })

          const firstSubscription = yield* harness.nextSubscription
          firstSubscription.apply()
          yield* awaitPhase(
            supervisor.phase,
            (phase) => phase.status === "live" && phase.attempt === 1,
          )

          harness.closeSocketSilently(1)
          page.dispatchEvent(new Event("online"))
          yield* awaitPhase(
            supervisor.phase,
            (phase) => phase.status === "reconnecting" && phase.attempt === 1,
          )
          expect(harness.disconnectCount(1)).toBe(1)

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

  it.effect("retries when a pending subscription is invalidated", () =>
    Effect.gen(function* () {
      const harness = yield* makeSupervisorHarness()

      yield* Effect.gen(function* () {
        const supervisor =
          yield* StdbInternal.makeWsSessionSupervisorFromModulePlan({
            plan,
            config: {
              builder: harness.builder,
              uri,
              databaseName,
              connectDurationMax: 1_000,
            },
            subscriptionTargets: [plan.targets.tables.user],
            policy: {
              reconnectDelayFirst: 100,
              reconnectDelayMax: 1_000,
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
          yield* StdbInternal.makeWsSessionSupervisorFromModulePlan({
            plan,
            config: {
              builder: harness.builder,
              uri,
              databaseName,
              connectDurationMax: 100,
            },
            setup: () => Effect.never,
            policy: {
              reconnectDelayFirst: 100,
              reconnectDelayMax: 1_000,
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

  it.effect("bounds an activation by the default with no timeout set", () =>
    Effect.gen(function* () {
      const harness = yield* makeSupervisorHarness()

      yield* Effect.gen(function* () {
        const supervisor =
          yield* StdbInternal.makeWsSessionSupervisorFromModulePlan({
            plan,
            config: { builder: harness.builder, uri, databaseName },
            setup: () => Effect.never,
            policy: {
              reconnectDelayFirst: 100,
              reconnectDelayMax: 1_000,
              reconnectJitter: false,
            },
          })

        expect(yield* harness.nextBuild).toBe(1)
        yield* TestClock.adjust(connectDurationMaxDefault)
        yield* awaitPhase(
          supervisor.phase,
          (phase) => phase.status === "reconnecting" && phase.attempt === 1,
        )
      }).pipe(Effect.scoped)
    }),
  )

  it.effect("retries when the session disconnects during setup", () =>
    Effect.gen(function* () {
      const harness = yield* makeSupervisorHarness()
      const setupStarted = yield* Deferred.make<void>()

      yield* Effect.gen(function* () {
        const supervisor =
          yield* StdbInternal.makeWsSessionSupervisorFromModulePlan({
            plan,
            config: {
              builder: harness.builder,
              uri,
              databaseName,
              connectDurationMax: 1_000,
            },
            setup: () =>
              Deferred.succeed(setupStarted, undefined).pipe(
                Effect.andThen(Effect.never),
              ),
            policy: {
              reconnectDelayFirst: 100,
              reconnectDelayMax: 1_000,
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
          yield* StdbInternal.makeWsSessionSupervisorFromModulePlan({
            plan,
            config: {
              builder: harness.builder,
              uri,
              databaseName,
              connectDurationMax: 1_000,
            },
            setup: () =>
              Effect.succeed(
                harness.disconnect(1, "closed as setup completed"),
              ),
            policy: {
              reconnectDelayFirst: 100,
              reconnectDelayMax: 1_000,
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
          yield* StdbInternal.makeWsSessionSupervisorFromModulePlan({
            plan,
            config: {
              builder: harness.builder,
              uri,
              databaseName,
              connectDurationMax: 1_000,
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
            StdbInternal.WsSessionSupervisorFatalError.is(fatal.failure),
          ).toBe(true)
          if (StdbInternal.WsSessionSupervisorFatalError.is(fatal.failure)) {
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
          yield* StdbInternal.makeWsSessionSupervisorFromModulePlan({
            plan,
            config: {
              builder: harness.builder,
              uri,
              databaseName,
              connectDurationMax: 1_000,
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
        const supervisor = yield* StdbInternal.makeWsSessionSupervisorGenerated(
          {
            module: FullModule,
            config: {
              DbConnection: { builder: harness.builder },
              uri,
              databaseName,
              createWebSocket: () => ({}),
              connectDurationMax: 1_000,
            },
          },
        )

        const fatal = yield* awaitPhase(
          supervisor.phase,
          (phase) => phase.status === "fatal",
        )
        expect(fatal.attempt).toBe(1)
        expect(fatal.status).toBe("fatal")
        if (fatal.status === "fatal") {
          expect(StdbInternal.WsConnectError.is(fatal.failure)).toBe(true)
          if (StdbInternal.WsConnectError.is(fatal.failure)) {
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
          yield* StdbInternal.makeWsSessionSupervisorFromModulePlan({
            plan,
            config: {
              builder: harness.builder,
              uri,
              databaseName,
              createWebSocket: () => ({}),
              connectDurationMax: 1_000,
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
          expect(StdbInternal.WsConnectError.is(fatal.failure)).toBe(true)
          if (StdbInternal.WsConnectError.is(fatal.failure)) {
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
          yield* StdbInternal.makeWsSessionSupervisorFromModulePlan({
            plan,
            config: {
              builder: harness.builder,
              uri,
              databaseName,
              connectDurationMax: 1_000,
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
            yield* StdbInternal.makeWsSessionSupervisorFromModulePlan({
              plan,
              config: {
                builder: harness.builder,
                uri,
                databaseName,
                connectDurationMax: 1_000,
              },
              policy: {
                reconnectDelayFirst: 100,
                reconnectDelayMax: 1_000,
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
              StdbInternal.ConnectionLostError.is(reconnecting.failure),
          ).toBe(true)
          if (
            reconnecting.status === "reconnecting" &&
            StdbInternal.ConnectionLostError.is(reconnecting.failure)
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
