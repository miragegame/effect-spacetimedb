import type { ModuleAccessors } from "./declarations.ts"
import type { AnyStdbModule } from "./handler-types.ts"
import type { SpecOfModule } from "./type-utils.ts"

export type ModuleExports<Module extends AnyStdbModule> = ModuleAccessors<
  SpecOfModule<Module>
>

type ModuleWithAccessors<Module extends AnyStdbModule> = Module &
  ModuleExports<Module>

export const moduleExports = <const Module extends AnyStdbModule>(
  module: ModuleWithAccessors<Module>,
): ModuleExports<Module> => ({
  Db: module.Db,
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
  Tx: module.Tx,
  withTx: module.withTx,
  HttpTx: module.HttpTx,
})
