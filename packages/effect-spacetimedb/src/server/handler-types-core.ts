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

import type { Request, SyncResponse } from "../http-primitives.ts"
import type { ViewQueryResult } from "../query/types.ts"

import type * as ServerContext from "./context.ts"

import type { HostFailure, StdbSenderError } from "./services.ts"

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

export type ModuleLifecycleKeys<Module extends AnyModuleSpec> = Extract<
  PresentKeys<Module["lifecycle"]>,
  LifecycleName
>

export type ParamsOf<Spec extends { readonly params: StructLikeValueType }> =
  TypeOf<Spec["params"]>

export type ViewArgsOf<Spec extends AnyViewSpec> = TypeOf<Spec["params"]>

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
> = DeclaredErrorsOf<Definition> | HostFailure

/**
 * A settle reducer (`Fn.outboxResult`) may not fail: the host rolls a
 * failed settle back without retrying it, so its outcome would be lost. Its
 * handler handles every failure itself; a defect still dies.
 */
export type ReducerHandlerErrors<Spec extends ReducerSpec> = Spec extends {
  readonly outboxResult: object
}
  ? never
  : HandlerBaseErrors<Spec["errors"]> | StdbSenderError

export type ProcedureHandlerErrors<Spec extends ProcedureSpec> =
  HandlerBaseErrors<Spec["errors"]>

export type HttpHandlerErrors<Spec extends HttpHandlerSpec> = HandlerBaseErrors<
  Spec["errors"]
>

export type ViewSuccessOf<Spec extends AnyViewSpec> =
  | TypeOf<Spec["returns"]>
  | ViewQueryResult<Spec>

export type ViewHandlerErrors = never

export type ExtraRequirements<
  Extra,
  Allowed extends ServerContext.AnyServerContextRequirements,
> = Extract<
  Extra,
  Exclude<ServerContext.AnyServerContextRequirements, Allowed>
> extends never
  ? Extra
  : never

// Every callable kind may also require the module environment.
export type HandlerRequirements<
  RuntimeR,
  Allowed extends ServerContext.AnyServerContextRequirements,
> =
  | ServerContext.WithEnv<Allowed>
  | ExtraRequirements<RuntimeR, ServerContext.WithEnv<Allowed>>

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
