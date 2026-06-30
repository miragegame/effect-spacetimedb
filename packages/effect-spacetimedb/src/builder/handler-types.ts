import * as Effect from "effect/Effect"

import type * as Layer from "effect/Layer"

import type * as Schema from "effect/Schema"
import { type HttpHandlerMethod } from "../contract/http-handler.ts"
import {
  type LifecycleName,
  type LifecycleSpecs,
} from "../contract/lifecycle.ts"
import { type AnyModuleSpec, type ModuleSpec } from "../contract/module.ts"
import { type ProcedureSpec } from "../contract/procedure.ts"
import { type ReducerSpec } from "../contract/reducer.ts"

import {
  type AnyValueType,
  type StructLikeValueType,
  type TypeOf,
} from "../contract/type.ts"

import type { Request, SyncResponse } from "../http-primitives.ts"

import * as Server from "../server/bind.ts"

import * as ServerContext from "../server/context.ts"
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

export type SuccessFor<Decl> = Decl extends { readonly declKind: "reducer" }
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

export type ErrorsFor<Decl> = Decl extends {
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

export type IsAny<Value> = 0 extends 1 & Value ? true : false

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

export type AllowedFor<Decl> = Decl extends {
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

export type EndpointHandlerFn<Decl> = Decl extends LifecycleDecl
  ? () => Effect.Effect<SuccessFor<Decl>, ErrorsFor<Decl>, unknown>
  : HasNoHandlerArgs<Decl> extends true
    ? () => Effect.Effect<SuccessFor<Decl>, ErrorsFor<Decl>, unknown>
    : (
        args: ArgsFor<Decl>,
      ) => Effect.Effect<SuccessFor<Decl>, ErrorsFor<Decl>, unknown>

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

export type HandlerRequirementsFor<Handler> = Handler extends (
  ...args: infer _Args
) => Effect.Effect<unknown, unknown, infer R>
  ? R
  : never

export type HasForbiddenRequirements<
  Handler,
  Allowed extends ServerContext.AnyServerContextRequirements,
> = Extract<
  HandlerRequirementsFor<Handler>,
  Exclude<ServerContext.AnyServerContextRequirements, Allowed>
> extends never
  ? false
  : true

export type HandlerWithAllowedRequirements<Decl, Handler> =
  HasForbiddenRequirements<Handler, AllowedFor<Decl>> extends true
    ? never
    : Handler

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
  Expand<{
    readonly [Decl in EndpointsOfGroupName<
      Module,
      Name
    > as Decl["name"]]: HandlerWithAllowedRequirements<
      Decl,
      HandlerForDecl<Handlers, Decl>
    >
  }>

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

export type HandlerContextForKey<
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

export type AllowedRequirementsForKey<
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

export type LifecycleHandlerKeys = {
  readonly [Name in LifecycleName]: unknown
}

export type ValidateLifecycleHandlers<Handlers> = NoExtraHandlerKeys<
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

export type HandlerServicesFor<Handler> = Handler extends (
  ...args: infer _Args
) => Effect.Effect<unknown, unknown, infer R>
  ? R
  : never

export type RuntimeROfGroupHandlers<Handlers> = Exclude<
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
export type AnyGroupImpl = {
  readonly groupName: string
}

export type AnyLifecycleImpl = {
  readonly kind: "stdbLifecycle"
}

export type AnyBuilderImpl = AnyGroupImpl | AnyLifecycleImpl

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
  Spec["httpHandlers"]
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

export type BuildRuntime<RuntimeR> =
  | SyncRunner<RuntimeR>
  | SyncRunnerLike<RuntimeR>
  | Layer.Layer<RuntimeR, never, never>

export type BuildOptions<RuntimeR> = {
  readonly runtime?: BuildRuntime<RuntimeR>
  readonly runtimeMode?: ConstrainedServerRuntimeMode
}

export type StdbBuildPlan<
  Module extends AnyModuleSpec = AnyModuleSpec,
  RuntimeR = never,
> = {
  readonly server: Server.ServerInstance<Module, RuntimeR>
  readonly handlers: Server.Handlers<Module, RuntimeR>
}
