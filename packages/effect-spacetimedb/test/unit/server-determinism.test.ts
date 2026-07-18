import * as EffectVitest from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Data from "effect/Data"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as FastCheck from "effect/testing/FastCheck"
import {
  type ConstrainedServerRuntimeMode,
  provideConstrainedServerSupport,
  ReducerAsyncNotAllowedError,
  ReducerGlobalRandomNotAllowedError,
  ReducerWallClockNotAllowedError,
} from "effect-spacetimedb/server"
import { Timestamp } from "spacetimedb"
import {
  makeServerClock,
  makeServerRandom,
  makeUntimedServerClock,
} from "../../src/server/runtime-layer.ts"

const { describe, expect, it } = EffectVitest

const propertyOptions = {
  fastCheck: { numRuns: 300, seed: 0x5eede11 },
} as const

class GuardedGlobalCallError extends Data.TaggedError(
  "GuardedGlobalCallError",
)<{
  readonly cause: unknown
}> {}

type HostRandom = {
  (): number
  readonly fill: <T>(array: T) => T
  readonly uint32: () => number
  readonly integerInRange: (min: number, max: number) => number
  readonly bigintInRange: (min: bigint, max: bigint) => bigint
}

type MakeHostRandom = (seed: Timestamp) => HostRandom

const sourcePath = new URL(
  "../src/server/rng.ts",
  import.meta.resolve("spacetimedb"),
).href
const randomModule = (await import(sourcePath)) as {
  readonly makeRandom: MakeHostRandom
}
const { makeRandom } = randomModule

const callGuarded = (
  mode: ConstrainedServerRuntimeMode,
  thunk: () => unknown,
) =>
  provideConstrainedServerSupport(
    Effect.try({
      try: () => {
        thunk()
        return undefined
      },
      catch: (cause) => new GuardedGlobalCallError({ cause }),
    }),
    mode,
  )

const callProperty = (
  owner: object,
  propertyKey: PropertyKey,
  ...args: ReadonlyArray<unknown>
) => {
  const value = Reflect.get(owner, propertyKey)
  return typeof value === "function"
    ? Reflect.apply(value, owner, args)
    : undefined
}

describe("server determinism", () => {
  it("converts server timestamps to clock millis and nanos", () => {
    const cases: ReadonlyArray<{
      readonly micros: bigint
      readonly millis: number
      readonly nanos: bigint
    }> = [
      { micros: 0n, millis: 0, nanos: 0n },
      { micros: 1_000n, millis: 1, nanos: 1_000_000n },
      { micros: 1_500_000n, millis: 1500, nanos: 1_500_000_000n },
      { micros: 999n, millis: 0, nanos: 999_000n },
      { micros: -1_000n, millis: -1, nanos: -1_000_000n },
      { micros: -999n, millis: 0, nanos: -999_000n },
    ]

    for (const { micros, millis, nanos } of cases) {
      const clock = makeServerClock({ timestamp: new Timestamp(micros) })

      expect(clock.currentTimeMillisUnsafe()).toBe(millis)
      expect(clock.currentTimeNanosUnsafe()).toBe(nanos)
    }
  })

  it.effect.prop(
    "keeps server clock millis and nanos derived from the same timestamp",
    [FastCheck.bigInt({ min: -(2n ** 62n), max: 2n ** 62n })],
    ([micros]) =>
      Effect.gen(function* () {
        const clock = makeServerClock({ timestamp: new Timestamp(micros) })
        const nanos = clock.currentTimeNanosUnsafe()

        expect(nanos).toBe(micros * 1000n)
        expect(Number(nanos / 1_000_000n)).toBe(clock.currentTimeMillisUnsafe())
        expect(yield* clock.currentTimeMillis).toBe(
          clock.currentTimeMillisUnsafe(),
        )
        expect(yield* clock.currentTimeNanos).toBe(nanos)
      }),
    propertyOptions,
  )

  it.effect("server clock forbids sleeping", () =>
    Effect.gen(function* () {
      const clock = makeServerClock({ timestamp: new Timestamp(0n) })
      const error = yield* Effect.flip(clock.sleep(Duration.millis(1)))

      expect(ReducerAsyncNotAllowedError.is(error)).toBe(true)
    }),
  )

  it.effect("untimed view clocks reject Effectful wall-clock reads", () =>
    Effect.gen(function* () {
      const clock = makeUntimedServerClock()
      expect(clock.currentTimeMillisUnsafe()).toBe(0)
      expect(clock.currentTimeNanosUnsafe()).toBe(0n)

      const reads: ReadonlyArray<Effect.Effect<unknown>> = [
        clock.currentTimeMillis,
        clock.currentTimeNanos,
      ]
      yield* Effect.forEach(
        reads,
        (read) =>
          Effect.gen(function* () {
            const exit = yield* Effect.exit(read)
            expect(Exit.isFailure(exit)).toBe(true)
            if (Exit.isFailure(exit)) {
              expect(Cause.squash(exit.cause)).toBeInstanceOf(
                ReducerWallClockNotAllowedError,
              )
            }
          }),
        { discard: true },
      )
    }),
  )

  it.effect(
    "dev-guarded support forbids ambient globals and restores them",
    () =>
      Effect.gen(function* () {
        const originalSetTimeout = globalThis.setTimeout
        const originalSetInterval = globalThis.setInterval
        const originalQueueMicrotask = globalThis.queueMicrotask
        const originalMathRandom = Math.random
        const originalDate = globalThis.Date

        const setTimeoutError = yield* Effect.flip(
          callGuarded("dev-guarded", () =>
            callProperty(globalThis, "setTimeout", () => {}, 0),
          ),
        )
        expect(ReducerAsyncNotAllowedError.is(setTimeoutError.cause)).toBe(true)

        const setIntervalError = yield* Effect.flip(
          callGuarded("dev-guarded", () =>
            callProperty(globalThis, "setInterval", () => {}, 0),
          ),
        )
        expect(ReducerAsyncNotAllowedError.is(setIntervalError.cause)).toBe(
          true,
        )

        const queueMicrotaskError = yield* Effect.flip(
          callGuarded("dev-guarded", () => globalThis.queueMicrotask(() => {})),
        )
        expect(ReducerAsyncNotAllowedError.is(queueMicrotaskError.cause)).toBe(
          true,
        )

        const mathRandomError = yield* Effect.flip(
          callGuarded("dev-guarded", () => Math.random()),
        )
        expect(mathRandomError.cause).toBeInstanceOf(
          ReducerGlobalRandomNotAllowedError,
        )

        const dateConstructorError = yield* Effect.flip(
          callGuarded("dev-guarded", () => new Date()),
        )
        expect(dateConstructorError.cause).toBeInstanceOf(
          ReducerWallClockNotAllowedError,
        )

        const dateNowError = yield* Effect.flip(
          callGuarded("dev-guarded", () => Date.now()),
        )
        expect(dateNowError.cause).toBeInstanceOf(
          ReducerWallClockNotAllowedError,
        )

        const runtimeRandomExit = yield* Effect.exit(
          callGuarded("runtime", () => Math.random()),
        )
        expect(Exit.isSuccess(runtimeRandomExit)).toBe(true)

        const runtimeDateExit = yield* Effect.exit(
          callGuarded("runtime", () => new Date()),
        )
        expect(Exit.isSuccess(runtimeDateExit)).toBe(true)

        expect(globalThis.setTimeout).toBe(originalSetTimeout)
        expect(globalThis.setInterval).toBe(originalSetInterval)
        expect(globalThis.queueMicrotask).toBe(originalQueueMicrotask)
        expect(Math.random).toBe(originalMathRandom)
        expect(globalThis.Date).toBe(originalDate)
      }),
  )

  it.prop(
    "server random is a deterministic, in-range function of its seed",
    [FastCheck.bigInt({ min: 1n, max: 2n ** 53n })],
    ([seedMicros]) => {
      const a = makeServerRandom({
        random: makeRandom(new Timestamp(seedMicros)),
      })
      const b = makeServerRandom({
        random: makeRandom(new Timestamp(seedMicros)),
      })
      const drawsA = Array.from({ length: 16 }, () => a.nextIntUnsafe())
      const drawsB = Array.from({ length: 16 }, () => b.nextIntUnsafe())

      expect(drawsA).toEqual(drawsB)
      for (const draw of drawsA) {
        expect(Number.isSafeInteger(draw)).toBe(true)
        expect(draw).toBeGreaterThanOrEqual(Number.MIN_SAFE_INTEGER)
        expect(draw).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER)
      }
    },
    propertyOptions,
  )
})
