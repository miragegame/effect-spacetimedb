import type * as Effect from "effect/Effect"

import type { AnyModuleSpec } from "../contract/module.ts"

import type { StdbDecodeError } from "../decode-error.ts"

import type { ModulePlan } from "../module-plan.ts"

import type * as ServerContext from "./context.ts"

import type { OwnedHandlerBundle, ServerOwner } from "./handler-ownership.ts"

import type { HttpHandlerHandler } from "./http-handler.ts"

import type { LifecycleHandler } from "./lifecycle.ts"

import type { ProcedureHandler } from "./procedure.ts"

import type { ReducerHandler } from "./reducer.ts"

import type { ServerSender, ServerSenderAuth } from "./runtime-types.ts"

import type { StdbHostFailure, StdbSenderFailure } from "./services.ts"

import type { ViewHandler } from "./view.ts"

import type {
  AnonymousViewAllowedRequirements,
  HandlerWithoutForbiddenRequirements,
  HttpHandlerAllowedRequirements,
  HttpHandlerHandlerRecord,
  HttpHandlerKeys,
  LifecycleHandlerRecord,
  LifecycleKeys,
  ProcedureAllowedRequirements,
  ProcedureHandlerRecord,
  ProcedureKeys,
  ReducerAllowedRequirements,
  ReducerHandlerRecord,
  ReducerKeys,
  SenderViewAllowedRequirements,
  TxAllowedRequirements,
  ViewHandlerRecord,
  ViewKeys,
} from "./handler-types-core.ts"

import type {
  BoundHttpHandlerExport,
  BoundLifecycleExport,
  BoundProcedureExport,
  BoundReducerExport,
  BoundViewExport,
  CallableContextEffects,
  HandlerInputDefinitions,
  Handlers,
  HttpHandlerContextEffects,
  HttpTransactionHelper,
  TransactionHelper,
} from "./handler-types-inputs.ts"

export type BoundReducerExports<
  Module extends AnyModuleSpec,
  Specs extends Partial<Record<string, unknown>>,
> = {
  readonly [Key in keyof Specs]: Key extends ReducerKeys<Module>
    ? BoundReducerExport<Module, Key>
    : never
}

export type BoundProcedureExports<
  Module extends AnyModuleSpec,
  Specs extends Partial<Record<string, unknown>>,
> = {
  readonly [Key in keyof Specs]: Key extends ProcedureKeys<Module>
    ? BoundProcedureExport<Module, Key>
    : never
}

export type BoundHttpHandlerExports<
  Module extends AnyModuleSpec,
  Specs extends Partial<Record<string, unknown>>,
> = {
  readonly [Key in keyof Specs]: Key extends HttpHandlerKeys<Module>
    ? BoundHttpHandlerExport<Module, Key>
    : never
}

export type BoundViewExports<
  Module extends AnyModuleSpec,
  Specs extends Partial<Record<string, unknown>>,
> = {
  readonly [Key in keyof Specs]: Key extends ViewKeys<Module>
    ? BoundViewExport<Module, Key>
    : never
}

export type BoundLifecycleExports<
  Module extends AnyModuleSpec,
  Specs extends Partial<Record<string, unknown>>,
> = {
  readonly [Key in keyof Specs]: Key extends LifecycleKeys
    ? BoundLifecycleExport<Module, Key>
    : never
}

export type ServerInstance<
  Module extends AnyModuleSpec,
  _RuntimeR = never,
> = ServerOwner & {
  readonly plan: ModulePlan<Module>
  readonly module: Module
  readonly scheduleBindings: ModulePlan<Module>["scheduleBindings"]
  readonly dispose: Effect.Effect<void>
  readonly ctx: {
    readonly reducer: CallableContextEffects<ServerContext.ReducerCtx> & {
      readonly senderAuth: Effect.Effect<
        ServerSenderAuth,
        never,
        ServerContext.ReducerCtx
      >
    }
    readonly procedure: CallableContextEffects<ServerContext.ProcedureCtx>
    readonly httpHandler: HttpHandlerContextEffects<ServerContext.HttpHandlerCtx>
    readonly tx: CallableContextEffects<ServerContext.TxCtx> & {
      readonly senderAuth: Effect.Effect<
        ServerSenderAuth,
        never,
        ServerContext.TxCtx
      >
    }
    readonly view: {
      readonly sender: Effect.Effect<ServerSender, never, ServerContext.ViewCtx>
    }
  }
  readonly reducerCtx: Effect.Effect<
    ServerContext.ReducerCtxService<Module>,
    never,
    ServerContext.ReducerCtx
  >
  readonly procedureCtx: Effect.Effect<
    ServerContext.ProcedureCtxService<Module>,
    never,
    ServerContext.ProcedureCtx
  >
  readonly httpHandlerCtx: Effect.Effect<
    ServerContext.HttpHandlerCtxService<Module>,
    never,
    ServerContext.HttpHandlerCtx
  >
  readonly txCtx: Effect.Effect<
    ServerContext.TxCtxService<Module>,
    never,
    ServerContext.TxCtx
  >
  readonly mutationCtx: Effect.Effect<
    ServerContext.MutationCtxService<Module>,
    never,
    ServerContext.MutationCtx
  >
  readonly viewCtx: Effect.Effect<
    ServerContext.ViewCtxService<Module>,
    never,
    ServerContext.ViewCtx
  >
  readonly anonymousViewCtx: Effect.Effect<
    ServerContext.AnonymousViewCtxService<Module>,
    never,
    ServerContext.AnonymousViewCtx
  >
  readonly db: Effect.Effect<
    ServerContext.DbService<Module>,
    never,
    ServerContext.Db
  >
  readonly readonlyDb: Effect.Effect<
    ServerContext.ReadonlyDbService<Module>,
    never,
    ServerContext.ReadonlyDb
  >
  readonly from: Effect.Effect<
    ServerContext.FromService<Module>,
    never,
    ServerContext.From
  >
  readonly http: Effect.Effect<
    ServerContext.HttpService<Module>,
    never,
    ServerContext.Http
  >
  readonly txRunner: Effect.Effect<
    ServerContext.TxRunnerService<Module>,
    never,
    ServerContext.TxRunner
  >
  readonly httpTxRunner: Effect.Effect<
    ServerContext.HttpTxRunnerService<Module>,
    never,
    ServerContext.HttpTxRunner
  >
  readonly withTx: <A, E, R>(
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
  readonly tx: TransactionHelper<Module>
  readonly transaction: TransactionHelper<Module>
  readonly httpTransaction: HttpTransactionHelper<Module>
  readonly failRaw: (message: string) => StdbSenderFailure
}

export type InternalServerInstance<
  Module extends AnyModuleSpec,
  RuntimeR = never,
> = ServerInstance<Module, RuntimeR> & {
  /**
   * @deprecated Prefer `StdbBuilder.group(...)` and `build(...)` for new
   * server authoring.
   */
  readonly reducer: {
    <Args, A, E, R>(
      handler: HandlerWithoutForbiddenRequirements<
        (args: Args) => Effect.Effect<A, E, R>,
        ReducerAllowedRequirements
      >,
    ): ReducerHandler<Args, A, E, R>
  }
  /**
   * @deprecated Prefer `StdbBuilder.group(...)` and `build(...)` for new
   * server authoring.
   */
  readonly procedure: {
    <A, E, R>(
      handler: HandlerWithoutForbiddenRequirements<
        () => Effect.Effect<A, E, R>,
        ProcedureAllowedRequirements
      >,
    ): ProcedureHandler<void, A, E, R>
    <Args, A, E, R>(
      handler: HandlerWithoutForbiddenRequirements<
        (args: Args) => Effect.Effect<A, E, R>,
        ProcedureAllowedRequirements
      >,
    ): ProcedureHandler<Args, A, E, R>
  }
  /**
   * @deprecated Prefer `StdbBuilder.group(...)` and `build(...)` for new
   * server authoring.
   */
  readonly httpHandler: {
    <Args, A, E, R>(
      handler: HandlerWithoutForbiddenRequirements<
        (args: Args) => Effect.Effect<A, E, R>,
        HttpHandlerAllowedRequirements
      >,
    ): HttpHandlerHandler<Args, A, E, R>
  }
  /**
   * @deprecated Prefer `StdbBuilder.group(...)` and `build(...)` for new
   * server authoring.
   */
  readonly view: {
    <Args, A, E, R>(
      handler: HandlerWithoutForbiddenRequirements<
        (args: Args) => Effect.Effect<A, E, R>,
        SenderViewAllowedRequirements
      >,
    ): ViewHandler<Args, A, E, R>
  }
  /**
   * @deprecated Prefer `StdbBuilder.group(...)` and `build(...)` for new
   * server authoring.
   */
  readonly anonymousView: {
    <Args, A, E, R>(
      handler: HandlerWithoutForbiddenRequirements<
        (args: Args) => Effect.Effect<A, E, R>,
        AnonymousViewAllowedRequirements
      >,
    ): ViewHandler<Args, A, E, R>
  }
  /**
   * @deprecated Prefer `StdbBuilder.group(...)` and `build(...)` for new
   * server authoring.
   */
  readonly init: <A, E, R>(
    handler: HandlerWithoutForbiddenRequirements<
      () => Effect.Effect<A, E, R>,
      ReducerAllowedRequirements
    >,
  ) => LifecycleHandler<A, E, R>
  /**
   * @deprecated Prefer `StdbBuilder.group(...)` and `build(...)` for new
   * server authoring.
   */
  readonly clientConnected: <A, E, R>(
    handler: HandlerWithoutForbiddenRequirements<
      () => Effect.Effect<A, E, R>,
      ReducerAllowedRequirements
    >,
  ) => LifecycleHandler<A, E, R>
  /**
   * @deprecated Prefer `StdbBuilder.group(...)` and `build(...)` for new
   * server authoring.
   */
  readonly clientDisconnected: <A, E, R>(
    handler: HandlerWithoutForbiddenRequirements<
      () => Effect.Effect<A, E, R>,
      ReducerAllowedRequirements
    >,
  ) => LifecycleHandler<A, E, R>
  /**
   * @deprecated Prefer `StdbBuilder.group(...)` and `build(...)` for new
   * server authoring.
   */
  readonly handlers: {
    (
      definitions: HandlerInputDefinitions<Module, RuntimeR>,
    ): Handlers<Module, RuntimeR>
    (definitions: OwnedHandlerBundle): Handlers<Module, RuntimeR>
  }
  /**
   * @deprecated Prefer `StdbBuilder.group(...)` and `build(...)` for new
   * server authoring.
   */
  readonly reducers: <Specs extends ReducerHandlerRecord<Module, RuntimeR>>(
    handlerSpecs: Specs,
  ) => BoundReducerExports<Module, Specs>
  /**
   * @deprecated Prefer `StdbBuilder.group(...)` and `build(...)` for new
   * server authoring.
   */
  readonly procedures: <Specs extends ProcedureHandlerRecord<Module, RuntimeR>>(
    handlerSpecs: Specs,
  ) => BoundProcedureExports<Module, Specs>
  /**
   * @deprecated Prefer `StdbBuilder.group(...)` and `build(...)` for new
   * server authoring.
   */
  readonly httpHandlers: <
    Specs extends HttpHandlerHandlerRecord<Module, RuntimeR>,
  >(
    handlerSpecs: Specs,
  ) => BoundHttpHandlerExports<Module, Specs>
  /**
   * @deprecated Prefer `StdbBuilder.group(...)` and `build(...)` for new
   * server authoring.
   */
  readonly views: <Specs extends ViewHandlerRecord<Module, RuntimeR>>(
    handlerSpecs: Specs,
  ) => BoundViewExports<Module, Specs>
  /**
   * @deprecated Prefer `StdbBuilder.group(...)` and `build(...)` for new
   * server authoring.
   */
  readonly lifecycle: <Specs extends LifecycleHandlerRecord<Module, RuntimeR>>(
    handlerSpecs: Specs,
  ) => BoundLifecycleExports<Module, Specs>
}
