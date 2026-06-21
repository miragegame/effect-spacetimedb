import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import { decodeDefectFromCause, type StdbDecodeError } from "../decode-error.ts"
import type {
  AnyServerContextRequirements,
  Db,
  EffectWithoutForbiddenRequirements,
  TxAllowedRequirements,
} from "./context.ts"
import type { HandlerRequirements } from "./handler-types.ts"
import { type StdbHostFailure, toHostFailure } from "./services.ts"
import type { SyncRunner } from "./sync-runner.ts"

type ScopedTxRunner<RuntimeR, Allowed extends AnyServerContextRequirements> = {
  readonly run: <A, E, R extends HandlerRequirements<RuntimeR, Allowed>>(
    effect: EffectWithoutForbiddenRequirements<Effect.Effect<A, E, R>, Allowed>,
  ) => Effect.Effect<
    A,
    E | StdbHostFailure | StdbDecodeError,
    Exclude<R, Allowed>
  >
}

export type TxRunner<RuntimeR = never> = ScopedTxRunner<
  RuntimeR,
  TxAllowedRequirements
>

export type DbOnlyTxRunner<RuntimeR = never> = ScopedTxRunner<RuntimeR, Db>

type ScopedTxRunnerOptions<
  RuntimeR,
  TxCtx,
  Allowed extends AnyServerContextRequirements,
> = {
  readonly ctx: {
    readonly withTx: <A>(body: (ctx: TxCtx) => A) => A
  }
  readonly runner: SyncRunner<RuntimeR>
  readonly provideServices: <
    A,
    E,
    R extends HandlerRequirements<RuntimeR, Allowed>,
  >(
    txCtx: TxCtx,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, RuntimeR>
}

class TxDomainFailure {
  readonly _tag = "TxDomainFailure"

  constructor(readonly error: unknown) {}
}

class TxDomainDefect {
  readonly _tag = "TxDomainDefect"

  constructor(readonly defect: unknown) {}
}

const makeScopedTxRunner = <
  RuntimeR,
  TxCtx,
  Allowed extends AnyServerContextRequirements,
>(
  options: ScopedTxRunnerOptions<RuntimeR, TxCtx, Allowed>,
): ScopedTxRunner<RuntimeR, Allowed> =>
  ({
    run: <A, E, R extends HandlerRequirements<RuntimeR, Allowed>>(
      effect: EffectWithoutForbiddenRequirements<
        Effect.Effect<A, E, R>,
        Allowed
      >,
    ): Effect.Effect<
      A,
      E | StdbHostFailure | StdbDecodeError,
      Exclude<R, Allowed>
    > =>
      Effect.try({
        try: () =>
          options.ctx.withTx((txCtx) => {
            const exit = options.runner.runSyncExit(
              options.provideServices(txCtx, effect),
            )

            return Exit.match(exit, {
              onFailure: (cause) => {
                const directDecodeFailure = decodeDefectFromCause(cause)
                if (directDecodeFailure != null) {
                  throw new TxDomainFailure(directDecodeFailure)
                }

                const defect = cause.reasons.find(Cause.isDieReason)?.defect
                if (defect !== undefined) {
                  throw new TxDomainDefect(defect)
                }

                const failure = Cause.findErrorOption(cause)
                return Option.match(failure, {
                  onNone: () => {
                    throw new TxDomainDefect(Cause.squash(cause))
                  },
                  onSome: (error) => {
                    throw new TxDomainFailure(error)
                  },
                })
              },
              onSuccess: (value) => value,
            })
          }),
        catch: (cause) =>
          cause instanceof TxDomainFailure || cause instanceof TxDomainDefect
            ? cause
            : toHostFailure("withTx", cause),
      }).pipe(
        Effect.catchIf(
          (cause): cause is TxDomainFailure => cause instanceof TxDomainFailure,
          (cause) => Effect.fail(cause.error as E | StdbDecodeError),
        ),
        Effect.catchIf(
          (cause): cause is TxDomainDefect => cause instanceof TxDomainDefect,
          (cause) => Effect.die(cause.defect),
        ),
      ),
  }) satisfies ScopedTxRunner<RuntimeR, Allowed>

export const makeTxRunner = <RuntimeR, TxCtx>(
  options: ScopedTxRunnerOptions<RuntimeR, TxCtx, TxAllowedRequirements>,
): TxRunner<RuntimeR> => makeScopedTxRunner(options)

export const makeDbOnlyTxRunner = <RuntimeR, TxCtx>(
  options: ScopedTxRunnerOptions<RuntimeR, TxCtx, Db>,
): DbOnlyTxRunner<RuntimeR> => makeScopedTxRunner(options)
