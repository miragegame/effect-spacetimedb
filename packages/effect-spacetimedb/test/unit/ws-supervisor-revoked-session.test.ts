import * as EffectVitest from "@effect/vitest"
import * as Data from "effect/Data"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Scheduler from "effect/Scheduler"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as TestClock from "effect/testing/TestClock"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import * as Atom from "effect/reactivity/Atom"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"
import {
  ConnectionIdentityChangedError,
  ConnectionLostError,
  SubscriptionInvalidatedError,
  WsConnectError,
  WsConnectTimeoutError,
  WsSessionSupervisorFatalError,
} from "effect-spacetimedb/client"
import {
  wsSupervisedSessionAtom,
  wsTableGroupAtomFamily,
  wsTableGroupSnapshotAtom,
} from "effect-spacetimedb/client/atom"
import * as StdbInternal from "effect-spacetimedb/testing/internal"
import { Identity, IdentityChangedError } from "spacetimedb"
import { connectionStateFor } from "../../src/client/connection-state.ts"
import { TestLayer } from "../helpers/test-layer"
import {
  awaitPhase,
  connectDurationMax,
  makeReconnectHarness,
  plan,
  reconnectConfig,
  recoveringReport,
} from "../helpers/ws-reconnect-harness"

const { expect } = EffectVitest
const describe = EffectVitest.layer(TestLayer)

/** More scheduler ticks than a reconnect takes to publish its session. */
const revocationSweepTicks = 8
/**
 * Fibers yield after this many operations: low enough to yield inside a
 * publication, where much lower and setup itself cannot finish between yields.
 * A hook moves the publication against the yields, so the sweep has both.
 */
const revocationSweep = [8, 16].flatMap((opsMax) =>
  [undefined, () => Effect.void].flatMap((onAutomaticReconnect) =>
    Array.from({ length: revocationSweepTicks }, (_, ticks) => ({
      opsMax,
      onAutomaticReconnect,
      ticks,
    })),
  ),
)

class TokenUnavailable extends Data.TaggedError("TokenUnavailable") {}

const fastPolicy = {
  reconnectDelayFirst: 100,
  reconnectDelayMax: 1_000,
  reconnectJitter: false,
}

/** A drop the SDK will not retry, which ends the session as `lost`. */
const closedReport = { error: new Error("WebSocket closed (code 1008)") }

const tokenThen = (next: Effect.Effect<string, TokenUnavailable>) => {
  let evaluations = 0
  return Effect.suspend(() => {
    evaluations += 1
    return evaluations === 1 ? Effect.succeed("token-1") : next
  })
}

const readableSession = <Session, Failure>(supervisor: {
  readonly session: SubscriptionRef.SubscriptionRef<
    AsyncResult.AsyncResult<Session, Failure>
  >
}) => supervisor.session.pipe(SubscriptionRef.getUnsafe, AsyncResult.value)

const awaitRef = <A>(
  ref: SubscriptionRef.SubscriptionRef<A>,
  predicate: (value: A) => boolean,
) =>
  SubscriptionRef.changes(ref).pipe(
    Stream.filter(predicate),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
  )

const awaitAtom = <A>(
  registry: AtomRegistry.AtomRegistry,
  atom: Atom.Atom<A>,
  predicate: (value: A) => boolean,
) =>
  AtomRegistry.toStream(registry, atom).pipe(
    Stream.filter(predicate),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
  )

const hasRows = <A, E>(value: AsyncResult.AsyncResult<A, E>) =>
  value.pipe(AsyncResult.value, Option.isSome)

const invalidationKindOf = (value: AsyncResult.AsyncResult<unknown, unknown>) =>
  AsyncResult.error(value).pipe(
    Option.filter(SubscriptionInvalidatedError.is),
    Option.map((error) => error.kind),
  )

const failedWith =
  (status: "reconnecting" | "fatal", matches: (failure: unknown) => boolean) =>
  (phase: StdbInternal.WsSessionSupervisorPhase<unknown>) =>
    phase.status === status && matches(phase.failure)

const connectCauseIs =
  (matches: (cause: unknown) => boolean) => (failure: unknown) =>
    WsConnectError.is(failure) && matches(failure.cause)

/** A connection with no token: the server mints a new identity for each. */
const newIdentityPerConnection = (build: number) => new Identity(BigInt(build))

const isLive = <A, E>(value: AsyncResult.AsyncResult<A, E>) =>
  AsyncResult.isSuccess(value) && !value.waiting

const isRetrying = <A, E>(value: AsyncResult.AsyncResult<A, E>) => value.waiting

const sessionIn = <A, E>(value: AsyncResult.AsyncResult<A, E>) =>
  Option.match(AsyncResult.value(value), {
    onNone: () => Effect.die("no session is live"),
    onSome: Effect.succeed,
  })

const registryIn = Effect.acquireRelease(
  Effect.suspend(() => Effect.succeed(AtomRegistry.make())),
  (registry) => Effect.succeed(registry.dispose()),
)

/** Every value an atom takes while the test runs. */
const recordedResults = Effect.fn(function* (
  registry: AtomRegistry.AtomRegistry,
  atom: Atom.Atom<AsyncResult.AsyncResult<unknown, unknown>>,
) {
  const results: Array<AsyncResult.AsyncResult<unknown, unknown>> = []
  const unsubscribe = registry.subscribe(
    atom,
    (result) => {
      results.push(result)
    },
    { immediate: true },
  )
  yield* Effect.addFinalizer(() => Effect.succeed(unsubscribe()))
  return results
})

describe("a supervised session that ended", (it) => {
  it.effect("is gone once a reconnect changes its identity", () =>
    Effect.gen(function* () {
      const harness = yield* makeReconnectHarness()
      const supervisor =
        yield* StdbInternal.makeWsSessionSupervisorFromModulePlan({
          plan,
          config: reconnectConfig(harness),
          policy: fastPolicy,
        })
      yield* awaitPhase(supervisor.phase, (phase) => phase.status === "live")
      expect(Option.isSome(readableSession(supervisor))).toBe(true)

      harness.drop(1, recoveringReport)
      harness.attemptFailed(1, { error: new IdentityChangedError() })
      yield* awaitPhase(supervisor.phase, (phase) => phase.status === "fatal")

      expect(readableSession(supervisor)).toEqual(Option.none())
      expect(
        AsyncResult.isFailure(SubscriptionRef.getUnsafe(supervisor.session)),
      ).toBe(true)
    }).pipe(Effect.scoped),
  )

  it.effect(
    "is not brought back by a reconnect that finishes as it is revoked",
    () =>
      Effect.forEach(
        revocationSweep,
        ({ opsMax, onAutomaticReconnect, ticks }) =>
          Effect.gen(function* () {
            const harness = yield* makeReconnectHarness()
            const supervisor =
              yield* StdbInternal.makeWsSessionSupervisorFromModulePlan({
                plan,
                config: reconnectConfig(harness),
                policy: fastPolicy,
                onAutomaticReconnect,
              })
            yield* awaitPhase(
              supervisor.phase,
              (phase) => phase.status === "live",
            )
            harness.drop(1, recoveringReport)
            yield* awaitPhase(
              supervisor.phase,
              (phase) => phase.status === "recovering",
            )
            // Everything a reader sees, up to the parked session, which is the
            // only one that is not waiting for anything.
            const watching = yield* Deferred.make<void>()
            const shown = yield* SubscriptionRef.changes(
              supervisor.session,
            ).pipe(
              Stream.tap(() => Deferred.succeed(watching, undefined)),
              Stream.takeUntil(
                (value) => AsyncResult.isFailure(value) && !value.waiting,
              ),
              Stream.runCollect,
              Effect.forkChild,
            )
            yield* Deferred.await(watching)

            harness.reconnect(1)
            yield* Effect.forEach(
              Array.from({ length: ticks }),
              () => Effect.yieldNow,
              { discard: true },
            )
            harness.drop(1, recoveringReport)
            harness.attemptFailed(1, { error: new IdentityChangedError() })

            // Settling is not enough: a reader must never see the rows come back,
            // even for a moment, because they may be another identity's.
            const showing = (yield* Fiber.join(shown)).map(hasRows)
            expect(showing.slice(showing.indexOf(false))).not.toContain(true)
            expect(readableSession(supervisor)).toEqual(Option.none())
          }).pipe(
            Effect.scoped,
            // Fibers yield often enough that, across the sweep, the revocation
            // lands at each point of the publication in turn.
            Effect.provideService(Scheduler.MaxOpsBeforeYield, opsMax),
          ),
        { discard: true },
      ),
  )

  it.effect("is gone if it is revoked while its attempt closes", () =>
    Effect.gen(function* () {
      const closing = yield* Deferred.make<void>()
      const closed = yield* Deferred.make<void>()
      const harness = yield* makeReconnectHarness({
        connectFailures: new Map([[2, new Error("connection refused")]]),
      })
      const supervisor =
        yield* StdbInternal.makeWsSessionSupervisorFromModulePlan({
          plan,
          config: reconnectConfig(harness),
          policy: fastPolicy,
          // The hook's failure ends the attempt, so nothing is left watching the
          // session, and this finalizer holds its connection open meanwhile.
          setup: () =>
            Effect.addFinalizer(() =>
              Deferred.succeed(closing, undefined).pipe(
                Effect.andThen(Deferred.await(closed)),
              ),
            ),
          onAutomaticReconnect: () => Effect.fail(new TokenUnavailable()),
        })
      yield* awaitPhase(supervisor.phase, (phase) => phase.status === "live")
      harness.drop(1, recoveringReport)
      yield* awaitPhase(
        supervisor.phase,
        (phase) => phase.status === "recovering",
      )

      harness.reconnect(1)
      yield* Deferred.await(closing)
      harness.drop(1, recoveringReport)
      harness.attemptFailed(1, { error: new IdentityChangedError() })
      yield* Deferred.succeed(closed, undefined)
      yield* awaitPhase(
        supervisor.phase,
        (phase) => phase.status === "reconnecting" && phase.attempt === 1,
      )
      expect(readableSession(supervisor)).toEqual(Option.none())

      // A replacement that only fails to connect brings nothing back.
      yield* TestClock.adjust(Duration.millis(100))
      yield* awaitPhase(
        supervisor.phase,
        (phase) => phase.status === "reconnecting" && phase.attempt === 2,
      )
      expect(readableSession(supervisor)).toEqual(Option.none())
    }).pipe(Effect.scoped),
  )

  it.effect("stays gone in `fatal` if it is revoked as its attempt dies", () =>
    Effect.gen(function* () {
      const closing = yield* Deferred.make<void>()
      const closed = yield* Deferred.make<void>()
      const harness = yield* makeReconnectHarness()
      const supervisor =
        yield* StdbInternal.makeWsSessionSupervisorFromModulePlan({
          plan,
          config: reconnectConfig(harness),
          policy: fastPolicy,
          setup: () =>
            Effect.addFinalizer(() =>
              Deferred.succeed(closing, undefined).pipe(
                Effect.andThen(Deferred.await(closed)),
              ),
            ),
          onAutomaticReconnect: () => Effect.die("the hook is broken"),
        })
      yield* awaitPhase(supervisor.phase, (phase) => phase.status === "live")
      harness.drop(1, recoveringReport)
      yield* awaitPhase(
        supervisor.phase,
        (phase) => phase.status === "recovering",
      )

      harness.reconnect(1)
      yield* Deferred.await(closing)
      harness.drop(1, recoveringReport)
      harness.attemptFailed(1, { error: new IdentityChangedError() })
      yield* Deferred.succeed(closed, undefined)
      yield* awaitPhase(supervisor.phase, (phase) => phase.status === "fatal")

      expect(readableSession(supervisor)).toEqual(Option.none())
    }).pipe(Effect.scoped),
  )

  it.effect("is gone while a failed token refresh is retried", () =>
    Effect.gen(function* () {
      const harness = yield* makeReconnectHarness()
      let refreshes = 0
      const supervisor =
        yield* StdbInternal.makeWsSessionSupervisorFromModulePlan({
          plan,
          config: reconnectConfig(harness, {
            token: tokenThen(
              Effect.suspend(() => {
                refreshes += 1
                return refreshes === 1
                  ? Effect.fail(new TokenUnavailable())
                  : Effect.succeed("token-2")
              }),
            ),
          }),
          policy: fastPolicy,
        })
      yield* awaitPhase(supervisor.phase, (phase) => phase.status === "live")
      const [refresh] = harness.tokenProviders()
      if (refresh === undefined) {
        return yield* Effect.die("the SDK received no token refresh")
      }

      harness.drop(1, recoveringReport)
      yield* Effect.promise(() => refresh().catch(() => undefined))
      yield* awaitPhase(
        supervisor.phase,
        (phase) => phase.status === "reconnecting",
      )
      expect(readableSession(supervisor)).toEqual(Option.none())

      yield* TestClock.adjust(Duration.millis(100))
      yield* awaitPhase(
        supervisor.phase,
        (phase) => phase.status === "live" && phase.attempt === 2,
      )
      expect(Option.isSome(readableSession(supervisor))).toBe(true)
    }).pipe(Effect.scoped),
  )

  it.effect("is gone once a token refresh dies", () =>
    Effect.gen(function* () {
      const harness = yield* makeReconnectHarness()
      const supervisor =
        yield* StdbInternal.makeWsSessionSupervisorFromModulePlan({
          plan,
          config: reconnectConfig(harness, {
            token: tokenThen(Effect.die("storage corrupt")),
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
      yield* awaitPhase(supervisor.phase, (phase) => phase.status === "fatal")

      expect(readableSession(supervisor)).toEqual(Option.none())
    }).pipe(Effect.scoped),
  )

  it.effect("stays readable through an ordinary loss", () =>
    Effect.gen(function* () {
      const harness = yield* makeReconnectHarness()
      const supervisor =
        yield* StdbInternal.makeWsSessionSupervisorFromModulePlan({
          plan,
          config: reconnectConfig(harness),
          policy: fastPolicy,
        })
      yield* awaitPhase(supervisor.phase, (phase) => phase.status === "live")
      const live = readableSession(supervisor)

      harness.drop(1, { error: new Error("WebSocket closed (code 1008)") })
      yield* awaitPhase(
        supervisor.phase,
        (phase) => phase.status === "reconnecting",
      )

      expect(Option.isSome(live)).toBe(true)
      expect(readableSession(supervisor)).toEqual(live)
    }).pipe(Effect.scoped),
  )

  it.effect("stays readable when an ordinary loss parks the supervisor", () =>
    Effect.gen(function* () {
      const harness = yield* makeReconnectHarness()
      const supervisor =
        yield* StdbInternal.makeWsSessionSupervisorFromModulePlan({
          plan,
          config: reconnectConfig(harness),
          policy: { ...fastPolicy, isRetryable: () => false },
        })
      yield* awaitPhase(supervisor.phase, (phase) => phase.status === "live")

      harness.drop(1, { error: new Error("WebSocket closed (code 1008)") })
      yield* awaitPhase(supervisor.phase, (phase) => phase.status === "fatal")

      expect(Option.isSome(readableSession(supervisor))).toBe(true)
    }).pipe(Effect.scoped),
  )

  it.effect(
    "tells its observers of an identity change once it is revoked",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeReconnectHarness()
        const supervisor =
          yield* StdbInternal.makeWsSessionSupervisorFromModulePlan({
            plan,
            config: reconnectConfig(harness),
            policy: fastPolicy,
          })
        yield* awaitPhase(supervisor.phase, (phase) => phase.status === "live")
        const live = yield* Option.match(readableSession(supervisor), {
          onNone: () => Effect.die("no session is live"),
          onSome: Effect.succeed,
        })
        const observed: Array<{
          readonly kind: string
          readonly revoked: boolean
        }> = []
        yield* live.observeInvalidation((invalidation) => {
          observed.push({ kind: invalidation.kind, revoked: live.isRevoked() })
        })

        harness.drop(1, recoveringReport)
        harness.attemptFailed(1, { error: new IdentityChangedError() })
        yield* awaitPhase(supervisor.phase, (phase) => phase.status === "fatal")

        expect(observed).toEqual([{ kind: "identityChanged", revoked: true }])
      }).pipe(Effect.scoped),
  )

  it.effect("leaves nothing readable through its atoms", () =>
    Effect.gen(function* () {
      const harness = yield* makeReconnectHarness()
      const sessions = wsSupervisedSessionAtom(
        StdbInternal.makeWsSessionSupervisorFromModulePlan({
          plan,
          config: reconnectConfig(harness),
          policy: fastPolicy,
        }),
      )
      const snapshots = wsTableGroupSnapshotAtom(sessions, ["user"] as const)
      const registry = AtomRegistry.make()
      yield* Effect.addFinalizer(() => Effect.succeed(registry.dispose()))
      const watch = Effect.fn(function* (
        atom: Atom.Atom<AsyncResult.AsyncResult<unknown, unknown>>,
      ) {
        const results =
          yield* Queue.unbounded<AsyncResult.AsyncResult<unknown, unknown>>()
        const unsubscribe = registry.subscribe(
          atom,
          (result) => {
            Queue.offerUnsafe(results, result)
          },
          { immediate: true },
        )
        yield* Effect.addFinalizer(() => Effect.succeed(unsubscribe()))
        return results
      })
      const sessionResults = yield* watch(sessions)
      const snapshotResults = yield* watch(snapshots)
      const takeUntil = Effect.fn(function* (
        results: Queue.Queue<AsyncResult.AsyncResult<unknown, unknown>>,
        predicate: (
          result: AsyncResult.AsyncResult<unknown, unknown>,
        ) => boolean,
      ) {
        while (true) {
          const result = yield* Queue.take(results)
          if (predicate(result)) {
            return result
          }
        }
      })

      const subscription = yield* harness.nextSubscription
      subscription.apply()
      yield* takeUntil(snapshotResults, AsyncResult.isSuccess)

      harness.drop(1, recoveringReport)
      harness.attemptFailed(1, { error: new IdentityChangedError() })
      const session = yield* takeUntil(sessionResults, (result) =>
        AsyncResult.isFailure(result),
      )
      const snapshot = yield* takeUntil(snapshotResults, (result) =>
        AsyncResult.isFailure(result),
      )

      expect(AsyncResult.value(session)).toEqual(Option.none())
      expect(AsyncResult.value(snapshot)).toEqual(Option.none())
      expect(AsyncResult.value(registry.get(sessions))).toEqual(Option.none())
      expect(AsyncResult.value(registry.get(snapshots))).toEqual(Option.none())
    }).pipe(Effect.scoped),
  )

  it.effect(
    "keeps its snapshot when an ordinary loss parks the supervisor",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeReconnectHarness()
        const sessions = wsSupervisedSessionAtom(
          StdbInternal.makeWsSessionSupervisorFromModulePlan({
            plan,
            config: reconnectConfig(harness),
            policy: { ...fastPolicy, isRetryable: () => false },
          }),
        )
        const snapshots = wsTableGroupSnapshotAtom(sessions, ["user"] as const)
        const registry = yield* registryIn
        yield* AtomRegistry.mount(registry, snapshots)

        const subscription = yield* harness.nextSubscription
        subscription.apply()
        yield* awaitAtom(registry, snapshots, AsyncResult.isSuccess)

        harness.drop(1, closedReport)
        yield* awaitAtom(registry, sessions, AsyncResult.isFailure)

        expect(hasRows(registry.get(snapshots))).toBe(true)
      }).pipe(Effect.scoped),
  )

  // Kept alive and watched by nothing, so that a read rebuilds it from its last
  // value and never sees the states in between.
  const unwatchedSnapshots = (
    harness: Effect.Success<ReturnType<typeof makeReconnectHarness>>,
    token?: Effect.Effect<string, TokenUnavailable>,
  ) => {
    const sessions = wsSupervisedSessionAtom(
      StdbInternal.makeWsSessionSupervisorFromModulePlan({
        plan,
        config: reconnectConfig(harness, token === undefined ? {} : { token }),
        policy: { ...fastPolicy, isRetryable: () => true },
      }),
    )
    return {
      sessions,
      snapshots: wsTableGroupSnapshotAtom(sessions, ["user"] as const).pipe(
        Atom.keepAlive,
      ),
    }
  }

  it.effect("hands nothing to the session that replaces a revoked one", () =>
    Effect.gen(function* () {
      const harness = yield* makeReconnectHarness()
      const { sessions, snapshots } = unwatchedSnapshots(harness)
      const registry = yield* registryIn
      yield* AtomRegistry.mount(registry, sessions)
      yield* awaitAtom(registry, sessions, AsyncResult.isSuccess)

      registry.get(snapshots)
      const subscription = yield* harness.nextSubscription
      subscription.apply()
      yield* awaitAtom(registry, snapshots, AsyncResult.isSuccess)

      harness.drop(1, recoveringReport)
      harness.attemptFailed(1, { error: new IdentityChangedError() })
      yield* awaitAtom(registry, sessions, AsyncResult.isFailure)
      yield* TestClock.adjust(Duration.millis(100))
      yield* harness.nextBuild
      yield* awaitAtom(registry, sessions, AsyncResult.isSuccess)

      expect(hasRows(registry.get(snapshots))).toBe(false)
    }).pipe(Effect.scoped),
  )

  it.effect("hands its rows to the session that replaces it after a loss", () =>
    Effect.gen(function* () {
      const harness = yield* makeReconnectHarness()
      const { sessions, snapshots } = unwatchedSnapshots(harness)
      const registry = yield* registryIn
      yield* AtomRegistry.mount(registry, sessions)
      yield* awaitAtom(registry, sessions, AsyncResult.isSuccess)

      registry.get(snapshots)
      const subscription = yield* harness.nextSubscription
      subscription.apply()
      yield* awaitAtom(registry, snapshots, AsyncResult.isSuccess)

      harness.drop(1, closedReport)
      yield* TestClock.adjust(Duration.millis(100))
      yield* harness.nextBuild
      yield* awaitAtom(
        registry,
        sessions,
        (result) => AsyncResult.isSuccess(result) && !result.waiting,
      )

      const carried = registry.get(snapshots)
      expect(hasRows(carried)).toBe(true)
      expect(carried.waiting).toBe(true)
    }).pipe(Effect.scoped),
  )

  it.effect("hands nothing to a replacement under another identity", () =>
    Effect.gen(function* () {
      const harness = yield* makeReconnectHarness({
        identityOf: newIdentityPerConnection,
      })
      const { sessions, snapshots } = unwatchedSnapshots(harness)
      const registry = yield* registryIn
      yield* AtomRegistry.mount(registry, sessions)
      yield* awaitAtom(registry, sessions, AsyncResult.isSuccess)

      registry.get(snapshots)
      const subscription = yield* harness.nextSubscription
      subscription.apply()
      yield* awaitAtom(registry, snapshots, AsyncResult.isSuccess)

      harness.drop(1, closedReport)
      yield* TestClock.adjust(Duration.millis(100))
      yield* awaitAtom(registry, sessions, isLive)

      expect(hasRows(registry.get(snapshots))).toBe(false)
    }).pipe(Effect.scoped),
  )

  // Rows from the first session, then a replacement under the same identity that
  // nothing reads, so the snapshot still names the first session.
  const snapshotSkippingASession = Effect.fn(function* (
    harness: Effect.Success<ReturnType<typeof makeReconnectHarness>>,
    token?: Effect.Effect<string, TokenUnavailable>,
  ) {
    const { sessions, snapshots } = unwatchedSnapshots(harness, token)
    const registry = yield* registryIn
    yield* AtomRegistry.mount(registry, sessions)
    yield* awaitAtom(registry, sessions, AsyncResult.isSuccess)

    registry.get(snapshots)
    const subscription = yield* harness.nextSubscription
    subscription.apply()
    yield* awaitAtom(registry, snapshots, AsyncResult.isSuccess)

    harness.drop(1, closedReport)
    yield* TestClock.adjust(Duration.millis(100))
    yield* awaitAtom(registry, sessions, isLive)
    return { registry, sessions, snapshots }
  })

  it.effect(
    "hands nothing over a skipped session once a later token fails",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeReconnectHarness()
        let tokens = 0
        const { registry, sessions, snapshots } =
          yield* snapshotSkippingASession(
            harness,
            Effect.suspend(() => {
              tokens += 1
              return tokens === 3
                ? Effect.fail(new TokenUnavailable())
                : Effect.succeed(`token-${tokens.toString()}`)
            }),
          )

        harness.drop(2, closedReport)
        yield* TestClock.adjust(Duration.millis(100))
        yield* awaitAtom(registry, sessions, AsyncResult.isFailure)
        yield* TestClock.adjust(Duration.millis(200))
        yield* awaitAtom(registry, sessions, isLive)

        expect(hasRows(registry.get(snapshots))).toBe(false)
      }).pipe(Effect.scoped),
  )

  it.effect(
    "hands nothing over a skipped session once a later reconnect changes identity",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeReconnectHarness()
        const { registry, sessions, snapshots } =
          yield* snapshotSkippingASession(harness)

        harness.drop(2, recoveringReport)
        harness.attemptFailed(2, { error: new IdentityChangedError() })
        yield* awaitAtom(registry, sessions, AsyncResult.isFailure)
        yield* TestClock.adjust(Duration.millis(100))
        yield* awaitAtom(registry, sessions, isLive)

        expect(hasRows(registry.get(snapshots))).toBe(false)
      }).pipe(Effect.scoped),
  )

  it.effect("hands its rows on through every session of one identity", () =>
    Effect.gen(function* () {
      const harness = yield* makeReconnectHarness()
      const { registry, sessions, snapshots } =
        yield* snapshotSkippingASession(harness)

      harness.drop(2, closedReport)
      yield* TestClock.adjust(Duration.millis(100))
      yield* awaitAtom(registry, sessions, isLive)

      const carried = registry.get(snapshots)
      expect(hasRows(carried)).toBe(true)
      expect(carried.waiting).toBe(true)
    }).pipe(Effect.scoped),
  )

  // Rows from the first session, then a replacement under the same identity that
  // subscribes and drops before its subscription applies.
  const snapshotOverAFailedReplacement = Effect.fn(function* (
    harness: Effect.Success<ReturnType<typeof makeReconnectHarness>>,
  ) {
    const { sessions, snapshots } = unwatchedSnapshots(harness)
    const registry = yield* registryIn
    yield* AtomRegistry.mount(registry, snapshots)
    const subscription = yield* harness.nextSubscription
    subscription.apply()
    yield* awaitAtom(registry, snapshots, AsyncResult.isSuccess)

    harness.drop(1, closedReport)
    yield* TestClock.adjust(Duration.millis(100))
    const replacement = yield* sessionIn(
      yield* awaitAtom(registry, sessions, isLive),
    )
    yield* harness.nextSubscription

    harness.drop(2, closedReport)
    yield* awaitAtom(
      registry,
      wsTableGroupAtomFamily(replacement)(["user"] as const),
      AsyncResult.isFailure,
    )
    return { registry, sessions, snapshots }
  })

  it.effect(
    "keeps the rows when a replacement fails before its first apply",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeReconnectHarness()
        const { registry, sessions, snapshots } =
          yield* snapshotOverAFailedReplacement(harness)

        const failed = registry.get(snapshots)
        expect(hasRows(failed)).toBe(true)
        expect(invalidationKindOf(failed)).toEqual(Option.some("lost"))

        yield* TestClock.adjust(Duration.millis(100))
        yield* awaitAtom(registry, sessions, isLive)
        yield* harness.nextSubscription
        const carried = registry.get(snapshots)
        expect(hasRows(carried)).toBe(true)
        expect(carried.waiting).toBe(true)
      }).pipe(Effect.scoped),
  )

  it.effect(
    "keeps the rows when it first reads a replacement that failed",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeReconnectHarness()
        const { registry, sessions, snapshots } =
          yield* snapshotSkippingASession(harness)
        const replacement = yield* sessionIn(registry.get(sessions))

        harness.drop(2, closedReport)
        yield* awaitAtom(registry, sessions, isRetrying)
        registry.get(snapshots)
        yield* awaitAtom(
          registry,
          wsTableGroupAtomFamily(replacement)(["user"] as const),
          AsyncResult.isFailure,
        )
        expect(hasRows(registry.get(snapshots))).toBe(true)

        yield* TestClock.adjust(Duration.millis(100))
        yield* awaitAtom(registry, sessions, isLive)
        expect(hasRows(registry.get(snapshots))).toBe(true)
      }).pipe(Effect.scoped),
  )

  it.effect(
    "gives up rows a failed replacement kept once they are revoked",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeReconnectHarness({
          identityOf: (build) => new Identity(build < 3 ? 1n : 2n),
        })
        const { registry, sessions, snapshots } =
          yield* snapshotOverAFailedReplacement(harness)
        expect(hasRows(registry.get(snapshots))).toBe(true)

        yield* TestClock.adjust(Duration.millis(100))
        yield* awaitAtom(registry, sessions, isLive)

        expect(hasRows(registry.get(snapshots))).toBe(false)
      }).pipe(Effect.scoped),
  )

  it.effect("carries no failure across a session's first apply", () =>
    Effect.gen(function* () {
      const harness = yield* makeReconnectHarness({
        connectFailures: new Map([[1, new Error("connection refused")]]),
      })
      const { sessions, snapshots } = unwatchedSnapshots(harness)
      const registry = yield* registryIn
      yield* AtomRegistry.mount(registry, snapshots)
      yield* awaitAtom(registry, snapshots, AsyncResult.isFailure)

      yield* TestClock.adjust(Duration.millis(100))
      yield* awaitAtom(registry, sessions, isLive)

      expect(AsyncResult.isInitial(registry.get(snapshots))).toBe(true)
    }).pipe(Effect.scoped),
  )
})

describe("a supervised session replaced under another identity", (it) => {
  const asRead = (result: AsyncResult.AsyncResult<unknown, unknown>) => ({
    lost: AsyncResult.error(result).pipe(Option.exists(ConnectionLostError.is)),
    rows: hasRows(result),
    waiting: result.waiting,
  })

  const superviseWatched = Effect.fn(function* (
    harness: Effect.Success<ReturnType<typeof makeReconnectHarness>>,
    setup?: () => Effect.Effect<void, TokenUnavailable>,
  ) {
    const supervisor =
      yield* StdbInternal.makeWsSessionSupervisorFromModulePlan({
        plan,
        config: reconnectConfig(harness),
        policy: fastPolicy,
        ...(setup === undefined ? {} : { setup }),
      })
    yield* awaitPhase(supervisor.phase, (phase) => phase.status === "live")
    const live = yield* Option.match(readableSession(supervisor), {
      onNone: () => Effect.die("no session is live"),
      onSome: Effect.succeed,
    })
    const rows = yield* live.subscribeTableRef("user")
    const subscription = yield* harness.nextSubscription
    subscription.apply()
    yield* awaitRef(rows, AsyncResult.isSuccess)
    return { supervisor, rows }
  })

  it.effect("loses its rows, and its replacement completes", () =>
    Effect.gen(function* () {
      const harness = yield* makeReconnectHarness({
        identityOf: newIdentityPerConnection,
      })
      const { supervisor, rows } = yield* superviseWatched(harness)

      harness.drop(1, closedReport)
      yield* TestClock.adjust(Duration.millis(100))
      yield* awaitPhase(
        supervisor.phase,
        (phase) => phase.status === "live" && phase.attempt === 2,
      )

      const revoked = yield* awaitRef(rows, (value) => !hasRows(value))
      expect(invalidationKindOf(revoked)).toEqual(
        Option.some("identityChanged"),
      )
      const replacement = readableSession(supervisor)
      expect(
        replacement.pipe(Option.map((session) => session.identity)),
      ).toEqual(Option.some(newIdentityPerConnection(2)))
      expect(harness.tokens()).toEqual([undefined, undefined])
    }).pipe(Effect.scoped),
  )

  it.effect(
    "shows its readers a lost connection, not the error that parks",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeReconnectHarness({
          identityOf: newIdentityPerConnection,
        })
        const activated = yield* Deferred.make<void>()
        let setups = 0
        const { supervisor } = yield* superviseWatched(harness, () =>
          Effect.suspend(() => {
            setups += 1
            return setups === 1 ? Effect.void : Deferred.await(activated)
          }),
        )
        const sessions = wsSupervisedSessionAtom(Effect.succeed(supervisor))
        const snapshots = wsTableGroupSnapshotAtom(sessions, ["user"] as const)
        const registry = yield* registryIn
        const seenBySessions = yield* recordedResults(registry, sessions)
        const seenBySnapshots = yield* recordedResults(registry, snapshots)
        yield* awaitAtom(registry, snapshots, AsyncResult.isSuccess)

        harness.drop(1, closedReport)
        yield* TestClock.adjust(Duration.millis(100))
        const withdrawn = yield* awaitAtom(
          registry,
          sessions,
          AsyncResult.isFailure,
        )
        const lostConnection = { lost: true, rows: false, waiting: true }
        expect(asRead(withdrawn)).toEqual(lostConnection)
        expect(asRead(registry.get(snapshots))).toEqual(lostConnection)

        yield* Deferred.succeed(activated, undefined)
        yield* awaitAtom(registry, sessions, isLive)
        expect(AsyncResult.isInitial(registry.get(snapshots))).toBe(true)
        const replayed = yield* harness.nextSubscription
        replayed.apply()
        yield* awaitAtom(registry, snapshots, isLive)

        const namingAnIdentityChange = [
          ...seenBySessions,
          ...seenBySnapshots,
        ].filter((result) =>
          AsyncResult.error(result).pipe(
            Option.exists(
              (error) =>
                ConnectionIdentityChangedError.is(error) ||
                (WsConnectError.is(error) &&
                  ConnectionIdentityChangedError.is(error.cause)),
            ),
          ),
        )
        expect(namingAnIdentityChange).toEqual([])
      }).pipe(Effect.scoped),
  )

  it.effect("loses its rows even if the replacement's setup fails", () =>
    Effect.gen(function* () {
      const harness = yield* makeReconnectHarness({
        identityOf: newIdentityPerConnection,
      })
      let setups = 0
      const { supervisor, rows } = yield* superviseWatched(harness, () =>
        Effect.suspend(() => {
          setups += 1
          return setups === 1
            ? Effect.void
            : Effect.fail(new TokenUnavailable())
        }),
      )

      harness.drop(1, closedReport)
      yield* TestClock.adjust(Duration.millis(100))
      yield* awaitPhase(
        supervisor.phase,
        (phase) =>
          phase.status === "reconnecting" &&
          phase.failure instanceof TokenUnavailable,
      )

      expect(readableSession(supervisor)).toEqual(Option.none())
      yield* awaitRef(rows, (value) => !hasRows(value))
    }).pipe(Effect.scoped),
  )
})

describe("a snapshot over a connection atom that moves", (it) => {
  type User = "ada" | "bob"

  // An application's read connection: its supervisor follows who is signed in.
  const connectionOf = <A, E>(
    who: Atom.Atom<User | null>,
    sessions: Record<User, Atom.Atom<AsyncResult.AsyncResult<A, E>>>,
  ) =>
    Atom.readable((get): AsyncResult.AsyncResult<A, E> => {
      const user = get(who)
      return user === null
        ? AsyncResult.initial<A, E>(true)
        : get(sessions[user])
    })

  const superviseUser = (
    harness: Effect.Success<ReturnType<typeof makeReconnectHarness>>,
  ) =>
    wsSupervisedSessionAtom(
      StdbInternal.makeWsSessionSupervisorFromModulePlan({
        plan,
        config: reconnectConfig(harness),
        policy: fastPolicy,
      }),
    )

  const snapshotOfAda = Effect.fn(function* () {
    const ada = yield* makeReconnectHarness({
      identityOf: () => new Identity(1n),
    })
    const bob = yield* makeReconnectHarness({
      identityOf: () => new Identity(2n),
    })
    const who = Atom.make<User | null>("ada")
    const sessions = { ada: superviseUser(ada), bob: superviseUser(bob) }
    const snapshots = wsTableGroupSnapshotAtom(connectionOf(who, sessions), [
      "user",
    ] as const)
    const registry = yield* registryIn
    yield* AtomRegistry.mount(registry, snapshots)
    const subscription = yield* ada.nextSubscription
    subscription.apply()
    yield* awaitAtom(registry, snapshots, AsyncResult.isSuccess)
    return { ada, bob, who, sessions, snapshots, registry }
  })

  it.effect("shows another supervisor's session none of the rows", () =>
    Effect.gen(function* () {
      const { bob, who, snapshots, registry } = yield* snapshotOfAda()

      registry.set(who, "bob")
      const subscription = yield* bob.nextSubscription
      expect(hasRows(registry.get(snapshots))).toBe(false)

      subscription.apply()
      yield* awaitAtom(registry, snapshots, isLive)
    }).pipe(Effect.scoped),
  )

  it.effect("shows nothing once there is no session", () =>
    Effect.gen(function* () {
      const { who, snapshots, registry } = yield* snapshotOfAda()

      registry.set(who, null)

      expect(AsyncResult.isInitial(registry.get(snapshots))).toBe(true)
    }).pipe(Effect.scoped),
  )

  it.effect("still carries the rows into a replacement of the same user", () =>
    Effect.gen(function* () {
      const { ada, sessions, snapshots, registry } = yield* snapshotOfAda()

      ada.drop(1, closedReport)
      yield* TestClock.adjust(Duration.millis(100))
      yield* awaitAtom(registry, sessions.ada, isLive)
      const subscription = yield* ada.nextSubscription
      const carried = registry.get(snapshots)
      expect(hasRows(carried)).toBe(true)
      expect(carried.waiting).toBe(true)

      subscription.apply()
      yield* awaitAtom(registry, snapshots, isLive)
    }).pipe(Effect.scoped),
  )

  it.effect("hands a connection without a supervisor's rows to no other", () =>
    Effect.gen(function* () {
      const harness = yield* makeReconnectHarness()
      const first = yield* StdbInternal.makeScopedFromModulePlan({
        plan,
        config: reconnectConfig(harness),
      })
      const second = yield* StdbInternal.makeScopedFromModulePlan({
        plan,
        config: reconnectConfig(harness),
      })
      const connection = Atom.make(
        AsyncResult.success<typeof first, never>(first),
      )
      const snapshots = wsTableGroupSnapshotAtom(connection, ["user"] as const)
      const registry = yield* registryIn
      yield* AtomRegistry.mount(registry, snapshots)
      const subscription = yield* harness.nextSubscription
      subscription.apply()
      yield* awaitAtom(registry, snapshots, AsyncResult.isSuccess)

      registry.set(connection, AsyncResult.success(second))
      yield* harness.nextSubscription

      expect(hasRows(registry.get(snapshots))).toBe(false)
    }).pipe(Effect.scoped),
  )
})

describe("a supervised session whose replacement has no token", (it) => {
  const superviseLive = Effect.fn(function* (
    harness: Effect.Success<ReturnType<typeof makeReconnectHarness>>,
    token: Effect.Effect<string, TokenUnavailable>,
  ) {
    const supervisor =
      yield* StdbInternal.makeWsSessionSupervisorFromModulePlan({
        plan,
        config: reconnectConfig(harness, { token }),
        policy: fastPolicy,
      })
    yield* awaitPhase(supervisor.phase, (phase) => phase.status === "live")
    const live = yield* Option.match(readableSession(supervisor), {
      onNone: () => Effect.die("no session is live"),
      onSome: Effect.succeed,
    })
    const rows = yield* live.subscribeTableRef("user")
    const subscription = yield* harness.nextSubscription
    subscription.apply()
    yield* awaitRef(rows, AsyncResult.isSuccess)

    harness.drop(1, closedReport)
    yield* awaitRef(rows, AsyncResult.isFailure)
    expect(hasRows(SubscriptionRef.getUnsafe(rows))).toBe(true)
    expect(Option.isSome(readableSession(supervisor))).toBe(true)
    yield* TestClock.adjust(Duration.millis(100))
    return { supervisor, rows }
  })

  it.effect("is gone once the token fails, and returns with a token", () =>
    Effect.gen(function* () {
      const harness = yield* makeReconnectHarness()
      let replacements = 0
      const { supervisor, rows } = yield* superviseLive(
        harness,
        tokenThen(
          Effect.suspend(() => {
            replacements += 1
            return replacements === 1
              ? Effect.fail(new TokenUnavailable())
              : Effect.succeed("token-2")
          }),
        ),
      )
      yield* awaitPhase(
        supervisor.phase,
        failedWith(
          "reconnecting",
          connectCauseIs((cause) => cause instanceof TokenUnavailable),
        ),
      )

      expect(readableSession(supervisor)).toEqual(Option.none())
      const revoked = yield* awaitRef(rows, (value) => !hasRows(value))
      expect(invalidationKindOf(revoked)).toEqual(
        Option.some("credentialsFailed"),
      )

      yield* TestClock.adjust(Duration.millis(200))
      yield* awaitPhase(
        supervisor.phase,
        (phase) => phase.status === "live" && phase.attempt === 3,
      )
      expect(Option.isSome(readableSession(supervisor))).toBe(true)
    }).pipe(Effect.scoped),
  )

  it.effect("is gone once the token dies", () =>
    Effect.gen(function* () {
      const harness = yield* makeReconnectHarness()
      const { supervisor, rows } = yield* superviseLive(
        harness,
        tokenThen(Effect.die("storage corrupt")),
      )
      yield* awaitPhase(
        supervisor.phase,
        failedWith("fatal", WsSessionSupervisorFatalError.is),
      )

      expect(readableSession(supervisor)).toEqual(Option.none())
      const revoked = yield* awaitRef(rows, (value) => !hasRows(value))
      expect(invalidationKindOf(revoked)).toEqual(
        Option.some("credentialsDefect"),
      )
    }).pipe(Effect.scoped),
  )

  it.effect("is gone once the token overruns its attempt", () =>
    Effect.gen(function* () {
      const harness = yield* makeReconnectHarness()
      const { supervisor, rows } = yield* superviseLive(
        harness,
        tokenThen(Effect.never),
      )
      yield* TestClock.adjust(Duration.millis(connectDurationMax))
      yield* awaitPhase(
        supervisor.phase,
        failedWith("reconnecting", connectCauseIs(WsConnectTimeoutError.is)),
      )

      expect(readableSession(supervisor)).toEqual(Option.none())
      yield* awaitRef(rows, (value) => !hasRows(value))
    }).pipe(Effect.scoped),
  )

  it.effect("takes the rows of a session already replaced", () =>
    Effect.gen(function* () {
      const harness = yield* makeReconnectHarness()
      let tokens = 0
      const { supervisor, rows } = yield* superviseLive(
        harness,
        Effect.suspend(() => {
          tokens += 1
          return tokens === 3
            ? Effect.fail(new TokenUnavailable())
            : Effect.succeed(`token-${tokens.toString()}`)
        }),
      )
      yield* awaitPhase(
        supervisor.phase,
        (phase) => phase.status === "live" && phase.attempt === 2,
      )
      expect(hasRows(SubscriptionRef.getUnsafe(rows))).toBe(true)

      harness.drop(2, closedReport)
      yield* TestClock.adjust(Duration.millis(200))
      yield* awaitPhase(
        supervisor.phase,
        failedWith(
          "reconnecting",
          connectCauseIs((cause) => cause instanceof TokenUnavailable),
        ),
      )

      const revoked = yield* awaitRef(rows, (value) => !hasRows(value))
      expect(invalidationKindOf(revoked)).toEqual(
        Option.some("credentialsFailed"),
      )
    }).pipe(Effect.scoped),
  )

  it.effect("stays readable when the replacement only fails to connect", () =>
    Effect.gen(function* () {
      const refused = new Error("connection refused")
      const harness = yield* makeReconnectHarness({
        connectFailures: new Map([[2, refused]]),
      })
      const { supervisor, rows } = yield* superviseLive(
        harness,
        Effect.succeed("token"),
      )
      yield* awaitPhase(
        supervisor.phase,
        failedWith(
          "reconnecting",
          connectCauseIs((cause) => cause === refused),
        ),
      )

      expect(Option.isSome(readableSession(supervisor))).toBe(true)
      const value = SubscriptionRef.getUnsafe(rows)
      expect(hasRows(value)).toBe(true)
      expect(invalidationKindOf(value)).toEqual(Option.some("lost"))
    }).pipe(Effect.scoped),
  )
})

EffectVitest.describe("a row lineage", () => {
  EffectVitest.it("hears of a connection revoked before it joined", () => {
    const earlier = connectionStateFor({})
    const joining = connectionStateFor({})
    joining.invalidateForIdentityChange("reconnected as someone else")

    joining.joinRowLineage(earlier.rowLineage())

    expect(joining.isRevoked()).toBe(true)
    expect(earlier.isRevoked()).toBe(true)
  })
})
