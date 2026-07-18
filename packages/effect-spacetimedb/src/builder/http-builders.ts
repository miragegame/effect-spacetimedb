import type * as Schema from "effect/Schema"
import * as Option from "effect/Option"
import {
  normalizeErrorsInput,
  type AnyErrorDefinition,
  type DefinitionOfInputOrUndefined,
  type ErrorsInput,
} from "../contract/error.ts"
import {
  define as defineHttpHandler,
  type HttpHandlerMethod,
  type HttpHandlerSpec,
} from "../contract/http-handler.ts"
import {
  lifecycle as defineLifecycle,
  type LifecycleSpec,
  type LifecycleSpecs,
} from "../contract/lifecycle.ts"
import type { AnyModuleSpec } from "../contract/module.ts"
import type { ProcedureSpec } from "../contract/procedure.ts"
import type { ReducerSpec } from "../contract/reducer.ts"
import type { ModuleSettings } from "../contract/settings.ts"
import type { AnyTableSpec } from "../contract/table.ts"
import { type AnyValueType } from "../contract/type.ts"
import {
  type AnyViewSpec,
  anonymous as defineAnonymousView,
  sender as defineSenderView,
} from "../contract/view.ts"
import type {
  AnonymousViewDecl,
  AnyCallableDecl,
  AnyGroup,
  AnyHttpRouteDecl,
  LifecycleDecl,
  ModuleAccessors,
  ModuleSpecFor,
  RawHttpRouteDecl,
  RuntimeModuleState,
  SenderViewDecl,
  TypedHttpRouteDecl,
} from "./declarations.ts"
import {
  makeCallableGroup,
  makeHttpGroup,
  makeModule,
  normalizeRoutePath,
} from "./runtime-helpers.ts"
import {
  procedureEndpoint,
  reducerEndpoint,
  scheduledProcedureEndpoint,
  scheduledReducerEndpoint,
} from "./runtime-impl.ts"

export type StdbGroup<
  Id extends string,
  Endpoints extends AnyCallableDecl = never,
  Errors extends AnyErrorDefinition | undefined = undefined,
  Reducers extends Record<
    string,
    ReducerSpec
  > = AnyCallableDecl extends Endpoints
    ? Record<string, ReducerSpec>
    : ReducerRecordsFromDeclsWithOptionalGroupErrors<Endpoints, Errors>,
  Procedures extends Record<
    string,
    ProcedureSpec
  > = AnyCallableDecl extends Endpoints
    ? Record<string, ProcedureSpec>
    : ProcedureRecordsFromDeclsWithOptionalGroupErrors<Endpoints, Errors>,
  Views extends Record<string, AnyViewSpec> = AnyCallableDecl extends Endpoints
    ? Record<string, AnyViewSpec>
    : ViewRecordsFromDecls<Endpoints>,
  HttpHandlers extends Record<string, HttpHandlerSpec> = {},
  Lifecycle extends LifecycleSpecs = AnyCallableDecl extends Endpoints
    ? LifecycleSpecs
    : LifecycleRecordsFromDecls<Endpoints>,
> = {
  readonly kind: "stdbGroup"
  readonly id: Id
  readonly errors?: Errors
  readonly endpoints: ReadonlyArray<AnyCallableDecl>
  // Keep section records as raw intersections through chained single-adds;
  // ModuleSpecFor flattens them at the module boundary. Remapping the growing
  // record on every add regresses the 50-link chain guard with TS2589.
  readonly add: <const Added extends NonEmptyReadonlyArray<AnyCallableDecl>>(
    ...endpoints: Added
  ) => StdbGroup<
    Id,
    Endpoints | Added[number],
    Errors,
    Reducers &
      ReducerRecordsFromDeclsWithOptionalGroupErrors<Added[number], Errors>,
    Procedures &
      ProcedureRecordsFromDeclsWithOptionalGroupErrors<Added[number], Errors>,
    Views & ViewRecordsFromDecls<Added[number]>,
    HttpHandlers,
    Lifecycle & LifecycleRecordsFromDecls<Added[number]>
  >
  readonly [EndpointTypeId]: Endpoints
  readonly [GroupReducersTypeId]: Reducers
  readonly [GroupProceduresTypeId]: Procedures
  readonly [GroupViewsTypeId]: Views
  readonly [GroupHttpHandlersTypeId]: HttpHandlers
  readonly [GroupLifecycleTypeId]: Lifecycle
}

export type StdbHttpGroup<
  Id extends string,
  Endpoints extends AnyHttpRouteDecl = never,
  Errors extends AnyErrorDefinition | undefined = undefined,
  HttpHandlers extends Record<
    string,
    HttpHandlerSpec
  > = AnyHttpRouteDecl extends Endpoints
    ? Record<string, HttpHandlerSpec>
    : HttpHandlerRecordsFromDeclsWithOptionalGroupErrors<Endpoints, Errors>,
> = {
  readonly kind: "stdbHttpGroup"
  readonly id: Id
  readonly errors?: Errors
  readonly endpoints: ReadonlyArray<AnyHttpRouteDecl>
  readonly add: <const Added extends NonEmptyReadonlyArray<AnyHttpRouteDecl>>(
    ...endpoints: Added
  ) => StdbHttpGroup<
    Id,
    Endpoints | Added[number],
    Errors,
    HttpHandlers &
      HttpHandlerRecordsFromDeclsWithOptionalGroupErrors<Added[number], Errors>
  >
  readonly prefix: <const Prefix extends string>(
    prefix: Prefix,
  ) => StdbHttpGroup<Id, Endpoints, Errors, HttpHandlers>
  readonly nest: <
    const Prefix extends string,
    Other extends StdbHttpGroup<
      string,
      AnyHttpRouteDecl,
      AnyErrorDefinition | undefined,
      Record<string, HttpHandlerSpec>
    >,
  >(
    prefix: Prefix,
    other: Other,
  ) => StdbHttpGroup<
    Id,
    Endpoints | EndpointsOfGroup<Other>,
    MergeErrorDefinitions<Errors, ErrorsOfGroup<Other>>,
    HttpHandlerRecordsFromDeclsWithOptionalGroupErrors<
      Endpoints | EndpointsOfGroup<Other>,
      MergeErrorDefinitions<Errors, ErrorsOfGroup<Other>>
    >
  >
  readonly merge: <
    Other extends StdbHttpGroup<
      string,
      AnyHttpRouteDecl,
      AnyErrorDefinition | undefined,
      Record<string, HttpHandlerSpec>
    >,
  >(
    other: Other,
  ) => StdbHttpGroup<
    Id,
    Endpoints | EndpointsOfGroup<Other>,
    MergeErrorDefinitions<Errors, ErrorsOfGroup<Other>>,
    HttpHandlerRecordsFromDeclsWithOptionalGroupErrors<
      Endpoints | EndpointsOfGroup<Other>,
      MergeErrorDefinitions<Errors, ErrorsOfGroup<Other>>
    >
  >
  readonly [EndpointTypeId]: Endpoints
  readonly [GroupHttpHandlersTypeId]: HttpHandlers
}

import type {
  EndpointsOfGroup,
  EndpointTypeId,
  ErrorsOfGroup,
  GroupEndpointPair,
  GroupEndpointPairsOf,
  GroupEndpointPairsTypeId,
  GroupHttpHandlersTypeId,
  GroupLifecycleTypeId,
  GroupNameOf,
  GroupNamesTypeId,
  GroupProceduresTypeId,
  GroupReducersTypeId,
  GroupViewsTypeId,
  GroupTypeId,
  HttpHandlerRecordsFromDeclsWithOptionalGroupErrors,
  HttpGroupPair,
  HttpGroupPairsOf,
  HttpGroupPairsTypeId,
  LifecycleConfig,
  LifecycleOf,
  LifecycleRecordsFromDecls,
  MergeErrorDefinitions,
  ModuleSpecTypeId,
  NonEmptyReadonlyArray,
  ProcedureRecordsFromDeclsWithOptionalGroupErrors,
  ReducerRecordsFromDeclsWithOptionalGroupErrors,
  ScheduledTableNameOf,
  ScheduledTableNamesTypeId,
  SchedulePair,
  SchedulePairsOf,
  SchedulePairsTypeId,
  TableNameOf,
  TableNamesTypeId,
  TablesFromTuple,
  ViewRecordsFromDecls,
} from "./type-utils.ts"

const normalizeOptionalErrors = <const Input extends ErrorsInput | undefined>(
  input: Input,
): DefinitionOfInputOrUndefined<Input> =>
  Option.fromUndefinedOr(input).pipe(
    Option.map(normalizeErrorsInput),
    Option.getOrUndefined,
  ) as DefinitionOfInputOrUndefined<Input>

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
  Spec extends AnyModuleSpec = ModuleSpecFor<
    Id,
    Tables,
    Groups,
    Lifecycle,
    HttpGroupPairs
  >,
> = RuntimeModuleState &
  ModuleAccessors<Spec> & {
    readonly spec: Spec
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
    readonly [ModuleSpecTypeId]: Spec
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
  make: <
    const Id extends string,
    const Errors extends ErrorsInput | undefined = undefined,
  >(
    id: Id,
    options?: { readonly errors?: Errors },
  ): StdbGroup<Id, never, DefinitionOfInputOrUndefined<Errors>> => {
    const errors = normalizeOptionalErrors(options?.errors)
    return makeCallableGroup<Id, never, DefinitionOfInputOrUndefined<Errors>>(
      id,
      [],
      errors,
    )
  },
}

export const StdbHttpGroup = {
  make: <
    const Id extends string,
    const Errors extends ErrorsInput | undefined = undefined,
  >(
    id: Id,
    options?: { readonly errors?: Errors },
  ): StdbHttpGroup<Id, never, DefinitionOfInputOrUndefined<Errors>> => {
    const errors = normalizeOptionalErrors(options?.errors)
    return makeHttpGroup<Id, never, DefinitionOfInputOrUndefined<Errors>>(
      id,
      [],
      errors,
    )
  },
  normalizeRoutePath,
}

const lifecycleSpecFromConfigEntry = (
  entry: LifecycleConfig[keyof LifecycleConfig],
): LifecycleSpec =>
  entry != null && "declKind" in entry && entry.declKind === "lifecycle"
    ? entry.spec
    : (entry as LifecycleSpec)

const normalizeLifecycleConfig = (
  lifecycle: LifecycleConfig | undefined,
): LifecycleSpecs =>
  lifecycle == null
    ? {}
    : Object.fromEntries(
        Object.entries(lifecycle).map(([key, entry]) => [
          key,
          lifecycleSpecFromConfigEntry(entry),
        ]),
      )

export const StdbModule = {
  make: <
    const Id extends string,
    const Lifecycle extends LifecycleConfig | undefined = undefined,
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
      lifecycle: normalizeLifecycleConfig(config?.lifecycle),
      groups: [],
    }),
}
