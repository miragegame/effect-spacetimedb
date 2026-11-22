import * as Clock from "effect/Clock"
import * as Data from "effect/Data"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Logger from "effect/Logger"
import * as Match from "effect/Match"
import * as Random from "effect/Random"
import * as Scheduler from "effect/Scheduler"
import { ensureServerPolyfills } from "../compat/polyfills.ts"
import type { ServerRandom } from "./runtime-types.ts"
import {
  HandlerAsyncNotAllowedDefect,
  HandlerGlobalRandomNotAllowedDefect,
  HandlerWallClockNotAllowedDefect,
} from "./services.ts"
import { withDeterministicDefaultTracer } from "./tracing.ts"

export type TimestampCtx = {
  readonly timestamp: {
    readonly microsSinceUnixEpoch: bigint
  }
}

export type RandomCtx = {
  readonly random: ServerRandom
}

export type TimedRuntimeCtx = TimestampCtx & RandomCtx

class ServerPolyfillInstallDefect extends Data.TaggedError(
  "ServerPolyfillInstallDefect",
)<{
  readonly cause: unknown
}> {}

class ServerDevGuardInstallDefect extends Data.TaggedError(
  "ServerDevGuardInstallDefect",
)<{
  readonly cause: unknown
}> {}

class ServerDevGuardReleaseError extends Data.TaggedError(
  "ServerDevGuardReleaseError",
)<{
  readonly cause: unknown
}> {}

type DevGuardTarget = {
  readonly key:
    | "setTimeout"
    | "setInterval"
    | "setImmediate"
    | "queueMicrotask"
    | "Math.random"
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
      throw new HandlerAsyncNotAllowedDefect()
    },
  },
  {
    key: "setInterval",
    owner: globalThis,
    propertyKey: "setInterval",
    value: (..._args: ReadonlyArray<unknown>) => {
      throw new HandlerAsyncNotAllowedDefect()
    },
  },
  {
    key: "setImmediate",
    owner: globalThis,
    propertyKey: "setImmediate",
    value: (..._args: ReadonlyArray<unknown>) => {
      throw new HandlerAsyncNotAllowedDefect()
    },
  },
  {
    key: "queueMicrotask",
    owner: globalThis,
    propertyKey: "queueMicrotask",
    value: (..._args: ReadonlyArray<unknown>) => {
      throw new HandlerAsyncNotAllowedDefect()
    },
  },
  {
    key: "Math.random",
    owner: Math,
    propertyKey: "random",
    value: (..._args: ReadonlyArray<unknown>) => {
      throw new HandlerGlobalRandomNotAllowedDefect()
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

// Capture the host wall clock when the runtime module loads, before any
// reducer can install process-global development guards. Procedure invocations
// may overlap reducer transactions in tests, so capturing at invocation time
// can accidentally retain the guarded Date.now implementation.
const procedureWallClockNow = Date.now.bind(Date)

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

export const serverRuntimeModeDefault: ConstrainedServerRuntimeMode =
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
        throw new HandlerWallClockNotAllowedDefect()
      }

      return Reflect.construct(target, args, newTarget)
    },
    get: (target, propertyKey, receiver) => {
      // Guard wall-clock reads on the *active* constructor: `Date.now()` resolves
      // through this proxy, so the guard holds even when globalThis.Date was
      // replaced (e.g. fake timers) before dev-guarded mode was entered.
      if (propertyKey === "now") {
        return () => {
          throw new HandlerWallClockNotAllowedDefect()
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
  catch: (cause) => new ServerPolyfillInstallDefect({ cause }),
}).pipe(Effect.orDie)

const installDevGuardsScoped = Effect.acquireRelease(
  Effect.try({
    try: () => installDevGuards(),
    catch: (cause) => new ServerDevGuardInstallDefect({ cause }),
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
  effect.pipe(
    Effect.provideService(Scheduler.MaxOpsBeforeYield, Number.MAX_SAFE_INTEGER),
    Effect.provideService(Scheduler.PreventSchedulerYield, true),
  )

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

/**
 * A handler runs to completion inside one synchronous host call, so a real
 * sleep can only be a defect. A typed failure here would sit in a `never`
 * channel, where `catch` swallows it and `retry` gives up after one attempt.
 * `retry` and `repeat` without a delay sleep for zero, which is no wait at all.
 */
const sleepNotAllowed = (duration: Duration.Duration): Effect.Effect<void> =>
  Duration.isZero(duration)
    ? Effect.void
    : Effect.die(new HandlerAsyncNotAllowedDefect())

const makeFixedServerClock = (microsSinceUnixEpoch: bigint): Clock.Clock => {
  const millis = Number(microsSinceUnixEpoch / 1000n)
  const nanos = microsSinceUnixEpoch * 1000n

  return {
    currentTimeMillisUnsafe: () => millis,
    currentTimeNanosUnsafe: () => nanos,
    currentTimeMillis: Effect.succeed(millis),
    currentTimeNanos: Effect.succeed(nanos),
    // A reducer runs at exactly one logical instant: SpacetimeDB hands it a
    // single transaction timestamp and replays must reproduce it. So the
    // monotonic source is that same frozen instant rather than a real
    // monotonic reading — every elapsed-time measurement inside a reducer is
    // therefore 0, which is the deterministic answer. Reading host monotonic
    // time here would be the one place nondeterminism could leak back in.
    // Effect only ever subtracts two readings from the same clock, and the
    // contract permits an arbitrary origin, so a constant satisfies it.
    monotonicTimeNanosUnsafe: () => nanos,
    monotonicTimeNanos: Effect.succeed(nanos),
    sleep: sleepNotAllowed,
  }
}

export const makeServerClock = (ctx: TimestampCtx): Clock.Clock =>
  makeFixedServerClock(ctx.timestamp.microsSinceUnixEpoch)

export const makeProcedureServerClock = (
  wallClockNow: () => number = procedureWallClockNow,
): Clock.Clock => {
  const currentTimeNanos = () => BigInt(wallClockNow()) * 1_000_000n
  // Procedures are the one server context allowed to read wall time, and the
  // guarded host clock is the only time source they have. Elapsed-time callers
  // must never see time run backwards, though, and a wall clock can be
  // corrected — so the monotonic reading is the guarded clock clamped to its
  // own high-water mark. The origin is arbitrary (the contract allows that);
  // what this buys is that differences are never negative.
  let monotonicHighWaterNanos = 0n
  const monotonicTimeNanos = () => {
    const observed = currentTimeNanos()
    if (observed > monotonicHighWaterNanos) monotonicHighWaterNanos = observed
    return monotonicHighWaterNanos
  }
  return {
    currentTimeMillisUnsafe: wallClockNow,
    currentTimeNanosUnsafe: currentTimeNanos,
    currentTimeMillis: Effect.suspend(() => Effect.succeed(wallClockNow())),
    currentTimeNanos: Effect.suspend(() => Effect.succeed(currentTimeNanos())),
    monotonicTimeNanosUnsafe: monotonicTimeNanos,
    monotonicTimeNanos: Effect.suspend(() =>
      Effect.succeed(monotonicTimeNanos()),
    ),
    sleep: sleepNotAllowed,
  }
}

// Views have no transaction timestamp. A fixed epoch clock keeps Effect's
// tracing/logging internals deterministic without consulting guarded wall time.
export const makeUntimedServerClock = (): Clock.Clock => ({
  currentTimeMillisUnsafe: () => 0,
  currentTimeNanosUnsafe: () => 0n,
  currentTimeMillis: Effect.die(new HandlerWallClockNotAllowedDefect()),
  currentTimeNanos: Effect.die(new HandlerWallClockNotAllowedDefect()),
  // Same split as the wall-clock members above, and for the same reason: the
  // unsafe reader returns a fixed value so Effect's own tracing/logging
  // internals keep working inside a view, while the Effect-visible reader is a
  // defect so user code asking a view what time it is fails loudly. A view has
  // no timestamp at all, so a constant is the only deterministic answer.
  monotonicTimeNanosUnsafe: () => 0n,
  monotonicTimeNanos: Effect.die(new HandlerWallClockNotAllowedDefect()),
  sleep: sleepNotAllowed,
})

export const makeServerRandom = (ctx: RandomCtx): Random.Random => ({
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
  mode: ConstrainedServerRuntimeMode = serverRuntimeModeDefault,
) => {
  const provided = Match.value(mode).pipe(
    Match.when("dev-guarded", () =>
      effect.pipe(withDevGuards, withServerPolyfills),
    ),
    Match.when("runtime", () => withServerPolyfills(effect)),
    Match.exhaustive,
  )

  return provided.pipe(
    withDeterministicDefaultTracer,
    withHostLogger,
    providePreventSchedulerYield,
  )
}

export const provideConstrainedServerRuntime = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  ctx: TimedRuntimeCtx,
  mode: ConstrainedServerRuntimeMode = serverRuntimeModeDefault,
  clock: Clock.Clock = makeServerClock(ctx),
) =>
  provideConstrainedServerSupport(
    effect.pipe(
      Effect.provideService(Clock.Clock, clock),
      Effect.provideService(Random.Random, makeServerRandom(ctx)),
    ),
    mode,
  )
