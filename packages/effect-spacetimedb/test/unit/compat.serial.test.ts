import { testEffectCallbackError } from "../helpers/effect-errors"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as EffectVitest from "@effect/vitest"
const { expect } = EffectVitest
import * as StdbTesting from "effect-spacetimedb/testing"
import {
  ReducerAsyncNotAllowedError,
  ReducerWallClockNotAllowedError,
} from "effect-spacetimedb/server"
import { TestLayer } from "../helpers/test-layer"

const describe = EffectVitest.layer(TestLayer)

const withMathRandomDescriptor = <A, E, R>(
  descriptor: PropertyDescriptor | undefined,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.acquireRelease(
    Effect.try({
      try: () => {
        const original = Object.getOwnPropertyDescriptor(Math, "random")
        if (descriptor != null) {
          Object.defineProperty(Math, "random", descriptor)
        } else {
          Reflect.deleteProperty(Math, "random")
        }
        return original
      },
      catch: testEffectCallbackError("effect-spacetimedb/unit/compat"),
    }).pipe(Effect.orDie),
    (original) =>
      Effect.try({
        try: () => {
          if (original != null) {
            Object.defineProperty(Math, "random", original)
          } else {
            Reflect.deleteProperty(Math, "random")
          }
        },
        catch: testEffectCallbackError("effect-spacetimedb/unit/compat"),
      }).pipe(Effect.orDie),
  ).pipe(Effect.andThen(effect), Effect.scoped)

const assertServerPolyfilledMathRandom = Effect.try({
  try: () => {
    StdbTesting.ensureServerPolyfills()
    const value = Math.random()

    expect(value).toBeGreaterThanOrEqual(0)
    expect(value).toBeLessThan(1)
  },
  catch: testEffectCallbackError("effect-spacetimedb/unit/compat"),
}).pipe(Effect.orDie)

describe("compat", (it) => {
  it.effect("installs Math.random fallback when Math.random is missing", () =>
    withMathRandomDescriptor(undefined, assertServerPolyfilledMathRandom),
  )

  it.effect(
    "installs Math.random fallback for SpaceTimeDB-style accessors",
    () =>
      withMathRandomDescriptor(
        {
          configurable: true,
          enumerable: false,
          get: () => {
            throw new TypeError("Math.random is not available")
          },
        },
        assertServerPolyfilledMathRandom,
      ),
  )

  it.effect(
    "restores SpaceTimeDB-style Math.random accessors after fallback scope close",
    () =>
      Effect.gen(function* () {
        const original = Object.getOwnPropertyDescriptor(Math, "random")

        yield* withMathRandomDescriptor(
          {
            configurable: true,
            enumerable: false,
            get: () => {
              throw new TypeError("Math.random is not available")
            },
          },
          assertServerPolyfilledMathRandom,
        )

        expect(Object.getOwnPropertyDescriptor(Math, "random")).toEqual(
          original,
        )
        expect(() => Math.random()).not.toThrow()
      }),
  )

  it.effect(
    "installs Math.random fallback for SpaceTimeDB-style throwing functions",
    () =>
      withMathRandomDescriptor(
        {
          configurable: true,
          enumerable: false,
          writable: true,
          value: () => {
            throw new TypeError("Math.random is not available")
          },
        },
        assertServerPolyfilledMathRandom,
      ),
  )

  it.effect("keeps the public root entrypoint side-effect free", () =>
    Effect.gen(function* () {
      const entrypoint = "effect-spacetimedb"
      const result = yield* Effect.tryPromise({
        try: async () => {
          const process = Bun.spawn({
            cmd: [
              "bun",
              "-e",
              [
                "delete String.prototype.toWellFormed",
                "const entrypoint = Bun.env.EFFECT_STDB_ENTRYPOINT",
                "if (entrypoint === undefined) throw new Error('missing entrypoint')",
                "await import(entrypoint)",
                "process.stdout.write(typeof String.prototype.toWellFormed)",
              ].join("\n"),
            ],
            env: {
              ...Bun.env,
              EFFECT_STDB_ENTRYPOINT: entrypoint,
            },
            stdout: "pipe",
            stderr: "pipe",
          })

          const [exitCode, stdout, stderr] = await Promise.all([
            process.exited,
            new Response(process.stdout).text(),
            new Response(process.stderr).text(),
          ])

          return {
            exitCode,
            stdout,
            stderr,
          }
        },
        catch: testEffectCallbackError("effect-spacetimedb/unit/compat"),
      })

      expect(result.exitCode).toBe(0)
      expect(result.stderr).toBe("")
      expect(result.stdout.trim()).toBe("undefined")
    }),
  )

  it.effect(
    "pins synchronous host scheduler polyfills in a fresh Bun process",
    () =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise({
          try: async () => {
            const process = Bun.spawn({
              cmd: [
                "bun",
                "-e",
                [
                  "delete globalThis.setTimeout",
                  "delete globalThis.clearTimeout",
                  "delete globalThis.setImmediate",
                  "delete globalThis.clearImmediate",
                  'await import("effect-spacetimedb/server-polyfills")',
                  "const calls = []",
                  'setTimeout(() => calls.push("timeout"), 50)',
                  'setImmediate(() => calls.push("immediate"))',
                  'const Effect = await import("effect/Effect")',
                  'const scheduler = Effect.runSync(Effect.yieldNow.pipe(Effect.as("drained")))',
                  "process.stdout.write(JSON.stringify({ calls, scheduler }))",
                ].join("\n"),
              ],
              stdout: "pipe",
              stderr: "pipe",
            })
            const [exitCode, stdout, stderr] = await Promise.all([
              process.exited,
              new Response(process.stdout).text(),
              new Response(process.stderr).text(),
            ])
            return { exitCode, stdout, stderr }
          },
          catch: testEffectCallbackError("effect-spacetimedb/unit/compat"),
        })

        expect(result.exitCode).toBe(0)
        expect(result.stderr).toBe("")
        expect(result.stdout).toBe(
          '{"calls":["timeout","immediate"],"scheduler":"drained"}',
        )
      }),
  )

  it.effect(
    "installs dev timeout and immediate guards without leaking them",
    () =>
      Effect.gen(function* () {
        const originalSetTimeout = globalThis.setTimeout
        const originalSetImmediate = globalThis.setImmediate

        const exit = yield* Effect.exit(
          StdbTesting.provideConstrainedServerSupport(
            Effect.try({
              try: () => {
                const guardedSetTimeout = globalThis as typeof globalThis & {
                  readonly setTimeout: typeof globalThis.setTimeout
                  readonly setImmediate: typeof globalThis.setImmediate
                }
                expect(() =>
                  guardedSetTimeout.setTimeout(() => undefined, 0),
                ).toThrow(ReducerAsyncNotAllowedError)
                expect(() =>
                  guardedSetTimeout.setImmediate(() => undefined),
                ).toThrow(ReducerAsyncNotAllowedError)
              },
              catch: testEffectCallbackError("effect-spacetimedb/unit/compat"),
            }),
            "dev-guarded",
          ),
        )

        expect(Exit.isSuccess(exit)).toBe(true)
        expect(globalThis.setTimeout).toBe(originalSetTimeout)
        expect(globalThis.setImmediate).toBe(originalSetImmediate)
      }),
  )

  it.effect(
    "installs dev wall-clock guards without leaking them after scope close",
    () =>
      Effect.gen(function* () {
        const originalDate = globalThis.Date
        const originalDateNow = globalThis.Date.now

        yield* StdbTesting.provideConstrainedServerSupport(
          Effect.try({
            try: () => {
              expect(Date.now).not.toBe(originalDateNow)
              expect(() => Date.now()).toThrow(ReducerWallClockNotAllowedError)
              expect(() => new Date()).toThrow(ReducerWallClockNotAllowedError)

              const dateFromNumber = new Date(123)
              expect(dateFromNumber.getTime()).toBe(123)
              expect(dateFromNumber).toBeInstanceOf(Date)

              const dateFromString = new Date("2020-01-01T00:00:00.000Z")
              expect(dateFromString.getUTCFullYear()).toBe(2020)
              expect(dateFromString).toBeInstanceOf(Date)

              expect(Date.parse("2020-01-01T00:00:00.000Z")).toBe(
                1_577_836_800_000,
              )
              expect(Date.UTC(2020, 0, 1)).toBe(1_577_836_800_000)
              expect(typeof Date()).toBe("string")
            },
            catch: testEffectCallbackError("effect-spacetimedb/unit/compat"),
          }),
          "dev-guarded",
        )

        expect(globalThis.Date).toBe(originalDate)
        expect(globalThis.Date.now).toBe(originalDateNow)

        yield* StdbTesting.provideConstrainedServerSupport(
          Effect.try({
            try: () => {
              expect(globalThis.Date).toBe(originalDate)
              expect(globalThis.Date.now).toBe(originalDateNow)
              expect(() => Date.now()).not.toThrow()
              expect(new Date()).toBeInstanceOf(Date)
            },
            catch: testEffectCallbackError("effect-spacetimedb/unit/compat"),
          }),
          "runtime",
        )
      }),
  )

  it.effect(
    "guards wall-clock on the active Date constructor when globalThis.Date is replaced",
    () =>
      Effect.gen(function* () {
        const realDate = globalThis.Date
        // A test (e.g. fake timers) may replace globalThis.Date before dev-guarded
        // mode is entered; the guard must act on the active constructor, not the
        // one captured at module load.
        class ReplacementDate extends realDate {
          static override now(): number {
            return 12_345
          }
        }
        // `typeof ReplacementDate` (a class) lacks Date's `(): string` call
        // signature, so bridge it to `DateConstructor` for the global swap.
        const replacementDate = ReplacementDate as unknown as DateConstructor

        const setGlobalDate = (value: DateConstructor) =>
          Effect.try({
            try: () => {
              const globals = globalThis as { Date: DateConstructor }
              globals.Date = value
            },
            catch: testEffectCallbackError("effect-spacetimedb/unit/compat"),
          }).pipe(Effect.orDie)

        yield* Effect.acquireRelease(setGlobalDate(replacementDate), () =>
          setGlobalDate(realDate),
        ).pipe(
          Effect.andThen(
            StdbTesting.provideConstrainedServerSupport(
              Effect.try({
                try: () => {
                  expect(() => Date.now()).toThrow(
                    ReducerWallClockNotAllowedError,
                  )
                  expect(() => new Date()).toThrow(
                    ReducerWallClockNotAllowedError,
                  )
                },
                catch: testEffectCallbackError(
                  "effect-spacetimedb/unit/compat",
                ),
              }),
              "dev-guarded",
            ),
          ),
          Effect.andThen(
            Effect.try({
              try: () => {
                expect(globalThis.Date).toBe(replacementDate)
                expect(globalThis.Date.now()).toBe(12_345)
              },
              catch: testEffectCallbackError("effect-spacetimedb/unit/compat"),
            }).pipe(Effect.orDie),
          ),
          Effect.scoped,
        )
      }),
  )

  it.effect(
    "keeps overlapping dev async guards installed until the final scope closes",
    () =>
      Effect.gen(function* () {
        const originalSetTimeout = globalThis.setTimeout
        const firstReady = yield* Deferred.make<void>()
        const secondReady = yield* Deferred.make<void>()
        const releaseFirst = yield* Deferred.make<void>()
        const releaseSecond = yield* Deferred.make<void>()

        const guardedRegion = (
          ready: Deferred.Deferred<void>,
          release: Deferred.Deferred<void>,
        ) =>
          StdbTesting.provideConstrainedServerSupport(
            Effect.gen(function* () {
              yield* Deferred.succeed(ready, undefined)
              yield* Deferred.await(release)
            }),
            "dev-guarded",
          )

        const firstFiber = yield* Effect.forkDetach(
          guardedRegion(firstReady, releaseFirst),
          { startImmediately: true },
        )
        yield* Deferred.await(firstReady)
        expect(globalThis.setTimeout).not.toBe(originalSetTimeout)

        const secondFiber = yield* Effect.forkDetach(
          guardedRegion(secondReady, releaseSecond),
          { startImmediately: true },
        )
        yield* Deferred.await(secondReady)
        expect(globalThis.setTimeout).not.toBe(originalSetTimeout)

        yield* Deferred.succeed(releaseFirst, undefined)
        expect(Exit.isSuccess(yield* Fiber.await(firstFiber))).toBe(true)
        expect(globalThis.setTimeout).not.toBe(originalSetTimeout)

        yield* Deferred.succeed(releaseSecond, undefined)
        expect(Exit.isSuccess(yield* Fiber.await(secondFiber))).toBe(true)
        expect(globalThis.setTimeout).toBe(originalSetTimeout)
      }),
  )
})
