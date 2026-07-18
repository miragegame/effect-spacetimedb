import * as Effect from "effect/Effect"
import type { AnyModuleSpec } from "../contract/module.ts"
import type { StdbDecodeError } from "../decode-error.ts"
import * as ServerContext from "./context.ts"
import type {
  HttpTransactionHelper,
  HttpTxAllowedRequirementsFor,
  HttpTxEffectWithoutScopedSuccess,
  TransactionHelper,
  TxAllowedRequirements,
  TxAllowedRequirementsFor,
  TxEffectWithoutScopedSuccess,
} from "./handler-types.ts"
import type { StdbHostFailure } from "./services.ts"

type WithTx<Module extends AnyModuleSpec> = <A, E, R>(
  effect: ServerContext.EffectWithoutForbiddenRequirements<
    Effect.Effect<A, E, R>,
    TxAllowedRequirements
  >,
) => Effect.Effect<
  A,
  E | StdbHostFailure | StdbDecodeError,
  | Exclude<R, TxAllowedRequirements>
  | ServerContext.ModuleScopedRequirement<Module, ServerContext.TxRunner>
>

export const makeTransactionHelpers = <Module extends AnyModuleSpec>(): {
  readonly withTx: WithTx<Module>
  readonly tx: TransactionHelper<Module>
  readonly httpTx: HttpTransactionHelper<Module>
} => {
  const withTx = <A, E, R>(
    effect: ServerContext.EffectWithoutForbiddenRequirements<
      Effect.Effect<A, E, R>,
      TxAllowedRequirements
    >,
  ): Effect.Effect<
    A,
    E | StdbHostFailure | StdbDecodeError,
    | Exclude<R, TxAllowedRequirements>
    | ServerContext.ModuleScopedRequirement<Module, ServerContext.TxRunner>
  > =>
    // Legacy ServerInstance.withTx validation is intentionally module-blind;
    // only its residual runner requirement is branded for transaction-family coherence.
    // @effect-diagnostics-next-line unsafeEffectTypeAssertion:off
    Effect.flatMap(ServerContext.TxRunner, (txRunner) =>
      txRunner.run(effect as never),
    ) as Effect.Effect<
      A,
      E | StdbHostFailure | StdbDecodeError,
      | Exclude<R, TxAllowedRequirements>
      | ServerContext.ModuleScopedRequirement<Module, ServerContext.TxRunner>
    >

  const tx = (<A, E, R>(
    body: (scope: {
      readonly ctx: ServerContext.TxCtxService<Module>
      readonly db: ServerContext.DbService<Module>
    }) => TxEffectWithoutScopedSuccess<Module, Effect.Effect<A, E, R>> &
      ServerContext.EffectWithoutForbiddenRequirements<
        TxEffectWithoutScopedSuccess<Module, Effect.Effect<A, E, R>>,
        TxAllowedRequirementsFor<Module>
      >,
  ): Effect.Effect<
    A,
    E | StdbHostFailure | StdbDecodeError,
    | Exclude<R, TxAllowedRequirementsFor<Module>>
    | ServerContext.ModuleScopedRequirement<Module, ServerContext.TxRunner>
  > => {
    const scoped = Effect.flatMap(ServerContext.TxCtx, (ctx) =>
      Effect.flatMap(
        ServerContext.Db,
        (db) =>
          body({
            ctx: ctx as ServerContext.TxCtxService<Module>,
            db: db as ServerContext.DbService<Module>,
          }) as TxEffectWithoutScopedSuccess<Module, Effect.Effect<A, E, R>>,
      ),
    )
    const constrained =
      scoped as ServerContext.EffectWithoutForbiddenRequirements<
        Effect.Effect<A, E, R>,
        TxAllowedRequirementsFor<Module>
      >
    const run = withTx(
      constrained as ServerContext.EffectWithoutForbiddenRequirements<
        Effect.Effect<A, E, R>,
        TxAllowedRequirements
      >,
    )
    // Server binding boundary: withTx preserves the caller channel after removing tx-scoped services.
    // @effect-diagnostics-next-line unsafeEffectTypeAssertion:off
    return run as Effect.Effect<
      A,
      E | StdbHostFailure | StdbDecodeError,
      | Exclude<R, TxAllowedRequirementsFor<Module>>
      | ServerContext.ModuleScopedRequirement<Module, ServerContext.TxRunner>
    >
  }) as TransactionHelper<Module>

  const httpWithTx = <A, E, R>(
    effect: ServerContext.EffectWithoutForbiddenRequirements<
      Effect.Effect<A, E, R>,
      HttpTxAllowedRequirementsFor<Module>
    >,
  ): Effect.Effect<
    A,
    E | StdbHostFailure | StdbDecodeError,
    | Exclude<R, HttpTxAllowedRequirementsFor<Module>>
    | ServerContext.ModuleScopedRequirement<Module, ServerContext.HttpTxRunner>
  > => {
    const validEffect = effect as Effect.Effect<A, E, R>
    const run = Effect.flatMap(
      ServerContext.httpTxRunnerForModule<Module>(),
      (txRunner) =>
        txRunner.run(
          validEffect as ServerContext.EffectWithoutForbiddenRequirements<
            Effect.Effect<A, E, R>,
            HttpTxAllowedRequirementsFor<Module>
          >,
        ),
    )
    // Server binding boundary: HttpTxRunner removes HTTP transaction services that the helper supplies.
    return run as Effect.Effect<
      A,
      E | StdbHostFailure | StdbDecodeError,
      | Exclude<R, HttpTxAllowedRequirementsFor<Module>>
      | ServerContext.ModuleScopedRequirement<
          Module,
          ServerContext.HttpTxRunner
        >
    >
  }

  const httpTx = (<A, E, R>(
    body: (scope: {
      readonly db: ServerContext.DbService<Module>
    }) => HttpTxEffectWithoutScopedSuccess<Module, Effect.Effect<A, E, R>> &
      ServerContext.EffectWithoutForbiddenRequirements<
        HttpTxEffectWithoutScopedSuccess<Module, Effect.Effect<A, E, R>>,
        HttpTxAllowedRequirementsFor<Module>
      >,
  ) =>
    httpWithTx(
      Effect.flatMap(
        ServerContext.Db,
        (db) =>
          body({
            db: db as ServerContext.DbService<Module>,
          }) as HttpTxEffectWithoutScopedSuccess<
            Module,
            Effect.Effect<A, E, R>
          >,
      ) as ServerContext.EffectWithoutForbiddenRequirements<
        HttpTxEffectWithoutScopedSuccess<Module, Effect.Effect<A, E, R>>,
        HttpTxAllowedRequirementsFor<Module>
      >,
    )) as HttpTransactionHelper<Module>

  return { withTx, tx, httpTx }
}
