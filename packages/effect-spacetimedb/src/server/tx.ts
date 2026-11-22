import * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import type * as Scope from "effect/Scope"
import { errorTypeId, hasErrorTypeId } from "../error-identity.ts"
import { resolveAsyncEscape } from "./callable-runtime.ts"
import * as ServerContext from "./context.ts"
import type {
  AnyServerContextRequirements,
  EffectWithoutForbiddenRequirements,
  HttpTxAllowedRequirements,
  TxAllowedRequirements,
  WithEnv,
} from "./context.ts"
import type { HandlerRequirements } from "./handler-types.ts"
import { type HostFailure, toHostFailure } from "./services.ts"
import type { SyncRunner } from "./sync-runner.ts"

type ScopedTxRunner<RuntimeR, Allowed extends AnyServerContextRequirements> = {
  readonly run: <A, E, R extends HandlerRequirements<RuntimeR, Allowed>>(
    effect: EffectWithoutForbiddenRequirements<Effect.Effect<A, E, R>, Allowed>,
  ) => Effect.Effect<A, E | HostFailure, Exclude<R, Allowed | Scope.Scope>>
}

export type TxRunner<RuntimeR = never> = ScopedTxRunner<
  RuntimeR,
  WithEnv<TxAllowedRequirements>
>

export type DbOnlyTxRunner<RuntimeR = never> = ScopedTxRunner<
  RuntimeR,
  WithEnv<HttpTxAllowedRequirements>
>

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

const TxDomainErrorTypeId = errorTypeId("TxDomainError")
class TxDomainError {
  readonly _tag = "TxDomainError"
  readonly [TxDomainErrorTypeId] = TxDomainErrorTypeId
  static is = hasErrorTypeId<TxDomainError>(TxDomainErrorTypeId)

  constructor(readonly error: unknown) {}
}

const TxDomainDefectTypeId = errorTypeId("TxDomainDefect")
class TxDomainDefect {
  readonly _tag = "TxDomainDefect"
  readonly [TxDomainDefectTypeId] = TxDomainDefectTypeId
  static is = hasErrorTypeId<TxDomainDefect>(TxDomainDefectTypeId)

  constructor(readonly defect: unknown) {}
}

/**
 * What a transaction body must not inherit from its caller: the callable's own
 * context, and with it a second way into a transaction. The body gets whichever
 * of these it may use from the transaction itself.
 */
const dropServerContext = Context.omit(
  ServerContext.AnonymousViewCtx,
  ServerContext.Db,
  ServerContext.Env,
  ServerContext.From,
  ServerContext.Http,
  ServerContext.HttpHandlerCtx,
  ServerContext.HttpTxRunner,
  ServerContext.MutationCtx,
  ServerContext.ProcedureCtx,
  ServerContext.ReadonlyDb,
  ServerContext.ReducerCtx,
  ServerContext.TxCtx,
  ServerContext.TxRunner,
  ServerContext.ViewCtx,
)

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
    ): Effect.Effect<A, E | HostFailure, Exclude<R, Allowed | Scope.Scope>> =>
      // The host takes the body as a synchronous callback, so it needs a fiber
      // of its own. That fiber still answers to its caller: services the caller
      // provided, its log annotations and its span all carry over, and the
      // transaction's own services are provided inside them. The body's scope
      // is the transaction's and shadows any the caller holds, so a release
      // runs before the commit, with the body's `Db`, and aborts it by dying.
      Effect.contextWith((caller: Context.Context<never>) => {
        const inherited = dropServerContext(caller)
        return Effect.try({
          try: () =>
            options.ctx.withTx((txCtx) => {
              // Tx runner boundary: invalid requirements are rejected at the
              // caller, so runtime execution receives the validated Effect.
              const scopedEffect = effect as Effect.Effect<A, E, R>
              const exit = options.runner.runSyncExit(
                options
                  .provideServices(txCtx, scopedEffect.pipe(Effect.scoped))
                  .pipe(Effect.provideContext(inherited)),
              )

              return Exit.match(exit, {
                onFailure: (failed) => {
                  // Resolved here, not at the call's boundary: a caller can
                  // read this exit, and a suspended body's finalizers belong
                  // inside the transaction it is about to abort.
                  const cause = resolveAsyncEscape(failed)
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
                      throw new TxDomainError(error)
                    },
                  })
                },
                onSuccess: (value) => value,
              })
            }),
          catch: (cause) =>
            TxDomainError.is(cause) || TxDomainDefect.is(cause)
              ? cause
              : toHostFailure("withTx", cause),
        }).pipe(
          Effect.catchIf(TxDomainError.is, (cause) =>
            Effect.fail(cause.error as E),
          ),
          Effect.catchIf(TxDomainDefect.is, (cause) =>
            Effect.die(cause.defect),
          ),
        )
      }),
  }) satisfies ScopedTxRunner<RuntimeR, Allowed>

export const makeTxRunner = <RuntimeR, TxCtx>(
  options: ScopedTxRunnerOptions<
    RuntimeR,
    TxCtx,
    WithEnv<TxAllowedRequirements>
  >,
): TxRunner<RuntimeR> => makeScopedTxRunner(options)

export const makeDbOnlyTxRunner = <RuntimeR, TxCtx>(
  options: ScopedTxRunnerOptions<
    RuntimeR,
    TxCtx,
    WithEnv<HttpTxAllowedRequirements>
  >,
): DbOnlyTxRunner<RuntimeR> => makeScopedTxRunner(options)
