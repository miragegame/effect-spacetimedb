import {
  StdbFn,
  StdbGroup as StdbGroupValue,
  StdbHttp,
  StdbHttpGroup as StdbHttpGroupValue,
  StdbModule as StdbModuleValue,
} from "./builder/http-builders.ts"
import type {
  AnyCallableDecl,
  AnyHttpRouteDecl,
  ModuleAccessors,
  ModuleSpecFor,
  RuntimeModuleState,
} from "./builder/declarations.ts"
import type { AnyTableSpec } from "./contract/table.ts"
import type { LifecycleSpecs } from "./contract/lifecycle.ts"
import type { ModuleSettings } from "./contract/settings.ts"
import type {
  EndpointTypeId,
  GroupEndpointPair,
  GroupEndpointPairsTypeId,
  GroupNamesTypeId,
  GroupTypeId,
  HttpGroupPairsTypeId,
  HttpGroupPair,
  ModuleSpecTypeId,
  ScheduledTableNamesTypeId,
  SchedulePair,
  SchedulePairsTypeId,
  TableNamesTypeId,
} from "./builder/type-utils.ts"

export type { ErrorInstances } from "./contract/error.ts"
export type {
  AnonymousViewDecl,
  AnyCallableDecl,
  AnyEndpointDecl,
  AnyHttpRouteDecl,
  LifecycleDecl,
  ProcedureDecl,
  RawHttpRouteDecl,
  ReducerDecl,
  ScheduledCallableMetadata,
  ScheduledProcedureDecl,
  ScheduledProcedureSpec,
  ScheduledReducerDecl,
  ScheduledReducerSpec,
  SenderViewDecl,
  TypedHttpRouteDecl,
} from "./builder/declarations.ts"

export type {
  AnyBuilderImpl,
  AnyStdbModule,
  BuildRuntime,
  BuildSpec,
  CoverAllGroups,
  CoverScheduleBindings,
  GroupCheckedHandlers,
  GroupHandlersRecord,
  GroupImpl,
  LifecycleImpl,
  RuntimeROfImpls,
  StdbBuildPlan,
} from "./builder/handler-types.ts"

export { StdbFn, StdbHttp }

type NonEmptyReadonlyArray<A> = readonly [A, ...ReadonlyArray<A>]

type Expand<T> = {
  readonly [K in keyof T]: T[K]
}

type EndpointsOfGroup<Group> = Group extends {
  readonly [EndpointTypeId]: infer Endpoints
}
  ? Endpoints
  : never

type GroupNameOf<Group> = Group extends {
  readonly id: infer Id extends string
}
  ? Id
  : never

type HttpGroupPairsOf<Groups> = Groups extends StdbHttpGroup<
  infer GroupId,
  infer Endpoints
>
  ? Endpoints extends AnyHttpRouteDecl
    ? { readonly name: Endpoints["name"]; readonly group: GroupId }
    : never
  : never

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

type GroupEndpointPairsOf<Groups> = Groups extends {
  readonly id: infer GroupId extends string
  readonly [EndpointTypeId]: infer Endpoints
}
  ? Endpoints extends { readonly name: infer EndpointName extends string }
    ? { readonly group: GroupId; readonly name: EndpointName }
    : never
  : never

type TablesFromTuple<Tables extends ReadonlyArray<AnyTableSpec>> = Expand<{
  readonly [Table in Tables[number] as Table["name"]]: Table
}>

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

type AnyGroup =
  | StdbGroup<string, AnyCallableDecl>
  | StdbHttpGroup<string, AnyHttpRouteDecl>

export type StdbModule<
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

export const StdbGroup: {
  readonly make: <const Id extends string>(id: Id) => StdbGroup<Id, never>
} = StdbGroupValue as unknown as {
  readonly make: <const Id extends string>(id: Id) => StdbGroup<Id, never>
}

export const StdbHttpGroup: {
  readonly make: <const Id extends string>(id: Id) => StdbHttpGroup<Id, never>
  readonly normalizeRoutePath: (...parts: ReadonlyArray<string>) => string
} = StdbHttpGroupValue as unknown as {
  readonly make: <const Id extends string>(id: Id) => StdbHttpGroup<Id, never>
  readonly normalizeRoutePath: (...parts: ReadonlyArray<string>) => string
}

export const StdbModule: {
  readonly make: <
    const Id extends string,
    const Lifecycle extends LifecycleSpecs | undefined = undefined,
  >(
    id: Id,
    config?: {
      readonly settings?: ModuleSettings
      readonly lifecycle?: Lifecycle
    },
  ) => StdbModule<
    Id,
    {},
    never,
    never,
    never,
    Lifecycle extends LifecycleSpecs ? Lifecycle : {},
    never,
    never,
    never,
    never
  >
} = StdbModuleValue as unknown as {
  readonly make: <
    const Id extends string,
    const Lifecycle extends LifecycleSpecs | undefined = undefined,
  >(
    id: Id,
    config?: {
      readonly settings?: ModuleSettings
      readonly lifecycle?: Lifecycle
    },
  ) => StdbModule<
    Id,
    {},
    never,
    never,
    never,
    Lifecycle extends LifecycleSpecs ? Lifecycle : {},
    never,
    never,
    never,
    never
  >
}

export { StdbBuilder } from "./builder/module-plan.ts"
