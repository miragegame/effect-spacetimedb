import * as Effect from "effect/Effect"

import type * as Layer from "effect/Layer"

import type * as Schema from "effect/Schema"
import {
  type HttpHandlerMethod,
  type HttpHandlerSpec,
} from "../contract/http-handler.ts"
import {
  type LifecycleName,
  type LifecycleSpecs,
} from "../contract/lifecycle.ts"
import { type AnyModuleSpec, type ModuleSpec } from "../contract/module.ts"
import type { ModuleBrand } from "../identity-brand.ts"
import { type ProcedureSpec } from "../contract/procedure.ts"
import { type ReducerSpec } from "../contract/reducer.ts"
import type { TableRow } from "../contract/table.ts"
import { type AnyViewSpec } from "../contract/view.ts"

import {
  type AnyValueType,
  type StructLikeValueType,
  type TypeOf,
} from "../contract/type.ts"

import type { Request, SyncResponse } from "../http-primitives.ts"

import type { ModulePlan } from "../module-plan.ts"

import * as Server from "../server/bind.ts"

import * as ServerContext from "../server/context.ts"
import type {
  HandlerInputDefinitions,
  HttpHandlerErrors,
  HttpHandlerRequestOf,
  HttpHandlerResponseOf,
  ProcedureHandlerErrors,
  ReducerHandlerErrors,
  ViewHandlerErrors,
  ViewSuccessOf,
} from "../server/handler-types.ts"
import type { ConstrainedServerRuntimeMode } from "../server/runtime-layer.ts"
import { type SyncRunner, type SyncRunnerLike } from "../server/sync-runner.ts"

import type {
  AnonymousViewDecl,
  AnyGroup,
  AnyHttpRouteDecl,
  LifecycleDecl,
  RawHttpRouteDecl,
  RuntimeModuleState,
  SenderViewDecl,
  TypedHttpRouteDecl,
} from "./declarations.ts"

import type {
  EndpointsOfGroup,
  Expand,
  GroupEndpointPair,
  GroupEndpointPairsTypeId,
  GroupImplRuntimeTypeId,
  GroupNamesTypeId,
  GroupsOfModule,
  GroupTypeId,
  HttpGroupPair,
  HttpGroupPairsTypeId,
  LifecycleImplHooksTypeId,
  LifecycleKeysOf,
  LifecycleRecordFromNames,
  ModuleSpecTypeId,
  ScheduledTableNamesTypeId,
  SchedulePair,
  SchedulePairsTypeId,
  SpecOfModule,
  TableNamesTypeId,
} from "./type-utils.ts"

export type AnyStdbModule = RuntimeModuleState & {
  readonly spec: AnyModuleSpec
  readonly [GroupTypeId]: AnyGroup
  readonly [GroupNamesTypeId]: string
  readonly [TableNamesTypeId]: string
  readonly [ScheduledTableNamesTypeId]: string
  readonly [SchedulePairsTypeId]: SchedulePair
  readonly [GroupEndpointPairsTypeId]: GroupEndpointPair
  readonly [HttpGroupPairsTypeId]: HttpGroupPair
  readonly [ModuleSpecTypeId]: AnyModuleSpec
}

export type ModuleNameOf<Module extends AnyStdbModule> =
  SpecOfModule<Module>["name"] & string

// Reads the eagerly-accumulated group-name union off the module (cheap) rather
// than deriving it from the heavy `[GroupTypeId]` group union.
export type GroupNames<Module extends AnyStdbModule> = Module extends {
  readonly [GroupNamesTypeId]: infer Names extends string
}
  ? Names
  : never

export type TableNames<Module extends AnyStdbModule> = Module extends {
  readonly [TableNamesTypeId]: infer Names extends string
}
  ? Names
  : never

export type ScheduledTableNames<Module extends AnyStdbModule> = Module extends {
  readonly [ScheduledTableNamesTypeId]: infer Names extends string
}
  ? Names
  : never

export type SchedulePairsOfModule<Module extends AnyStdbModule> =
  Module extends {
    readonly [SchedulePairsTypeId]: infer Pairs extends SchedulePair
  }
    ? Pairs
    : never

export type GroupEndpointPairsOfModule<Module extends AnyStdbModule> =
  Module extends {
    readonly [GroupEndpointPairsTypeId]: infer Pairs extends GroupEndpointPair
  }
    ? Pairs
    : never

export type GroupByName<
  Module extends AnyStdbModule,
  Name extends string,
> = Extract<GroupsOfModule<Module>, { readonly id: Name }>

export type EndpointsOfGroupName<
  Module extends AnyStdbModule,
  Name extends string,
> = EndpointsOfGroup<GroupByName<Module, Name>>

export type ArgsFor<Decl> = Decl extends {
  readonly declKind: "reducer" | "procedure"
  readonly spec: { readonly params: infer Params extends StructLikeValueType }
}
  ? TypeOf<Params>
  : Decl extends ReducerSpec<infer Params>
    ? TypeOf<Params>
    : Decl extends ProcedureSpec<infer Params>
      ? TypeOf<Params>
      : Decl extends TypedHttpRouteDecl<
            string,
            HttpHandlerMethod,
            Schema.Top,
            Schema.Top
          >
        ? HttpHandlerRequestOf<Decl["spec"]>
        : Decl extends HttpHandlerSpec
          ? HttpHandlerRequestOf<Decl>
          : Decl extends RawHttpRouteDecl
            ? Request
            : Decl extends SenderViewDecl | AnonymousViewDecl | AnyViewSpec
              ? Record<string, never>
              : Record<string, never>

export type SuccessFor<Decl> = Decl extends { readonly declKind: "reducer" }
  ? unknown
  : Decl extends ReducerSpec
    ? unknown
    : Decl extends {
          readonly declKind: "procedure"
          readonly spec: {
            readonly returns: infer Returns extends AnyValueType
          }
        }
      ? TypeOf<Returns>
      : Decl extends ProcedureSpec<StructLikeValueType, infer Returns>
        ? TypeOf<Returns>
        : Decl extends TypedHttpRouteDecl
          ? HttpHandlerResponseOf<Decl["spec"]>
          : Decl extends HttpHandlerSpec
            ? HttpHandlerResponseOf<Decl>
            : Decl extends RawHttpRouteDecl
              ? SyncResponse
              : Decl extends SenderViewDecl | AnonymousViewDecl
                ? ViewSuccessOf<Decl["spec"]>
                : Decl extends AnyViewSpec
                  ? ViewSuccessOf<Decl>
                  : unknown

export type ErrorsFor<Decl> = Decl extends {
  readonly declKind: "reducer"
  readonly spec: ReducerSpec
}
  ? ReducerHandlerErrors<Decl["spec"]>
  : Decl extends ReducerSpec
    ? ReducerHandlerErrors<Decl>
    : Decl extends {
          readonly declKind: "procedure"
          readonly spec: ProcedureSpec
        }
      ? ProcedureHandlerErrors<Decl["spec"]>
      : Decl extends ProcedureSpec
        ? ProcedureHandlerErrors<Decl>
        : Decl extends AnyHttpRouteDecl
          ? HttpHandlerErrors<Decl["spec"]>
          : Decl extends HttpHandlerSpec
            ? HttpHandlerErrors<Decl>
            : Decl extends SenderViewDecl | AnonymousViewDecl | AnyViewSpec
              ? ViewHandlerErrors
              : unknown

export type ReducerArgsFor<
  Module extends AnyStdbModule,
  Name extends string,
> = Name extends keyof SpecOfModule<Module>["reducers"] & string
  ? ArgsFor<SpecOfModule<Module>["reducers"][Name]>
  : never

export type RowOf<
  Module extends AnyStdbModule,
  Name extends keyof SpecOfModule<Module>["tables"] & string,
> = TableRow<SpecOfModule<Module>["tables"][Name]>

export type ReducerSuccessFor<
  Module extends AnyStdbModule,
  Name extends string,
> = Name extends keyof SpecOfModule<Module>["reducers"] & string
  ? SuccessFor<SpecOfModule<Module>["reducers"][Name]>
  : never

export type ReducerErrorsFor<
  Module extends AnyStdbModule,
  Name extends string,
> = Name extends keyof SpecOfModule<Module>["reducers"] & string
  ? ErrorsFor<SpecOfModule<Module>["reducers"][Name]>
  : never

export type ProcedureArgsFor<
  Module extends AnyStdbModule,
  Name extends string,
> = Name extends keyof SpecOfModule<Module>["procedures"] & string
  ? ArgsFor<SpecOfModule<Module>["procedures"][Name]>
  : never

export type ProcedureSuccessFor<
  Module extends AnyStdbModule,
  Name extends string,
> = Name extends keyof SpecOfModule<Module>["procedures"] & string
  ? SuccessFor<SpecOfModule<Module>["procedures"][Name]>
  : never

export type ProcedureErrorsFor<
  Module extends AnyStdbModule,
  Name extends string,
> = Name extends keyof SpecOfModule<Module>["procedures"] & string
  ? ErrorsFor<SpecOfModule<Module>["procedures"][Name]>
  : never

export type HttpHandlerArgsFor<
  Module extends AnyStdbModule,
  Name extends string,
> = Name extends keyof SpecOfModule<Module>["httpHandlers"] & string
  ? ArgsFor<SpecOfModule<Module>["httpHandlers"][Name]>
  : never

export type HttpHandlerSuccessFor<
  Module extends AnyStdbModule,
  Name extends string,
> = Name extends keyof SpecOfModule<Module>["httpHandlers"] & string
  ? SuccessFor<SpecOfModule<Module>["httpHandlers"][Name]>
  : never

export type HttpHandlerErrorsFor<
  Module extends AnyStdbModule,
  Name extends string,
> = Name extends keyof SpecOfModule<Module>["httpHandlers"] & string
  ? ErrorsFor<SpecOfModule<Module>["httpHandlers"][Name]>
  : never

export type ViewArgsFor<
  Module extends AnyStdbModule,
  Name extends string,
> = Name extends keyof SpecOfModule<Module>["views"] & string
  ? ArgsFor<SpecOfModule<Module>["views"][Name]>
  : never

export type ViewSuccessFor<
  Module extends AnyStdbModule,
  Name extends string,
> = Name extends keyof SpecOfModule<Module>["views"] & string
  ? SuccessFor<SpecOfModule<Module>["views"][Name]>
  : never

export type ViewErrorsFor<
  Module extends AnyStdbModule,
  Name extends string,
> = Name extends keyof SpecOfModule<Module>["views"] & string
  ? ErrorsFor<SpecOfModule<Module>["views"][Name]>
  : never

export type IsAny<Value> = 0 extends 1 & Value ? true : false

export type IsUnknown<Value> = IsAny<Value> extends true
  ? false
  : unknown extends Value
    ? [Value] extends [unknown]
      ? true
      : false
    : false

export type ServiceName<Service> = IsAny<Service> extends true
  ? "any"
  : IsUnknown<Service> extends true
    ? "unknown"
    : Service extends { readonly key: infer Key extends string }
      ? Key extends `effect-spacetimedb/Server/${infer Name}`
        ? Name
        : Key
      : "unknown service"

export type IsNoPayloadArgs<Args> = IsAny<Args> extends true
  ? false
  : [Args] extends [Record<string, never>]
    ? [Record<string, never>] extends [Args]
      ? true
      : false
    : false

export type HasNoHandlerArgs<Decl> = IsNoPayloadArgs<ArgsFor<Decl>> extends true
  ? true
  : false

export type AllowedFor<Module extends AnyStdbModule, Decl> = Decl extends {
  readonly declKind: "reducer" | "lifecycle"
}
  ? ServerContext.ReducerAllowedRequirementsFor<SpecOfModule<Module>>
  : Decl extends { readonly declKind: "procedure" }
    ? ServerContext.ProcedureAllowedRequirementsFor<SpecOfModule<Module>>
    : Decl extends AnyHttpRouteDecl
      ? ServerContext.HttpHandlerAllowedRequirementsFor<SpecOfModule<Module>>
      : Decl extends SenderViewDecl
        ? ServerContext.SenderViewAllowedRequirementsFor<SpecOfModule<Module>>
        : Decl extends AnonymousViewDecl
          ? ServerContext.AnonymousViewAllowedRequirementsFor<
              SpecOfModule<Module>
            >
          : never

export type EndpointHandlerFn<
  Decl,
  Error = unknown,
> = Decl extends LifecycleDecl
  ? () => Effect.Effect<SuccessFor<Decl>, Error, unknown>
  : HasNoHandlerArgs<Decl> extends true
    ? () => Effect.Effect<SuccessFor<Decl>, Error, unknown>
    : (args: ArgsFor<Decl>) => Effect.Effect<SuccessFor<Decl>, Error, unknown>

export type GroupHandlerKeys<
  Module extends AnyStdbModule,
  Name extends string,
> = Expand<{
  readonly [Decl in EndpointsOfGroupName<Module, Name> as Decl["name"]]: unknown
}>

export type GroupHandlersRecord<
  Module extends AnyStdbModule,
  Name extends string,
> = Expand<{
  readonly [Decl in EndpointsOfGroupName<
    Module,
    Name
  > as Decl["name"]]: EndpointHandlerFn<Decl>
}>

export type GroupMiddlewareEffect = Effect.Effect<unknown, unknown, unknown>

export type GroupMiddlewareByKind = {
  readonly reducers?: GroupMiddlewareEffect
  readonly procedures?: GroupMiddlewareEffect
  readonly httpHandlers?: GroupMiddlewareEffect
}

export type GroupMiddleware = GroupMiddlewareEffect | GroupMiddlewareByKind

type MiddlewareForKey<
  Module extends AnyStdbModule,
  Key extends string,
  Middleware,
  Spec extends AnyModuleSpec = SpecOfModule<Module>,
> = Middleware extends Effect.Effect<unknown, unknown, unknown>
  ? Key extends
      | (keyof Spec["reducers"] & string)
      | (keyof Spec["procedures"] & string)
      | (keyof Spec["httpHandlers"] & string)
    ? Middleware
    : never
  : Key extends keyof Spec["reducers"] & string
    ? Middleware extends { readonly reducers?: infer Candidate }
      ? Extract<Candidate, GroupMiddlewareEffect>
      : never
    : Key extends keyof Spec["procedures"] & string
      ? Middleware extends { readonly procedures?: infer Candidate }
        ? Extract<Candidate, GroupMiddlewareEffect>
        : never
      : Key extends keyof Spec["httpHandlers"] & string
        ? Middleware extends { readonly httpHandlers?: infer Candidate }
          ? Extract<Candidate, GroupMiddlewareEffect>
          : never
        : never

type MiddlewareHandler<Middleware> = Middleware extends GroupMiddlewareEffect
  ? () => Middleware
  : never

type IsRawHttpHandlerKey<
  Module extends AnyStdbModule,
  Key extends string,
  Spec extends AnyModuleSpec = SpecOfModule<Module>,
> = Key extends keyof Spec["httpHandlers"] & string
  ? Spec["httpHandlers"][Key] extends { readonly request: Schema.Top }
    ? false
    : true
  : false

type MiddlewareAllowedErrorsForKey<
  Module extends AnyStdbModule,
  Key extends string,
> = IsRawHttpHandlerKey<Module, Key> extends true
  ? never
  : HandlerErrorsForKey<Module, Key>

type MiddlewareUndeclaredErrorDiagnosticKeys<
  Module extends AnyStdbModule,
  Name extends string,
  Middleware,
> = {
  readonly [Key in GroupEndpointNames<Module, Name>]: MiddlewareForKey<
    Module,
    Key,
    Middleware
  > extends infer Candidate
    ? [Candidate] extends [never]
      ? never
      : UndeclaredHandlerErrorLabels<
            MiddlewareHandler<Candidate>,
            MiddlewareAllowedErrorsForKey<Module, Key>
          > extends infer Label extends string
        ? `Middleware for ${Key} may only fail with declared errors; undeclared error: ${Label}`
        : never
    : never
}[GroupEndpointNames<Module, Name>]

type MiddlewareForbiddenServiceDiagnosticKeys<
  Module extends AnyStdbModule,
  Name extends string,
  Middleware,
> = {
  readonly [Key in GroupEndpointNames<Module, Name>]: MiddlewareForKey<
    Module,
    Key,
    Middleware
  > extends infer Candidate
    ? [Candidate] extends [never]
      ? never
      : ForbiddenServerServiceLabels<
            MiddlewareHandler<Candidate>,
            AllowedRequirementsForKey<Module, Key>
          > extends infer Label extends string
        ? `Middleware for ${Key} requires a server service that is not allowed for this endpoint: ${Label}`
        : never
    : never
}[GroupEndpointNames<Module, Name>]

export type ValidateGroupMiddleware<
  Module extends AnyStdbModule,
  Name extends string,
  Middleware,
> = DiagnosticRecord<
  | MiddlewareUndeclaredErrorDiagnosticKeys<Module, Name, Middleware>
  | MiddlewareForbiddenServiceDiagnosticKeys<Module, Name, Middleware>
>

type MiddlewareEffects<Middleware> = Middleware extends GroupMiddlewareEffect
  ? Middleware
  : Middleware extends GroupMiddlewareByKind
    ? Exclude<Middleware[keyof Middleware], undefined>
    : never

export type RuntimeROfGroupMiddleware<Middleware> = Exclude<
  MiddlewareEffects<Middleware> extends infer Candidate
    ? Candidate extends GroupMiddlewareEffect
      ? IsAny<HandlerRequirementsFor<MiddlewareHandler<Candidate>>> extends true
        ? never
        : IsUnknown<
              HandlerRequirementsFor<MiddlewareHandler<Candidate>>
            > extends true
          ? never
          : HandlerRequirementsFor<MiddlewareHandler<Candidate>>
      : never
    : never,
  ServerContext.AnyServerContextRequirements
>

export type HandlerRequirementsFor<Handler> = Handler extends (
  ...args: infer _Args
) => Effect.Effect<unknown, unknown, infer R>
  ? R
  : never

export type HandlerErrorsFor<Handler> = Handler extends (
  ...args: infer _Args
) => Effect.Effect<unknown, infer E, unknown>
  ? E
  : never

export type HandlerServicesFor<Handler> = HandlerRequirementsFor<Handler>

type DiagnosticRecord<Keys extends string> = [Keys] extends [never]
  ? unknown
  : {
      readonly [Key in Keys]: never
    }

type HandlerErrorLabel<Error> = IsAny<Error> extends true
  ? "any"
  : IsUnknown<Error> extends true
    ? "unknown"
    : Error extends { readonly _tag: infer Tag extends string }
      ? Tag
      : "non-tagged error"

type UndeclaredHandlerErrorLabels<Handler, AllowedError> = IsAny<
  HandlerErrorsFor<Handler>
> extends true
  ? never
  : IsUnknown<HandlerErrorsFor<Handler>> extends true
    ? never
    : HandlerErrorsFor<Handler> extends infer Error
      ? Error extends AllowedError
        ? never
        : HandlerErrorLabel<Error>
      : never

type HandlerUndeclaredErrorDiagnosticKeys<
  Module extends AnyStdbModule,
  Name extends string,
  Handlers,
> = {
  readonly [Key in keyof Handlers & string]: Key extends GroupEndpointNames<
    Module,
    Name
  >
    ? UndeclaredHandlerErrorLabels<
        Handlers[Key],
        HandlerErrorsForKey<Module, Key>
      > extends infer Label extends string
      ? `Handler ${Key} may only fail with declared errors; undeclared error: ${Label}`
      : never
    : never
}[keyof Handlers & string]

type NoUndeclaredHandlerErrors<
  Module extends AnyStdbModule,
  Name extends string,
  Handlers,
> = DiagnosticRecord<
  HandlerUndeclaredErrorDiagnosticKeys<Module, Name, Handlers>
>

export type HasForbiddenRequirements<
  Handler,
  Allowed extends ServerContext.AnyServerContextRequirements,
> = Exclude<
  Extract<
    HandlerRequirementsFor<Handler>,
    ServerContext.AnyServerContextRequirements
  >,
  Allowed
> extends never
  ? false
  : true

type ForbiddenServerServiceLabels<
  Handler,
  Allowed extends ServerContext.AnyServerContextRequirements,
> = Extract<
  Exclude<
    Extract<
      HandlerServicesFor<Handler>,
      ServerContext.AnyServerContextRequirements
    >,
    Allowed
  >,
  unknown
> extends infer Service
  ? [Service] extends [never]
    ? never
    : Service extends unknown
      ? ServiceName<Service>
      : never
  : never

type ForbiddenPrecheckedServiceLabels<Handler, Allowed> = Exclude<
  HandlerServicesFor<Handler>,
  Allowed
> extends infer Service
  ? [Service] extends [never]
    ? never
    : Service extends unknown
      ? ServiceName<Service>
      : never
  : never

type ForbiddenHandlerServiceDiagnosticKeys<
  Module extends AnyStdbModule,
  Name extends string,
  Handlers,
> = {
  readonly [Key in keyof Handlers & string]: Key extends GroupEndpointNames<
    Module,
    Name
  >
    ? ForbiddenServerServiceLabels<
        Handlers[Key],
        AllowedRequirementsForKey<Module, Key>
      > extends infer Label extends string
      ? ForbiddenServerServiceMessage<
          Module,
          Key,
          Label,
          Handlers[Key],
          AllowedRequirementsForKey<Module, Key>
        >
      : never
    : never
}[keyof Handlers & string]

type NoForbiddenHandlerServices<
  Module extends AnyStdbModule,
  Name extends string,
  Handlers,
> = DiagnosticRecord<
  ForbiddenHandlerServiceDiagnosticKeys<Module, Name, Handlers>
>

type PrecheckedForbiddenServiceDiagnosticKeys<
  Module extends AnyStdbModule,
  Name extends string,
  Handlers,
> = {
  readonly [Key in keyof Handlers & string]: Key extends GroupEndpointNames<
    Module,
    Name
  >
    ? ForbiddenPrecheckedServiceLabels<
        Handlers[Key],
        AllowedRequirementsForKey<Module, Key>
      > extends infer Label extends string
      ? PrecheckedForbiddenServiceMessage<
          Module,
          Key,
          Label,
          Handlers[Key],
          AllowedRequirementsForKey<Module, Key>
        >
      : never
    : never
}[keyof Handlers & string]

type NoPrecheckedForbiddenServices<
  Module extends AnyStdbModule,
  Name extends string,
  Handlers,
> = DiagnosticRecord<
  PrecheckedForbiddenServiceDiagnosticKeys<Module, Name, Handlers>
>

export type HandlerWithAllowedRequirements<
  Module extends AnyStdbModule,
  Decl,
  Handler,
> = HasForbiddenRequirements<Handler, AllowedFor<Module, Decl>> extends true
  ? never
  : Handler

type ServiceModuleName<Service> = Service extends ModuleBrand<infer Name>
  ? Name
  : never

type ForbiddenServices<Handler, Allowed> = Exclude<
  Extract<
    HandlerServicesFor<Handler>,
    ServerContext.AnyServerContextRequirements
  >,
  Allowed
>

type IsRawModuleScopedService<Service> = Service extends ServerContext.Http
  ? false
  : [ServiceModuleName<Service>] extends [never]
    ? Service extends ServerContext.AnyServerContextRequirements
      ? true
      : false
    : false

type AccessorName<Service> = Service extends ServerContext.ReadonlyDb
  ? "ReadonlyDb"
  : Service extends ServerContext.ReducerCtx
    ? "ReducerCtx"
    : Service extends ServerContext.ProcedureCtx
      ? "ProcedureCtx"
      : Service extends ServerContext.TxCtx
        ? "TxCtx"
        : Service extends ServerContext.ViewCtx
          ? "ViewCtx"
          : Service extends ServerContext.AnonymousViewCtx
            ? "AnonymousViewCtx"
            : Service extends ServerContext.HttpHandlerCtx
              ? "HttpHandlerCtx"
              : Service extends ServerContext.MutationCtx
                ? "MutationCtx"
                : Service extends ServerContext.From
                  ? "From"
                  : Service extends ServerContext.TxRunner
                    ? "Tx"
                    : Service extends ServerContext.HttpTxRunner
                      ? "HttpTx"
                      : Service extends ServerContext.Db
                        ? "Db"
                        : "accessor"

type ForbiddenServerServiceMessage<
  Module extends AnyStdbModule,
  Key extends string,
  Label extends string,
  Handler,
  Allowed,
> = ForbiddenServices<Handler, Allowed> extends infer Service
  ? Service extends unknown
    ? ServiceName<Service> extends Label
      ? [ServiceModuleName<Service>] extends [never]
        ? IsRawModuleScopedService<Service> extends true
          ? `Handler '${Key}' yields the raw ${Label} tag; use this module's accessor (Module.${AccessorName<Service>})`
          : `Handler ${Key} requires a server service that is not allowed for this endpoint: ${Label} — ${ScopeRuleForKey<Module, Key>}`
        : ServiceModuleName<Service> extends infer SourceModule extends string
          ? SourceModule extends ModuleNameOf<Module>
            ? `Handler ${Key} requires a server service that is not allowed for this endpoint: ${Label} — ${ScopeRuleForKey<Module, Key>}`
            : `Handler '${Key}' uses module '${SourceModule}' ${Label} inside module '${ModuleNameOf<Module>}'`
          : never
      : never
    : never
  : never

type PrecheckedForbiddenServiceMessage<
  Module extends AnyStdbModule,
  Key extends string,
  Label extends string,
  Handler,
  Allowed,
> = Exclude<HandlerServicesFor<Handler>, Allowed> extends infer Service
  ? Service extends unknown
    ? ServiceName<Service> extends Label
      ? Service extends ServerContext.AnyServerContextRequirements
        ? ForbiddenServerServiceMessage<Module, Key, Label, Handler, Allowed>
        : `Prechecked handler ${Key} requires a service that groupPrechecked cannot erase: ${Label} — ${ScopeRuleForKey<Module, Key>}`
      : never
    : never
  : never

export type ExtraHandlerKeys<Handlers, Expected> = Exclude<
  keyof Handlers,
  keyof Expected
>

export type NoExtraHandlerKeys<Handlers, Expected> = [
  ExtraHandlerKeys<Handlers, Expected>,
] extends [never]
  ? unknown
  : {
      readonly [Key in ExtraHandlerKeys<Handlers, Expected>]: never
    }

export type HandlerForDecl<
  Handlers,
  Decl extends { readonly name: string },
> = Decl["name"] extends keyof Handlers ? Handlers[Decl["name"]] : never

export type ValidateGroupHandlers<
  Module extends AnyStdbModule,
  Name extends string,
  Handlers,
> = NoExtraHandlerKeys<Handlers, GroupHandlerKeys<Module, Name>> &
  NoUndeclaredHandlerErrors<Module, Name, Handlers> &
  NoForbiddenHandlerServices<Module, Name, Handlers>

export type GroupEndpointNames<
  Module extends AnyStdbModule,
  Name extends string,
> = Extract<
  GroupEndpointPairsOfModule<Module>,
  { readonly group: Name }
>["name"]

export type GroupEndpointKeyRecord<
  Module extends AnyStdbModule,
  Name extends string,
> = {
  readonly [Key in GroupEndpointNames<Module, Name>]: unknown
}

export type MissingGroupHandlerKeys<
  Module extends AnyStdbModule,
  Name extends string,
  Handlers,
> = Exclude<GroupEndpointNames<Module, Name>, keyof Handlers>

export type NoMissingGroupHandlerKeys<
  Module extends AnyStdbModule,
  Name extends string,
  Handlers,
> = [MissingGroupHandlerKeys<Module, Name, Handlers>] extends [never]
  ? unknown
  : {
      readonly [Key in MissingGroupHandlerKeys<Module, Name, Handlers>]: never
    }

export type HandlerForKey<
  Module extends AnyStdbModule,
  Key extends string,
  Spec extends AnyModuleSpec = SpecOfModule<Module>,
> = HandlerForKeyWithChannels<
  Key,
  Spec,
  HandlerErrorsForKey<Module, Key, Spec>,
  AllowedRequirementsForKey<Module, Key, Spec>
>

type HandlerShapeForKey<
  Module extends AnyStdbModule,
  Key extends string,
  Spec extends AnyModuleSpec = SpecOfModule<Module>,
> = HandlerForKeyWithChannels<Key, Spec, unknown, unknown>

type HandlerForKeyWithChannels<
  Key extends string,
  Spec extends AnyModuleSpec,
  Error,
  Requirements,
> = Key extends keyof Spec["reducers"] & string
  ? (
      args: TypeOf<Spec["reducers"][Key]["params"]>,
    ) => Effect.Effect<unknown, Error, Requirements>
  : Key extends keyof Spec["procedures"] & string
    ? (
        args: TypeOf<Spec["procedures"][Key]["params"]>,
      ) => Effect.Effect<
        TypeOf<Spec["procedures"][Key]["returns"]>,
        Error,
        Requirements
      >
    : Key extends keyof Spec["views"] & string
      ? () => Effect.Effect<
          ViewSuccessOf<Spec["views"][Key]>,
          Error,
          Requirements
        >
      : Key extends keyof Spec["httpHandlers"] & string
        ? (
            args: HttpHandlerRequestOf<Spec["httpHandlers"][Key]>,
          ) => Effect.Effect<
            HttpHandlerResponseOf<Spec["httpHandlers"][Key]>,
            Error,
            Requirements
          >
        : Key extends keyof Spec["lifecycle"] & LifecycleName
          ? () => Effect.Effect<unknown, Error, Requirements>
          : never

type HandlerErrorsForKey<
  Module extends AnyStdbModule,
  Key extends string,
  Spec extends AnyModuleSpec = SpecOfModule<Module>,
> = Key extends keyof Spec["reducers"] & string
  ? ReducerHandlerErrors<Spec["reducers"][Key]>
  : Key extends keyof Spec["procedures"] & string
    ? ProcedureHandlerErrors<Spec["procedures"][Key]>
    : Key extends keyof Spec["views"] & string
      ? ViewHandlerErrors
      : Key extends keyof Spec["httpHandlers"] & string
        ? HttpHandlerErrors<Spec["httpHandlers"][Key]>
        : Key extends keyof Spec["lifecycle"] & LifecycleName
          ? unknown
          : never

export type HandlerFor<
  Module extends AnyStdbModule,
  Name extends string,
  Key extends string,
  Spec extends AnyModuleSpec = SpecOfModule<Module>,
> = Key extends GroupEndpointNames<Module, Name>
  ? HandlerForKey<Module, Key, Spec>
  : never

export type AllowedRequirementsForKey<
  Module extends AnyStdbModule,
  Key extends string,
  Spec extends AnyModuleSpec = SpecOfModule<Module>,
> = Key extends keyof Spec["reducers"] & string
  ? ServerContext.ReducerAllowedRequirementsFor<Spec>
  : Key extends keyof Spec["procedures"] & string
    ? ServerContext.ProcedureAllowedRequirementsFor<Spec>
    : Key extends keyof Spec["views"] & string
      ? Spec["views"][Key] extends { readonly context: "anonymous" }
        ? ServerContext.AnonymousViewAllowedRequirementsFor<Spec>
        : ServerContext.SenderViewAllowedRequirementsFor<Spec>
      : Key extends keyof Spec["httpHandlers"] & string
        ? ServerContext.HttpHandlerAllowedRequirementsFor<Spec>
        : Key extends keyof Spec["lifecycle"] & LifecycleName
          ? ServerContext.ReducerAllowedRequirementsFor<Spec>
          : never

type ScopeRuleForKey<
  Module extends AnyStdbModule,
  Key extends string,
  Spec extends AnyModuleSpec = SpecOfModule<Module>,
> = Key extends keyof Spec["reducers"] & string
  ? "reducers may require Db, ReducerCtx, and MutationCtx"
  : Key extends keyof Spec["procedures"] & string
    ? "procedures access the database via Tx.run"
    : Key extends keyof Spec["views"] & string
      ? Spec["views"][Key] extends { readonly context: "anonymous" }
        ? "anonymous views may require AnonymousViewCtx, ReadonlyDb, and From"
        : "sender views may require ViewCtx, ReadonlyDb, and From"
      : Key extends keyof Spec["httpHandlers"] & string
        ? "HTTP handlers access the database via HttpTx.run"
        : Key extends keyof Spec["lifecycle"] & LifecycleName
          ? "lifecycle hooks may require Db, ReducerCtx, and MutationCtx"
          : "use this endpoint's module accessors"

export type CheckedForbiddenHandlerKeys<
  Module extends AnyStdbModule,
  Name extends string,
  Handlers,
> = {
  readonly [Key in keyof Handlers & string]: Key extends GroupEndpointNames<
    Module,
    Name
  >
    ? HasForbiddenRequirements<
        Handlers[Key],
        AllowedRequirementsForKey<Module, Key>
      > extends true
      ? Key
      : never
    : never
}[keyof Handlers & string]

export type NoCheckedForbiddenRequirements<
  Module extends AnyStdbModule,
  Name extends string,
  Handlers,
> = [CheckedForbiddenHandlerKeys<Module, Name, Handlers>] extends [never]
  ? unknown
  : {
      readonly [Key in CheckedForbiddenHandlerKeys<
        Module,
        Name,
        Handlers
      >]: never
    }

export type ValidateCheckedGroupHandlers<
  Module extends AnyStdbModule,
  Name extends string,
  Handlers,
> = NoExtraHandlerKeys<Handlers, GroupEndpointKeyRecord<Module, Name>> &
  NoMissingGroupHandlerKeys<Module, Name, Handlers> &
  NoUndeclaredHandlerErrors<Module, Name, Handlers> &
  NoForbiddenHandlerServices<Module, Name, Handlers> &
  Expand<{
    readonly [Key in keyof Handlers & string]: Key extends GroupEndpointNames<
      Module,
      Name
    >
      ? HandlerShapeForKey<Module, Key>
      : unknown
  }>

export type ValidatePrecheckedGroupHandlers<
  Module extends AnyStdbModule,
  Name extends string,
  Handlers,
> = NoExtraHandlerKeys<Handlers, GroupEndpointKeyRecord<Module, Name>> &
  NoMissingGroupHandlerKeys<Module, Name, Handlers> &
  NoUndeclaredHandlerErrors<Module, Name, Handlers> &
  NoPrecheckedForbiddenServices<Module, Name, Handlers> &
  Expand<{
    readonly [Key in keyof Handlers & string]: Key extends GroupEndpointNames<
      Module,
      Name
    >
      ? HandlerShapeForKey<Module, Key>
      : unknown
  }>

export type GroupCheckedHandlers<
  Module extends AnyStdbModule,
  Name extends GroupNames<Module>,
  Keys extends GroupEndpointNames<Module, Name> = GroupEndpointNames<
    Module,
    Name
  >,
> = Expand<{
  readonly [Key in Keys]: HandlerFor<Module, Name, Key>
}>

export type GroupImplHandlersFor<
  Module extends AnyStdbModule,
  Name extends string,
> = Expand<{
  readonly [Key in GroupEndpointNames<Module, Name>]: HandlerFor<
    Module,
    Name,
    Key
  >
}>

export type LifecycleImplHandlersFor<
  Module extends AnyStdbModule,
  Hooks extends LifecycleName,
> = Expand<{
  readonly [Key in Hooks]: () => Effect.Effect<
    unknown,
    unknown,
    ServerContext.ReducerAllowedRequirementsFor<SpecOfModule<Module>>
  >
}>

export type LifecycleHandlerKeys = {
  readonly [Name in LifecycleName]: unknown
}

type NoForbiddenLifecycleServices<
  Module extends AnyStdbModule,
  Handlers,
> = DiagnosticRecord<
  {
    readonly [Name in keyof Handlers &
      LifecycleName]: ForbiddenServerServiceLabels<
      Handlers[Name],
      ServerContext.ReducerAllowedRequirementsFor<SpecOfModule<Module>>
    > extends infer Label extends string
      ? ForbiddenServerServiceMessage<
          Module,
          Name,
          Label,
          Handlers[Name],
          ServerContext.ReducerAllowedRequirementsFor<SpecOfModule<Module>>
        >
      : never
  }[keyof Handlers & LifecycleName]
>

export type ValidateLifecycleHandlers<
  Module extends AnyStdbModule,
  Handlers,
> = NoExtraHandlerKeys<Handlers, LifecycleHandlerKeys> &
  NoForbiddenLifecycleServices<Module, Handlers> &
  Expand<{
    readonly [Name in keyof Handlers & LifecycleName]: unknown
  }>

export type RuntimeROfGroupHandlers<Handlers> = Exclude<
  keyof Handlers extends infer Key
    ? Key extends keyof Handlers
      ? IsAny<HandlerServicesFor<Handlers[Key]>> extends true
        ? never
        : IsUnknown<HandlerServicesFor<Handlers[Key]>> extends true
          ? never
          : HandlerServicesFor<Handlers[Key]>
      : never
    : never,
  ServerContext.AnyServerContextRequirements
>

export const GroupImplTypeId = "~effect-spacetimedb/GroupImpl" as const
export type GroupImplTypeId = typeof GroupImplTypeId

export const LifecycleImplTypeId = "~effect-spacetimedb/LifecycleImpl" as const
export type LifecycleImplTypeId = typeof LifecycleImplTypeId

export type GroupImpl<
  Name extends string = string,
  RuntimeR = never,
  ModuleName extends string = string,
> = ModuleBrand<ModuleName> & {
  readonly [GroupImplTypeId]: GroupImplTypeId
  readonly groupName: Name
  readonly [GroupImplRuntimeTypeId]: RuntimeR
}

export type LifecycleImpl<
  Hooks extends LifecycleName = LifecycleName,
  RuntimeR = never,
  ModuleName extends string = string,
> = ModuleBrand<ModuleName> & {
  readonly [LifecycleImplTypeId]: LifecycleImplTypeId
  readonly kind: "stdbLifecycle"
  readonly [LifecycleImplHooksTypeId]: Hooks
  readonly [GroupImplRuntimeTypeId]: RuntimeR
}

export type AnyBuilderImpl =
  | GroupImpl<string, unknown, string>
  | LifecycleImpl<LifecycleName, unknown, string>

export type InternalGroupImpl<
  Name extends string = string,
  RuntimeR = unknown,
  ModuleName extends string = string,
> = GroupImpl<Name, RuntimeR, ModuleName> & {
  readonly module: AnyStdbModule
  readonly definitions: Partial<
    HandlerInputDefinitions<AnyModuleSpec, RuntimeR>
  >
}

export type InternalLifecycleImpl<
  Hooks extends LifecycleName = LifecycleName,
  RuntimeR = unknown,
  ModuleName extends string = string,
> = LifecycleImpl<Hooks, RuntimeR, ModuleName> & {
  readonly module: AnyStdbModule
  readonly lifecycleSpecs: Partial<LifecycleRecordFromNames<Hooks>>
  readonly definitions: Partial<
    HandlerInputDefinitions<AnyModuleSpec, RuntimeR>
  >
}

export type InternalBuilderImpl =
  | InternalGroupImpl<string, unknown, string>
  | InternalLifecycleImpl<LifecycleName, unknown, string>

export type RuntimeROfImpl<Impl> = Impl extends {
  readonly [GroupImplRuntimeTypeId]: infer RuntimeR
}
  ? RuntimeR
  : never

export type RuntimeROfImpls<Impls extends ReadonlyArray<unknown>> =
  Impls[number] extends infer Impl ? RuntimeROfImpl<Impl> : never

export type ImplGroupName<Impl> = Impl extends {
  readonly groupName: infer Name
}
  ? Name
  : never

export type LifecycleHooksOfImpl<Impl> = Impl extends {
  readonly [LifecycleImplHooksTypeId]: infer Hooks extends LifecycleName
}
  ? Hooks
  : never

export type ModuleNameOfImpl<Impl> = Impl extends GroupImpl<
  string,
  unknown,
  infer ModuleName extends string
>
  ? ModuleName
  : Impl extends LifecycleImpl<
        LifecycleName,
        unknown,
        infer ModuleName extends string
      >
    ? ModuleName
    : never

export type HandlersOf<
  Module extends AnyStdbModule,
  Impl,
> = Impl extends GroupImpl<infer Name extends string, unknown, string>
  ? GroupImplHandlersFor<Module, Name>
  : Impl extends LifecycleImpl<
        infer Hooks extends LifecycleName,
        unknown,
        string
      >
    ? LifecycleImplHandlersFor<Module, Hooks>
    : never

export type LifecycleSpecsOfImpls<Impls extends ReadonlyArray<unknown>> =
  Expand<LifecycleRecordFromNames<LifecycleHooksOfImpl<Impls[number]>>>

export type SpecWithLifecycle<
  Spec extends AnyModuleSpec,
  Lifecycle extends LifecycleSpecs,
> = ModuleSpec<
  Spec["tables"],
  Spec["views"],
  Spec["reducers"],
  Spec["procedures"],
  LifecycleRecordFromNames<
    LifecycleKeysOf<Spec["lifecycle"]> | LifecycleKeysOf<Lifecycle>
  >,
  Spec["httpHandlers"],
  Spec["httpGroups"],
  Spec["reducerGroups"],
  Spec["procedureGroups"]
> & { readonly name: Spec["name"] }

export type BuildSpec<
  Module extends AnyStdbModule,
  Impls extends ReadonlyArray<unknown>,
> = SpecWithLifecycle<SpecOfModule<Module>, LifecycleSpecsOfImpls<Impls>>

export type MissingGroups<
  Module extends AnyStdbModule,
  Impls extends ReadonlyArray<unknown>,
> = Exclude<GroupNames<Module>, ImplGroupName<Impls[number]>>

// Tail-recursive (accumulator) form: TS instantiates this as a single chain
// rather than unioning each recursive result, which keeps the per-`build` call
// instantiation budget low enough for large modules (many groups) to avoid
// TS2589 "excessively deep" in full-program builds.
export type DuplicateImplGroups<
  Impls extends ReadonlyArray<unknown>,
  Seen = never,
  Dup = never,
> = Impls extends readonly [infer Head, ...infer Tail]
  ? DuplicateImplGroups<
      Tail,
      Seen | ImplGroupName<Head>,
      ImplGroupName<Head> extends Seen ? Dup | ImplGroupName<Head> : Dup
    >
  : Dup

export type CoverAllGroups<
  Module extends AnyStdbModule,
  Impls extends ReadonlyArray<unknown>,
> = [MissingGroups<Module, Impls>] extends [never]
  ? [DuplicateImplGroups<Impls>] extends [never]
    ? unknown
    : {
        readonly [Name in DuplicateImplGroups<Impls> &
          string as `Group implemented more than once: ${Name}`]: never
      }
  : {
      readonly [Name in MissingGroups<Module, Impls> &
        string as `Group not implemented: ${Name}`]: never
    }

export type MissingScheduleTargets<Module extends AnyStdbModule> = Exclude<
  ScheduledTableNames<Module>,
  SchedulePairsOfModule<Module>["table"]
>

export type UnregisteredScheduleTargetTables<Module extends AnyStdbModule> =
  Exclude<SchedulePairsOfModule<Module>["table"], TableNames<Module>>

export type CoverScheduleBindings<Module extends AnyStdbModule> = [
  UnregisteredScheduleTargetTables<Module>,
] extends [never]
  ? [MissingScheduleTargets<Module>] extends [never]
    ? unknown
    : {
        readonly [Name in MissingScheduleTargets<Module> &
          string as `Scheduled table has no target: ${Name}`]: never
      }
  : {
      readonly [Name in UnregisteredScheduleTargetTables<Module> &
        string as `Scheduled target references an unregistered table: ${Name}`]: never
    }

type TupleIndexKeys<Values extends ReadonlyArray<unknown>> = Exclude<
  keyof Values,
  keyof (readonly unknown[])
>

type ImplModuleMismatchDiagnosticKey<
  Module extends AnyStdbModule,
  Impl,
> = string extends ModuleNameOf<Module>
  ? "module type was widened; use a concretely-typed module"
  : string extends ModuleNameOfImpl<Impl>
    ? Impl extends GroupImpl<infer Name extends string, unknown, string>
      ? `Group impl '${Name}' has a widened module type; use the concrete return from StdbBuilder.group`
      : Impl extends LifecycleImpl<LifecycleName, unknown, string>
        ? "Lifecycle impl has a widened module type; use the concrete return from StdbBuilder.lifecycle"
        : never
    : ModuleNameOfImpl<Impl> extends ModuleNameOf<Module>
      ? never
      : Impl extends GroupImpl<string, unknown, string>
        ? `Group impl was built for module '${ModuleNameOfImpl<Impl>}', not '${ModuleNameOf<Module>}'`
        : Impl extends LifecycleImpl<LifecycleName, unknown, string>
          ? `Lifecycle impl was built for module '${ModuleNameOfImpl<Impl>}', not '${ModuleNameOf<Module>}'`
          : never

export type ImplModuleMismatchDiagnosticKeys<
  Module extends AnyStdbModule,
  Impls extends ReadonlyArray<unknown>,
> = {
  readonly [Index in TupleIndexKeys<Impls>]: ImplModuleMismatchDiagnosticKey<
    Module,
    Impls[Index]
  >
}[TupleIndexKeys<Impls>]

export type NoImplModuleMismatches<
  Module extends AnyStdbModule,
  Impls extends ReadonlyArray<unknown>,
> = DiagnosticRecord<ImplModuleMismatchDiagnosticKeys<Module, Impls>>

type CoverBuildImpls<
  Module extends AnyStdbModule,
  Impls extends ReadonlyArray<unknown>,
> = [ImplModuleMismatchDiagnosticKeys<Module, Impls>] extends [never]
  ? CoverAllGroups<Module, Impls> & CoverScheduleBindings<Module>
  : unknown

export type BuildRuntime<RuntimeR> =
  | SyncRunner<RuntimeR>
  | SyncRunnerLike<RuntimeR>
  | Layer.Layer<RuntimeR, never, never>

export type BuildOptions<RuntimeR> = {
  readonly runtime?: BuildRuntime<RuntimeR>
  readonly runtimeMode?: ConstrainedServerRuntimeMode
}

export type RejectWidenedImplArray<Impls extends ReadonlyArray<unknown>> =
  number extends Impls["length"]
    ? {
        readonly "Builder impls must be passed as a readonly tuple; add as const": never
      }
    : unknown

export type BuildImplsWithoutRuntime<
  Module extends AnyStdbModule,
  Impls extends ReadonlyArray<AnyBuilderImpl>,
> = Impls &
  RejectWidenedImplArray<Impls> &
  NoImplModuleMismatches<Module, Impls> &
  CoverBuildImpls<Module, Impls> &
  ([RuntimeROfImpls<Impls>] extends [never]
    ? unknown
    : {
        readonly "Handlers require external services; pass options.runtime providing them": RuntimeROfImpls<Impls>
      })

export type BuildImplsWithRuntime<
  Module extends AnyStdbModule,
  Impls extends ReadonlyArray<AnyBuilderImpl>,
> = Impls &
  RejectWidenedImplArray<Impls> &
  NoImplModuleMismatches<Module, Impls> &
  CoverBuildImpls<Module, Impls>

export type BuildOptionsWithoutRuntime<
  Impls extends ReadonlyArray<AnyBuilderImpl>,
> = BuildOptions<RuntimeROfImpls<Impls>> & {
  readonly runtime?: never
  readonly runtimeMode: NonNullable<
    BuildOptions<RuntimeROfImpls<Impls>>["runtimeMode"]
  >
}

export type BuildOptionsWithRuntime<
  Impls extends ReadonlyArray<AnyBuilderImpl>,
> = BuildOptions<RuntimeROfImpls<Impls>> & {
  readonly runtime: BuildRuntime<RuntimeROfImpls<Impls>>
}

export type BuildArgsWithoutRuntime<
  Module extends AnyStdbModule,
  Impls extends ReadonlyArray<AnyBuilderImpl>,
> = readonly [module: Module, impls: BuildImplsWithoutRuntime<Module, Impls>]

export type BuildArgsWithRuntimeMode<
  Module extends AnyStdbModule,
  Impls extends ReadonlyArray<AnyBuilderImpl>,
> = readonly [
  module: Module,
  impls: BuildImplsWithoutRuntime<Module, Impls>,
  options: BuildOptionsWithoutRuntime<Impls>,
]

export type BuildArgsWithRuntime<
  Module extends AnyStdbModule,
  Impls extends ReadonlyArray<AnyBuilderImpl>,
> = readonly [
  module: Module,
  impls: BuildImplsWithRuntime<Module, Impls>,
  options: BuildOptionsWithRuntime<Impls>,
]

export type StdbBuildPlan<
  Module extends AnyModuleSpec = AnyModuleSpec,
  RuntimeR = never,
> = {
  readonly module: Module
  readonly scheduleBindings: ModulePlan<Module>["scheduleBindings"]
  readonly handlers: Server.Handlers<Module, RuntimeR>
}
