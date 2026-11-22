import type * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import type { HandlerLogAnnotations } from "./bind-support.ts"
import {
  prettyFailureCause,
  resolveAsyncEscape,
  stringifyFailure,
} from "./callable-runtime.ts"
import type { SyncRunner } from "./sync-runner.ts"

export type CallLogAnnotations = HandlerLogAnnotations & {
  readonly route?: string
  readonly sender?: string
}

/** One host call's way out of Effect, shared by every callable kind. */
export type CallBoundary<RuntimeR> = {
  readonly run: <A, E>(
    effect: () => Effect.Effect<A, E, RuntimeR>,
  ) => Exit.Exit<A, unknown>
  /**
   * Resolves a failed exit into the cause the caller's answer is built from,
   * reporting it once unless `isAnswer` says it is no failure of the module.
   */
  readonly settle: <A>(
    exit: Exit.Exit<A, unknown>,
    isAnswer?: (cause: Cause.Cause<unknown>) => boolean,
  ) => Exit.Exit<A, unknown>
  readonly report: (cause: Cause.Cause<unknown>) => void
  readonly warn: (message: string) => void
}

const ranWithoutThrowing = (run: () => void): boolean => {
  try {
    run()
    return true
  } catch {
    return false
  }
}

/**
 * Every call leaves Effect through here. Going through one place is what makes
 * a report exactly once: a failure inside `withTx` comes back as this call's
 * cause, and a handler that went asynchronous, or a runtime that could not
 * start, only exists once the fiber has already returned.
 */
export const makeCallBoundaryFactory =
  <RuntimeR>(
    runner: SyncRunner<RuntimeR>,
    onDefect: ((cause: Cause.Cause<unknown>) => void) | undefined,
  ) =>
  (
    annotations: CallLogAnnotations,
    provideLogRuntime: (effect: Effect.Effect<void>) => Effect.Effect<void>,
  ): CallBoundary<RuntimeR> => {
    // This may run inside a procedure, which must not throw. A runner whose
    // layer failed to build cannot run the line that says so, and the line
    // needs no service of the runner's.
    const log = (entry: Effect.Effect<void>): void => {
      const logged = Effect.suspend(() => provideLogRuntime(entry)).pipe(
        Effect.annotateLogs(annotations),
      )
      if (!ranWithoutThrowing(() => runner.runSync(logged))) {
        ranWithoutThrowing(() => Effect.runSync(logged))
      }
    }

    const report = (cause: Cause.Cause<unknown>): void => {
      log(Effect.suspend(() => cause.pipe(prettyFailureCause, Effect.logError)))
      if (onDefect === undefined) {
        return
      }

      try {
        onDefect(cause)
      } catch (thrown) {
        // Reading what a hook threw can throw again, so it happens in the line.
        log(
          Effect.suspend(() =>
            Effect.logError(`onDefect threw: ${stringifyFailure(thrown)}`),
          ).pipe(
            Effect.catchDefect(() =>
              Effect.logError("onDefect threw a value that cannot be read"),
            ),
          ),
        )
      }
    }

    return {
      run: (effect) => {
        try {
          return runner.runSyncExit(
            Effect.suspend(effect).pipe(Effect.annotateLogs(annotations)),
          )
        } catch (thrown) {
          return Exit.die(thrown)
        }
      },
      settle: (exit, isAnswer = () => false) => {
        if (Exit.isSuccess(exit)) {
          return exit
        }

        const cause = resolveAsyncEscape(exit.cause)
        if (!isAnswer(cause)) {
          report(cause)
        }
        return Exit.failCause(cause)
      },
      report,
      warn: (message) => log(Effect.logWarning(message)),
    }
  }
