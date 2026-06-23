import type * as Schema from "effect/Schema"

import {
  anonymous as defineAnonymousView,
  sender as defineSenderView,
} from "../contract/view.ts"

import {
  lifecycle as defineLifecycle,
  type LifecycleSpecs,
} from "../contract/lifecycle.ts"

import {
  define as defineHttpHandler,
  type HttpHandlerMethod,
} from "../contract/http-handler.ts"

import type {
  DefinitionOfInputOrUndefined,
  ErrorsInput,
} from "../contract/error.ts"

import type { ModuleSettings } from "../contract/settings.ts"

import type { AnyTableSpec } from "../contract/table.ts"

import { type AnyValueType } from "../contract/type.ts"

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

import type {
  AnonymousViewDecl,
  AnyCallableDecl,
  AnyGroup,
  AnyHttpRouteDecl,
  LifecycleDecl,
  RawHttpRouteDecl,
  SenderViewDecl,
  StdbGroup as StdbGroupShape,
  StdbHttpGroup as StdbHttpGroupShape,
  StdbModule as StdbModuleShape,
  TypedHttpRouteDecl,
} from "./declarations.ts"

export type StdbGroup<
  Id extends string,
  Endpoints extends AnyCallableDecl = never,
> = StdbGroupShape<Id, Endpoints>

export type StdbHttpGroup<
  Id extends string,
  Endpoints extends AnyHttpRouteDecl = never,
> = StdbHttpGroupShape<Id, Endpoints>

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
> = StdbModuleShape<
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

import type {
  GroupEndpointPair,
  GroupEndpointPairsOf,
  GroupNameOf,
  HttpGroupPair,
  HttpGroupPairsOf,
  LifecycleOf,
  ScheduledTableNameOf,
  SchedulePair,
  SchedulePairsOf,
} from "./type-utils.ts"

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

export type RawHttpOptions = {
  readonly successStatus?: number
  readonly request?: undefined
  readonly response?: undefined
  readonly errors?: undefined
}

export type TypedHttpOptions<
  Req extends Schema.Top,
  Res extends Schema.Top,
  Errors extends ErrorsInput | undefined,
> = {
  readonly request: Req
  readonly response: Res
  readonly errors?: Errors
  readonly successStatus?: number
}

export type HttpMethodBuilder<Method extends HttpHandlerMethod> = {
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

export const httpMethod = <const Method extends HttpHandlerMethod>(
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
