import * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import * as EffectRuntime from "effect/Effect"
import * as Exit from "effect/Exit"
import type * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Scheduler from "effect/Scheduler"
import { RuntimeLayerAsyncError } from "./services.ts"

export type SyncRunner<RuntimeR = never> = {
  readonly runSync: <A, E, R extends RuntimeR>(
    effect: Effect.Effect<A, E, R>,
  ) => A
  readonly runSyncExit: <A, E, R extends RuntimeR>(
    effect: Effect.Effect<A, E, R>,
  ) => Exit.Exit<A, E>
  readonly dispose?: Effect.Effect<void>
}

export type SyncRunnerLike<RuntimeR = never> = {
  readonly runSync: SyncRunner<RuntimeR>["runSync"]
  readonly runSyncExit: SyncRunner<RuntimeR>["runSyncExit"]
  readonly dispose?: SyncRunner<RuntimeR>["dispose"]
}

const preventSchedulerYield = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  EffectRuntime.provideService(effect, Scheduler.PreventSchedulerYield, true)

export const isSyncRunnerLike = <RuntimeR>(
  value: unknown,
): value is SyncRunnerLike<RuntimeR> =>
  typeof value === "object" &&
  value !== null &&
  "runSync" in value &&
  typeof value.runSync === "function" &&
  "runSyncExit" in value &&
  typeof value.runSyncExit === "function"

export const from = <R>(
  value: SyncRunner<R> | Context.Context<R> | SyncRunnerLike<R>,
): SyncRunner<R> => {
  if (isSyncRunnerLike<R>(value)) {
    return value.dispose != null
      ? {
          runSync: value.runSync,
          runSyncExit: value.runSyncExit,
          dispose: value.dispose,
        }
      : {
          runSync: value.runSync,
          runSyncExit: value.runSyncExit,
        }
  }

  const context = Context.add(value, Scheduler.PreventSchedulerYield, true)

  return {
    runSync: (effect) =>
      effect.pipe(preventSchedulerYield, EffectRuntime.runSyncWith(context)),
    runSyncExit: (effect) =>
      effect.pipe(
        preventSchedulerYield,
        EffectRuntime.runSyncExitWith(context),
      ),
  }
}

export const fromManagedRuntime = <R>(
  runtime: ManagedRuntime.ManagedRuntime<R, never>,
): SyncRunner<R> => {
  let initialized = false

  const ensureInitialized = (): Cause.Cause<never> | undefined => {
    if (initialized) {
      return undefined
    }

    const exit = runtime.runSyncExit(runtime.contextEffect)
    if (Exit.isSuccess(exit)) {
      initialized = true
      return undefined
    }

    const asyncFailure = exit.cause.reasons
      .filter(Cause.isDieReason)
      .map((reason) => reason.defect)
      .find(Cause.isAsyncFiberError)
    if (asyncFailure != null) {
      asyncFailure.fiber.interruptUnsafe()
      throw new RuntimeLayerAsyncError()
    }

    return exit.cause
  }

  return {
    runSync: (effect) => {
      const initializationFailure = ensureInitialized()
      if (initializationFailure != null) {
        throw Cause.squash(initializationFailure)
      }
      return runtime.runSync(preventSchedulerYield(effect))
    },
    runSyncExit: (effect) => {
      const initializationFailure = ensureInitialized()
      if (initializationFailure != null) {
        return Exit.failCause(initializationFailure)
      }
      return runtime.runSyncExit(preventSchedulerYield(effect))
    },
    dispose: runtime.disposeEffect,
  }
}

export const fromLayer = <R>(
  layer: Layer.Layer<R, never, never>,
): SyncRunner<R> => layer.pipe(ManagedRuntime.make, fromManagedRuntime)
