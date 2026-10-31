import * as Effect from "effect/Effect"
import type { AnyModuleSpec } from "../contract/module.ts"
import * as ServerContext from "../server/context.ts"
import type { ModuleAccessors } from "./declarations.ts"

// Module accessors are typed facades over shared runtime tags; this is the
// single builder-side seam that attaches the module brand to the R channel.
const moduleScopedAccessor = <
  Spec extends AnyModuleSpec,
  A,
  Requirement extends ServerContext.AnyServerContextRequirements,
>(
  effect: Effect.Effect<A, never, Requirement>,
): Effect.Effect<
  A,
  never,
  ServerContext.ModuleScopedRequirement<Spec, Requirement>
> =>
  // Builder accessor boundary: the runtime tag is shared; only the R-channel
  // records which module accessor produced it.
  // @effect-diagnostics-next-line unsafeEffectTypeAssertion:off
  effect as Effect.Effect<
    A,
    never,
    ServerContext.ModuleScopedRequirement<Spec, Requirement>
  >

export const makeAccessors = <
  Spec extends AnyModuleSpec,
>(): ModuleAccessors<Spec> => ({
  Db: moduleScopedAccessor<
    Spec,
    ServerContext.DbService<Spec>,
    ServerContext.Db
  >(Effect.map(ServerContext.Db, (db) => db as ServerContext.DbService<Spec>)),
  ReadonlyDb: moduleScopedAccessor<
    Spec,
    ServerContext.ReadonlyDbService<Spec>,
    ServerContext.ReadonlyDb
  >(
    Effect.map(
      ServerContext.ReadonlyDb,
      (db) => db as ServerContext.ReadonlyDbService<Spec>,
    ),
  ),
  ReducerCtx: moduleScopedAccessor<
    Spec,
    ServerContext.ReducerCtxService<Spec>,
    ServerContext.ReducerCtx
  >(
    Effect.map(
      ServerContext.ReducerCtx,
      (ctx) => ctx as ServerContext.ReducerCtxService<Spec>,
    ),
  ),
  ProcedureCtx: moduleScopedAccessor<
    Spec,
    ServerContext.ProcedureCtxService<Spec>,
    ServerContext.ProcedureCtx
  >(
    Effect.map(
      ServerContext.ProcedureCtx,
      (ctx) => ctx as ServerContext.ProcedureCtxService<Spec>,
    ),
  ),
  TxCtx: moduleScopedAccessor<
    Spec,
    ServerContext.TxCtxService<Spec>,
    ServerContext.TxCtx
  >(
    Effect.map(
      ServerContext.TxCtx,
      (ctx) => ctx as ServerContext.TxCtxService<Spec>,
    ),
  ),
  ViewCtx: moduleScopedAccessor<
    Spec,
    ServerContext.ViewCtxService<Spec>,
    ServerContext.ViewCtx
  >(
    Effect.map(
      ServerContext.ViewCtx,
      (ctx) => ctx as ServerContext.ViewCtxService<Spec>,
    ),
  ),
  AnonymousViewCtx: moduleScopedAccessor<
    Spec,
    ServerContext.AnonymousViewCtxService<Spec>,
    ServerContext.AnonymousViewCtx
  >(
    Effect.map(
      ServerContext.AnonymousViewCtx,
      (ctx) => ctx as ServerContext.AnonymousViewCtxService<Spec>,
    ),
  ),
  HttpHandlerCtx: moduleScopedAccessor<
    Spec,
    ServerContext.HttpHandlerCtxService<Spec>,
    ServerContext.HttpHandlerCtx
  >(
    Effect.map(
      ServerContext.HttpHandlerCtx,
      (ctx) => ctx as ServerContext.HttpHandlerCtxService<Spec>,
    ),
  ),
  MutationCtx: moduleScopedAccessor<
    Spec,
    ServerContext.MutationCtxService<Spec>,
    ServerContext.MutationCtx
  >(
    Effect.map(
      ServerContext.MutationCtx,
      (ctx) => ctx as ServerContext.MutationCtxService<Spec>,
    ),
  ),
  From: moduleScopedAccessor<
    Spec,
    ServerContext.FromService<Spec>,
    ServerContext.From
  >(
    Effect.map(
      ServerContext.From,
      (from) => from as ServerContext.FromService<Spec>,
    ),
  ),
  // Http is module-independent and deliberately unbranded.
  Http: ServerContext.Http,
  Env: moduleScopedAccessor<
    Spec,
    ServerContext.EnvService<Spec>,
    ServerContext.Env
  >(
    Effect.map(
      ServerContext.Env,
      (env) => env as ServerContext.EnvService<Spec>,
    ),
  ),
  Tx: ServerContext.txRunnerForModule<Spec>(),
  withTx: (effect) =>
    Effect.flatMap(ServerContext.txRunnerForModule<Spec>(), (runner) =>
      runner.run(effect),
    ),
  HttpTx: ServerContext.httpTxRunnerForModule<Spec>(),
})
