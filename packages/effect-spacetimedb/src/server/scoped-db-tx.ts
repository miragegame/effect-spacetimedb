import * as Effect from "effect/Effect"
import type { AnyModuleSpec } from "../contract/module.ts"
import type { AnyTableSpec } from "../contract/table.ts"
import type { StdbDecodeError } from "../decode-error.ts"
import type { ModuleAccessors } from "../builder/declarations.ts"
import * as ServerContext from "./context.ts"
import type { DbHandleFor, StdbHostFailure } from "./services.ts"

export type FragmentTxCtx = Pick<
  ServerContext.MutationCtxService<AnyModuleSpec>,
  "timestamp" | "random"
>

export type FragmentTxScopedSuccess<
  Tables extends Record<string, AnyTableSpec>,
> = DbHandleFor<Tables> | FragmentTxCtx

// Guards the common accidental escape case where a reusable transaction
// fragment directly returns the scoped db/ctx handle. Wrapped user objects are
// intentionally outside this lightweight structural guard.
export type ScopedDbTxEffectWithoutScopedSuccess<
  Tables extends Record<string, AnyTableSpec>,
  EffectType extends ServerContext.AnyServerEffect,
> = [
  Extract<Effect.Success<EffectType>, FragmentTxScopedSuccess<Tables>>,
] extends [never]
  ? EffectType
  : never

export type ScopedDbTxEffectWithoutServerRequirements<
  EffectType extends ServerContext.AnyServerEffect,
> = [
  Extract<
    Effect.Services<EffectType>,
    ServerContext.AnyServerContextRequirements
  >,
] extends [never]
  ? EffectType
  : never

export type ScopedDbTx<
  Tables extends Record<string, AnyTableSpec>,
  E0 = never,
  R0 = never,
> = <A, E, R>(
  body: (scope: {
    readonly db: DbHandleFor<Tables>
    readonly ctx: FragmentTxCtx
  }) => ScopedDbTxEffectWithoutScopedSuccess<Tables, Effect.Effect<A, E, R>> &
    ScopedDbTxEffectWithoutServerRequirements<Effect.Effect<A, E, R>>,
) => Effect.Effect<A, E | E0, R | R0>

type ScopedDbTxModule<Module extends AnyModuleSpec> = Pick<
  ModuleAccessors<Module>,
  "Db" | "MutationCtx" | "withTx"
>

type ScopedDbTxTablesMatchModule<
  Module extends AnyModuleSpec,
  Tables extends Record<string, AnyTableSpec>,
> = Module["tables"] extends Tables
  ? unknown
  : {
      readonly __scopedDbTxTablesMustBeSatisfiedByModuleTables: never
    }

/**
 * Builds a reusable transaction-fragment runner from a module value.
 *
 * The transaction body may execute more than once: SpacetimeDB re-runs it on
 * an optimistic commit conflict. Keep the body a pure function of database
 * state with no external or captured-state side effects; the transaction
 * timestamp may differ between attempts.
 */
export const scopedDbTx =
  <
    Module extends AnyModuleSpec,
    Tables extends Record<string, AnyTableSpec> = Module["tables"],
  >(
    module: ScopedDbTxModule<Module> &
      ScopedDbTxTablesMatchModule<Module, Tables>,
  ): ScopedDbTx<
    Tables,
    StdbHostFailure | StdbDecodeError,
    ServerContext.ModuleScopedRequirement<Module, ServerContext.TxRunner>
  > =>
  <A, E, R>(
    body: (scope: {
      readonly db: DbHandleFor<Tables>
      readonly ctx: FragmentTxCtx
    }) => ScopedDbTxEffectWithoutScopedSuccess<Tables, Effect.Effect<A, E, R>> &
      ScopedDbTxEffectWithoutServerRequirements<Effect.Effect<A, E, R>>,
  ) => {
    const scoped = Effect.flatMap(module.Db, (db) =>
      Effect.flatMap(module.MutationCtx, (ctx) =>
        body({
          db: db as unknown as DbHandleFor<Tables>,
          ctx,
        }),
      ),
    )

    // The generic fragment body is proven server-requirement-free by the
    // ScopedDbTx body guard; module.withTx still needs the same narrow boundary
    // cast used by transaction-helpers.ts when it hands generic effects to
    // the concrete TxRunner.
    const constrained =
      scoped as ServerContext.EffectWithoutForbiddenRequirements<
        Effect.Effect<A, E, R | ServerContext.TxAllowedRequirementsFor<Module>>,
        ServerContext.TxAllowedRequirementsFor<Module>
      >
    const run = module.withTx(constrained)

    return run as Effect.Effect<
      A,
      E | StdbHostFailure | StdbDecodeError,
      R | ServerContext.ModuleScopedRequirement<Module, ServerContext.TxRunner>
    >
  }

export const scopedDbTxFromCtx =
  <Tables extends Record<string, AnyTableSpec>>(scope: {
    readonly db: DbHandleFor<Tables>
    readonly ctx: FragmentTxCtx
  }): ScopedDbTx<Tables> =>
  <A, E, R>(
    body: (scope: {
      readonly db: DbHandleFor<Tables>
      readonly ctx: FragmentTxCtx
    }) => ScopedDbTxEffectWithoutScopedSuccess<Tables, Effect.Effect<A, E, R>> &
      ScopedDbTxEffectWithoutServerRequirements<Effect.Effect<A, E, R>>,
  ) =>
    body(scope)
