import * as Cause from "effect/Cause"
import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Scheduler from "effect/Scheduler"
import * as EffectVitest from "@effect/vitest"
import {
  ReducerAsyncNotAllowedError,
  RuntimeLayerAsyncError,
  type SyncRunner,
  fromLayer,
  fromManagedRuntime,
} from "effect-spacetimedb/server"
import { toReducerThrow } from "../../src/server/callable-runtime.ts"
import {
  makeUntimedServerClock,
  provideConstrainedServerSupport,
} from "../../src/server/runtime-layer.ts"

const { describe, expect, it } = EffectVitest

class RuntimeValue extends Context.Service<RuntimeValue, number>()(
  "effect-spacetimedb/test/unit/sync-runner-robustness.test/RuntimeValue",
) {}

const runSync = <A, R>(
  runner: SyncRunner<R>,
  effect: Effect.Effect<A, never, R>,
): A => runner.runSync(effect)

describe("managed synchronous runner robustness", () => {
  for (const method of ["runSync", "runSyncExit"] as const) {
    it(`reports async layer initialization from ${method}`, () => {
      let handlerEntered = false
      const layer = Layer.effect(RuntimeValue, Effect.never)
      const runner = layer.pipe(ManagedRuntime.make, fromManagedRuntime)
      const handler = Effect.suspend(() => {
        handlerEntered = true
        return Effect.succeed(1)
      })

      expect(() => runner[method](handler)).toThrow(RuntimeLayerAsyncError)
      expect(handlerEntered).toBe(false)
    })
  }

  it("keeps first-call handler suspension classified as reducer async work", () => {
    const runner = Layer.empty.pipe(ManagedRuntime.make, fromManagedRuntime)
    const exit = runner.runSyncExit(Effect.never)

    expect(() => toReducerThrow(exit)).toThrow(ReducerAsyncNotAllowedError)
  })

  it("preflights a synchronous managed layer only once", () => {
    let builds = 0
    const layer = Layer.effect(
      RuntimeValue,
      Effect.suspend(() => {
        builds = builds + 1
        return Effect.succeed(42)
      }),
    )
    const runner = layer.pipe(ManagedRuntime.make, fromManagedRuntime)

    expect(runSync(runner, RuntimeValue)).toBe(42)
    expect(runner.runSyncExit(RuntimeValue).pipe(Exit.isSuccess)).toBe(true)
    expect(builds).toBe(1)
  })

  it("returns synchronous layer defects from runSyncExit", () => {
    const defect = new Error("synchronous layer defect")
    const layer = Layer.effect(
      RuntimeValue,
      Effect.failCause(Cause.die(defect)),
    )
    const runner = layer.pipe(ManagedRuntime.make, fromManagedRuntime)
    const exit = runner.runSyncExit(Effect.succeed(1))

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(Cause.squash(exit.cause)).toBe(defect)
    }
    expect(() => runSync(runner, Effect.succeed(1))).toThrow(defect)
  })

  it("prevents cooperative scheduler yields in large nested transactions", () => {
    const runner = fromLayer(Layer.empty)
    // The dev guards make wall-clock reads throw, and Effect stamps span start
    // times from the ambient clock, so a guarded scope needs the same
    // timestamp-less clock a real handler is given.
    const guarded = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      provideConstrainedServerSupport(
        Effect.provideService(effect, Clock.Clock, makeUntimedServerClock()),
        "dev-guarded",
      )
    const namedWork = Effect.fn("namedSynchronousWork")(function* () {
      expect(yield* Scheduler.PreventSchedulerYield).toBe(true)
      expect(yield* Scheduler.MaxOpsBeforeYield).toBe(Number.MAX_SAFE_INTEGER)
      yield* Effect.forEach(
        Array.from({ length: 300 }),
        () =>
          Effect.try({
            try: () => undefined,
            catch: () => undefined,
          }),
        { discard: true },
      )
      expect(yield* Scheduler.PreventSchedulerYield).toBe(true)
      expect(yield* Scheduler.MaxOpsBeforeYield).toBe(Number.MAX_SAFE_INTEGER)
    })
    const transaction = Effect.gen(function* () {
      expect(yield* Scheduler.PreventSchedulerYield).toBe(true)
      expect(yield* Scheduler.MaxOpsBeforeYield).toBe(Number.MAX_SAFE_INTEGER)
      yield* Effect.forEach(Array.from({ length: 40 }), namedWork, {
        discard: true,
      })
    })
    const nested = Effect.suspend(() =>
      Effect.succeed(runner.runSyncExit(guarded(transaction))),
    )
    const exit = runner.runSyncExit(guarded(nested))

    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toEqual(Exit.void)
    }
  })
})
