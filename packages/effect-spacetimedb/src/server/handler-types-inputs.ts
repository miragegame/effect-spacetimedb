import type * as Effect from "effect/Effect"

import type { ProcedureResultEnvelope } from "../callable-protocol.ts"

import type * as ErrorCodec from "../contract/error.ts"

import type { AnyModuleSpec } from "../contract/module.ts"

import type { StdbDecodeError } from "../decode-error.ts"

import type { Request, SyncResponse } from "../http-primitives.ts"

import type * as ServerContext from "./context.ts"

import type { OwnedHandlerBundle } from "./handler-ownership.ts"

import type { HttpHandlerHandler } from "./http-handler.ts"

import type { ProcedureHandler } from "./procedure.ts"

import type { ReducerHandler } from "./reducer.ts"

import type {
  AnonymousViewCtxLike,
  BaseReducerCtx,
  HttpHandlerCtxLike,
  ProcedureCtxLike,
  ServerConnectionId,
  ServerDatabaseIdentity,
  ServerIdentity,
  ServerRandom,
  ServerSender,
  ServerTimestamp,
  ServerUuid,
  ViewCtxLike,
} from "./runtime-types.ts"

import type { StdbHostFailure } from "./services.ts"

import type { ViewHandler } from "./view.ts"

import type {
  AnonymousViewAllowedRequirements,
  CompleteHttpHandlerHandlerRecord,
  CompleteLifecycleHandlerRecord,
  CompleteProcedureHandlerRecord,
  CompleteReducerHandlerRecord,
  CompleteViewHandlerRecord,
  HttpHandlerAllowedRequirements,
  HttpHandlerErrors,
  HttpHandlerKeys,
  HttpHandlerRequestOf,
  HttpHandlerResponseOf,
  HttpTxAllowedRequirementsFor,
  HttpTxEffectWithoutScopedSuccess,
  HandlerRequirements,
  LifecycleKeys,
  ModuleLifecycleKeys,
  ParamsOf,
  ProcedureAllowedRequirements,
  ProcedureHandlerErrors,
  ProcedureKeys,
  ReducerAllowedRequirements,
  ReducerHandlerErrors,
  ReducerKeys,
  ReturnsOf,
  SenderViewAllowedRequirements,
  TxAllowedRequirementsFor,
  TxEffectWithoutScopedSuccess,
  ViewArgsOf,
  ViewHandlerErrors,
  ViewKeys,
  ViewSuccessOf,
} from "./handler-types-core.ts"

export type CallableContextFields = {
  readonly sender: ServerSender
  readonly databaseIdentity: ServerDatabaseIdentity
  /** @deprecated Use `databaseIdentity` instead. */
  readonly identity: ServerIdentity
  readonly timestamp: ServerTimestamp
  readonly connectionId: ServerConnectionId
  readonly newUuidV4: () => ServerUuid
  readonly newUuidV7: () => ServerUuid
  readonly random: ServerRandom
}

export type HandlerDefinitions<
  Module extends AnyModuleSpec,
  RuntimeR = unknown,
> = {
  readonly reducers?: CompleteReducerHandlerRecord<Module, RuntimeR>
  readonly procedures?: CompleteProcedureHandlerRecord<Module, RuntimeR>
  readonly httpHandlers?: CompleteHttpHandlerHandlerRecord<Module, RuntimeR>
  readonly views?: CompleteViewHandlerRecord<Module, RuntimeR>
  readonly lifecycle?: CompleteLifecycleHandlerRecord<Module, RuntimeR>
}

export type Handlers<
  Module extends AnyModuleSpec,
  RuntimeR = unknown,
> = HandlerDefinitions<Module, RuntimeR> & OwnedHandlerBundle

export type SectionFor<Keys extends string, Name extends string, Record> = [
  Keys,
] extends [never]
  ? {
      readonly [Key in Name]?: Record
    }
  : {
      readonly [Key in Name]: Record
    }

export type RawReducerHandlerRecord<Module extends AnyModuleSpec, RuntimeR> = {
  readonly [Key in ReducerKeys<Module>]:
    | ReducerHandler<
        ParamsOf<Module["reducers"][Key]>,
        unknown,
        ReducerHandlerErrors<Module["reducers"][Key]>,
        HandlerRequirements<RuntimeR, ReducerAllowedRequirements>
      >
    | ((
        args: ParamsOf<Module["reducers"][Key]>,
      ) => Effect.Effect<
        unknown,
        ReducerHandlerErrors<Module["reducers"][Key]>,
        HandlerRequirements<RuntimeR, ReducerAllowedRequirements>
      >)
}

export type RawProcedureHandlerRecord<
  Module extends AnyModuleSpec,
  RuntimeR,
> = {
  readonly [Key in ProcedureKeys<Module>]:
    | ProcedureHandler<
        ParamsOf<Module["procedures"][Key]>,
        ReturnsOf<Module["procedures"][Key]>,
        ProcedureHandlerErrors<Module["procedures"][Key]>,
        HandlerRequirements<RuntimeR, ProcedureAllowedRequirements>
      >
    | ((
        args: ParamsOf<Module["procedures"][Key]>,
      ) => Effect.Effect<
        ReturnsOf<Module["procedures"][Key]>,
        ProcedureHandlerErrors<Module["procedures"][Key]>,
        HandlerRequirements<RuntimeR, ProcedureAllowedRequirements>
      >)
}

export type RawHttpHandlerRecord<Module extends AnyModuleSpec, RuntimeR> = {
  readonly [Key in HttpHandlerKeys<Module>]:
    | HttpHandlerHandler<
        HttpHandlerRequestOf<Module["httpHandlers"][Key]>,
        HttpHandlerResponseOf<Module["httpHandlers"][Key]>,
        HttpHandlerErrors<Module["httpHandlers"][Key]>,
        HandlerRequirements<RuntimeR, HttpHandlerAllowedRequirements>
      >
    | ((
        args: HttpHandlerRequestOf<Module["httpHandlers"][Key]>,
      ) => Effect.Effect<
        HttpHandlerResponseOf<Module["httpHandlers"][Key]>,
        HttpHandlerErrors<Module["httpHandlers"][Key]>,
        HandlerRequirements<RuntimeR, HttpHandlerAllowedRequirements>
      >)
}

export type RawViewHandlerRecord<Module extends AnyModuleSpec, RuntimeR> = {
  readonly [Key in ViewKeys<Module>]:
    | ViewHandler<
        ViewArgsOf<Module["views"][Key]>,
        ViewSuccessOf<Module["views"][Key]>,
        ViewHandlerErrors,
        HandlerRequirements<
          RuntimeR,
          Module["views"][Key]["context"] extends "sender"
            ? SenderViewAllowedRequirements
            : AnonymousViewAllowedRequirements
        >
      >
    | ((
        args: ViewArgsOf<Module["views"][Key]>,
      ) => Effect.Effect<
        ViewSuccessOf<Module["views"][Key]>,
        ViewHandlerErrors,
        HandlerRequirements<
          RuntimeR,
          Module["views"][Key]["context"] extends "sender"
            ? SenderViewAllowedRequirements
            : AnonymousViewAllowedRequirements
        >
      >)
}

export type RawLifecycleHandlerRecord<
  Module extends AnyModuleSpec,
  RuntimeR,
> = {
  readonly [Key in ModuleLifecycleKeys<Module>]: () => Effect.Effect<
    unknown,
    unknown,
    HandlerRequirements<RuntimeR, ReducerAllowedRequirements>
  >
}

export type HandlerInputDefinitions<
  Module extends AnyModuleSpec,
  RuntimeR = never,
> = SectionFor<
  ReducerKeys<Module>,
  "reducers",
  RawReducerHandlerRecord<Module, RuntimeR>
> &
  SectionFor<
    ProcedureKeys<Module>,
    "procedures",
    RawProcedureHandlerRecord<Module, RuntimeR>
  > &
  SectionFor<
    HttpHandlerKeys<Module>,
    "httpHandlers",
    RawHttpHandlerRecord<Module, RuntimeR>
  > &
  SectionFor<
    ViewKeys<Module>,
    "views",
    RawViewHandlerRecord<Module, RuntimeR>
  > &
  SectionFor<
    ModuleLifecycleKeys<Module>,
    "lifecycle",
    RawLifecycleHandlerRecord<Module, RuntimeR>
  >

export type BoundReducerExport<
  Module extends AnyModuleSpec,
  Key extends ReducerKeys<Module>,
> = {
  readonly kind: "reducer"
  readonly key: Key
  readonly spec: Module["reducers"][Key]
  readonly invoke: (
    ctx: BaseReducerCtx<Module>,
    args: ParamsOf<Module["reducers"][Key]>,
  ) => void
}

export type BoundProcedureExport<
  Module extends AnyModuleSpec,
  Key extends ProcedureKeys<Module>,
> = {
  readonly kind: "procedure"
  readonly key: Key
  readonly spec: Module["procedures"][Key]
  readonly invoke: (
    ctx: ProcedureCtxLike<Module>,
    args: ParamsOf<Module["procedures"][Key]>,
  ) =>
    | ReturnsOf<Module["procedures"][Key]>
    | ProcedureResultEnvelope<
        ReturnsOf<Module["procedures"][Key]>,
        ErrorCodec.ProcedureDeclaredErrorCarrier
      >
}

export type BoundHttpHandlerExport<
  Module extends AnyModuleSpec,
  Key extends HttpHandlerKeys<Module>,
> = {
  readonly kind: "httpHandler"
  readonly key: Key
  readonly spec: Module["httpHandlers"][Key]
  readonly invoke: (
    ctx: HttpHandlerCtxLike<Module>,
    req: Request,
  ) => SyncResponse
}

export type BoundViewExport<
  Module extends AnyModuleSpec,
  Key extends ViewKeys<Module>,
> = {
  readonly kind: "view"
  readonly key: Key
  readonly spec: Module["views"][Key]
  readonly invoke: (
    ctx: Module["views"][Key]["context"] extends "sender"
      ? ViewCtxLike<Module>
      : AnonymousViewCtxLike<Module>,
    args: Record<string, never>,
  ) => ViewSuccessOf<Module["views"][Key]>
}

export type BoundLifecycleExport<
  Module extends AnyModuleSpec,
  Key extends LifecycleKeys,
> = {
  readonly kind: "lifecycle"
  readonly key: Key
  readonly invoke: (ctx: BaseReducerCtx<Module>) => void
}

export type CallableContextEffects<Requirements> = {
  readonly sender: Effect.Effect<ServerSender, never, Requirements>
  readonly databaseIdentity: Effect.Effect<
    ServerDatabaseIdentity,
    never,
    Requirements
  >
  /** @deprecated Use `databaseIdentity` instead. */
  readonly identity: Effect.Effect<ServerIdentity, never, Requirements>
  readonly timestamp: Effect.Effect<ServerTimestamp, never, Requirements>
  readonly connectionId: Effect.Effect<ServerConnectionId, never, Requirements>
  readonly random: Effect.Effect<ServerRandom, never, Requirements>
  readonly newUuidV4: Effect.Effect<ServerUuid, StdbHostFailure, Requirements>
  readonly newUuidV7: Effect.Effect<ServerUuid, StdbHostFailure, Requirements>
}

export type HttpHandlerContextEffects<Requirements> = {
  readonly databaseIdentity: Effect.Effect<
    ServerDatabaseIdentity,
    never,
    Requirements
  >
  readonly timestamp: Effect.Effect<ServerTimestamp, never, Requirements>
  readonly random: Effect.Effect<ServerRandom, never, Requirements>
  readonly newUuidV4: Effect.Effect<ServerUuid, StdbHostFailure, Requirements>
  readonly newUuidV7: Effect.Effect<ServerUuid, StdbHostFailure, Requirements>
}

export type TransactionHelper<Module extends AnyModuleSpec> = <A, E, R>(
  body: (scope: {
    readonly ctx: ServerContext.TxCtxService<Module>
    readonly db: ServerContext.DbService<Module>
  }) => TxEffectWithoutScopedSuccess<Module, Effect.Effect<A, E, R>> &
    ServerContext.EffectWithoutForbiddenRequirements<
      TxEffectWithoutScopedSuccess<Module, Effect.Effect<A, E, R>>,
      TxAllowedRequirementsFor<Module>
    >,
) => Effect.Effect<
  A,
  E | StdbHostFailure | StdbDecodeError,
  | Exclude<R, TxAllowedRequirementsFor<Module>>
  | ServerContext.ModuleScopedRequirement<Module, ServerContext.TxRunner>
>

export type HttpTransactionHelper<Module extends AnyModuleSpec> = <A, E, R>(
  body: (scope: {
    readonly db: ServerContext.DbService<Module>
  }) => HttpTxEffectWithoutScopedSuccess<Module, Effect.Effect<A, E, R>> &
    ServerContext.EffectWithoutForbiddenRequirements<
      HttpTxEffectWithoutScopedSuccess<Module, Effect.Effect<A, E, R>>,
      HttpTxAllowedRequirementsFor<Module>
    >,
) => Effect.Effect<
  A,
  E | StdbHostFailure | StdbDecodeError,
  | Exclude<R, HttpTxAllowedRequirementsFor<Module>>
  | ServerContext.ModuleScopedRequirement<Module, ServerContext.HttpTxRunner>
>
