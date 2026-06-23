import * as Effect from "effect/Effect"

import type * as Schema from "effect/Schema"

import type { StdbDecodeError } from "../decode-error.ts"

import { type AnyModuleSpec, type ModuleSpec } from "../contract/module.ts"

import { type ReducerSpec } from "../contract/reducer.ts"

import { type ProcedureSpec } from "../contract/procedure.ts"

import { type AnyViewSpec } from "../contract/view.ts"

import {
  type LifecycleName,
  type LifecycleSpec,
  type LifecycleSpecs,
} from "../contract/lifecycle.ts"

import {
  type HttpHandlerMethod,
  type HttpHandlerSpec,
  type RawHttpHandlerSpec,
  type TypedHttpHandlerSpec,
} from "../contract/http-handler.ts"

import type { AnyErrorDefinition } from "../contract/error.ts"

import type { ModuleSettings } from "../contract/settings.ts"

import type { AnyScheduledTableSpec, AnyTableSpec } from "../contract/table.ts"

import {
  unit,
  type AnyValueType,
  type StructLikeValueType,
  type TypeOf,
} from "../contract/type.ts"

import * as ServerContext from "../server/context.ts"

import type { StdbHostFailure } from "../server/services.ts"

import type {
  EndpointsOfGroup,
  EndpointTypeId,
  GroupEndpointPair,
  GroupEndpointPairsOf,
  GroupEndpointPairsTypeId,
  GroupNameOf,
  GroupNamesTypeId,
  GroupTypeId,
  HttpGroupMapFromPairs,
  HttpGroupPair,
  HttpGroupPairsOf,
  HttpGroupPairsTypeId,
  LifecycleKeysOf,
  LifecycleNamesFromDecls,
  LifecycleRecordFromNames,
  ModuleSpecTypeId,
  NonEmptyReadonlyArray,
  RecordFromDecls,
  ScheduledTableNameOf,
  ScheduledTableNamesTypeId,
  SchedulePair,
  SchedulePairsOf,
  SchedulePairsTypeId,
  TableNameOf,
  TableNamesTypeId,
  TablesFromTuple,
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
> = ModuleSpec<
  Tables,
  RecordFromDecls<EndpointsOfGroups<Groups>, "view", AnyViewSpec>,
  RecordFromDecls<EndpointsOfGroups<Groups>, "reducer", ReducerSpec>,
  RecordFromDecls<EndpointsOfGroups<Groups>, "procedure", ProcedureSpec>,
  LifecycleRecordFromNames<
    | LifecycleKeysOf<Lifecycle>
    | LifecycleNamesFromDecls<EndpointsOfGroups<Groups>>
  >,
  RecordFromDecls<EndpointsOfGroups<Groups>, "httpHandler", HttpHandlerSpec>,
  HttpGroupMapFromPairs<HttpGroupPairs>
> & { readonly name: Id }

export type AnyGroup =
  | StdbGroup<string, AnyCallableDecl>
  | StdbHttpGroup<string, AnyHttpRouteDecl>

export type RuntimeModuleState = {
  readonly id: string
  readonly settings: ModuleSettings
  readonly tables: Record<string, AnyTableSpec>
  readonly lifecycle: LifecycleSpecs
  readonly groups: ReadonlyArray<AnyGroup>
}

export type ModuleAccessors<Spec extends AnyModuleSpec> = {
  readonly Db: Effect.Effect<
    ServerContext.DbService<Spec>,
    never,
    ServerContext.Db
  >
  readonly ReadonlyDb: Effect.Effect<
    ServerContext.ReadonlyDbService<Spec>,
    never,
    ServerContext.ReadonlyDb
  >
  readonly ReducerCtx: Effect.Effect<
    ServerContext.ReducerCtxService<Spec>,
    never,
    ServerContext.ReducerCtx
  >
  readonly ProcedureCtx: Effect.Effect<
    ServerContext.ProcedureCtxService<Spec>,
    never,
    ServerContext.ProcedureCtx
  >
  readonly TxCtx: Effect.Effect<
    ServerContext.TxCtxService<Spec>,
    never,
    ServerContext.TxCtx
  >
  readonly ViewCtx: Effect.Effect<
    ServerContext.ViewCtxService<Spec>,
    never,
    ServerContext.ViewCtx
  >
  readonly AnonymousViewCtx: Effect.Effect<
    ServerContext.AnonymousViewCtxService<Spec>,
    never,
    ServerContext.AnonymousViewCtx
  >
  readonly HttpHandlerCtx: Effect.Effect<
    ServerContext.HttpHandlerCtxService<Spec>,
    never,
    ServerContext.HttpHandlerCtx
  >
  readonly MutationCtx: Effect.Effect<
    ServerContext.MutationCtxService<Spec>,
    never,
    ServerContext.MutationCtx
  >
  readonly From: Effect.Effect<
    ServerContext.FromService<Spec>,
    never,
    ServerContext.From
  >
  readonly Http: Effect.Effect<
    ServerContext.HttpService<Spec>,
    never,
    ServerContext.Http
  >
  readonly Tx: Effect.Effect<
    ServerContext.TxRunnerService<Spec>,
    never,
    ServerContext.TxRunner
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
      ServerContext.TxAllowedRequirements
    >,
  ) => Effect.Effect<
    A,
    E | StdbHostFailure | StdbDecodeError,
    Exclude<R, ServerContext.TxAllowedRequirements> | ServerContext.TxRunner
  >
  readonly HttpTx: Effect.Effect<
    ServerContext.HttpTxRunnerService<Spec>,
    never,
    ServerContext.HttpTxRunner
  >
}

export type StdbGroup<
  Id extends string,
  Endpoints extends AnyCallableDecl = never,
> = {
  readonly kind: "stdbGroup"
  readonly id: Id
  readonly endpoints: ReadonlyArray<AnyCallableDecl>
  readonly add: <const Added extends NonEmptyReadonlyArray<AnyCallableDecl>>(
    ...endpoints: Added
  ) => StdbGroup<Id, Endpoints | Added[number]>
  readonly [EndpointTypeId]: Endpoints
}

export type StdbHttpGroup<
  Id extends string,
  Endpoints extends AnyHttpRouteDecl = never,
> = {
  readonly kind: "stdbHttpGroup"
  readonly id: Id
  readonly endpoints: ReadonlyArray<AnyHttpRouteDecl>
  readonly add: <const Added extends NonEmptyReadonlyArray<AnyHttpRouteDecl>>(
    ...endpoints: Added
  ) => StdbHttpGroup<Id, Endpoints | Added[number]>
  readonly prefix: <const Prefix extends string>(
    prefix: Prefix,
  ) => StdbHttpGroup<Id, Endpoints>
  readonly nest: <
    const Prefix extends string,
    Other extends StdbHttpGroup<string, AnyHttpRouteDecl>,
  >(
    prefix: Prefix,
    other: Other,
  ) => StdbHttpGroup<Id, Endpoints | EndpointsOfGroup<Other>>
  readonly merge: <Other extends StdbHttpGroup<string, AnyHttpRouteDecl>>(
    other: Other,
  ) => StdbHttpGroup<Id, Endpoints | EndpointsOfGroup<Other>>
  readonly [EndpointTypeId]: Endpoints
}

export type StdbModule<
  Id extends string,
  Tables extends Record<string, AnyTableSpec>,
  Groups extends AnyGroup = never,
  // Eagerly-accumulated lightweight union of declared group names. Threaded
  // through `add` so `GroupNames` can read it directly instead of
  // materializing the heavy `Groups` union at `build` time (which blew TS's
  // instantiation budget — TS2589 — for large modules). Defaults to deriving
  // from `Groups` so a bare 3-arg `StdbModule<…>` annotation stays correct;
  // large modules should pass this 4th argument explicitly to stay cheap.
  GroupNameUnion extends string = GroupNameOf<Groups>,
  // Eagerly-accumulated lightweight union of table names. This avoids forcing
  // name-only checks through a large `Tables` intersection for large modules.
  TableNameUnion extends string = keyof Tables & string,
  Lifecycle extends LifecycleSpecs = {},
  // Eagerly-accumulated route-to-HTTP-group pairs. This keeps the canonical
  // HttpApi projection from deriving group membership from the heavy `Groups`
  // union when `.spec` is read.
  HttpGroupPairs extends HttpGroupPair = HttpGroupPairsOf<Groups>,
  // Eagerly-accumulated scheduled table names and target/table pairs. These are
  // intentionally name-only unions so build-time schedule coverage checks never
  // derive through the heavy module/group spec surface.
  ScheduledTableNameUnion extends string = ScheduledTableNameOf<
    Tables[keyof Tables]
  >,
  SchedulePairs extends SchedulePair = SchedulePairsOf<Groups>,
  GroupEndpointPairs extends GroupEndpointPair = GroupEndpointPairsOf<Groups>,
> = RuntimeModuleState &
  ModuleAccessors<
    ModuleSpecFor<Id, Tables, Groups, Lifecycle, HttpGroupPairs>
  > & {
    readonly spec: ModuleSpecFor<Id, Tables, Groups, Lifecycle, HttpGroupPairs>
    readonly addTables: <const Added extends ReadonlyArray<AnyTableSpec>>(
      ...tables: Added
    ) => StdbModule<
      Id,
      Tables & TablesFromTuple<Added>,
      Groups,
      GroupNameUnion,
      TableNameUnion | TableNameOf<Added[number]>,
      Lifecycle,
      HttpGroupPairs,
      ScheduledTableNameUnion | ScheduledTableNameOf<Added[number]>,
      SchedulePairs,
      GroupEndpointPairs
    >
    readonly add: <const Added extends NonEmptyReadonlyArray<AnyGroup>>(
      ...groups: Added
    ) => StdbModule<
      Id,
      Tables,
      Groups | Added[number],
      GroupNameUnion | GroupNameOf<Added[number]>,
      TableNameUnion,
      Lifecycle,
      HttpGroupPairs | HttpGroupPairsOf<Added[number]>,
      ScheduledTableNameUnion,
      SchedulePairs | SchedulePairsOf<Added[number]>,
      GroupEndpointPairs | GroupEndpointPairsOf<Added[number]>
    >
    readonly [GroupTypeId]: Groups
    readonly [GroupNamesTypeId]: GroupNameUnion
    readonly [TableNamesTypeId]: TableNameUnion
    readonly [ScheduledTableNamesTypeId]: ScheduledTableNameUnion
    readonly [SchedulePairsTypeId]: SchedulePairs
    readonly [GroupEndpointPairsTypeId]: GroupEndpointPairs
    readonly [HttpGroupPairsTypeId]: HttpGroupPairs
    readonly [ModuleSpecTypeId]: ModuleSpecFor<
      Id,
      Tables,
      Groups,
      Lifecycle,
      HttpGroupPairs
    >
  }
