import * as EffectVitest from "@effect/vitest"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as TestClock from "effect/testing/TestClock"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import {
  callDurationMaxDefault,
  ConnectionLostError,
} from "effect-spacetimedb/client"
import * as StdbInternal from "effect-spacetimedb/testing/internal"
import { FullModule, UserId } from "../fixtures/full-module"
import { TestLayer } from "../helpers/test-layer"
import {
  awaitPhase,
  makeReconnectHarness,
  plan,
  reconnectConfig,
  upsert,
} from "../helpers/ws-reconnect-harness"
import { makeFullModuleWsConnection } from "../helpers/ws-fixtures"

const { expect } = EffectVitest
const describe = EffectVitest.layer(TestLayer)

const callDurationMaxMillis = 5_000
const callDurationMax = Duration.millis(callDurationMaxMillis)

const expectConnectionLost = (failure: unknown) => {
  expect(ConnectionLostError.is(failure)).toBe(true)
}

describe("ws call duration bound", (it) => {
  it.effect("ends the connection of a reducer call nobody answers", () =>
    Effect.gen(function* () {
      const harness = yield* makeReconnectHarness()
      const session = yield* StdbInternal.makeScopedFromModulePlan({
        plan,
        config: reconnectConfig(harness, { callDurationMax }),
      })
      harness.at(1).holdCalls()
      const call = yield* session.reducers
        .userUpsert(upsert)
        .pipe(Effect.flip, Effect.forkChild)
      yield* harness.nextHeldCall

      yield* TestClock.adjust(Duration.millis(callDurationMaxMillis - 1))
      expect(call.pollUnsafe()).toBeUndefined()
      expect(session.isInvalidated()).toBe(false)
      expect(harness.at(1).disconnectCount()).toBe(0)

      yield* TestClock.adjust(Duration.millis(1))
      const failure = yield* Fiber.join(call)
      expectConnectionLost(failure)
      expect(session.isInvalidated()).toBe(true)
      expect(harness.at(1).disconnectCount()).toBe(1)

      // The session has ended: the next call fails without reaching the SDK.
      const sent = harness.at(1).reducerCallCount()
      expectConnectionLost(
        yield* session.reducers.userUpsert(upsert).pipe(Effect.flip),
      )
      expect(harness.at(1).reducerCallCount()).toBe(sent)
    }).pipe(Effect.scoped),
  )

  it.effect("bounds a connection the SDK does not reconnect", () =>
    Effect.gen(function* () {
      const harness = yield* makeReconnectHarness()
      const session = yield* StdbInternal.makeScopedFromModulePlan({
        plan,
        config: reconnectConfig(harness, {
          callDurationMax,
          automaticReconnect: undefined,
        }),
      })
      harness.at(1).holdCalls()
      const call = yield* session.reducers
        .userUpsert(upsert)
        .pipe(Effect.flip, Effect.forkChild)
      yield* harness.nextHeldCall

      yield* TestClock.adjust(callDurationMax)
      expectConnectionLost(yield* Fiber.join(call))
      expect(harness.at(1).disconnectCount()).toBe(1)
    }).pipe(Effect.scoped),
  )

  it.effect("bounds a procedure call the same way", () =>
    Effect.gen(function* () {
      const harness = yield* makeReconnectHarness()
      const session = yield* StdbInternal.makeScopedFromModulePlan({
        plan,
        config: reconnectConfig(harness, { callDurationMax }),
      })
      harness.at(1).holdCalls()
      const call = yield* session.procedures
        .userGet({ userId: UserId.make("user-1") })
        .pipe(Effect.flip, Effect.forkChild)
      yield* harness.nextHeldCall

      yield* TestClock.adjust(callDurationMax)
      expectConnectionLost(yield* Fiber.join(call))
      expect(session.isInvalidated()).toBe(true)
    }).pipe(Effect.scoped),
  )

  it.effect("takes every other call on the connection down with it", () =>
    Effect.gen(function* () {
      const harness = yield* makeReconnectHarness()
      const session = yield* StdbInternal.makeScopedFromModulePlan({
        plan,
        config: reconnectConfig(harness, { callDurationMax }),
      })
      harness.at(1).holdCalls()
      const first = yield* session.reducers
        .userUpsert(upsert)
        .pipe(Effect.flip, Effect.forkChild)
      yield* harness.nextHeldCall
      yield* TestClock.adjust(Duration.millis(callDurationMaxMillis / 2))
      const second = yield* session.reducers
        .userUpsert(upsert)
        .pipe(Effect.flip, Effect.forkChild)
      yield* harness.nextHeldCall

      yield* TestClock.adjust(Duration.millis(callDurationMaxMillis / 2))
      expectConnectionLost(yield* Fiber.join(first))
      expectConnectionLost(yield* Fiber.join(second))
      expect(harness.at(1).disconnectCount()).toBe(1)
    }).pipe(Effect.scoped),
  )

  it.effect("leaves a connection whose calls were answered alone", () =>
    Effect.gen(function* () {
      const harness = yield* makeReconnectHarness()
      const session = yield* StdbInternal.makeScopedFromModulePlan({
        plan,
        config: reconnectConfig(harness, { callDurationMax }),
      })

      yield* session.reducers.userUpsert(upsert)
      yield* TestClock.adjust(Duration.times(callDurationMax, 2))

      expect(session.isInvalidated()).toBe(false)
      expect(harness.at(1).disconnectCount()).toBe(0)
    }).pipe(Effect.scoped),
  )

  it.effect("leaves the connection alone when its caller gives up first", () =>
    Effect.gen(function* () {
      const harness = yield* makeReconnectHarness()
      const session = yield* StdbInternal.makeScopedFromModulePlan({
        plan,
        config: reconnectConfig(harness, { callDurationMax }),
      })
      harness.at(1).holdCalls()
      const call = yield* session.reducers
        .userUpsert(upsert)
        .pipe(Effect.forkChild)
      yield* harness.nextHeldCall

      yield* Fiber.interrupt(call)
      yield* TestClock.adjust(callDurationMax)

      expect(session.isInvalidated()).toBe(false)
      expect(harness.at(1).disconnectCount()).toBe(0)
    }).pipe(Effect.scoped),
  )

  it.effect(
    "keeps an unanswered call and its connection live with Duration.infinity",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeReconnectHarness()
        const session = yield* StdbInternal.makeScopedFromModulePlan({
          plan,
          config: reconnectConfig(harness, {
            callDurationMax: Duration.infinity,
          }),
        })
        harness.at(1).holdCalls()
        const call = yield* session.reducers
          .userUpsert(upsert)
          .pipe(Effect.forkChild)
        yield* harness.nextHeldCall
        yield* TestClock.adjust(Duration.minutes(1))
        expect(call.pollUnsafe()).toBeUndefined()
        expect(session.isInvalidated()).toBe(false)
        yield* Fiber.interrupt(call)
      }).pipe(Effect.scoped),
  )

  it.effect("defaults to callDurationMaxDefault", () =>
    Effect.gen(function* () {
      const harness = yield* makeReconnectHarness()
      const session = yield* StdbInternal.makeScopedFromModulePlan({
        plan,
        config: reconnectConfig(harness),
      })
      harness.at(1).holdCalls()
      const call = yield* session.reducers
        .userUpsert(upsert)
        .pipe(Effect.flip, Effect.forkChild)
      yield* harness.nextHeldCall

      yield* TestClock.adjust(
        Duration.subtract(callDurationMaxDefault, Duration.millis(1)),
      )
      expect(call.pollUnsafe()).toBeUndefined()
      yield* TestClock.adjust(Duration.millis(1))
      expectConnectionLost(yield* Fiber.join(call))
    }).pipe(Effect.scoped),
  )

  it.effect(
    "has a supervisor replace the session, keeping its rows for now",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeReconnectHarness()
        const supervisor =
          yield* StdbInternal.makeWsSessionSupervisorFromModulePlan({
            plan,
            config: reconnectConfig(harness, { callDurationMax }),
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
        const session = yield* SubscriptionRef.get(supervisor.session).pipe(
          Effect.map(AsyncResult.value),
          Effect.map(Option.getOrThrow),
        )
        harness.at(1).holdCalls()
        const call = yield* session.reducers
          .userUpsert(upsert)
          .pipe(Effect.flip, Effect.forkChild)
        yield* harness.nextHeldCall

        yield* TestClock.adjust(callDurationMax)
        expectConnectionLost(yield* Fiber.join(call))
        const reconnecting = yield* awaitPhase(
          supervisor.phase,
          (phase) => phase.status === "reconnecting" && phase.attempt === 1,
        )
        expectConnectionLost(
          reconnecting.status === "reconnecting"
            ? reconnecting.failure
            : undefined,
        )
        expect(session.isRevoked()).toBe(false)
        expect(harness.at(1).disconnectCount()).toBe(1)

        yield* TestClock.adjust(Duration.millis(100))
        yield* awaitPhase(
          supervisor.phase,
          (phase) => phase.status === "live" && phase.attempt === 2,
        )
        expect(harness.buildCount()).toBe(2)
      }).pipe(Effect.scoped),
  )

  it.effect(
    "only invalidates a connection it does not own, and reports it ended",
    () =>
      Effect.gen(function* () {
        let disconnects = 0
        const sent = yield* Deferred.make<void>()
        const connection = {
          ...makeFullModuleWsConnection({}),
          callReducerWithParams: () => {
            Deferred.doneUnsafe(sent, Effect.void)
            return Promise.withResolvers<void>().promise
          },
          callProcedureWithParams: () => Promise.resolve(undefined),
          disconnect: () => {
            disconnects += 1
          },
        }
        const session = StdbInternal.ClientWs.make({
          module: FullModule,
          connection,
          callDurationMax,
        })
        expect(session.isActive()).toBe(true)
        const call = yield* session.reducers
          .userUpsert(upsert)
          .pipe(Effect.flip, Effect.forkChild)
        yield* Deferred.await(sent)

        yield* TestClock.adjust(callDurationMax)
        expectConnectionLost(yield* Fiber.join(call))
        expect(session.isInvalidated()).toBe(true)
        expect(disconnects).toBe(0)
        // The SDK still calls its socket active; every call on it would fail.
        expect(connection.isActive).toBe(true)
        expect(session.isActive()).toBe(false)
      }),
  )

  it.effect("refuses a bound that bounds nothing when a client is built", () =>
    Effect.gen(function* () {
      const harness = yield* makeReconnectHarness()
      const scoped = (bound: Duration.Input) => () =>
        StdbInternal.makeScopedFromModulePlan({
          plan,
          config: reconnectConfig(harness, { callDurationMax: bound }),
        })
      const supervised = (bound: Duration.Input) => () =>
        StdbInternal.makeWsSessionSupervisorFromModulePlan({
          plan,
          config: reconnectConfig(harness, { callDurationMax: bound }),
        })
      const bare = (bound: Duration.Input) => () =>
        StdbInternal.ClientWs.make({
          module: FullModule,
          connection: makeFullModuleWsConnection({}),
          callDurationMax: bound,
        })

      expect(scoped(0)).toThrow(TypeError)
      expect(scoped(Number.NaN)).toThrow(TypeError)
      expect(scoped(Duration.infinity)).not.toThrow(TypeError)
      expect(supervised(-1)).toThrow(TypeError)
      expect(bare("Infinity")).not.toThrow(TypeError)
      expect(harness.buildCount()).toBe(0)
    }),
  )
})
