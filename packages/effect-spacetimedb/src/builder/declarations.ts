import * as Effect from "effect/Effect"

import type * as Schema from "effect/Schema"
import type { AnyErrorDefinition } from "../contract/error.ts"
import {
  type HttpHandlerMethod,
  type HttpHandlerSpec,
  type RawHttpHandlerSpec,
  type TypedHttpHandlerSpec,
} from "../contract/http-handler.ts"
import {
  type LifecycleName,
  type LifecycleSpec,
  type LifecycleSpecs,
} from "../contract/lifecycle.ts"
import { type AnyModuleSpec, type ModuleSpec } from "../contract/module.ts"
import type { ModuleBrand } from "../identity-brand.ts"
import { type ProcedureSpec } from "../contract/procedure.ts"
import { type ReducerSpec } from "../contract/reducer.ts"
import type { ModuleSettings } from "../contract/settings.ts"
import type { AnyScheduledTableSpec, AnyTableSpec } from "../contract/table.ts"
import {
  type AnyValueType,
  type StructLikeValueType,
  type TypeOf,
  unit,
} from "../contract/type.ts"
import { type AnyViewSpec } from "../contract/view.ts"
import type { StdbDecodeError } from "../decode-error.ts"

import * as ServerContext from "../server/context.ts"

import type { StdbHostFailure } from "../server/services.ts"

import type { StdbGroup, StdbHttpGroup } from "./http-builders.ts"

import type {
  EndpointsOfGroup,
  HttpGroupMapFromPairs,
  HttpGroupPair,
  HttpGroupPairsOf,
  HttpHandlerRecordsOfGroups,
  LifecycleRecordFromConfigAndGroups,
  ProcedureRecordsOfGroups,
  ProcedureGroupMapFromPairs,
  ProcedureGroupPairsOf,
  ReducerGroupMapFromPairs,
  ReducerGroupPairsOf,
  ReducerRecordsOfGroups,
  ViewRecordsOfGroups,
} from "./type-utils.ts"

export type ReducerDecl<
  Name extends string = string,
  Params extends StructLikeValueType = StructLikeValueType,
  Errors extends AnyErrorDefinition | undefined =
    | AnyErrorDefinition
    | undefined,
  Public extends boolean = boolean,
> = {
  readonly declKind: "reducer"
  readonly name: Name
  readonly spec: ReducerSpec<Params, Errors, Public>
}

export type ProcedureDecl<
  Name extends string = string,
  Params extends StructLikeValueType = StructLikeValueType,
  Returns extends AnyValueType = AnyValueType,
  Errors extends AnyErrorDefinition | undefined =
    | AnyErrorDefinition
    | undefined,
  Public extends boolean = boolean,
> = {
  readonly declKind: "procedure"
  readonly name: Name
  readonly spec: ProcedureSpec<Params, Returns, Errors, Public>
}

export type ScheduledParams<Table extends AnyTableSpec> =
  StructLikeValueType & {
    readonly Type: {
      readonly data: TypeOf<Table["row"]>
    }
  }

export type ScheduledCallableMetadata<
  Table extends AnyScheduledTableSpec = AnyScheduledTableSpec,
> = {
  readonly table: Table
  readonly allowExternalCallers: boolean
}

export type ScheduledReducerSpec<
  Table extends AnyScheduledTableSpec = AnyScheduledTableSpec,
  Errors extends AnyErrorDefinition | undefined =
    | AnyErrorDefinition
    | undefined,
> = ReducerSpec<ScheduledParams<Table>, Errors, false> & {
  readonly scheduled: ScheduledCallableMetadata<Table>
}

export type ScheduledProcedureSpec<
  Table extends AnyScheduledTableSpec = AnyScheduledTableSpec,
  Errors extends AnyErrorDefinition | undefined =
    | AnyErrorDefinition
    | undefined,
> = ProcedureSpec<
  ScheduledParams<Table>,
  ReturnType<typeof unit>,
  Errors,
  false
> & {
  readonly scheduled: ScheduledCallableMetadata<Table>
}

export type ScheduledReducerDecl<
  Name extends string = string,
  Table extends AnyScheduledTableSpec = AnyScheduledTableSpec,
  Errors extends AnyErrorDefinition | undefined =
    | AnyErrorDefinition
    | undefined,
> = ReducerDecl<Name, ScheduledParams<Table>, Errors, false> & {
  readonly spec: ScheduledReducerSpec<Table, Errors>
}

export type ScheduledProcedureDecl<
  Name extends string = string,
  Table extends AnyScheduledTableSpec = AnyScheduledTableSpec,
  Errors extends AnyErrorDefinition | undefined =
    | AnyErrorDefinition
    | undefined,
> = ProcedureDecl<
  Name,
  ScheduledParams<Table>,
  ReturnType<typeof unit>,
  Errors,
  false
> & {
  readonly spec: ScheduledProcedureSpec<Table, Errors>
}

export type SenderViewDecl<
  Name extends string = string,
  Returns extends AnyValueType = AnyValueType,
> = {
  readonly declKind: "view"
  readonly name: Name
  readonly spec: AnyViewSpec & {
    readonly context: "sender"
    readonly returns: Returns
  }
}

export type AnonymousViewDecl<
  Name extends string = string,
  Returns extends AnyValueType = AnyValueType,
> = {
  readonly declKind: "view"
  readonly name: Name
  readonly spec: AnyViewSpec & {
    readonly context: "anonymous"
    readonly returns: Returns
  }
}

export type LifecycleDecl<Name extends LifecycleName = LifecycleName> = {
  readonly declKind: "lifecycle"
  readonly name: Name
  readonly spec: LifecycleSpec<Name>
}

export type RawHttpRouteDecl<
  Name extends string = string,
  Method extends HttpHandlerMethod = HttpHandlerMethod,
> = {
  readonly declKind: "httpHandler"
  readonly httpMode: "raw"
  readonly name: Name
  readonly spec: RawHttpHandlerSpec<Method>
}

export type TypedHttpRouteDecl<
  Name extends string = string,
  Method extends HttpHandlerMethod = HttpHandlerMethod,
  Req extends Schema.Top = Schema.Top,
  Res extends Schema.Top = Schema.Top,
  Errors extends AnyErrorDefinition | undefined =
    | AnyErrorDefinition
    | undefined,
> = {
  readonly declKind: "httpHandler"
  readonly httpMode: "typed"
  readonly name: Name
  readonly spec: TypedHttpHandlerSpec<Req, Res, Errors, Method>
}

export type AnyCallableDecl =
  | ReducerDecl
  | ProcedureDecl
  | ScheduledReducerDecl
  | ScheduledProcedureDecl
  | SenderViewDecl
  | AnonymousViewDecl
  | LifecycleDecl

export type AnyHttpRouteDecl = RawHttpRouteDecl | TypedHttpRouteDecl

export type AnyEndpointDecl = AnyCallableDecl | AnyHttpRouteDecl

export type EndpointsOfGroups<Groups> = Groups extends unknown
  ? EndpointsOfGroup<Groups>
  : never

export type ModuleSpecFor<
  Id extends string,
  Tables extends Record<string, AnyTableSpec>,
  Groups,
  Lifecycle extends LifecycleSpecs = {},
  HttpGroupPairs extends HttpGroupPair = HttpGroupPairsOf<Groups>,
  ReducerGroupPairs extends HttpGroupPair = ReducerGroupPairsOf<Groups>,
  ProcedureGroupPairs extends HttpGroupPair = ProcedureGroupPairsOf<Groups>,
> = ModuleSpec<
  Tables,
  ViewRecordsOfGroups<Groups>,
  ReducerRecordsOfGroups<Groups>,
  ProcedureRecordsOfGroups<Groups>,
  LifecycleRecordFromConfigAndGroups<Lifecycle, Groups>,
  HttpHandlerRecordsOfGroups<Groups>,
  HttpGroupMapFromPairs<HttpGroupPairs>,
  ReducerGroupMapFromPairs<ReducerGroupPairs>,
  ProcedureGroupMapFromPairs<ProcedureGroupPairs>
> & { readonly name: Id }

export type AnyGroup =
  | StdbGroup<
      string,
      AnyCallableDecl,
      AnyErrorDefinition | undefined,
      Record<string, ReducerSpec>,
      Record<string, ProcedureSpec>,
      Record<string, AnyViewSpec>,
      {},
      LifecycleSpecs
    >
  | StdbHttpGroup<
      string,
      AnyHttpRouteDecl,
      AnyErrorDefinition | undefined,
      Record<string, HttpHandlerSpec>
    >

export type RuntimeModuleState = {
  readonly id: string
  readonly settings: ModuleSettings
  readonly tables: Record<string, AnyTableSpec>
  readonly lifecycle: LifecycleSpecs
  readonly groups: ReadonlyArray<AnyGroup>
}

type ModuleScopedRequirement<
  Spec extends AnyModuleSpec,
  Requirement,
> = Requirement extends ServerContext.Http
  ? Requirement
  : Requirement & ModuleBrand<Spec["name"] & string>

export type ModuleAccessors<Spec extends AnyModuleSpec> = {
  readonly Db: Effect.Effect<
    ServerContext.DbService<Spec>,
    never,
    ModuleScopedRequirement<Spec, ServerContext.Db>
  >
  readonly ReadonlyDb: Effect.Effect<
    ServerContext.ReadonlyDbService<Spec>,
    never,
    ModuleScopedRequirement<Spec, ServerContext.ReadonlyDb>
  >
  readonly ReducerCtx: Effect.Effect<
    ServerContext.ReducerCtxService<Spec>,
    never,
    ModuleScopedRequirement<Spec, ServerContext.ReducerCtx>
  >
  readonly ProcedureCtx: Effect.Effect<
    ServerContext.ProcedureCtxService<Spec>,
    never,
    ModuleScopedRequirement<Spec, ServerContext.ProcedureCtx>
  >
  readonly TxCtx: Effect.Effect<
    ServerContext.TxCtxService<Spec>,
    never,
    ModuleScopedRequirement<Spec, ServerContext.TxCtx>
  >
  readonly ViewCtx: Effect.Effect<
    ServerContext.ViewCtxService<Spec>,
    never,
    ModuleScopedRequirement<Spec, ServerContext.ViewCtx>
  >
  readonly AnonymousViewCtx: Effect.Effect<
    ServerContext.AnonymousViewCtxService<Spec>,
    never,
    ModuleScopedRequirement<Spec, ServerContext.AnonymousViewCtx>
  >
  readonly HttpHandlerCtx: Effect.Effect<
    ServerContext.HttpHandlerCtxService<Spec>,
    never,
    ModuleScopedRequirement<Spec, ServerContext.HttpHandlerCtx>
  >
  readonly MutationCtx: Effect.Effect<
    ServerContext.MutationCtxService<Spec>,
    never,
    ModuleScopedRequirement<Spec, ServerContext.MutationCtx>
  >
  readonly From: Effect.Effect<
    ServerContext.FromService<Spec>,
    never,
    ModuleScopedRequirement<Spec, ServerContext.From>
  >
  readonly Http: Effect.Effect<
    ServerContext.HttpService<Spec>,
    never,
    ServerContext.Http
  >
  readonly Tx: Effect.Effect<
    ServerContext.TxRunnerService<Spec>,
    never,
    ModuleScopedRequirement<Spec, ServerContext.TxRunner>
  >
  /**
   * The transaction body may execute more than once: SpacetimeDB re-runs it on
   * an optimistic commit conflict. Keep the body a pure function of database
   * state with no external or captured-state side effects; the transaction
   * timestamp may differ between attempts.
   */
  readonly withTx: <A, E, R>(
    effect: ServerContext.EffectWithoutForbiddenRequirements<
      Effect.Effect<A, E, R>,
      ServerContext.TxAllowedRequirementsFor<Spec>
    >,
  ) => Effect.Effect<
    A,
    E | StdbHostFailure | StdbDecodeError,
    | Exclude<R, ServerContext.TxAllowedRequirementsFor<Spec>>
    | ModuleScopedRequirement<Spec, ServerContext.TxRunner>
  >
  readonly HttpTx: Effect.Effect<
    ServerContext.HttpTxRunnerService<Spec>,
    never,
    ModuleScopedRequirement<Spec, ServerContext.HttpTxRunner>
  >
}

export type { StdbGroup, StdbHttpGroup, StdbModule } from "./http-builders.ts"
