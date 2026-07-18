import type * as Effect from "effect/Effect"

import type * as Schema from "effect/Schema"

import type * as ErrorCodec from "../contract/error.ts"

import type { HttpHandlerSpec } from "../contract/http-handler.ts"

import type { LifecycleName } from "../contract/lifecycle.ts"

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
import type { Request, SyncResponse } from "../http-primitives.ts"
import type { ViewQueryResult } from "../query/types.ts"

import type * as ServerContext from "./context.ts"

import type { HttpHandlerHandler } from "./http-handler.ts"

import type { LifecycleHandler } from "./lifecycle.ts"

import type { ProcedureHandler } from "./procedure.ts"

import type { ReducerHandler } from "./reducer.ts"

import type { ConstrainedServerRuntimeMode } from "./runtime-layer.ts"

import type { StdbHostFailure, StdbSenderFailure } from "./services.ts"

import type { SyncRunner, SyncRunnerLike } from "./sync-runner.ts"

import type { ViewHandler } from "./view.ts"

export type PresentKeys<RecordType> = {
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

export type { LifecycleName as LifecycleKeys } from "../contract/lifecycle.ts"

export type ModuleLifecycleKeys<Module extends AnyModuleSpec> = Extract<
  PresentKeys<Module["lifecycle"]>,
  LifecycleName
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

export type DeclaredErrorsOf<
  Definition extends ErrorCodec.AnyErrorDefinition | undefined,
> = Definition extends ErrorCodec.AnyErrorDefinition
  ? ErrorCodec.ErrorInstances<Definition>
  : never

export type HandlerBaseErrors<
  Definition extends ErrorCodec.AnyErrorDefinition | undefined,
> = DeclaredErrorsOf<Definition> | StdbHostFailure | StdbDecodeError

export type ReducerHandlerErrors<Spec extends ReducerSpec> =
  | HandlerBaseErrors<Spec["errors"]>
  | StdbSenderFailure

export type ProcedureHandlerErrors<Spec extends ProcedureSpec> =
  HandlerBaseErrors<Spec["errors"]>

export type HttpHandlerErrors<Spec extends HttpHandlerSpec> = HandlerBaseErrors<
  Spec["errors"]
>

export type ViewSuccessOf<Spec extends AnyViewSpec> =
  | TypeOf<Spec["returns"]>
  | ViewQueryResult<Spec>

export type ViewHandlerErrors = StdbHostFailure | StdbDecodeError

export type ExtraRequirements<
  Extra,
  Allowed extends ServerContext.AnyServerContextRequirements,
> = Extract<
  Extra,
  Exclude<ServerContext.AnyServerContextRequirements, Allowed>
> extends never
  ? Extra
  : never

export type HandlerRequirements<
  RuntimeR,
  Allowed extends ServerContext.AnyServerContextRequirements,
> = Allowed | ExtraRequirements<RuntimeR, Allowed>

export type ReducerHandlerRecord<
  Module extends AnyModuleSpec,
  RuntimeR = never,
> = Partial<{
  readonly [Key in ReducerKeys<Module>]: ReducerHandler<
    ParamsOf<Module["reducers"][Key]>,
    unknown,
    ReducerHandlerErrors<Module["reducers"][Key]>,
    HandlerRequirements<RuntimeR, ReducerAllowedRequirements>
  >
}>

export type ProcedureHandlerRecord<
  Module extends AnyModuleSpec,
  RuntimeR = never,
> = Partial<{
  readonly [Key in ProcedureKeys<Module>]: ProcedureHandler<
    ParamsOf<Module["procedures"][Key]>,
    ReturnsOf<Module["procedures"][Key]>,
    ProcedureHandlerErrors<Module["procedures"][Key]>,
    HandlerRequirements<RuntimeR, ProcedureAllowedRequirements>
  >
}>

export type HttpHandlerHandlerRecord<
  Module extends AnyModuleSpec,
  RuntimeR = never,
> = Partial<{
  readonly [Key in HttpHandlerKeys<Module>]: HttpHandlerHandler<
    HttpHandlerRequestOf<Module["httpHandlers"][Key]>,
    HttpHandlerResponseOf<Module["httpHandlers"][Key]>,
    HttpHandlerErrors<Module["httpHandlers"][Key]>,
    HandlerRequirements<RuntimeR, HttpHandlerAllowedRequirements>
  >
}>

export type ViewHandlerRecord<
  Module extends AnyModuleSpec,
  RuntimeR = never,
> = Partial<{
  readonly [Key in ViewKeys<Module>]: ViewHandler<
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
}>

export type LifecycleHandlerRecord<
  Module extends AnyModuleSpec,
  RuntimeR = never,
> = Partial<{
  readonly [Key in ModuleLifecycleKeys<Module>]: LifecycleHandler<
    unknown,
    unknown,
    HandlerRequirements<RuntimeR, ReducerAllowedRequirements>
  >
}>

export type CompleteReducerHandlerRecord<
  Module extends AnyModuleSpec,
  RuntimeR = unknown,
> = {
  readonly [Key in ReducerKeys<Module>]: ReducerHandler<
    ParamsOf<Module["reducers"][Key]>,
    unknown,
    ReducerHandlerErrors<Module["reducers"][Key]>,
    HandlerRequirements<RuntimeR, ReducerAllowedRequirements>
  >
}

export type CompleteProcedureHandlerRecord<
  Module extends AnyModuleSpec,
  RuntimeR = unknown,
> = {
  readonly [Key in ProcedureKeys<Module>]: ProcedureHandler<
    ParamsOf<Module["procedures"][Key]>,
    ReturnsOf<Module["procedures"][Key]>,
    ProcedureHandlerErrors<Module["procedures"][Key]>,
    HandlerRequirements<RuntimeR, ProcedureAllowedRequirements>
  >
}

export type CompleteHttpHandlerHandlerRecord<
  Module extends AnyModuleSpec,
  RuntimeR = unknown,
> = {
  readonly [Key in HttpHandlerKeys<Module>]: HttpHandlerHandler<
    HttpHandlerRequestOf<Module["httpHandlers"][Key]>,
    HttpHandlerResponseOf<Module["httpHandlers"][Key]>,
    HttpHandlerErrors<Module["httpHandlers"][Key]>,
    HandlerRequirements<RuntimeR, HttpHandlerAllowedRequirements>
  >
}

export type CompleteViewHandlerRecord<
  Module extends AnyModuleSpec,
  RuntimeR = unknown,
> = {
  readonly [Key in ViewKeys<Module>]: ViewHandler<
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
}

export type CompleteLifecycleHandlerRecord<
  Module extends AnyModuleSpec,
  RuntimeR = unknown,
> = {
  readonly [Key in ModuleLifecycleKeys<Module>]: LifecycleHandler<
    unknown,
    unknown,
    HandlerRequirements<RuntimeR, ReducerAllowedRequirements>
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

export type TxAllowedRequirementsFor<Module extends AnyModuleSpec> =
  ServerContext.TxAllowedRequirementsFor<Module>

export type HttpTxAllowedRequirementsFor<Module extends AnyModuleSpec> =
  ServerContext.HttpTxAllowedRequirementsFor<Module>

export type TxScopedSuccess<Module extends AnyModuleSpec> =
  | ServerContext.TxCtxService<Module>
  | ServerContext.DbService<Module>

export type HttpTxScopedSuccess<Module extends AnyModuleSpec> =
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

export type ProcedureHandlerEffect<Handler> = Handler extends (
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
  readonly runtimeMode?: ConstrainedServerRuntimeMode
}
