import {
  type LifecycleName,
  type LifecycleSpec,
  type LifecycleSpecs,
} from "../contract/lifecycle.ts"
import type { AnyErrorDefinition, ErrorDefinition } from "../contract/error.ts"
import type { HttpHandlerSpec } from "../contract/http-handler.ts"
import { type AnyModuleSpec } from "../contract/module.ts"
import type { ProcedureSpec } from "../contract/procedure.ts"
import type { ReducerSpec } from "../contract/reducer.ts"

import type { AnyTableSpec } from "../contract/table.ts"
import type { AnyViewSpec } from "../contract/view.ts"

import type { AnyEndpointDecl, AnyHttpRouteDecl } from "./declarations.ts"
import type { StdbHttpGroup } from "./http-builders.ts"

export declare const EndpointTypeId: unique symbol

export declare const GroupReducersTypeId: unique symbol

export declare const GroupProceduresTypeId: unique symbol

export declare const GroupViewsTypeId: unique symbol

export declare const GroupHttpHandlersTypeId: unique symbol

export declare const GroupLifecycleTypeId: unique symbol

export declare const GroupTypeId: unique symbol

export declare const ModuleSpecTypeId: unique symbol

export declare const GroupNamesTypeId: unique symbol

export declare const TableNamesTypeId: unique symbol

export declare const ScheduledTableNamesTypeId: unique symbol

export declare const SchedulePairsTypeId: unique symbol

export declare const GroupEndpointPairsTypeId: unique symbol

export declare const HttpGroupPairsTypeId: unique symbol

export declare const GroupImplRuntimeTypeId: unique symbol

export declare const LifecycleImplHooksTypeId: unique symbol

export type NonEmptyReadonlyArray<A> = readonly [A, ...ReadonlyArray<A>]

export type Expand<T> = {
  readonly [K in keyof T]: T[K]
}

export type UnionToIntersection<Union> = (
  Union extends unknown
    ? (value: Union) => void
    : never
) extends (value: infer Intersection) => void
  ? Intersection
  : never

export type DeclRecordUnion<
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

export type MergeRecordUnion<Union> = [Union] extends [never]
  ? {}
  : UnionToIntersection<Union>

export type MergeConstrainedRecordUnion<Union, SpecConstraint> = Expand<{
  readonly [Key in keyof MergeRecordUnion<Union> & string]: Extract<
    MergeRecordUnion<Union>[Key],
    SpecConstraint
  >
}>

export type RecordFromDecls<
  Endpoints,
  Kind extends AnyEndpointDecl["declKind"],
  SpecConstraint,
> = MergeConstrainedRecordUnion<
  DeclRecordUnion<Endpoints, Kind, SpecConstraint>,
  SpecConstraint
>

export type MergeErrorDefinitions<
  Default extends AnyErrorDefinition | undefined,
  Own extends AnyErrorDefinition | undefined,
> = Default extends AnyErrorDefinition
  ? Own extends AnyErrorDefinition
    ? ErrorDefinition<
        ReadonlyArray<Default["errors"][number] | Own["errors"][number]>
      >
    : Default
  : Own

type WithErrors<Spec, Errors extends AnyErrorDefinition | undefined> = Omit<
  Spec,
  "errors"
> &
  (Errors extends AnyErrorDefinition
    ? { readonly errors: Errors }
    : { readonly errors?: undefined })

type SpecWithGroupErrors<
  Spec,
  Default extends AnyErrorDefinition | undefined,
> = Spec extends ReducerSpec<infer _Params, infer Own, infer _Public>
  ? WithErrors<Spec, MergeErrorDefinitions<Default, Own>>
  : Spec extends ProcedureSpec<
        infer _Params,
        infer _Returns,
        infer Own,
        infer _Public
      >
    ? WithErrors<Spec, MergeErrorDefinitions<Default, Own>>
    : Spec extends HttpHandlerSpec<
          infer Request,
          infer _Response,
          infer Own,
          infer _Method,
          infer _Path
        >
      ? Request extends undefined
        ? Spec
        : WithErrors<Spec, MergeErrorDefinitions<Default, Own>>
      : Spec

type DeclRecordUnionWithGroupErrors<
  Endpoints,
  Kind extends AnyEndpointDecl["declKind"],
  SpecConstraint,
  Default extends AnyErrorDefinition | undefined,
> = Endpoints extends {
  readonly declKind: Kind
  readonly name: infer Name extends string
  readonly spec: infer Spec extends SpecConstraint
}
  ? {
      readonly [RecordKey in Name]: SpecWithGroupErrors<Spec, Default>
    }
  : never

type RecordFromDeclsWithGroupErrors<
  Endpoints,
  Kind extends AnyEndpointDecl["declKind"],
  SpecConstraint,
  Default extends AnyErrorDefinition | undefined,
> = MergeConstrainedRecordUnion<
  DeclRecordUnionWithGroupErrors<Endpoints, Kind, SpecConstraint, Default>,
  SpecConstraint
>

export type LifecycleRecordFromNames<Names extends LifecycleName> = Expand<{
  readonly [Name in Names]: LifecycleSpec<Name>
}>

export type LifecycleConfigEntry<Name extends LifecycleName = LifecycleName> =
  | LifecycleSpec<Name>
  | {
      readonly declKind: "lifecycle"
      readonly name: Name
      readonly spec: LifecycleSpec<Name>
    }

export type LifecycleConfig = Partial<{
  readonly [Name in LifecycleName]: LifecycleConfigEntry<Name>
}>

type SpecOfLifecycleConfigEntry<Entry> = Entry extends {
  readonly spec: infer Spec extends LifecycleSpec
}
  ? Spec
  : Entry extends LifecycleSpec
    ? Entry
    : never

export type LifecycleOf<Lifecycle> = Lifecycle extends LifecycleConfig
  ? Expand<{
      readonly [Name in keyof Lifecycle &
        LifecycleName]: SpecOfLifecycleConfigEntry<Lifecycle[Name]>
    }>
  : {}

export type LifecycleKeysOf<Lifecycle> = Lifecycle extends LifecycleSpecs
  ? LifecycleSpecs extends Lifecycle
    ? never
    : keyof Lifecycle & LifecycleName
  : never

export type LiteralLifecycleName<Name extends LifecycleName> =
  LifecycleName extends Name ? never : Name

export type LifecycleNamesFromDecls<Endpoints> = Endpoints extends {
  readonly declKind: "lifecycle"
  readonly name: infer Name extends LifecycleName
}
  ? LiteralLifecycleName<Name>
  : never

export type EndpointsOfGroup<Group> = Group extends {
  readonly [EndpointTypeId]: infer Endpoints
}
  ? Endpoints
  : never

export type ErrorsOfGroup<Group> = Group extends {
  readonly errors?: infer Errors extends AnyErrorDefinition | undefined
}
  ? Errors
  : undefined

export type ReducerRecordsFromDecls<Endpoints> = RecordFromDecls<
  Endpoints,
  "reducer",
  ReducerSpec
>

export type ReducerRecordsFromDeclsWithGroupErrors<
  Endpoints,
  Default extends AnyErrorDefinition | undefined,
> = RecordFromDeclsWithGroupErrors<Endpoints, "reducer", ReducerSpec, Default>

export type ReducerRecordsFromDeclsWithOptionalGroupErrors<
  Endpoints,
  Default extends AnyErrorDefinition | undefined,
> = [Default] extends [undefined]
  ? ReducerRecordsFromDecls<Endpoints>
  : ReducerRecordsFromDeclsWithGroupErrors<Endpoints, Default>

export type ProcedureRecordsFromDecls<Endpoints> = RecordFromDecls<
  Endpoints,
  "procedure",
  ProcedureSpec
>

export type ProcedureRecordsFromDeclsWithGroupErrors<
  Endpoints,
  Default extends AnyErrorDefinition | undefined,
> = RecordFromDeclsWithGroupErrors<
  Endpoints,
  "procedure",
  ProcedureSpec,
  Default
>

export type ProcedureRecordsFromDeclsWithOptionalGroupErrors<
  Endpoints,
  Default extends AnyErrorDefinition | undefined,
> = [Default] extends [undefined]
  ? ProcedureRecordsFromDecls<Endpoints>
  : ProcedureRecordsFromDeclsWithGroupErrors<Endpoints, Default>

export type ViewRecordsFromDecls<Endpoints> = RecordFromDecls<
  Endpoints,
  "view",
  AnyViewSpec
>

export type HttpHandlerRecordsFromDecls<Endpoints> = RecordFromDecls<
  Endpoints,
  "httpHandler",
  HttpHandlerSpec
>

export type HttpHandlerRecordsFromDeclsWithGroupErrors<
  Endpoints,
  Default extends AnyErrorDefinition | undefined,
> = RecordFromDeclsWithGroupErrors<
  Endpoints,
  "httpHandler",
  HttpHandlerSpec,
  Default
>

export type HttpHandlerRecordsFromDeclsWithOptionalGroupErrors<
  Endpoints,
  Default extends AnyErrorDefinition | undefined,
> = [Default] extends [undefined]
  ? HttpHandlerRecordsFromDecls<Endpoints>
  : HttpHandlerRecordsFromDeclsWithGroupErrors<Endpoints, Default>

export type LifecycleRecordsFromDecls<Endpoints> = LifecycleRecordFromNames<
  LifecycleNamesFromDecls<Endpoints>
>

export type ReducerRecordOfGroup<Group> = Group extends {
  readonly [GroupReducersTypeId]: infer Reducers extends Record<
    string,
    ReducerSpec
  >
}
  ? Reducers
  : {}

export type ProcedureRecordOfGroup<Group> = Group extends {
  readonly [GroupProceduresTypeId]: infer Procedures extends Record<
    string,
    ProcedureSpec
  >
}
  ? Procedures
  : {}

export type ViewRecordOfGroup<Group> = Group extends {
  readonly [GroupViewsTypeId]: infer Views extends Record<string, AnyViewSpec>
}
  ? Views
  : {}

export type HttpHandlerRecordOfGroup<Group> = Group extends {
  readonly [GroupHttpHandlersTypeId]: infer HttpHandlers extends Record<
    string,
    HttpHandlerSpec
  >
}
  ? HttpHandlers
  : {}

export type LifecycleRecordOfGroup<Group> = Group extends {
  readonly [GroupLifecycleTypeId]: infer Lifecycle extends LifecycleSpecs
}
  ? Lifecycle
  : {}

export type DeclSpecRecordOfGroup<Group> = Expand<
  ReducerRecordOfGroup<Group> &
    ProcedureRecordOfGroup<Group> &
    ViewRecordOfGroup<Group> &
    HttpHandlerRecordOfGroup<Group> &
    LifecycleRecordOfGroup<Group>
>

export type DeclNameOf<Group> = keyof DeclSpecRecordOfGroup<Group> & string

export type DeclSpecOf<
  Group,
  Name extends DeclNameOf<Group>,
> = DeclSpecRecordOfGroup<Group>[Name]

export type DeclOf<Group, Name extends DeclNameOf<Group>> = Extract<
  EndpointsOfGroup<Group>,
  { readonly name: Name }
>

export type ReducerRecordsOfGroups<Groups> = Expand<
  MergeConstrainedRecordUnion<
    Groups extends unknown ? ReducerRecordOfGroup<Groups> : never,
    ReducerSpec
  >
>

export type ProcedureRecordsOfGroups<Groups> = Expand<
  MergeConstrainedRecordUnion<
    Groups extends unknown ? ProcedureRecordOfGroup<Groups> : never,
    ProcedureSpec
  >
>

export type ViewRecordsOfGroups<Groups> = Expand<
  MergeConstrainedRecordUnion<
    Groups extends unknown ? ViewRecordOfGroup<Groups> : never,
    AnyViewSpec
  >
>

export type HttpHandlerRecordsOfGroups<Groups> = Expand<
  MergeConstrainedRecordUnion<
    Groups extends unknown ? HttpHandlerRecordOfGroup<Groups> : never,
    HttpHandlerSpec
  >
>

export type LifecycleRecordsOfGroups<Groups> = Expand<
  MergeRecordUnion<
    Groups extends unknown ? LifecycleRecordOfGroup<Groups> : never
  >
>

export type LifecycleRecordFromConfigAndGroups<Lifecycle, Groups> = Expand<
  LifecycleOf<Lifecycle> & LifecycleRecordsOfGroups<Groups>
>

export type GroupsOfModule<Module> = Module extends {
  readonly [GroupTypeId]: infer Groups
}
  ? Groups
  : never

// Extracts just the `id` literal(s) from a group (or group union). Cheap when
// applied to the small set of groups passed to a single `.add(...)`; used to
// eagerly accumulate a lightweight group-name union on the module type so
// `GroupNames` never has to materialize the heavy `[GroupTypeId]` group union.
export type GroupNameOf<Group> = Group extends {
  readonly id: infer Id extends string
}
  ? Id
  : never

export type GroupEndpointPair = {
  readonly group: string
  readonly name: string
}

export type GroupEndpointPairsOf<Groups> = Groups extends {
  readonly id: infer GroupId extends string
  readonly [EndpointTypeId]: infer Endpoints
}
  ? Endpoints extends { readonly name: infer EndpointName extends string }
    ? { readonly group: GroupId; readonly name: EndpointName }
    : never
  : never

export type HttpGroupPair = { readonly name: string; readonly group: string }

export type HttpGroupPairsOf<Groups> = Groups extends StdbHttpGroup<
  infer GroupId,
  infer Endpoints
>
  ? Endpoints extends AnyHttpRouteDecl
    ? { readonly name: Endpoints["name"]; readonly group: GroupId }
    : never
  : never

export type HttpGroupMapFromPairs<Pairs extends HttpGroupPair> = {
  readonly [Pair in Pairs as Pair["name"]]: Pair["group"]
}

export type ReducerGroupPairsOf<Groups> = Groups extends {
  readonly id: infer GroupId extends string
  readonly [GroupReducersTypeId]: infer Reducers extends Record<
    string,
    ReducerSpec
  >
}
  ? {
      readonly [Name in keyof Reducers & string]: {
        readonly name: Name
        readonly group: GroupId
      }
    }[keyof Reducers & string]
  : never

export type ProcedureGroupPairsOf<Groups> = Groups extends {
  readonly id: infer GroupId extends string
  readonly [GroupProceduresTypeId]: infer Procedures extends Record<
    string,
    ProcedureSpec
  >
}
  ? {
      readonly [Name in keyof Procedures & string]: {
        readonly name: Name
        readonly group: GroupId
      }
    }[keyof Procedures & string]
  : never

export type ReducerGroupMapFromPairs<Pairs extends HttpGroupPair> = {
  readonly [Pair in Pairs as Pair["name"]]: Pair["group"]
}

export type ProcedureGroupMapFromPairs<Pairs extends HttpGroupPair> = {
  readonly [Pair in Pairs as Pair["name"]]: Pair["group"]
}

export type TableNameOf<Table> = Table extends {
  readonly name: infer Name extends string
}
  ? Name
  : never

export type ScheduledTableNameOf<Table> = Table extends {
  readonly scheduled: true
  readonly name: infer Name extends string
}
  ? Name
  : never

export type SchedulePair = { readonly target: string; readonly table: string }

export type SchedulePairsOf<Groups> = Groups extends {
  readonly [EndpointTypeId]: infer Endpoints
}
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

export type TablesFromTuple<Tables extends ReadonlyArray<AnyTableSpec>> =
  Expand<{
    readonly [Table in Tables[number] as Table["name"]]: Table
  }>

export type SpecOfModule<Module> = Module extends {
  readonly spec: infer Spec extends AnyModuleSpec
}
  ? Spec
  : Module extends {
        readonly [ModuleSpecTypeId]: infer Spec extends AnyModuleSpec
      }
    ? Spec
    : never
