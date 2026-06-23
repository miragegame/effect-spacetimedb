import { type AnyModuleSpec } from "../contract/module.ts"

import {
  type LifecycleName,
  type LifecycleSpec,
  type LifecycleSpecs,
} from "../contract/lifecycle.ts"

import type { AnyTableSpec } from "../contract/table.ts"

import type {
  AnyEndpointDecl,
  AnyHttpRouteDecl,
  StdbGroup,
  StdbHttpGroup,
} from "./declarations.ts"

export declare const EndpointTypeId: unique symbol

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

export type RecordFromDecls<
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

export type LifecycleRecordFromNames<Names extends LifecycleName> = Expand<{
  readonly [Name in Names]: LifecycleSpec<Name>
}>

export type LifecycleOf<Lifecycle> = Lifecycle extends LifecycleSpecs
  ? Lifecycle
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

export type SchedulePairsOf<Groups> = Groups extends StdbGroup<
  string,
  infer Endpoints
>
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
  readonly [ModuleSpecTypeId]: infer Spec extends AnyModuleSpec
}
  ? Spec
  : never
