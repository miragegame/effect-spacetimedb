import * as Effect from "effect/Effect"
import type * as Layer from "effect/Layer"
import * as Match from "effect/Match"
import type * as Schema from "effect/Schema"

import type { StdbDecodeError } from "./decode-error.ts"
import {
  httpHandlerRoutesOverlap,
  StdbDiagnostic,
  StdbValidationError,
  type StdbDiagnosticCode,
} from "./contract/module-validation.ts"
import {
  define as defineModule,
  type AnyModuleSpec,
  type ModuleSpec,
} from "./contract/module.ts"
import {
  define as defineReducer,
  type ReducerSpec,
} from "./contract/reducer.ts"
import {
  define as defineProcedure,
  type ProcedureSpec,
} from "./contract/procedure.ts"
import {
  anonymous as defineAnonymousView,
  sender as defineSenderView,
  type AnyViewSpec,
} from "./contract/view.ts"
import {
  isLifecycleName,
  lifecycle as defineLifecycle,
  type LifecycleName,
  type LifecycleSpec,
  type LifecycleSpecs,
} from "./contract/lifecycle.ts"
import {
  define as defineHttpHandler,
  type HttpHandlerMethod,
  type HttpHandlerSpec,
  type RawHttpHandlerSpec,
  type TypedHttpHandlerSpec,
} from "./contract/http-handler.ts"
import type {
  AnyErrorDefinition,
  DefinitionOfInputOrUndefined,
  ErrorInstances,
  ErrorsInput,
} from "./contract/error.ts"
import type { ModuleSettings } from "./contract/settings.ts"
import type { AnyScheduledTableSpec, AnyTableSpec } from "./contract/table.ts"
import {
  struct,
  unit,
  type AnyValueType,
  type StructLikeValueType,
  type TypeOf,
} from "./contract/type.ts"
import type { Request, SyncResponse } from "./http-primitives.ts"
import * as Server from "./server/bind.ts"
import * as ServerContext from "./server/context.ts"
import type { StdbHostFailure } from "./server/services.ts"
import {
  fromLayer as syncRunnerFromLayer,
  isSyncRunnerLike,
  type SyncRunner,
  type SyncRunnerLike,
} from "./server/sync-runner.ts"
import type {
  AnonymousViewAllowedRequirements,
  HandlerInputDefinitions,
  HttpHandlerAllowedRequirements,
  HttpHandlerErrors,
  HttpHandlerRequestOf,
  HttpHandlerResponseOf,
  ProcedureAllowedRequirements,
  ProcedureHandlerErrors,
  ReducerAllowedRequirements,
  ReducerHandlerErrors,
  SenderViewAllowedRequirements,
  ViewHandlerErrors,
  ViewSuccessOf,
} from "./server/handler-types.ts"

declare const EndpointTypeId: unique symbol
declare const GroupTypeId: unique symbol
declare const ModuleSpecTypeId: unique symbol
declare const GroupNamesTypeId: unique symbol
declare const TableNamesTypeId: unique symbol
declare const ScheduledTableNamesTypeId: unique symbol
declare const SchedulePairsTypeId: unique symbol
declare const GroupEndpointPairsTypeId: unique symbol
declare const HttpGroupPairsTypeId: unique symbol
declare const GroupImplRuntimeTypeId: unique symbol
declare const LifecycleImplHooksTypeId: unique symbol

type NonEmptyReadonlyArray<A> = readonly [A, ...ReadonlyArray<A>]

type Expand<T> = {
  readonly [K in keyof T]: T[K]
}

type UnionToIntersection<Union> = (
  Union extends unknown
    ? (value: Union) => void
    : never
) extends (value: infer Intersection) => void
  ? Intersection
  : never

type DeclRecordUnion<
  Endpoints,
  Kind extends AnyEndpointDecl["declKind"],
  SpecConstraint,
> = Endpoints extends {
  readonly declKind: Kind
  readonly name: infer Name extends string
  readonly spec: infer Spec extends SpecConstraint
}
  ? { readonly [RecordKey in Name]: Spec }
  : never

type MergeRecordUnion<Union> = [Union] extends [never]
  ? {}
  : UnionToIntersection<Union>

type RecordFromDecls<
  Endpoints,
  Kind extends AnyEndpointDecl["declKind"],
  SpecConstraint,
> = Expand<{
  readonly [Key in keyof MergeRecordUnion<
    DeclRecordUnion<Endpoints, Kind, SpecConstraint>
  > &
    string]: Extract<
    MergeRecordUnion<DeclRecordUnion<Endpoints, Kind, SpecConstraint>>[Key],
    SpecConstraint
  >
}>

type LifecycleRecordFromNames<Names extends LifecycleName> = Expand<{
  readonly [Name in Names]: LifecycleSpec<Name>
}>

type LifecycleOf<Lifecycle> = Lifecycle extends LifecycleSpecs ? Lifecycle : {}

type LifecycleKeysOf<Lifecycle> = Lifecycle extends LifecycleSpecs
  ? LifecycleSpecs extends Lifecycle
    ? never
    : keyof Lifecycle & LifecycleName
  : never

type LiteralLifecycleName<Name extends LifecycleName> =
  LifecycleName extends Name ? never : Name

type LifecycleNamesFromDecls<Endpoints> = Endpoints extends {
  readonly declKind: "lifecycle"
  readonly name: infer Name extends LifecycleName
}
  ? LiteralLifecycleName<Name>
  : never

type EndpointsOfGroup<Group> = Group extends {
  readonly [EndpointTypeId]: infer Endpoints
}
  ? Endpoints
  : never

type GroupsOfModule<Module> = Module extends {
  readonly [GroupTypeId]: infer Groups
}
  ? Groups
  : never

// Extracts just the `id` literal(s) from a group (or group union). Cheap when
// applied to the small set of groups passed to a single `.add(...)`; used to
// eagerly accumulate a lightweight group-name union on the module type so
// `GroupNames` never has to materialize the heavy `[GroupTypeId]` group union.
type GroupNameOf<Group> = Group extends { readonly id: infer Id extends string }
  ? Id
  : never

type GroupEndpointPair = { readonly group: string; readonly name: string }

type GroupEndpointPairsOf<Groups> = Groups extends {
  readonly id: infer GroupId extends string
  readonly [EndpointTypeId]: infer Endpoints
}
  ? Endpoints extends { readonly name: infer EndpointName extends string }
    ? { readonly group: GroupId; readonly name: EndpointName }
    : never
  : never

type HttpGroupPair = { readonly name: string; readonly group: string }

type HttpGroupPairsOf<Groups> = Groups extends StdbHttpGroup<
  infer GroupId,
  infer Endpoints
>
  ? Endpoints extends AnyHttpRouteDecl
    ? { readonly name: Endpoints["name"]; readonly group: GroupId }
    : never
  : never

type HttpGroupMapFromPairs<Pairs extends HttpGroupPair> = {
  readonly [Pair in Pairs as Pair["name"]]: Pair["group"]
}

type TableNameOf<Table> = Table extends {
  readonly name: infer Name extends string
}
  ? Name
  : never

type ScheduledTableNameOf<Table> = Table extends {
  readonly scheduled: true
  readonly name: infer Name extends string
}
  ? Name
  : never

type SchedulePair = { readonly target: string; readonly table: string }

type SchedulePairsOf<Groups> = Groups extends StdbGroup<string, infer Endpoints>
  ? Endpoints extends {
      readonly name: infer Target extends string
      readonly spec: {
        readonly scheduled: {
          readonly table: { readonly name: infer Table extends string }
        }
      }
    }
    ? { readonly target: Target; readonly table: Table }
    : never
  : never

type TablesFromTuple<Tables extends ReadonlyArray<AnyTableSpec>> = Expand<{
  readonly [Table in Tables[number] as Table["name"]]: Table
}>

type SpecOfModule<Module> = Module extends {
  readonly [ModuleSpecTypeId]: infer Spec extends AnyModuleSpec
}
  ? Spec
  : never

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

type ScheduledParams<Table extends AnyTableSpec> = StructLikeValueType & {
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

type EndpointsOfGroups<Groups> = Groups extends unknown
  ? EndpointsOfGroup<Groups>
  : never

type ModuleSpecFor<
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

type AnyGroup =
  | StdbGroup<string, AnyCallableDecl>
  | StdbHttpGroup<string, AnyHttpRouteDecl>

type RuntimeModuleState = {
  readonly id: string
  readonly settings: ModuleSettings
  readonly tables: Record<string, AnyTableSpec>
  readonly lifecycle: LifecycleSpecs
  readonly groups: ReadonlyArray<AnyGroup>
}

type ModuleAccessors<Spec extends AnyModuleSpec> = {
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

// Reads the eagerly-accumulated group-name union off the module (cheap) rather
// than deriving it from the heavy `[GroupTypeId]` group union.
type GroupNames<Module extends AnyStdbModule> = Module extends {
  readonly [GroupNamesTypeId]: infer Names extends string
}
  ? Names
  : never

type TableNames<Module extends AnyStdbModule> = Module extends {
  readonly [TableNamesTypeId]: infer Names extends string
}
  ? Names
  : never

type ScheduledTableNames<Module extends AnyStdbModule> = Module extends {
  readonly [ScheduledTableNamesTypeId]: infer Names extends string
}
  ? Names
  : never

type SchedulePairsOfModule<Module extends AnyStdbModule> = Module extends {
  readonly [SchedulePairsTypeId]: infer Pairs extends SchedulePair
}
  ? Pairs
  : never

type GroupEndpointPairsOfModule<Module extends AnyStdbModule> = Module extends {
  readonly [GroupEndpointPairsTypeId]: infer Pairs extends GroupEndpointPair
}
  ? Pairs
  : never

type GroupByName<Module extends AnyStdbModule, Name extends string> = Extract<
  GroupsOfModule<Module>,
  { readonly id: Name }
>

type EndpointsOfGroupName<
  Module extends AnyStdbModule,
  Name extends string,
> = EndpointsOfGroup<GroupByName<Module, Name>>

type ArgsFor<Decl> = Decl extends {
  readonly declKind: "reducer" | "procedure"
  readonly spec: { readonly params: infer Params extends StructLikeValueType }
}
  ? TypeOf<Params>
  : Decl extends TypedHttpRouteDecl<
        string,
        HttpHandlerMethod,
        Schema.Top,
        Schema.Top
      >
    ? HttpHandlerRequestOf<Decl["spec"]>
    : Decl extends RawHttpRouteDecl
      ? Request
      : Decl extends SenderViewDecl | AnonymousViewDecl
        ? Record<string, never>
        : Record<string, never>

type SuccessFor<Decl> = Decl extends { readonly declKind: "reducer" }
  ? unknown
  : Decl extends {
        readonly declKind: "procedure"
        readonly spec: { readonly returns: infer Returns extends AnyValueType }
      }
    ? TypeOf<Returns>
    : Decl extends TypedHttpRouteDecl
      ? HttpHandlerResponseOf<Decl["spec"]>
      : Decl extends RawHttpRouteDecl
        ? SyncResponse
        : Decl extends SenderViewDecl | AnonymousViewDecl
          ? ViewSuccessOf<Decl["spec"]>
          : unknown

type ErrorsFor<Decl> = Decl extends {
  readonly declKind: "reducer"
  readonly spec: ReducerSpec
}
  ? ReducerHandlerErrors<Decl["spec"]>
  : Decl extends {
        readonly declKind: "procedure"
        readonly spec: ProcedureSpec
      }
    ? ProcedureHandlerErrors<Decl["spec"]>
    : Decl extends AnyHttpRouteDecl
      ? HttpHandlerErrors<Decl["spec"]>
      : Decl extends SenderViewDecl | AnonymousViewDecl
        ? ViewHandlerErrors
        : unknown

type IsAny<Value> = 0 extends 1 & Value ? true : false

type IsNoPayloadArgs<Args> = IsAny<Args> extends true
  ? false
  : [Args] extends [Record<string, never>]
    ? [Record<string, never>] extends [Args]
      ? true
      : false
    : false

type HasNoHandlerArgs<Decl> = IsNoPayloadArgs<ArgsFor<Decl>> extends true
  ? true
  : false

type AllowedFor<Decl> = Decl extends {
  readonly declKind: "reducer" | "lifecycle"
}
  ? ReducerAllowedRequirements
  : Decl extends { readonly declKind: "procedure" }
    ? ProcedureAllowedRequirements
    : Decl extends AnyHttpRouteDecl
      ? HttpHandlerAllowedRequirements
      : Decl extends SenderViewDecl
        ? SenderViewAllowedRequirements
        : Decl extends AnonymousViewDecl
          ? AnonymousViewAllowedRequirements
          : never

type EndpointHandlerFn<Decl> = Decl extends LifecycleDecl
  ? () => Effect.Effect<SuccessFor<Decl>, ErrorsFor<Decl>, unknown>
  : HasNoHandlerArgs<Decl> extends true
    ? () => Effect.Effect<SuccessFor<Decl>, ErrorsFor<Decl>, unknown>
    : (
        args: ArgsFor<Decl>,
      ) => Effect.Effect<SuccessFor<Decl>, ErrorsFor<Decl>, unknown>

type GroupHandlerKeys<
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

type HandlerRequirementsFor<Handler> = Handler extends (
  ...args: infer _Args
) => Effect.Effect<unknown, unknown, infer R>
  ? R
  : never

type HasForbiddenRequirements<
  Handler,
  Allowed extends ServerContext.AnyServerContextRequirements,
> = Extract<
  HandlerRequirementsFor<Handler>,
  Exclude<ServerContext.AnyServerContextRequirements, Allowed>
> extends never
  ? false
  : true

type HandlerWithAllowedRequirements<Decl, Handler> = HasForbiddenRequirements<
  Handler,
  AllowedFor<Decl>
> extends true
  ? never
  : Handler

type ExtraHandlerKeys<Handlers, Expected> = Exclude<
  keyof Handlers,
  keyof Expected
>

type NoExtraHandlerKeys<Handlers, Expected> = [
  ExtraHandlerKeys<Handlers, Expected>,
] extends [never]
  ? unknown
  : {
      readonly [Key in ExtraHandlerKeys<Handlers, Expected>]: never
    }

type HandlerForDecl<
  Handlers,
  Decl extends { readonly name: string },
> = Decl["name"] extends keyof Handlers ? Handlers[Decl["name"]] : never

type ValidateGroupHandlers<
  Module extends AnyStdbModule,
  Name extends string,
  Handlers,
> = NoExtraHandlerKeys<Handlers, GroupHandlerKeys<Module, Name>> &
  Expand<{
    readonly [Decl in EndpointsOfGroupName<
      Module,
      Name
    > as Decl["name"]]: HandlerWithAllowedRequirements<
      Decl,
      HandlerForDecl<Handlers, Decl>
    >
  }>

type GroupEndpointNames<
  Module extends AnyStdbModule,
  Name extends string,
> = Extract<
  GroupEndpointPairsOfModule<Module>,
  { readonly group: Name }
>["name"]

type GroupEndpointKeyRecord<
  Module extends AnyStdbModule,
  Name extends string,
> = {
  readonly [Key in GroupEndpointNames<Module, Name>]: unknown
}

type MissingGroupHandlerKeys<
  Module extends AnyStdbModule,
  Name extends string,
  Handlers,
> = Exclude<GroupEndpointNames<Module, Name>, keyof Handlers>

type NoMissingGroupHandlerKeys<
  Module extends AnyStdbModule,
  Name extends string,
  Handlers,
> = [MissingGroupHandlerKeys<Module, Name, Handlers>] extends [never]
  ? unknown
  : {
      readonly [Key in MissingGroupHandlerKeys<Module, Name, Handlers>]: never
    }

type HandlerContextForKey<
  Module extends AnyStdbModule,
  Name extends string,
  Key extends string,
  Spec extends AnyModuleSpec = SpecOfModule<Module>,
> = Key extends GroupEndpointNames<Module, Name>
  ? Key extends keyof Spec["reducers"] & string
    ? (
        args: TypeOf<Spec["reducers"][Key]["params"]>,
      ) => Effect.Effect<
        unknown,
        ReducerHandlerErrors<Spec["reducers"][Key]>,
        unknown
      >
    : Key extends keyof Spec["procedures"] & string
      ? (
          args: TypeOf<Spec["procedures"][Key]["params"]>,
        ) => Effect.Effect<
          TypeOf<Spec["procedures"][Key]["returns"]>,
          ProcedureHandlerErrors<Spec["procedures"][Key]>,
          unknown
        >
      : Key extends keyof Spec["views"] & string
        ? () => Effect.Effect<
            ViewSuccessOf<Spec["views"][Key]>,
            ViewHandlerErrors,
            unknown
          >
        : Key extends keyof Spec["httpHandlers"] & string
          ? (
              args: HttpHandlerRequestOf<Spec["httpHandlers"][Key]>,
            ) => Effect.Effect<
              HttpHandlerResponseOf<Spec["httpHandlers"][Key]>,
              HttpHandlerErrors<Spec["httpHandlers"][Key]>,
              unknown
            >
          : Key extends keyof Spec["lifecycle"] & LifecycleName
            ? () => Effect.Effect<unknown, unknown, unknown>
            : never
  : never

type AllowedRequirementsForKey<
  Module extends AnyStdbModule,
  Key extends string,
  Spec extends AnyModuleSpec = SpecOfModule<Module>,
> = Key extends keyof Spec["reducers"] & string
  ? ReducerAllowedRequirements
  : Key extends keyof Spec["procedures"] & string
    ? ProcedureAllowedRequirements
    : Key extends keyof Spec["views"] & string
      ? Spec["views"][Key] extends { readonly context: "anonymous" }
        ? AnonymousViewAllowedRequirements
        : SenderViewAllowedRequirements
      : Key extends keyof Spec["httpHandlers"] & string
        ? HttpHandlerAllowedRequirements
        : Key extends keyof Spec["lifecycle"] & LifecycleName
          ? ReducerAllowedRequirements
          : never

type CheckedForbiddenHandlerKeys<
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

type NoCheckedForbiddenRequirements<
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

type ValidateCheckedGroupHandlers<
  Module extends AnyStdbModule,
  Name extends string,
  Handlers,
> = NoExtraHandlerKeys<Handlers, GroupEndpointKeyRecord<Module, Name>> &
  NoMissingGroupHandlerKeys<Module, Name, Handlers> &
  NoCheckedForbiddenRequirements<Module, Name, Handlers> &
  Expand<{
    readonly [Key in keyof Handlers & string]: HandlerContextForKey<
      Module,
      Name,
      Key
    >
  }>

export type GroupCheckedHandlers<
  Module extends AnyStdbModule,
  Name extends GroupNames<Module>,
  Keys extends GroupEndpointNames<Module, Name> = GroupEndpointNames<
    Module,
    Name
  >,
> = Expand<{
  readonly [Key in Keys]: HandlerContextForKey<Module, Name, Key>
}>

type LifecycleHandlerKeys = {
  readonly [Name in LifecycleName]: unknown
}

type ValidateLifecycleHandlers<Handlers> = NoExtraHandlerKeys<
  Handlers,
  LifecycleHandlerKeys
> &
  Expand<{
    readonly [Name in keyof Handlers &
      LifecycleName]: HandlerWithAllowedRequirements<
      LifecycleDecl<Name>,
      Handlers[Name]
    > extends never
      ? never
      : Handlers[Name] extends () => Effect.Effect<unknown, unknown, unknown>
        ? HandlerWithAllowedRequirements<LifecycleDecl<Name>, Handlers[Name]>
        : never
  }>

type HandlerServicesFor<Handler> = Handler extends (
  ...args: infer _Args
) => Effect.Effect<unknown, unknown, infer R>
  ? R
  : never

type RuntimeROfGroupHandlers<Handlers> = Exclude<
  keyof Handlers extends infer Key
    ? Key extends keyof Handlers
      ? HandlerServicesFor<Handlers[Key]>
      : never
    : never,
  ServerContext.AnyServerContextRequirements
>

export type GroupImpl<
  Module extends AnyStdbModule,
  Name extends string,
  RuntimeR,
> = {
  readonly module: Module
  readonly groupName: Name
  readonly definitions: Partial<
    HandlerInputDefinitions<SpecOfModule<Module>, RuntimeR>
  >
  readonly [GroupImplRuntimeTypeId]: RuntimeR
}

export type LifecycleImpl<
  Module extends AnyStdbModule,
  Hooks extends LifecycleName,
  RuntimeR,
> = {
  readonly kind: "stdbLifecycle"
  readonly module: Module
  readonly lifecycleSpecs: Partial<LifecycleRecordFromNames<Hooks>>
  readonly definitions: Partial<
    HandlerInputDefinitions<
      SpecOfModule<Module> & {
        readonly lifecycle: Expand<
          SpecOfModule<Module>["lifecycle"] & LifecycleRecordFromNames<Hooks>
        >
      },
      RuntimeR
    >
  >
  readonly [LifecycleImplHooksTypeId]: Hooks
  readonly [GroupImplRuntimeTypeId]: RuntimeR
}

// The `build` element constraint only needs each impl's `groupName` (to check
// exhaustiveness via `CoverAllGroups`/`ImplGroupName`). It deliberately omits
// `GroupImpl`'s heavy `module` and `definitions` fields so reading names from N
// impls never materializes the full per-group endpoint surface N times — that
// blew TS's instantiation budget (TS2589) for large modules. Per-group handler
// coverage is already enforced where each impl is built (`StdbBuilder.group` →
// `ValidateComplete`); the real (heavy) `GroupImpl` values still satisfy this.
type AnyGroupImpl = {
  readonly groupName: string
}

type AnyLifecycleImpl = {
  readonly kind: "stdbLifecycle"
}

export type AnyBuilderImpl = AnyGroupImpl | AnyLifecycleImpl

type RuntimeROfImpl<Impl> = Impl extends {
  readonly [GroupImplRuntimeTypeId]: infer RuntimeR
}
  ? RuntimeR
  : never

export type RuntimeROfImpls<Impls extends ReadonlyArray<unknown>> =
  Impls[number] extends infer Impl ? RuntimeROfImpl<Impl> : never

type ImplGroupName<Impl> = Impl extends { readonly groupName: infer Name }
  ? Name
  : never

type LifecycleHooksOfImpl<Impl> = Impl extends {
  readonly [LifecycleImplHooksTypeId]: infer Hooks extends LifecycleName
}
  ? Hooks
  : never

type LifecycleSpecsOfImpls<Impls extends ReadonlyArray<unknown>> = Expand<
  LifecycleRecordFromNames<LifecycleHooksOfImpl<Impls[number]>>
>

type SpecWithLifecycle<
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
  Spec["httpHandlers"]
> & { readonly name: Spec["name"] }

export type BuildSpec<
  Module extends AnyStdbModule,
  Impls extends ReadonlyArray<unknown>,
> = SpecWithLifecycle<SpecOfModule<Module>, LifecycleSpecsOfImpls<Impls>>

type MissingGroups<
  Module extends AnyStdbModule,
  Impls extends ReadonlyArray<unknown>,
> = Exclude<GroupNames<Module>, ImplGroupName<Impls[number]>>

// Tail-recursive (accumulator) form: TS instantiates this as a single chain
// rather than unioning each recursive result, which keeps the per-`build` call
// instantiation budget low enough for large modules (many groups) to avoid
// TS2589 "excessively deep" in full-program builds.
type DuplicateImplGroups<
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

type MissingScheduleTargets<Module extends AnyStdbModule> = Exclude<
  ScheduledTableNames<Module>,
  SchedulePairsOfModule<Module>["table"]
>

type UnregisteredScheduleTargetTables<Module extends AnyStdbModule> = Exclude<
  SchedulePairsOfModule<Module>["table"],
  TableNames<Module>
>

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

export type BuildRuntime<RuntimeR> =
  | SyncRunner<RuntimeR>
  | SyncRunnerLike<RuntimeR>
  | Layer.Layer<RuntimeR, never, never>

export type StdbBuildPlan<
  Module extends AnyModuleSpec = AnyModuleSpec,
  RuntimeR = never,
> = {
  readonly server: Server.ServerInstance<Module, RuntimeR>
  readonly handlers: Server.Handlers<Module, RuntimeR>
}

const diagnostic = (
  code: StdbDiagnosticCode,
  path: ReadonlyArray<string | number>,
  message: string,
): StdbValidationError =>
  new StdbValidationError({
    diagnostics: [
      new StdbDiagnostic({
        code,
        path,
        message,
        severity: "error",
      }),
    ],
  })

const duplicateCallableError = (
  path: ReadonlyArray<string | number>,
  message: string,
): StdbValidationError => diagnostic("DuplicateCallableName", path, message)

const normalizeRoutePath = (...parts: ReadonlyArray<string>): string => {
  const joined = parts.filter((part) => part.length > 0).join("/")
  const normalized = joined.replaceAll(/\/+/g, "/")
  const withLeadingSlash = normalized.startsWith("/")
    ? normalized
    : `/${normalized}`
  return withLeadingSlash.length > 1 && withLeadingSlash.endsWith("/")
    ? withLeadingSlash.slice(0, -1)
    : withLeadingSlash
}

const assertUniqueEndpointNames = (
  groupId: string,
  endpoints: ReadonlyArray<AnyEndpointDecl>,
): void => {
  const seen = new Set<string>()
  for (const endpoint of endpoints) {
    if (seen.has(endpoint.name)) {
      throw duplicateCallableError(
        ["groups", groupId, endpoint.name],
        `Group ${groupId} declares duplicate endpoint ${endpoint.name}`,
      )
    }
    seen.add(endpoint.name)
  }
}

const assertHttpRouteConflicts = (
  groupId: string,
  endpoints: ReadonlyArray<AnyHttpRouteDecl>,
): void => {
  for (let leftIndex = 0; leftIndex < endpoints.length; leftIndex += 1) {
    const left = endpoints[leftIndex]
    if (left == null) {
      continue
    }
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < endpoints.length;
      rightIndex += 1
    ) {
      const right = endpoints[rightIndex]
      if (right == null) {
        continue
      }
      if (!httpHandlerRoutesOverlap(left.spec, right.spec)) {
        continue
      }
      throw diagnostic(
        "DuplicateHttpHandlerRoute",
        ["groups", groupId, right.name],
        `HTTP route ${right.spec.method.toUpperCase()} ${right.spec.path} for ${right.name} overlaps with ${left.name}`,
      )
    }
  }
}

const assertUniqueGroupIds = (groups: ReadonlyArray<AnyGroup>): void => {
  const seen = new Set<string>()
  for (const group of groups) {
    if (seen.has(group.id)) {
      throw duplicateCallableError(
        ["groups", group.id],
        `Module declares duplicate group ${group.id}`,
      )
    }
    seen.add(group.id)
  }
}

const assertNoDuplicateTableKeys = (
  left: Record<string, AnyTableSpec>,
  right: Record<string, AnyTableSpec>,
): void => {
  for (const key of Object.keys(right)) {
    if (Object.hasOwn(left, key)) {
      throw diagnostic(
        "DuplicateRelationName",
        ["tables", key],
        `Module merge declares duplicate table key ${key}`,
      )
    }
  }
}

const tableRecordFromList = (
  tables: ReadonlyArray<AnyTableSpec>,
): Record<string, AnyTableSpec> => {
  const entries: Array<readonly [string, AnyTableSpec]> = []
  const seen = new Set<string>()
  for (const table of tables) {
    if (seen.has(table.name)) {
      throw diagnostic(
        "DuplicateRelationName",
        ["tables", table.name],
        `Module declares duplicate table ${table.name}`,
      )
    }
    seen.add(table.name)
    entries.push([table.name, table])
  }
  return Object.fromEntries(entries)
}

const transformHttpEndpointPath = <Endpoint extends AnyHttpRouteDecl>(
  endpoint: Endpoint,
  prefix: string,
): Endpoint =>
  ({
    ...endpoint,
    spec: {
      ...endpoint.spec,
      path: normalizeRoutePath(prefix, endpoint.spec.path),
    },
  }) as Endpoint

const makeCallableGroup = <
  Id extends string,
  Endpoints extends AnyCallableDecl,
>(
  id: Id,
  endpoints: ReadonlyArray<AnyCallableDecl>,
): StdbGroup<Id, Endpoints> => {
  assertUniqueEndpointNames(id, endpoints)

  return {
    kind: "stdbGroup",
    id,
    endpoints,
    add: (...added) =>
      makeCallableGroup<Id, Endpoints | (typeof added)[number]>(id, [
        ...endpoints,
        ...added,
      ]),
  } as StdbGroup<Id, Endpoints>
}

const makeHttpGroup = <Id extends string, Endpoints extends AnyHttpRouteDecl>(
  id: Id,
  endpoints: ReadonlyArray<AnyHttpRouteDecl>,
  activePrefix = "",
): StdbHttpGroup<Id, Endpoints> => {
  assertUniqueEndpointNames(id, endpoints)
  assertHttpRouteConflicts(id, endpoints)

  return {
    kind: "stdbHttpGroup",
    id,
    endpoints,
    add: (...added: NonEmptyReadonlyArray<AnyHttpRouteDecl>) =>
      makeHttpGroup<Id, Endpoints | (typeof added)[number]>(
        id,
        [
          ...endpoints,
          ...added.map((endpoint) =>
            transformHttpEndpointPath(endpoint, activePrefix),
          ),
        ],
        activePrefix,
      ),
    prefix: (nextPrefix: string) =>
      makeHttpGroup<Id, Endpoints>(
        id,
        endpoints.map((endpoint) =>
          transformHttpEndpointPath(endpoint, nextPrefix),
        ),
        normalizeRoutePath(activePrefix, nextPrefix),
      ),
    nest: (prefix: string, other: StdbHttpGroup<string, AnyHttpRouteDecl>) =>
      makeHttpGroup(
        id,
        [
          ...endpoints,
          ...other.endpoints.map((endpoint: AnyHttpRouteDecl) =>
            transformHttpEndpointPath(
              endpoint,
              normalizeRoutePath(activePrefix, prefix),
            ),
          ),
        ],
        activePrefix,
      ) as never,
    merge: (other: StdbHttpGroup<string, AnyHttpRouteDecl>) =>
      makeHttpGroup(
        id,
        [...endpoints, ...other.endpoints],
        activePrefix,
      ) as never,
  } as unknown as StdbHttpGroup<Id, Endpoints>
}

const makeAccessors = <
  Spec extends AnyModuleSpec,
>(): ModuleAccessors<Spec> => ({
  Db: Effect.map(ServerContext.Db, (db) => db as ServerContext.DbService<Spec>),
  ReadonlyDb: Effect.map(
    ServerContext.ReadonlyDb,
    (db) => db as ServerContext.ReadonlyDbService<Spec>,
  ),
  ReducerCtx: Effect.map(
    ServerContext.ReducerCtx,
    (ctx) => ctx as ServerContext.ReducerCtxService<Spec>,
  ),
  ProcedureCtx: Effect.map(
    ServerContext.ProcedureCtx,
    (ctx) => ctx as ServerContext.ProcedureCtxService<Spec>,
  ),
  TxCtx: Effect.map(
    ServerContext.TxCtx,
    (ctx) => ctx as ServerContext.TxCtxService<Spec>,
  ),
  ViewCtx: Effect.map(
    ServerContext.ViewCtx,
    (ctx) => ctx as ServerContext.ViewCtxService<Spec>,
  ),
  AnonymousViewCtx: Effect.map(
    ServerContext.AnonymousViewCtx,
    (ctx) => ctx as ServerContext.AnonymousViewCtxService<Spec>,
  ),
  HttpHandlerCtx: Effect.map(
    ServerContext.HttpHandlerCtx,
    (ctx) => ctx as ServerContext.HttpHandlerCtxService<Spec>,
  ),
  MutationCtx: Effect.map(
    ServerContext.MutationCtx,
    (ctx) => ctx as ServerContext.MutationCtxService<Spec>,
  ),
  From: Effect.map(
    ServerContext.From,
    (from) => from as ServerContext.FromService<Spec>,
  ),
  Http: Effect.map(ServerContext.Http, (http) => http),
  Tx: ServerContext.txRunnerForModule<Spec>(),
  withTx: (effect) =>
    Effect.flatMap(ServerContext.TxRunner, (runner) => runner.run(effect)),
  HttpTx: ServerContext.httpTxRunnerForModule<Spec>(),
})

const sortedRecord = <Value>(
  entries: ReadonlyArray<readonly [string, Value]>,
): Record<string, Value> =>
  Object.fromEntries(
    entries.slice().sort(([left], [right]) => left.localeCompare(right)),
  ) as Record<string, Value>

const assembleSpec = <
  Id extends string,
  Tables extends Record<string, AnyTableSpec>,
  Groups extends AnyGroup,
  Lifecycle extends LifecycleSpecs,
  HttpGroupPairs extends HttpGroupPair,
>(
  state: RuntimeModuleState,
): ModuleSpecFor<Id, Tables, Groups, Lifecycle, HttpGroupPairs> => {
  const reducerEntries: Array<readonly [string, ReducerSpec]> = []
  const procedureEntries: Array<readonly [string, ProcedureSpec]> = []
  const viewEntries: Array<readonly [string, AnyViewSpec]> = []
  const lifecycleEntries: Array<readonly [string, LifecycleSpec]> = []
  const httpHandlerEntries: Array<readonly [string, HttpHandlerSpec]> = []
  const httpGroupEntries: Array<readonly [string, string]> = []
  const names = new Map<string, string>()
  const relationNames = new Map<string, string>()

  const assertExportName = (section: string, name: string): void => {
    const previous = names.get(name)
    if (previous != null) {
      throw duplicateCallableError(
        [section, name],
        `Endpoint ${name} is declared by both ${previous} and ${section}`,
      )
    }
    names.set(name, section)
  }

  const assertRelationName = (section: string, name: string): void => {
    const previous = relationNames.get(name)
    if (previous != null) {
      throw diagnostic(
        "DuplicateRelationName",
        [section, name],
        `Relation ${name} is declared by both ${previous} and ${section}`,
      )
    }
    relationNames.set(name, section)
  }

  for (const [tableKey, table] of Object.entries(state.tables)) {
    assertRelationName(`tables.${tableKey}`, table.name)
  }

  for (const [name, spec] of Object.entries(state.lifecycle)) {
    assertExportName("lifecycle", name)
    lifecycleEntries.push([name, spec])
  }

  for (const group of state.groups) {
    for (const endpoint of group.endpoints) {
      Match.value(endpoint).pipe(
        Match.discriminatorsExhaustive("declKind")({
          reducer: (endpoint) => {
            assertExportName("reducers", endpoint.name)
            reducerEntries.push([endpoint.name, endpoint.spec])
          },
          procedure: (endpoint) => {
            assertExportName("procedures", endpoint.name)
            procedureEntries.push([endpoint.name, endpoint.spec])
          },
          view: (endpoint) => {
            assertRelationName(`views.${endpoint.name}`, endpoint.name)
            viewEntries.push([endpoint.name, endpoint.spec])
          },
          lifecycle: (endpoint) => {
            assertExportName("lifecycle", endpoint.name)
            lifecycleEntries.push([endpoint.name, endpoint.spec])
          },
          httpHandler: (endpoint) => {
            assertExportName("httpHandlers", endpoint.name)
            httpHandlerEntries.push([endpoint.name, endpoint.spec])
            httpGroupEntries.push([endpoint.name, group.id])
          },
        }),
      )
    }
  }

  return defineModule({
    name: state.id,
    settings: state.settings,
    tables: state.tables as Tables,
    views: sortedRecord(viewEntries),
    reducers: sortedRecord(reducerEntries),
    procedures: sortedRecord(procedureEntries),
    lifecycle: sortedRecord(lifecycleEntries),
    httpHandlers: sortedRecord(httpHandlerEntries),
    httpGroups: sortedRecord(httpGroupEntries),
  }) as unknown as ModuleSpecFor<Id, Tables, Groups, Lifecycle, HttpGroupPairs>
}

const makeModule = <
  Id extends string,
  Tables extends Record<string, AnyTableSpec>,
  Groups extends AnyGroup = never,
  GroupNameUnion extends string = GroupNameOf<Groups>,
  TableNameUnion extends string = keyof Tables & string,
  Lifecycle extends LifecycleSpecs = {},
  HttpGroupPairs extends HttpGroupPair = HttpGroupPairsOf<Groups>,
  ScheduledTableNameUnion extends string = ScheduledTableNameOf<
    Tables[keyof Tables]
  >,
  SchedulePairs extends SchedulePair = SchedulePairsOf<Groups>,
  GroupEndpointPairs extends GroupEndpointPair = GroupEndpointPairsOf<Groups>,
>(
  state: RuntimeModuleState,
): StdbModule<
  Id,
  Tables,
  Groups,
  GroupNameUnion,
  TableNameUnion,
  Lifecycle,
  HttpGroupPairs,
  ScheduledTableNameUnion,
  SchedulePairs,
  GroupEndpointPairs
> => {
  assertUniqueGroupIds(state.groups)
  const accessors =
    makeAccessors<
      ModuleSpecFor<Id, Tables, Groups, Lifecycle, HttpGroupPairs>
    >()
  const module = {
    ...state,
    ...accessors,
    get spec() {
      return assembleSpec<Id, Tables, Groups, Lifecycle, HttpGroupPairs>(state)
    },
    addTables: (...tables: ReadonlyArray<AnyTableSpec>) => {
      const added = tableRecordFromList(tables)
      assertNoDuplicateTableKeys(state.tables, added)
      return makeModule<
        Id,
        Tables & TablesFromTuple<typeof tables>,
        Groups,
        GroupNameUnion,
        TableNameUnion | TableNameOf<(typeof tables)[number]>,
        Lifecycle,
        HttpGroupPairs,
        ScheduledTableNameUnion | ScheduledTableNameOf<(typeof tables)[number]>,
        SchedulePairs,
        GroupEndpointPairs
      >({
        ...state,
        tables: {
          ...state.tables,
          ...added,
        },
      })
    },
    add: (...groups: NonEmptyReadonlyArray<AnyGroup>) =>
      makeModule<
        Id,
        Tables,
        Groups | (typeof groups)[number],
        GroupNameUnion | GroupNameOf<(typeof groups)[number]>,
        TableNameUnion,
        Lifecycle,
        HttpGroupPairs | HttpGroupPairsOf<(typeof groups)[number]>,
        ScheduledTableNameUnion,
        SchedulePairs | SchedulePairsOf<(typeof groups)[number]>,
        GroupEndpointPairs | GroupEndpointPairsOf<(typeof groups)[number]>
      >({
        ...state,
        groups: [...state.groups, ...groups],
      }),
  }

  return module as unknown as StdbModule<
    Id,
    Tables,
    Groups,
    GroupNameUnion,
    TableNameUnion,
    Lifecycle,
    HttpGroupPairs,
    ScheduledTableNameUnion,
    SchedulePairs,
    GroupEndpointPairs
  >
}

const sectionForDecl = (
  decl: AnyEndpointDecl,
): keyof HandlerInputDefinitions<AnyModuleSpec> => {
  switch (decl.declKind) {
    case "reducer":
      return "reducers"
    case "procedure":
      return "procedures"
    case "view":
      return "views"
    case "lifecycle":
      return "lifecycle"
    case "httpHandler":
      return "httpHandlers"
  }
}

const findDecl = (
  groupId: string,
  endpoints: ReadonlyArray<AnyEndpointDecl>,
  name: string,
): AnyEndpointDecl => {
  const decl = endpoints.find((endpoint) => endpoint.name === name)
  if (decl == null) {
    throw diagnostic(
      "UnknownEndpoint",
      ["groups", groupId, name],
      `Unknown endpoint ${name}`,
    )
  }
  return decl
}

const makeHandlerDefinitionsFromRecord = <
  Module extends AnyStdbModule,
  RuntimeR,
>(
  groupId: string,
  endpoints: ReadonlyArray<AnyEndpointDecl>,
  handlers: Record<string, unknown>,
): {
  readonly definitions: Partial<
    HandlerInputDefinitions<SpecOfModule<Module>, RuntimeR>
  >
  readonly remainingNames: ReadonlySet<string>
} => {
  let definitions: Partial<
    HandlerInputDefinitions<SpecOfModule<Module>, RuntimeR>
  > = {}
  const remainingNames = new Set(endpoints.map((endpoint) => endpoint.name))

  for (const [name, handler] of Object.entries(handlers)) {
    if (!remainingNames.has(name)) {
      throw diagnostic(
        "EndpointAlreadyHandled",
        ["groups", groupId, name],
        `Endpoint ${name} was already handled or is not in group`,
      )
    }

    const decl = findDecl(groupId, endpoints, name)
    const section = sectionForDecl(decl)
    const nextSection = {
      ...((definitions[section] as Record<string, unknown> | undefined) ?? {}),
      [name]: handler,
    }
    definitions = {
      ...definitions,
      [section]: nextSection,
    } as Partial<HandlerInputDefinitions<SpecOfModule<Module>, RuntimeR>>
    remainingNames.delete(name)
  }

  return { definitions, remainingNames }
}

type RuntimeBuilderImpl<Module extends AnyStdbModule, RuntimeR> = {
  readonly definitions: Partial<
    HandlerInputDefinitions<SpecOfModule<Module>, RuntimeR>
  >
}

const mergeDefinitions = <Module extends AnyStdbModule, RuntimeR>(
  impls: ReadonlyArray<RuntimeBuilderImpl<Module, RuntimeR>>,
): Partial<HandlerInputDefinitions<SpecOfModule<Module>, RuntimeR>> => {
  const sections = {
    reducers: [] as Array<readonly [string, unknown]>,
    procedures: [] as Array<readonly [string, unknown]>,
    httpHandlers: [] as Array<readonly [string, unknown]>,
    views: [] as Array<readonly [string, unknown]>,
    lifecycle: [] as Array<readonly [string, unknown]>,
  }

  for (const impl of impls) {
    for (const section of Object.keys(sections) as Array<
      keyof typeof sections
    >) {
      for (const [key, handler] of Object.entries(
        (impl.definitions[section] as Record<string, unknown> | undefined) ??
          {},
      )) {
        sections[section].push([key, handler])
      }
    }
  }

  return {
    reducers:
      sections.reducers.length > 0
        ? sortedRecord(sections.reducers)
        : undefined,
    procedures:
      sections.procedures.length > 0
        ? sortedRecord(sections.procedures)
        : undefined,
    httpHandlers:
      sections.httpHandlers.length > 0
        ? sortedRecord(sections.httpHandlers)
        : undefined,
    views: sections.views.length > 0 ? sortedRecord(sections.views) : undefined,
    lifecycle:
      sections.lifecycle.length > 0
        ? sortedRecord(sections.lifecycle)
        : undefined,
  } as Partial<HandlerInputDefinitions<SpecOfModule<Module>, RuntimeR>>
}

const normalizeRuntime = <RuntimeR>(
  runtime: BuildRuntime<RuntimeR>,
): SyncRunner<RuntimeR> | SyncRunnerLike<RuntimeR> =>
  isSyncRunnerLike<RuntimeR>(runtime) ? runtime : syncRunnerFromLayer(runtime)

const EmptyEndpointParams = struct({})

const reducerEndpoint = <
  const Name extends string,
  const Params extends StructLikeValueType = typeof EmptyEndpointParams,
  const Errors extends ErrorsInput | undefined = undefined,
  const Public extends boolean = true,
>(
  name: Name,
  spec: {
    readonly params?: Params
    readonly errors?: Errors
    readonly public?: Public
  },
): ReducerDecl<Name, Params, DefinitionOfInputOrUndefined<Errors>, Public> => ({
  declKind: "reducer",
  name,
  spec: defineReducer(spec as never) as ReducerSpec<
    Params,
    DefinitionOfInputOrUndefined<Errors>,
    Public
  >,
})

const procedureEndpoint = <
  const Name extends string,
  const Returns extends AnyValueType,
  const Params extends StructLikeValueType = typeof EmptyEndpointParams,
  const Errors extends ErrorsInput | undefined = undefined,
  const Public extends boolean = true,
>(
  name: Name,
  spec: {
    readonly params?: Params
    readonly returns: Returns
    readonly errors?: Errors
    readonly public?: Public
  },
): ProcedureDecl<
  Name,
  Params,
  Returns,
  DefinitionOfInputOrUndefined<Errors>,
  Public
> => ({
  declKind: "procedure",
  name,
  spec: defineProcedure(spec as never) as ProcedureSpec<
    Params,
    Returns,
    DefinitionOfInputOrUndefined<Errors>,
    Public
  >,
})

type ScheduledCallableOptions<
  Table extends AnyScheduledTableSpec,
  Errors extends ErrorsInput | undefined,
> = {
  readonly table: Table
  readonly errors?: Errors
  readonly allowExternalCallers?: boolean
}

const scheduledParams = <Table extends AnyScheduledTableSpec>(
  table: Table,
): ScheduledParams<Table> =>
  struct({
    data: table.row,
  }) as ScheduledParams<Table>

const scheduledReducerEndpoint = <
  const Name extends string,
  const Table extends AnyScheduledTableSpec,
  const Errors extends ErrorsInput | undefined = undefined,
>(
  name: Name,
  spec: ScheduledCallableOptions<Table, Errors>,
): ScheduledReducerDecl<Name, Table, DefinitionOfInputOrUndefined<Errors>> => {
  const reducer = defineReducer({
    params: scheduledParams(spec.table),
    errors: spec.errors,
    public: false,
  } as never) as ScheduledReducerSpec<
    Table,
    DefinitionOfInputOrUndefined<Errors>
  >

  return {
    declKind: "reducer",
    name,
    spec: {
      ...reducer,
      scheduled: {
        table: spec.table,
        allowExternalCallers: spec.allowExternalCallers === true,
      },
    },
  }
}

const scheduledProcedureEndpoint = <
  const Name extends string,
  const Table extends AnyScheduledTableSpec,
  const Errors extends ErrorsInput | undefined = undefined,
>(
  name: Name,
  spec: ScheduledCallableOptions<Table, Errors>,
): ScheduledProcedureDecl<
  Name,
  Table,
  DefinitionOfInputOrUndefined<Errors>
> => {
  const procedure = defineProcedure({
    params: scheduledParams(spec.table),
    returns: unit(),
    errors: spec.errors,
    public: false,
  } as never) as ScheduledProcedureSpec<
    Table,
    DefinitionOfInputOrUndefined<Errors>
  >

  return {
    declKind: "procedure",
    name,
    spec: {
      ...procedure,
      scheduled: {
        table: spec.table,
        allowExternalCallers: spec.allowExternalCallers === true,
      },
    },
  }
}

export const StdbFn = {
  reducer: reducerEndpoint,
  procedure: procedureEndpoint,
  scheduledReducer: scheduledReducerEndpoint,
  scheduledProcedure: scheduledProcedureEndpoint,
  view: <const Name extends string, const Returns extends AnyValueType>(
    name: Name,
    spec: { readonly returns: Returns; readonly public?: boolean },
  ): SenderViewDecl<Name, Returns> => ({
    declKind: "view",
    name,
    spec: defineSenderView({
      public: spec.public ?? true,
      returns: spec.returns,
    }) as SenderViewDecl<Name, Returns>["spec"],
  }),
  anonymousView: <
    const Name extends string,
    const Returns extends AnyValueType,
  >(
    name: Name,
    spec: { readonly returns: Returns; readonly public?: boolean },
  ): AnonymousViewDecl<Name, Returns> => ({
    declKind: "view",
    name,
    spec: defineAnonymousView({
      public: spec.public ?? true,
      returns: spec.returns,
    }) as AnonymousViewDecl<Name, Returns>["spec"],
  }),
  init: (): LifecycleDecl<"init"> => ({
    declKind: "lifecycle",
    name: "init",
    spec: defineLifecycle("init"),
  }),
  clientConnected: (): LifecycleDecl<"clientConnected"> => ({
    declKind: "lifecycle",
    name: "clientConnected",
    spec: defineLifecycle("clientConnected"),
  }),
  clientDisconnected: (): LifecycleDecl<"clientDisconnected"> => ({
    declKind: "lifecycle",
    name: "clientDisconnected",
    spec: defineLifecycle("clientDisconnected"),
  }),
}

type RawHttpOptions = {
  readonly successStatus?: number
  readonly request?: undefined
  readonly response?: undefined
  readonly errors?: undefined
}

type TypedHttpOptions<
  Req extends Schema.Top,
  Res extends Schema.Top,
  Errors extends ErrorsInput | undefined,
> = {
  readonly request: Req
  readonly response: Res
  readonly errors?: Errors
  readonly successStatus?: number
}

type HttpMethodBuilder<Method extends HttpHandlerMethod> = {
  <const Name extends string>(
    name: Name,
    path: string,
    spec?: RawHttpOptions,
  ): RawHttpRouteDecl<Name, Method>
  <
    const Name extends string,
    const Req extends Schema.Top,
    const Res extends Schema.Top,
    const Errors extends ErrorsInput | undefined = undefined,
  >(
    name: Name,
    path: string,
    spec: TypedHttpOptions<Req, Res, Errors>,
  ): TypedHttpRouteDecl<
    Name,
    Method,
    Req,
    Res,
    DefinitionOfInputOrUndefined<Errors>
  >
}

const httpMethod = <const Method extends HttpHandlerMethod>(
  method: Method,
): HttpMethodBuilder<Method> =>
  ((
    name: string,
    path: string,
    spec:
      | RawHttpOptions
      | TypedHttpOptions<Schema.Top, Schema.Top, ErrorsInput | undefined> = {},
  ) => {
    const normalizedPath = normalizeRoutePath(path)
    const httpSpec = defineHttpHandler({
      method,
      path: normalizedPath,
      ...spec,
    } as never)
    return {
      declKind: "httpHandler",
      httpMode:
        "request" in spec && spec.request !== undefined ? "typed" : "raw",
      name,
      spec: httpSpec,
    }
  }) as HttpMethodBuilder<Method>

export const StdbHttp = {
  get: httpMethod("get"),
  post: httpMethod("post"),
  put: httpMethod("put"),
  delete: httpMethod("delete"),
  patch: httpMethod("patch"),
  head: httpMethod("head"),
  options: httpMethod("options"),
  any: httpMethod("any"),
}

export const StdbGroup = {
  make: <const Id extends string>(id: Id): StdbGroup<Id, never> =>
    makeCallableGroup<Id, never>(id, []),
}

export const StdbHttpGroup = {
  make: <const Id extends string>(id: Id): StdbHttpGroup<Id, never> =>
    makeHttpGroup<Id, never>(id, []),
  normalizeRoutePath,
}

export const StdbModule = {
  make: <
    const Id extends string,
    const Lifecycle extends LifecycleSpecs | undefined = undefined,
  >(
    id: Id,
    config?: {
      readonly settings?: ModuleSettings
      readonly lifecycle?: Lifecycle
    },
  ): StdbModule<
    Id,
    {},
    never,
    never,
    never,
    LifecycleOf<Lifecycle>,
    never,
    never,
    never,
    never
  > =>
    makeModule<
      Id,
      {},
      never,
      never,
      never,
      LifecycleOf<Lifecycle>,
      never,
      never,
      never,
      never
    >({
      id,
      tables: {},
      settings: config?.settings ?? {},
      lifecycle: config?.lifecycle ?? {},
      groups: [],
    }),
}

const makeGroupImpl = <
  Module extends AnyStdbModule,
  Name extends GroupNames<Module>,
>(
  module: Module,
  name: Name,
  handlers: Record<string, unknown>,
): GroupImpl<Module, Name, unknown> => {
  const group = module.groups.find((candidate) => candidate.id === name)
  if (group == null) {
    throw diagnostic("UnknownGroup", ["groups", name], `Unknown group ${name}`)
  }

  const built = makeHandlerDefinitionsFromRecord<Module, unknown>(
    group.id,
    group.endpoints,
    handlers,
  )
  if (built.remainingNames.size > 0) {
    for (const missing of built.remainingNames) {
      throw diagnostic(
        "EndpointNotHandled",
        ["groups", group.id, missing],
        `Endpoint not handled: ${missing}`,
      )
    }
  }

  return {
    module,
    groupName: name,
    definitions: built.definitions,
  } as GroupImpl<Module, Name, unknown>
}

function group<
  Module extends AnyStdbModule,
  const Name extends GroupNames<Module>,
  const Handlers extends GroupHandlersRecord<Module, Name>,
>(
  module: Module,
  name: Name,
  handlers: Handlers & ValidateGroupHandlers<Module, Name, Handlers>,
): GroupImpl<Module, Name, RuntimeROfGroupHandlers<Handlers>>
function group<
  Module extends AnyStdbModule,
  const Name extends GroupNames<Module>,
>(
  module: Module,
  name: Name,
  handlers: Record<string, unknown>,
): GroupImpl<Module, Name, unknown> {
  return makeGroupImpl(module, name, handlers)
}

function groupChecked<
  Module extends AnyStdbModule,
  const Name extends GroupNames<Module>,
  const Handlers extends Record<string, unknown>,
>(
  module: Module,
  name: Name,
  handlers: ValidateCheckedGroupHandlers<Module, Name, Handlers> & Handlers,
): GroupImpl<Module, Name, unknown>
function groupChecked<
  Module extends AnyStdbModule,
  const Name extends GroupNames<Module>,
>(
  module: Module,
  name: Name,
  handlers: Record<string, unknown>,
): GroupImpl<Module, Name, unknown> {
  return makeGroupImpl(module, name, handlers)
}

function groupPrechecked<
  Module extends AnyStdbModule,
  const Name extends GroupNames<Module>,
>(
  module: Module,
  name: Name,
  handlers: GroupCheckedHandlers<Module, Name>,
): GroupImpl<Module, Name, unknown>
function groupPrechecked<
  Module extends AnyStdbModule,
  const Name extends GroupNames<Module>,
>(
  module: Module,
  name: Name,
  handlers: Record<string, unknown>,
): GroupImpl<Module, Name, unknown> {
  return makeGroupImpl(module, name, handlers)
}

function lifecycle<Module extends AnyStdbModule, const Handlers>(
  module: Module,
  handlers: Handlers & ValidateLifecycleHandlers<Handlers>,
): LifecycleImpl<
  Module,
  keyof Handlers & LifecycleName,
  RuntimeROfGroupHandlers<Handlers>
>
function lifecycle<Module extends AnyStdbModule>(
  module: Module,
  handlers: Record<string, unknown>,
): LifecycleImpl<Module, LifecycleName, unknown> {
  const lifecycleEntries: Array<readonly [string, unknown]> = []
  const specEntries: Array<readonly [string, LifecycleSpec]> = []

  for (const [name, handler] of Object.entries(handlers)) {
    if (!isLifecycleName(name)) {
      throw diagnostic(
        "UnknownEndpoint",
        ["lifecycle", name],
        `Unknown lifecycle hook ${name}`,
      )
    }

    lifecycleEntries.push([name, handler])
    specEntries.push([name, defineLifecycle(name)])
  }

  return {
    kind: "stdbLifecycle",
    module,
    lifecycleSpecs: sortedRecord(specEntries),
    definitions:
      lifecycleEntries.length > 0
        ? { lifecycle: sortedRecord(lifecycleEntries) }
        : {},
  } as LifecycleImpl<Module, LifecycleName, unknown>
}

export const StdbBuilder = {
  group,
  groupChecked,
  groupPrechecked,
  lifecycle,
  plan: planModule,
}

const isRecordLike = (value: unknown): value is Record<PropertyKey, unknown> =>
  (typeof value === "object" && value !== null) || typeof value === "function"

const isGroupImpl = (impl: AnyBuilderImpl): impl is AnyGroupImpl =>
  isRecordLike(impl) && "groupName" in impl

const isLifecycleImpl = (impl: AnyBuilderImpl): impl is AnyLifecycleImpl => {
  if (!isRecordLike(impl) || !("kind" in impl)) {
    return false
  }

  return impl.kind === "stdbLifecycle"
}

const assertImplBelongsToModule = (
  module: AnyStdbModule,
  impl: AnyBuilderImpl,
): void => {
  if (!isRecordLike(impl) || !("module" in impl)) {
    return
  }

  if (impl.module === module) {
    return
  }

  if (isLifecycleImpl(impl)) {
    throw diagnostic(
      "UnknownEndpoint",
      ["lifecycle"],
      "Lifecycle implementation was built for a different module",
    )
  }

  if (isGroupImpl(impl)) {
    throw diagnostic(
      "UndeclaredGroupImpl",
      ["groups", impl.groupName],
      `Group ${impl.groupName} implementation was built for a different module`,
    )
  }
}

const collectLifecycleSpecs = (
  impls: ReadonlyArray<AnyBuilderImpl>,
): LifecycleSpecs => {
  const entries: Array<readonly [string, LifecycleSpec]> = []
  const seen = new Set<string>()

  for (const impl of impls) {
    if (!isLifecycleImpl(impl)) {
      continue
    }

    const lifecycleImpl = impl as unknown as {
      readonly lifecycleSpecs: LifecycleSpecs
    }
    for (const [name, spec] of Object.entries(lifecycleImpl.lifecycleSpecs)) {
      if (seen.has(name)) {
        throw duplicateCallableError(
          ["lifecycle", name],
          `Lifecycle hook implemented more than once: ${name}`,
        )
      }
      seen.add(name)
      entries.push([name, spec])
    }
  }

  return sortedRecord(entries)
}

const moduleSpecWithLifecycle = <
  Module extends AnyStdbModule,
  Impls extends ReadonlyArray<unknown>,
>(
  module: Module,
  impls: ReadonlyArray<AnyBuilderImpl>,
): BuildSpec<Module, Impls> => {
  const lifecycleSpecs = collectLifecycleSpecs(impls)
  if (Object.keys(lifecycleSpecs).length === 0) {
    return module.spec as BuildSpec<Module, Impls>
  }

  const base = module.spec
  return defineModule({
    name: base.name,
    settings: base.settings,
    tables: base.tables,
    views: base.views,
    reducers: base.reducers,
    procedures: base.procedures,
    httpHandlers: base.httpHandlers,
    lifecycle: {
      ...base.lifecycle,
      ...lifecycleSpecs,
    },
  }) as BuildSpec<Module, Impls>
}

function planModule<
  Module extends AnyStdbModule,
  const Impls extends ReadonlyArray<AnyBuilderImpl>,
>(
  module: Module,
  impls: Impls &
    CoverAllGroups<Module, Impls> &
    CoverScheduleBindings<Module> &
    ([RuntimeROfImpls<Impls>] extends [never]
      ? unknown
      : { readonly __runtimeRequired: RuntimeROfImpls<Impls> }),
): StdbBuildPlan<BuildSpec<Module, Impls>, RuntimeROfImpls<Impls>>
function planModule<
  Module extends AnyStdbModule,
  const Impls extends ReadonlyArray<AnyBuilderImpl>,
>(
  module: Module,
  impls: Impls & CoverAllGroups<Module, Impls> & CoverScheduleBindings<Module>,
  options: { readonly runtime: BuildRuntime<RuntimeROfImpls<Impls>> },
): StdbBuildPlan<BuildSpec<Module, Impls>, RuntimeROfImpls<Impls>>
function planModule<
  Module extends AnyStdbModule,
  const Impls extends ReadonlyArray<AnyBuilderImpl>,
>(
  module: Module,
  impls: Impls,
  options?: { readonly runtime: BuildRuntime<RuntimeROfImpls<Impls>> },
): StdbBuildPlan<BuildSpec<Module, Impls>, RuntimeROfImpls<Impls>> {
  const expectedGroups = new Set(module.groups.map((group) => group.id))
  const implementedGroups = new Set<string>()
  for (const impl of impls) {
    assertImplBelongsToModule(module, impl)

    if (!isGroupImpl(impl)) {
      continue
    }
    if (!expectedGroups.has(impl.groupName)) {
      throw diagnostic(
        "UndeclaredGroupImpl",
        ["groups", impl.groupName],
        `Group ${impl.groupName} is not declared by module`,
      )
    }
    if (implementedGroups.has(impl.groupName)) {
      throw diagnostic(
        "DuplicateGroupImpl",
        ["groups", impl.groupName],
        `Group implemented more than once: ${impl.groupName}`,
      )
    }
    implementedGroups.add(impl.groupName)
  }

  for (const group of expectedGroups) {
    if (!implementedGroups.has(group)) {
      throw diagnostic(
        "GroupNotImplemented",
        ["groups", group],
        `Group not implemented: ${group}`,
      )
    }
  }

  const spec = moduleSpecWithLifecycle<Module, Impls>(module, impls)
  const runtime =
    options === undefined ? undefined : normalizeRuntime(options.runtime)
  const server =
    runtime === undefined
      ? Server.make({ module: spec })
      : Server.make({ module: spec, runtime })
  const typedServer = server as unknown as Server.ServerInstance<
    BuildSpec<Module, Impls>,
    RuntimeROfImpls<Impls>
  >
  const handlers = typedServer.handlers(
    mergeDefinitions(
      impls as unknown as ReadonlyArray<
        RuntimeBuilderImpl<Module, RuntimeROfImpls<Impls>>
      >,
    ) as HandlerInputDefinitions<
      BuildSpec<Module, Impls>,
      RuntimeROfImpls<Impls>
    >,
  )

  return {
    server: typedServer,
    handlers,
  }
}

export type { ErrorInstances }
