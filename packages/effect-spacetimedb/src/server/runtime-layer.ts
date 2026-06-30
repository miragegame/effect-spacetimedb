import * as Clock from "effect/Clock"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Logger from "effect/Logger"
import * as Match from "effect/Match"
import * as Random from "effect/Random"
import * as Scheduler from "effect/Scheduler"
import { ensureServerPolyfills } from "../compat/polyfills.ts"
import type { ServerRandom } from "./runtime-types.ts"
import {
  ReducerAsyncNotAllowedError,
  ReducerGlobalRandomNotAllowedError,
  ReducerWallClockNotAllowedError,
} from "./services.ts"

type TimestampCtx = {
  readonly timestamp: {
    readonly microsSinceUnixEpoch: bigint
  }
}

type RandomCtx = {
  readonly random: ServerRandom
}

type TimedRuntimeCtx = TimestampCtx & RandomCtx

class ServerPolyfillInstallError extends Data.TaggedError(
  "ServerPolyfillInstallError",
)<{
  readonly cause: unknown
}> {}

class ServerDevGuardInstallError extends Data.TaggedError(
  "ServerDevGuardInstallError",
)<{
  readonly cause: unknown
}> {}

class ServerDevGuardReleaseError extends Data.TaggedError(
  "ServerDevGuardReleaseError",
)<{
  readonly cause: unknown
}> {}

type DevGuardTarget = {
  readonly key: "setTimeout" | "setInterval" | "queueMicrotask" | "Math.random"
  readonly owner: object
  readonly propertyKey: PropertyKey
  readonly value: (...args: ReadonlyArray<unknown>) => never
}

const DevGuardTargets = [
  {
    key: "setTimeout",
    owner: globalThis,
    propertyKey: "setTimeout",
    value: (..._args: ReadonlyArray<unknown>) => {
      throw new ReducerAsyncNotAllowedError()
    },
  },
  {
    key: "setInterval",
    owner: globalThis,
    propertyKey: "setInterval",
    value: (..._args: ReadonlyArray<unknown>) => {
      throw new ReducerAsyncNotAllowedError()
    },
  },
  {
    key: "queueMicrotask",
    owner: globalThis,
    propertyKey: "queueMicrotask",
    value: (..._args: ReadonlyArray<unknown>) => {
      throw new ReducerAsyncNotAllowedError()
    },
  },
  {
    key: "Math.random",
    owner: Math,
    propertyKey: "random",
    value: (..._args: ReadonlyArray<unknown>) => {
      throw new ReducerGlobalRandomNotAllowedError()
    },
  },
] as const satisfies ReadonlyArray<DevGuardTarget>

type DevGuardKey = (typeof DevGuardTargets)[number]["key"]

type DevGuardOriginals = Map<DevGuardKey, PropertyDescriptor | undefined>

type DevGuardState = {
  depth: number
  readonly originals: DevGuardOriginals
  readonly originalDate: PropertyDescriptor | undefined
}

export type ConstrainedServerRuntimeMode = "runtime" | "dev-guarded"

let devGuardState: DevGuardState | undefined

const hostLogger = Logger.withLeveledConsole(Logger.formatSimple)

const hostLoggers: ReadonlySet<Logger.Logger<unknown, unknown>> = new Set([
  hostLogger,
])

const shouldUseDevGuards = (): boolean => {
  const processValue = (globalThis as { readonly process?: unknown }).process
  if (typeof processValue !== "object" || processValue === null) {
    return false
  }

  const env = (
    processValue as {
      readonly env?: Record<string, string | undefined>
    }
  ).env
  if (env === undefined) {
    return false
  }

  return env.VITEST !== undefined || env.NODE_ENV === "test"
}

export const defaultServerRuntimeMode: ConstrainedServerRuntimeMode =
  shouldUseDevGuards() ? "dev-guarded" : "runtime"

const restoreDevGuardTarget = (
  target: DevGuardTarget,
  original: PropertyDescriptor | undefined,
) => {
  if (original != null) {
    Object.defineProperty(target.owner, target.propertyKey, original)
    return
  }

  Reflect.deleteProperty(target.owner, target.propertyKey)
}

const installDevGuardTarget = (
  target: DevGuardTarget,
  original: PropertyDescriptor | undefined,
) => {
  Object.defineProperty(target.owner, target.propertyKey, {
    configurable: true,
    enumerable: original?.enumerable ?? false,
    writable: false,
    value: target.value,
  })
}

const makeGuardedDateConstructor = (
  originalDate: DateConstructor,
): DateConstructor =>
  new Proxy(originalDate, {
    apply: (target, thisArg, args) => Reflect.apply(target, thisArg, args),
    construct: (target, args, newTarget) => {
      if (args.length === 0) {
        throw new ReducerWallClockNotAllowedError()
      }

      return Reflect.construct(target, args, newTarget)
    },
    get: (target, propertyKey, receiver) => {
      // Guard wall-clock reads on the *active* constructor: `Date.now()` resolves
      // through this proxy, so the guard holds even when globalThis.Date was
      // replaced (e.g. fake timers) before dev-guarded mode was entered.
      if (propertyKey === "now") {
        return () => {
          throw new ReducerWallClockNotAllowedError()
        }
      }

      return Reflect.get(target, propertyKey, receiver)
    },
  })

const restoreDateConstructorDevGuard = (
  original: PropertyDescriptor | undefined,
) => {
  if (original != null) {
    Object.defineProperty(globalThis, "Date", original)
    return
  }

  Reflect.deleteProperty(globalThis, "Date")
}

const installDateConstructorDevGuard = (
  original: PropertyDescriptor | undefined,
) => {
  if (original == null || typeof original.value !== "function") {
    throw new TypeError("globalThis.Date is not a constructor")
  }

  Object.defineProperty(globalThis, "Date", {
    configurable: original.configurable ?? true,
    enumerable: original.enumerable ?? false,
    writable: "writable" in original ? original.writable : true,
    value: makeGuardedDateConstructor(original.value),
  })
}

const captureDevGuardOriginals = (): DevGuardOriginals =>
  new Map(
    DevGuardTargets.map((target) => [
      target.key,
      Object.getOwnPropertyDescriptor(target.owner, target.propertyKey),
    ]),
  )

const releaseDevGuards = (): ReadonlyArray<ServerDevGuardReleaseError> => {
  const state = devGuardState

  if (state == null) {
    return []
  }

  state.depth = state.depth - 1
  if (state.depth > 0) {
    return []
  }

  // Clear depth tracking before best-effort restores so one broken target cannot
  // wedge later guarded scopes. If an external mutation makes a guard
  // unrestorable, the next install may capture that target as-is, but the other
  // targets still recover.
  devGuardState = undefined
  const errors: Array<ServerDevGuardReleaseError> = []
  for (let index = DevGuardTargets.length - 1; index >= 0; index = index - 1) {
    const target = DevGuardTargets[index]!
    try {
      restoreDevGuardTarget(target, state.originals.get(target.key))
    } catch (cause) {
      errors.push(new ServerDevGuardReleaseError({ cause }))
    }
  }
  try {
    restoreDateConstructorDevGuard(state.originalDate)
  } catch (cause) {
    errors.push(new ServerDevGuardReleaseError({ cause }))
  }

  return errors
}

const installDevGuards =
  (): (() => ReadonlyArray<ServerDevGuardReleaseError>) => {
    if (devGuardState != null) {
      devGuardState.depth = devGuardState.depth + 1
      return releaseDevGuards
    }

    const originals = captureDevGuardOriginals()
    const originalDate = Object.getOwnPropertyDescriptor(globalThis, "Date")
    const installedTargets: DevGuardTarget[] = []
    let installedDateConstructorGuard = false

    try {
      for (const target of DevGuardTargets) {
        installDevGuardTarget(target, originals.get(target.key))
        installedTargets.push(target)
      }
      installDateConstructorDevGuard(originalDate)
      installedDateConstructorGuard = true

      devGuardState = {
        depth: 1,
        originals,
        originalDate,
      }
      return releaseDevGuards
    } catch (cause) {
      if (installedDateConstructorGuard) {
        try {
          restoreDateConstructorDevGuard(originalDate)
        } catch {
          // Keep restoring every target; the original install failure is the error
          // that explains why the guarded environment could not be created.
        }
      }
      for (
        let index = installedTargets.length - 1;
        index >= 0;
        index = index - 1
      ) {
        const target = installedTargets[index]!
        try {
          restoreDevGuardTarget(target, originals.get(target.key))
        } catch {
          // Keep restoring every target; the original install failure is the error
          // that explains why the guarded environment could not be created.
        }
      }

      throw cause
    }
  }

export const installServerPolyfills = Effect.try({
  try: () => {
    ensureServerPolyfills()
  },
  catch: (cause) => new ServerPolyfillInstallError({ cause }),
}).pipe(Effect.orDie)

const installDevGuardsScoped = Effect.acquireRelease(
  Effect.try({
    try: () => installDevGuards(),
    catch: (cause) => new ServerDevGuardInstallError({ cause }),
  }).pipe(Effect.orDie),
  (restore) =>
    Effect.suspend(() => {
      const errors = restore()
      return errors.length === 0
        ? Effect.void
        : Effect.logWarning(
            "Failed to restore one or more reducer dev guards",
            {
              errors,
            },
          )
    }),
)

const providePreventSchedulerYield = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.provideService(effect, Scheduler.PreventSchedulerYield, true)

const withServerPolyfills = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> => installServerPolyfills.pipe(Effect.andThen(effect))

const withDevGuards = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  installDevGuardsScoped.pipe(
    Effect.andThen(effect),
    Effect.scoped,
  ) as Effect.Effect<A, E, R>

const withHostLogger = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.provideService(effect, Logger.CurrentLoggers, hostLoggers)

const withTracerDisabled = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> => Effect.withTracerEnabled(effect, false)

export const makeServerClock = (ctx: TimestampCtx): Clock.Clock => {
  const millis = Number(ctx.timestamp.microsSinceUnixEpoch / 1000n)
  const nanos = ctx.timestamp.microsSinceUnixEpoch * 1000n

  return {
    currentTimeMillisUnsafe: () => millis,
    currentTimeNanosUnsafe: () => nanos,
    currentTimeMillis: Effect.succeed(millis),
    currentTimeNanos: Effect.succeed(nanos),
    // Clock.sleep cannot carry the typed async-not-allowed error through the
    // Clock service signature, so bind.ts translates this failure at the edge.
    sleep: () =>
      Effect.fail(
        new ReducerAsyncNotAllowedError(),
      ) as unknown as Effect.Effect<void>,
  }
}

export const makeServerRandom = (
  ctx: RandomCtx,
): (typeof Random.Random)["Service"] => ({
  nextIntUnsafe: () =>
    Number(
      ctx.random.bigintInRange(
        BigInt(Number.MIN_SAFE_INTEGER),
        BigInt(Number.MAX_SAFE_INTEGER),
      ),
    ),
  nextDoubleUnsafe: () => ctx.random(),
})

export const provideConstrainedServerSupport = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  mode: ConstrainedServerRuntimeMode = defaultServerRuntimeMode,
) => {
  const provided = Match.value(mode).pipe(
    Match.when("dev-guarded", () =>
      effect.pipe(withDevGuards, withServerPolyfills),
    ),
    Match.when("runtime", () => withServerPolyfills(effect)),
    Match.exhaustive,
  )

  return provided.pipe(
    withTracerDisabled,
    withHostLogger,
    providePreventSchedulerYield,
  )
}

export const provideConstrainedServerRuntime = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  ctx: TimedRuntimeCtx,
  mode: ConstrainedServerRuntimeMode = defaultServerRuntimeMode,
) =>
  provideConstrainedServerSupport(
    effect.pipe(
      Effect.provideService(Clock.Clock, makeServerClock(ctx)),
      Effect.provideService(Random.Random, makeServerRandom(ctx)),
    ),
    mode,
  )
