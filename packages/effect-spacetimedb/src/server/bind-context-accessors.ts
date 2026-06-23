import * as Effect from "effect/Effect"
import type { AnyModuleSpec } from "../contract/module.ts"
import {
  makeCallableContextHelpers,
  makeHttpHandlerContextHelpers,
} from "./bind-support.ts"
import * as ServerContext from "./context.ts"

export const makeServerContextAccessors = <Module extends AnyModuleSpec>() => ({
  ctx: {
    reducer: {
      ...makeCallableContextHelpers(ServerContext.ReducerCtx, "reducerCtx"),
      senderAuth: Effect.map(
        ServerContext.ReducerCtx,
        (reducerCtx) => reducerCtx.senderAuth,
      ),
    },
    procedure: makeCallableContextHelpers(
      ServerContext.ProcedureCtx,
      "procedureCtx",
    ),
    httpHandler: makeHttpHandlerContextHelpers(ServerContext.HttpHandlerCtx),
    tx: {
      ...makeCallableContextHelpers(ServerContext.TxCtx, "txCtx"),
      senderAuth: Effect.map(ServerContext.TxCtx, (txCtx) => txCtx.senderAuth),
    },
    view: {
      sender: Effect.map(ServerContext.ViewCtx, (viewCtx) => viewCtx.sender),
    },
  },
  reducerCtx: Effect.map(
    ServerContext.ReducerCtx,
    (ctx) => ctx as ServerContext.ReducerCtxService<Module>,
  ),
  procedureCtx: Effect.map(
    ServerContext.ProcedureCtx,
    (ctx) => ctx as ServerContext.ProcedureCtxService<Module>,
  ),
  httpHandlerCtx: Effect.map(
    ServerContext.HttpHandlerCtx,
    (ctx) => ctx as ServerContext.HttpHandlerCtxService<Module>,
  ),
  txCtx: Effect.map(
    ServerContext.TxCtx,
    (ctx) => ctx as ServerContext.TxCtxService<Module>,
  ),
  mutationCtx: Effect.map(
    ServerContext.MutationCtx,
    (ctx) => ctx as ServerContext.MutationCtxService<Module>,
  ),
  viewCtx: Effect.map(
    ServerContext.ViewCtx,
    (ctx) => ctx as ServerContext.ViewCtxService<Module>,
  ),
  anonymousViewCtx: Effect.map(
    ServerContext.AnonymousViewCtx,
    (ctx) => ctx as ServerContext.AnonymousViewCtxService<Module>,
  ),
  db: Effect.map(
    ServerContext.Db,
    (db) => db as ServerContext.DbService<Module>,
  ),
  readonlyDb: Effect.map(
    ServerContext.ReadonlyDb,
    (db) => db as ServerContext.ReadonlyDbService<Module>,
  ),
  from: Effect.map(
    ServerContext.From,
    (from) => from as ServerContext.FromService<Module>,
  ),
  http: Effect.map(ServerContext.Http, (http) => http),
  txRunner: ServerContext.txRunnerForModule<Module>(),
  httpTxRunner: ServerContext.httpTxRunnerForModule<Module>(),
})
