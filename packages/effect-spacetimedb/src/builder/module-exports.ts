import type { ModuleAccessors } from "./declarations.ts"
import type { AnyModule } from "./handler-types.ts"
import type { SpecOfModule } from "./type-utils.ts"

export type ModuleExports<Module extends AnyModule> = ModuleAccessors<
  SpecOfModule<Module>
>

export type ModuleWithAccessors<Module extends AnyModule> = Module &
  ModuleExports<Module>

export const moduleExports = <const Module extends AnyModule>(
  module: ModuleWithAccessors<Module>,
): ModuleExports<Module> => ({
  Db: module.Db,
  mounts: module.mounts,
  ReadonlyDb: module.ReadonlyDb,
  ReducerCtx: module.ReducerCtx,
  ProcedureCtx: module.ProcedureCtx,
  TxCtx: module.TxCtx,
  ViewCtx: module.ViewCtx,
  AnonymousViewCtx: module.AnonymousViewCtx,
  HttpHandlerCtx: module.HttpHandlerCtx,
  MutationCtx: module.MutationCtx,
  From: module.From,
  Http: module.Http,
  Env: module.Env,
  Tx: module.Tx,
  withTx: module.withTx,
  HttpTx: module.HttpTx,
})
