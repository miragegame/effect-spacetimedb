import * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as EffectVitest from "@effect/vitest"
import {
  ReducerAsyncNotAllowedError,
  RuntimeLayerAsyncError,
  type SyncRunner,
  fromManagedRuntime,
} from "effect-spacetimedb/server"
import { toReducerThrow } from "../../src/server/callable-runtime.ts"

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
})
