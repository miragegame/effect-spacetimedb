import type * as Effect from "effect/Effect"
import type * as Schema from "effect/Schema"
import type { ProcedureResultEnvelope } from "../callable-protocol.ts"
import type * as ErrorCodec from "../contract/error.ts"
import type { HttpHandlerSpec } from "../contract/http-handler.ts"
import type { AnyModuleSpec } from "../contract/module.ts"
import type { ProcedureSpec } from "../contract/procedure.ts"
import type { ReducerSpec } from "../contract/reducer.ts"
import type {
  AnyValueType,
  StructLikeValueType,
  TypeOf,
} from "../contract/type.ts"
import type { AnyViewSpec } from "../contract/view.ts"
import type { StdbDecodeError } from "../decode-error.ts"
import type { ModulePlan } from "../module-plan.ts"
import type { ViewQueryResult } from "../query/types.ts"
import type { Request, SyncResponse } from "../http-primitives.ts"
import type * as ServerContext from "./context.ts"
import type { OwnedHandlerBundle, ServerOwner } from "./handler-ownership.ts"
import type { HttpHandlerHandler } from "./http-handler.ts"
import type { LifecycleHandler } from "./lifecycle.ts"
import type { ProcedureHandler } from "./procedure.ts"
import type { ReducerHandler } from "./reducer.ts"
import type {
  AnonymousViewCtxLike,
  BaseReducerCtx,
  HttpHandlerCtxLike,
  ProcedureCtxLike,
  ServerDatabaseIdentity,
  ServerConnectionId,
  ServerIdentity,
  ServerRandom,
  ServerSender,
  ServerSenderAuth,
  ServerTimestamp,
  ServerUuid,
  ViewCtxLike,
} from "./runtime-types.ts"
import type { StdbHostFailure, StdbSenderFailure } from "./services.ts"
import type { SyncRunner, SyncRunnerLike } from "./sync-runner.ts"
import type { ViewHandler } from "./view.ts"

type PresentKeys<RecordType> = {
  readonly [Key in keyof RecordType & string]-?: [
    NonNullable<RecordType[Key]>,
  ] extends [never]
    ? never
    : Key
}[keyof RecordType & string]

export type ReducerKeys<Module extends AnyModuleSpec> = PresentKeys<
  Module["reducers"]
>

export type ProcedureKeys<Module extends AnyModuleSpec> = PresentKeys<
  Module["procedures"]
>

export type HttpHandlerKeys<Module extends AnyModuleSpec> = PresentKeys<
  Module["httpHandlers"]
>

export type ViewKeys<Module extends AnyModuleSpec> = PresentKeys<
  Module["views"]
>

export type LifecycleKeys = "init" | "clientConnected" | "clientDisconnected"

type ModuleLifecycleKeys<Module extends AnyModuleSpec> = Extract<
  PresentKeys<Module["lifecycle"]>,
  LifecycleKeys
>

export type ParamsOf<Spec extends { readonly params: StructLikeValueType }> =
  TypeOf<Spec["params"]>

export type ViewArgsOf<_Spec extends AnyViewSpec> = Record<string, never>

export type ReturnsOf<Spec extends { readonly returns: AnyValueType }> = TypeOf<
  Spec["returns"]
>

export type HttpHandlerRequestOf<Spec extends HttpHandlerSpec> = Spec extends {
  readonly request: infer RequestSchema extends Schema.Top
}
  ? Schema.Schema.Type<RequestSchema>
  : Request

export type HttpHandlerResponseOf<Spec extends HttpHandlerSpec> = Spec extends {
  readonly response: infer ResponseSchema extends Schema.Top
}
  ? Schema.Schema.Type<ResponseSchema>
  : SyncResponse

type DeclaredErrorsOf<
  Definition extends ErrorCodec.AnyErrorDefinition | undefined,
> = Definition extends ErrorCodec.AnyErrorDefinition
  ? ErrorCodec.ErrorInstances<Definition>
  : never

export type ReducerHandlerErrors<Spec extends ReducerSpec> =
  | DeclaredErrorsOf<Spec["errors"]>
  | StdbSenderFailure
  | StdbHostFailure
  | StdbDecodeError

export type ProcedureHandlerErrors<Spec extends ProcedureSpec> =
  | DeclaredErrorsOf<Spec["errors"]>
  | StdbHostFailure
  | StdbDecodeError

export type HttpHandlerErrors<Spec extends HttpHandlerSpec> =
  | DeclaredErrorsOf<Spec["errors"]>
  | StdbHostFailure
  | StdbDecodeError

export type ViewSuccessOf<Spec extends AnyViewSpec> =
  | TypeOf<Spec["returns"]>
  | ViewQueryResult<Spec>

export type ViewHandlerErrors = StdbHostFailure | StdbDecodeError

export type ReducerHandlerRecord<
  Module extends AnyModuleSpec,
  _RuntimeR = never,
> = Partial<{
  readonly [Key in ReducerKeys<Module>]: ReducerHandler<
    ParamsOf<Module["reducers"][Key]>,
    unknown,
    ReducerHandlerErrors<Module["reducers"][Key]>,
    unknown
  >
}>

export type ProcedureHandlerRecord<
  Module extends AnyModuleSpec,
  _RuntimeR = never,
> = Partial<{
  readonly [Key in ProcedureKeys<Module>]: ProcedureHandler<
    ParamsOf<Module["procedures"][Key]>,
    ReturnsOf<Module["procedures"][Key]>,
    ProcedureHandlerErrors<Module["procedures"][Key]>,
    unknown
  >
}>

export type HttpHandlerHandlerRecord<
  Module extends AnyModuleSpec,
  _RuntimeR = never,
> = Partial<{
  readonly [Key in HttpHandlerKeys<Module>]: HttpHandlerHandler<
    HttpHandlerRequestOf<Module["httpHandlers"][Key]>,
    HttpHandlerResponseOf<Module["httpHandlers"][Key]>,
    HttpHandlerErrors<Module["httpHandlers"][Key]>,
    unknown
  >
}>

export type ViewHandlerRecord<
  Module extends AnyModuleSpec,
  _RuntimeR = never,
> = Partial<{
  readonly [Key in ViewKeys<Module>]: ViewHandler<
    ViewArgsOf<Module["views"][Key]>,
    ViewSuccessOf<Module["views"][Key]>,
    ViewHandlerErrors,
    unknown
  >
}>

export type LifecycleHandlerRecord<
  Module extends AnyModuleSpec,
  _RuntimeR = never,
> = Partial<{
  readonly [Key in ModuleLifecycleKeys<Module>]: LifecycleHandler<
    unknown,
    unknown,
    unknown
  >
}>

type CompleteReducerHandlerRecord<
  Module extends AnyModuleSpec,
  _RuntimeR = unknown,
> = {
  readonly [Key in ReducerKeys<Module>]: ReducerHandler<
    ParamsOf<Module["reducers"][Key]>,
    unknown,
    ReducerHandlerErrors<Module["reducers"][Key]>,
    unknown
  >
}

type CompleteProcedureHandlerRecord<
  Module extends AnyModuleSpec,
  _RuntimeR = unknown,
> = {
  readonly [Key in ProcedureKeys<Module>]: ProcedureHandler<
    ParamsOf<Module["procedures"][Key]>,
    ReturnsOf<Module["procedures"][Key]>,
    ProcedureHandlerErrors<Module["procedures"][Key]>,
    unknown
  >
}

type CompleteHttpHandlerHandlerRecord<
  Module extends AnyModuleSpec,
  _RuntimeR = unknown,
> = {
  readonly [Key in HttpHandlerKeys<Module>]: HttpHandlerHandler<
    HttpHandlerRequestOf<Module["httpHandlers"][Key]>,
    HttpHandlerResponseOf<Module["httpHandlers"][Key]>,
    HttpHandlerErrors<Module["httpHandlers"][Key]>,
    unknown
  >
}

type CompleteViewHandlerRecord<
  Module extends AnyModuleSpec,
  _RuntimeR = unknown,
> = {
  readonly [Key in ViewKeys<Module>]: ViewHandler<
    ViewArgsOf<Module["views"][Key]>,
    ViewSuccessOf<Module["views"][Key]>,
    ViewHandlerErrors,
    unknown
  >
}

type CompleteLifecycleHandlerRecord<
  Module extends AnyModuleSpec,
  _RuntimeR = unknown,
> = {
  readonly [Key in ModuleLifecycleKeys<Module>]: LifecycleHandler<
    unknown,
    unknown,
    unknown
  >
}

export type AnyServerContextRequirements =
  ServerContext.AnyServerContextRequirements

export type ReducerAllowedRequirements =
  ServerContext.ReducerAllowedRequirements

export type ProcedureAllowedRequirements =
  ServerContext.ProcedureAllowedRequirements

export type HttpHandlerAllowedRequirements =
  ServerContext.HttpHandlerAllowedRequirements

export type SenderViewAllowedRequirements =
  ServerContext.SenderViewAllowedRequirements

export type AnonymousViewAllowedRequirements =
  ServerContext.AnonymousViewAllowedRequirements

export type TxAllowedRequirements = ServerContext.TxAllowedRequirements

export type HttpTxAllowedRequirements = ServerContext.Db

type TxScopedSuccess<Module extends AnyModuleSpec> =
  | ServerContext.TxCtxService<Module>
  | ServerContext.DbService<Module>

type HttpTxScopedSuccess<Module extends AnyModuleSpec> =
  ServerContext.DbService<Module>

// Guards the common accidental escape case where a tx callback directly
// returns the scoped ctx/db handle. TypeScript cannot reject handles wrapped in
// arbitrary user objects.
export type TxEffectWithoutScopedSuccess<
  Module extends AnyModuleSpec,
  EffectType extends ServerContext.AnyServerEffect,
> = [Extract<Effect.Success<EffectType>, TxScopedSuccess<Module>>] extends [
  never,
]
  ? EffectType
  : never

export type HttpTxEffectWithoutScopedSuccess<
  Module extends AnyModuleSpec,
  EffectType extends ServerContext.AnyServerEffect,
> = [Extract<Effect.Success<EffectType>, HttpTxScopedSuccess<Module>>] extends [
  never,
]
  ? EffectType
  : never

type ProcedureHandlerEffect<Handler> = Handler extends (
  ...args: infer _Args
) => Effect.Effect<infer A, infer E, infer R>
  ? Effect.Effect<A, E, R>
  : never

export type HandlerWithoutForbiddenRequirements<
  Handler,
  Allowed extends AnyServerContextRequirements,
> = [ProcedureHandlerEffect<Handler>] extends [never]
  ? never
  : Extract<
        Effect.Services<ProcedureHandlerEffect<Handler>>,
        Exclude<AnyServerContextRequirements, Allowed>
      > extends never
    ? Handler
    : never

export type MakeOptions<Module extends AnyModuleSpec, RuntimeR = never> = {
  readonly module: Module
  readonly runtime?: SyncRunner<RuntimeR> | SyncRunnerLike<RuntimeR>
}

export type CallableContextFields = {
  readonly sender: ServerSender
  readonly identity: ServerIdentity
  readonly timestamp: ServerTimestamp
  readonly connectionId: ServerConnectionId
  readonly newUuidV4: () => ServerUuid
  readonly newUuidV7: () => ServerUuid
  readonly random: ServerRandom
}

type HandlerDefinitions<Module extends AnyModuleSpec, RuntimeR = unknown> = {
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

type SectionFor<Keys extends string, Name extends string, Record> = [
  Keys,
] extends [never]
  ? {
      readonly [Key in Name]?: Record
    }
  : {
      readonly [Key in Name]: Record
    }

type ExtraRequirements<
  Extra,
  Allowed extends AnyServerContextRequirements,
> = Extract<Extra, Exclude<AnyServerContextRequirements, Allowed>> extends never
  ? Extra
  : never

export type HandlerRequirements<
  RuntimeR,
  Allowed extends AnyServerContextRequirements,
> = Allowed | ExtraRequirements<RuntimeR, Allowed>

type RawReducerHandlerRecord<Module extends AnyModuleSpec, RuntimeR> = {
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

type RawProcedureHandlerRecord<Module extends AnyModuleSpec, RuntimeR> = {
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

type RawHttpHandlerRecord<Module extends AnyModuleSpec, RuntimeR> = {
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

type RawViewHandlerRecord<Module extends AnyModuleSpec, RuntimeR> = {
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

type RawLifecycleHandlerRecord<Module extends AnyModuleSpec, RuntimeR> = {
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

export type TransactionHelper<Module extends AnyModuleSpec> = <
  EffectType extends ServerContext.AnyServerEffect,
>(
  body: (scope: {
    readonly ctx: ServerContext.TxCtxService<Module>
    readonly db: ServerContext.DbService<Module>
  }) => ServerContext.EffectWithoutForbiddenRequirements<
    TxEffectWithoutScopedSuccess<Module, EffectType>,
    TxAllowedRequirements
  >,
) => Effect.Effect<
  Effect.Success<EffectType>,
  Effect.Error<EffectType> | StdbHostFailure | StdbDecodeError,
  | Exclude<Effect.Services<EffectType>, TxAllowedRequirements>
  | ServerContext.TxRunner
>

export type HttpTransactionHelper<Module extends AnyModuleSpec> = <
  EffectType extends ServerContext.AnyServerEffect,
>(
  body: (scope: {
    readonly db: ServerContext.DbService<Module>
  }) => ServerContext.EffectWithoutForbiddenRequirements<
    HttpTxEffectWithoutScopedSuccess<Module, EffectType>,
    HttpTxAllowedRequirements
  >,
) => Effect.Effect<
  Effect.Success<EffectType>,
  Effect.Error<EffectType> | StdbHostFailure | StdbDecodeError,
  | Exclude<Effect.Services<EffectType>, HttpTxAllowedRequirements>
  | ServerContext.HttpTxRunner
>

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
  RuntimeR = never,
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
    Exclude<R, TxAllowedRequirements> | ServerContext.TxRunner
  >
  readonly tx: TransactionHelper<Module>
  readonly transaction: TransactionHelper<Module>
  readonly httpTransaction: HttpTransactionHelper<Module>
  readonly reducer: {
    <Args, A, E, R>(
      handler: HandlerWithoutForbiddenRequirements<
        (args: Args) => Effect.Effect<A, E, R>,
        ReducerAllowedRequirements
      >,
    ): ReducerHandler<Args, A, E, R>
  }
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
  readonly httpHandler: {
    <Args, A, E, R>(
      handler: HandlerWithoutForbiddenRequirements<
        (args: Args) => Effect.Effect<A, E, R>,
        HttpHandlerAllowedRequirements
      >,
    ): HttpHandlerHandler<Args, A, E, R>
  }
  readonly view: {
    <Args, A, E, R>(
      handler: HandlerWithoutForbiddenRequirements<
        (args: Args) => Effect.Effect<A, E, R>,
        SenderViewAllowedRequirements
      >,
    ): ViewHandler<Args, A, E, R>
  }
  readonly anonymousView: {
    <Args, A, E, R>(
      handler: HandlerWithoutForbiddenRequirements<
        (args: Args) => Effect.Effect<A, E, R>,
        AnonymousViewAllowedRequirements
      >,
    ): ViewHandler<Args, A, E, R>
  }
  readonly init: <A, E, R>(
    handler: HandlerWithoutForbiddenRequirements<
      () => Effect.Effect<A, E, R>,
      ReducerAllowedRequirements
    >,
  ) => LifecycleHandler<A, E, R>
  readonly clientConnected: <A, E, R>(
    handler: HandlerWithoutForbiddenRequirements<
      () => Effect.Effect<A, E, R>,
      ReducerAllowedRequirements
    >,
  ) => LifecycleHandler<A, E, R>
  readonly clientDisconnected: <A, E, R>(
    handler: HandlerWithoutForbiddenRequirements<
      () => Effect.Effect<A, E, R>,
      ReducerAllowedRequirements
    >,
  ) => LifecycleHandler<A, E, R>
  readonly handlers: {
    (
      definitions: HandlerInputDefinitions<Module, RuntimeR>,
    ): Handlers<Module, RuntimeR>
    (definitions: OwnedHandlerBundle): Handlers<Module, RuntimeR>
  }
  readonly failRaw: (message: string) => StdbSenderFailure
  readonly reducers: <Specs extends ReducerHandlerRecord<Module, RuntimeR>>(
    handlerSpecs: Specs,
  ) => BoundReducerExports<Module, Specs>
  readonly procedures: <Specs extends ProcedureHandlerRecord<Module, RuntimeR>>(
    handlerSpecs: Specs,
  ) => BoundProcedureExports<Module, Specs>
  readonly httpHandlers: <
    Specs extends HttpHandlerHandlerRecord<Module, RuntimeR>,
  >(
    handlerSpecs: Specs,
  ) => BoundHttpHandlerExports<Module, Specs>
  readonly views: <Specs extends ViewHandlerRecord<Module, RuntimeR>>(
    handlerSpecs: Specs,
  ) => BoundViewExports<Module, Specs>
  readonly lifecycle: <Specs extends LifecycleHandlerRecord<Module, RuntimeR>>(
    handlerSpecs: Specs,
  ) => BoundLifecycleExports<Module, Specs>
}
