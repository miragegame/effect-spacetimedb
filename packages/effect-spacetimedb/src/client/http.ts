// Sanctioned SpacetimeDB protocol-client layer: generated/typed SDK calls
// assemble STDB REST URLs here so downstream consumers do not build them.

import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as HttpApi from "effect/http-api/HttpApi"
import * as HttpApiClient from "effect/http-api/HttpApiClient"
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint"
import * as HttpApiGroup from "effect/http-api/HttpApiGroup"
import * as HttpApiSchema from "effect/http-api/HttpApiSchema"
import type {
  HttpHandlerCallableDescriptor,
  ProcedureCallableDescriptor,
  ReducerCallableDescriptor,
} from "../callable-protocol.ts"
import type { HttpHandlerSpec } from "../contract/http-handler.ts"
import type { AnyModuleSpec } from "../contract/module.ts"
import type { ProcedureSpec } from "../contract/procedure.ts"
import type { ReducerSpec } from "../contract/reducer.ts"
import { type AnyValueType, isUnitValueType } from "../contract/type.ts"
import type { ModulePlan } from "../module-plan.ts"
import { makeModulePlan } from "../module-plan.ts"
import { prefixId } from "../utils.ts"
import {
  encodeArgsArray,
  RemoteRejectedBody,
  StdbDecodeError,
  TransportError,
} from "./call-errors.ts"
import {
  callProcedure,
  callProcedureRaw,
  callReducer,
  callReducerRaw,
} from "./call-runtime.ts"
import type {
  HttpHandlerKeys,
  HttpHandlerCallOptions,
  HttpHandlerConcreteMethod,
  HttpHandlerRequestOf,
  PublicProcedureKeys,
  PublicReducerKeys,
} from "./rpc.ts"
import { make as makeRpc, type ParamsOf } from "./rpc.ts"
import { executeHttpHandlerCall } from "./http-handler-call.ts"
import {
  assertCallDurationMaxBounded,
  boundCallDuration,
  type HttpClientConfig,
  normalizeBaseUri,
  readResponseText,
  transportErrorFrom,
} from "./http-transport.ts"
import * as ValueCodec from "./value-codec.ts"

export {
  HttpCallDurationExceeded,
  type HttpClientConfig,
  normalizeBaseUri,
} from "./http-transport.ts"

export type HttpClientOptions<Module extends AnyModuleSpec> = {
  readonly module: Module
} & HttpClientConfig

type Simplify<Value> = { readonly [Key in keyof Value]: Value[Key] } & {}

type FlatHttpClient<Module extends AnyModuleSpec> = ReturnType<
  typeof makeRpc<Module, HttpClient.HttpClient>
>

export type GroupIdsOf<Module extends AnyModuleSpec> =
  | Module["reducerGroups"][keyof Module["reducerGroups"] & string]
  | Module["procedureGroups"][keyof Module["procedureGroups"] & string]
  | Module["httpGroups"][keyof Module["httpGroups"] & string]

export type ReducerKeysInGroup<
  Module extends AnyModuleSpec,
  Group extends string,
> = {
  readonly [Key in keyof Module["reducerGroups"] &
    string]: Module["reducerGroups"][Key] extends Group ? Key : never
}[keyof Module["reducerGroups"] & string]

export type ProcedureKeysInGroup<
  Module extends AnyModuleSpec,
  Group extends string,
> = {
  readonly [Key in keyof Module["procedureGroups"] &
    string]: Module["procedureGroups"][Key] extends Group ? Key : never
}[keyof Module["procedureGroups"] & string]

export type HttpHandlerKeysInGroup<
  Module extends AnyModuleSpec,
  Group extends string,
> = {
  readonly [Key in keyof Module["httpGroups"] &
    string]: Module["httpGroups"][Key] extends Group ? Key : never
}[keyof Module["httpGroups"] & string]

type ProjectedHttpGroupClientFromFlat<
  Module extends AnyModuleSpec,
  Group extends GroupIdsOf<Module>,
  Flat extends FlatHttpClient<Module>,
> = {
  readonly reducers: Pick<
    Flat["reducers"],
    ReducerKeysInGroup<Module, Group> & PublicReducerKeys<Module>
  >
  readonly procedures: Pick<
    Flat["procedures"],
    ProcedureKeysInGroup<Module, Group> & PublicProcedureKeys<Module>
  >
  readonly httpHandlers: Pick<
    Flat["httpHandlers"],
    HttpHandlerKeysInGroup<Module, Group> & HttpHandlerKeys<Module>
  >
}

export type ProjectedHttpGroupClient<
  Module extends AnyModuleSpec,
  Group extends GroupIdsOf<Module>,
> = ProjectedHttpGroupClientFromFlat<Module, Group, FlatHttpClient<Module>>

type HttpGroupClients<
  Module extends AnyModuleSpec,
  Flat extends FlatHttpClient<Module>,
> = {
  readonly [Group in GroupIdsOf<Module>]: ProjectedHttpGroupClientFromFlat<
    Module,
    Group,
    Flat
  >
}

export type ProjectedHttpClient<Module extends AnyModuleSpec> =
  FlatHttpClient<Module> extends infer Flat extends FlatHttpClient<Module>
    ? Simplify<Flat & HttpGroupClients<Module, Flat>>
    : never

export declare const ProjectedHttpClientTagTypeId: unique symbol

export type ProjectedHttpClientTagIdentifier<Module extends AnyModuleSpec> = {
  readonly [ProjectedHttpClientTagTypeId]: Module["name"]
}

export type ProjectedHttpClientTag<Module extends AnyModuleSpec> = Context.Key<
  ProjectedHttpClientTagIdentifier<Module>,
  ProjectedHttpClient<Module>
>

const buildRequest = (
  args: ReadonlyArray<unknown>,
): Effect.Effect<string, TransportError> =>
  Effect.try({
    try: () => ValueCodec.httpJson.encodeInput(args),
    catch: (cause) => new TransportError({ cause }),
  })

const StdbCallPayload = Schema.String.pipe(
  HttpApiSchema.asText({ contentType: "application/json" }),
)

const StdbCallApi = HttpApi.make("EffectSpacetimeDbCallApi").add(
  HttpApiGroup.make("database").add(
    HttpApiEndpoint.post("call", "/v1/database/:databaseName/call/:callName", {
      params: Schema.Struct({
        databaseName: Schema.String,
        callName: Schema.String,
      }),
      payload: StdbCallPayload,
      success: Schema.String.pipe(HttpApiSchema.asText()),
    }),
  ),
)

const makeStdbCallClient = (config: HttpClientConfig) =>
  HttpApiClient.make(StdbCallApi, {
    baseUrl: normalizeBaseUri(config.uri),
    transformClient:
      config.token == null
        ? undefined
        : HttpClient.mapRequest(HttpClientRequest.bearerToken(config.token)),
  })

const executeStdbCall = (
  config: HttpClientConfig,
  name: string,
  args: ReadonlyArray<unknown>,
) =>
  buildRequest(args).pipe(
    Effect.flatMap(
      Effect.fn(function* (payload) {
        const client = yield* makeStdbCallClient(config)
        return yield* client.database.call({
          params: { databaseName: config.databaseName, callName: name },
          payload,
          responseMode: "response-only",
        })
      }),
    ),
    Effect.mapError(transportErrorFrom),
  )

const decodeHttpBody = <A>(
  type: AnyValueType,
  body: string | undefined,
): Effect.Effect<A, StdbDecodeError> => {
  if (body === undefined) {
    return isUnitValueType(type)
      ? Effect.succeed(undefined as A)
      : Effect.fail(
          new StdbDecodeError({
            phase: "ok",
            cause: new Error("Expected HTTP response body"),
          }),
        )
  }

  return ValueCodec.httpJson.decodeOutput<A>(type, body)
}

const decodeHttpValue = <A>(
  type: AnyValueType,
  value: unknown,
): Effect.Effect<A, StdbDecodeError> =>
  typeof value === "string" || value === undefined
    ? decodeHttpBody<A>(type, value)
    : Effect.fail(
        new StdbDecodeError({
          phase: "ok",
          cause: new Error("Expected HTTP response body"),
        }),
      )

const readProcedureBody = (response: {
  readonly status: number
  readonly text: Effect.Effect<string, unknown>
}): Effect.Effect<string | undefined, TransportError> =>
  readResponseText(response).pipe(
    Effect.map((body) => (body.length === 0 ? undefined : body)),
  )

const failRemoteRejection = (response: {
  readonly status: number
  readonly text: Effect.Effect<string, unknown>
}): Effect.Effect<never, RemoteRejectedBody | TransportError> =>
  readResponseText(response).pipe(
    Effect.flatMap(
      (body): Effect.Effect<never, RemoteRejectedBody | TransportError> =>
        Effect.fail(
          new RemoteRejectedBody({ raw: body, status: response.status }),
        ),
    ),
  )

const executeReducerCall = (
  config: HttpClientConfig,
  name: string,
  args: ReadonlyArray<unknown>,
): Effect.Effect<
  void,
  RemoteRejectedBody | TransportError,
  HttpClient.HttpClient
> =>
  executeStdbCall(config, name, args).pipe(
    Effect.flatMap(
      (response): Effect.Effect<void, RemoteRejectedBody | TransportError> =>
        response.status >= 200 && response.status < 300
          ? Effect.void
          : failRemoteRejection(response),
    ),
    boundCallDuration(config, name),
  )

const executeProcedureCall = (
  config: HttpClientConfig,
  name: string,
  args: ReadonlyArray<unknown>,
): Effect.Effect<
  string | undefined,
  RemoteRejectedBody | TransportError,
  HttpClient.HttpClient
> =>
  executeStdbCall(config, name, args).pipe(
    Effect.flatMap(
      (
        response,
      ): Effect.Effect<
        string | undefined,
        RemoteRejectedBody | TransportError
      > =>
        response.status >= 200 && response.status < 300
          ? readProcedureBody(response)
          : failRemoteRejection(response),
    ),
    boundCallDuration(config, name),
  )

const httpTagForModule = <Module extends AnyModuleSpec>(
  module: Module,
): ProjectedHttpClientTag<Module> =>
  Context.Service<
    ProjectedHttpClientTagIdentifier<Module>,
    ProjectedHttpClient<Module>
  >(prefixId(`Client/Http/${module.name}`))

type RuntimeRpcClient = {
  readonly reducers: Record<string, unknown>
  readonly procedures: Record<string, unknown>
  readonly httpHandlers: Record<string, unknown>
}

const projectGroupMembers = (
  members: Record<string, unknown>,
  groups: Record<string, string>,
  groupId: string,
): Record<string, unknown> => {
  const projected = Object.fromEntries(
    Object.entries(members).filter(([name]) => groups[name] === groupId),
  )
  Object.setPrototypeOf(projected, null)
  return projected
}

function withHttpGroupClients<Module extends AnyModuleSpec>(
  module: Module,
  flat: FlatHttpClient<Module>,
): ProjectedHttpClient<Module>
// The runtime assembly is intentionally unparameterized at this seam. The
// module's group records are its source of truth; identity and partition tests
// pin this implementation to the projected overload above.
function withHttpGroupClients(
  module: AnyModuleSpec,
  flat: RuntimeRpcClient,
): RuntimeRpcClient
function withHttpGroupClients(
  module: AnyModuleSpec,
  flat: RuntimeRpcClient,
): RuntimeRpcClient {
  Object.setPrototypeOf(flat, null)
  const groupIds = new Set([
    ...Object.values(module.reducerGroups),
    ...Object.values(module.procedureGroups),
    ...Object.values(module.httpGroups),
  ])

  for (const groupId of groupIds) {
    let memoized: RuntimeRpcClient | undefined
    Object.defineProperty(flat, groupId, {
      configurable: false,
      enumerable: true,
      get: () => {
        if (memoized == null) {
          memoized = {
            reducers: projectGroupMembers(
              flat.reducers,
              module.reducerGroups,
              groupId,
            ),
            procedures: projectGroupMembers(
              flat.procedures,
              module.procedureGroups,
              groupId,
            ),
            httpHandlers: projectGroupMembers(
              flat.httpHandlers,
              module.httpGroups,
              groupId,
            ),
          }
          Object.setPrototypeOf(memoized, null)
        }
        return memoized
      },
    })
  }

  return flat
}

export const makeFromModulePlan = <Module extends AnyModuleSpec>(options: {
  readonly plan: ModulePlan<Module>
  readonly config: HttpClientConfig
}): ProjectedHttpClient<Module> => {
  assertCallDurationMaxBounded(options.config)
  const flat = makeRpc({
    reducers: options.plan.publicReducers,
    procedures: options.plan.publicProcedures,
    httpHandlers: options.plan.projectedHttpHandlers,
    reducerCallables: options.plan.reducerCallables,
    procedureCallables: options.plan.procedureCallables,
    httpHandlerCallables: options.plan.httpHandlerCallables,
    callReducer: <Spec extends ReducerSpec>(
      callable: ReducerCallableDescriptor<Spec>,
      payload: ParamsOf<Spec>,
    ) =>
      callReducer({
        moduleName: options.plan.module.name,
        transport: "http",
        callable,
        payload,
        runtime: {
          prepareArgs: (spec, value) => encodeArgsArray(spec.params, value),
          invoke: (name, _spec, encoded) =>
            executeReducerCall(options.config, name, encoded),
        },
      }),
    callReducerRaw: <Spec extends ReducerSpec>(
      callable: ReducerCallableDescriptor<Spec>,
      payload: ParamsOf<Spec>,
    ) =>
      callReducerRaw({
        moduleName: options.plan.module.name,
        transport: "http",
        callable,
        payload,
        runtime: {
          prepareArgs: (spec, value) => encodeArgsArray(spec.params, value),
          invoke: (name, _spec, encoded) =>
            executeReducerCall(options.config, name, encoded),
        },
      }),
    callProcedure: <Spec extends ProcedureSpec>(
      callable: ProcedureCallableDescriptor<Spec>,
      payload: ParamsOf<Spec>,
    ) =>
      callProcedure({
        moduleName: options.plan.module.name,
        transport: "http",
        callable,
        payload,
        runtime: {
          prepareArgs: (spec, value) => encodeArgsArray(spec.params, value),
          invoke: (name, _spec, encoded) =>
            executeProcedureCall(options.config, name, encoded),
          decodeValue: decodeHttpValue,
        },
      }),
    callProcedureRaw: <Spec extends ProcedureSpec>(
      callable: ProcedureCallableDescriptor<Spec>,
      payload: ParamsOf<Spec>,
    ) =>
      callProcedureRaw({
        moduleName: options.plan.module.name,
        transport: "http",
        callable,
        payload,
        runtime: {
          prepareArgs: (spec, value) => encodeArgsArray(spec.params, value),
          invoke: (name, _spec, encoded) =>
            executeProcedureCall(options.config, name, encoded),
          decodeValue: decodeHttpValue,
        },
      }),
    callHttpHandler: <Spec extends HttpHandlerSpec>(
      callable: HttpHandlerCallableDescriptor<Spec>,
      method: HttpHandlerConcreteMethod,
      payload: HttpHandlerRequestOf<Spec> | undefined,
      callOptions?: HttpHandlerCallOptions,
    ) =>
      executeHttpHandlerCall(
        options.config,
        method,
        callable,
        payload,
        callOptions,
      ),
  })

  return withHttpGroupClients(options.plan.module, flat)
}

export const groupFromModulePlan = <
  Module extends AnyModuleSpec,
  Group extends GroupIdsOf<Module>,
>(options: {
  readonly plan: ModulePlan<Module>
  readonly group: Group
  readonly config: HttpClientConfig
}): ProjectedHttpGroupClient<Module, Group> =>
  getHttpGroupClient(
    makeFromModulePlan({ plan: options.plan, config: options.config }),
    options.group,
  )

function getHttpGroupClient<
  Module extends AnyModuleSpec,
  Group extends GroupIdsOf<Module>,
>(
  client: ProjectedHttpClient<Module>,
  group: Group,
): ProjectedHttpGroupClient<Module, Group>
// `withHttpGroupClients` defines every GroupIdsOf<Module> property. Keep the
// runtime lookup narrow here and let the public overload preserve that proof.
function getHttpGroupClient(client: object, group: string): unknown
function getHttpGroupClient(client: object, group: string): unknown {
  return Reflect.get(client, group)
}

export const make = <Module extends AnyModuleSpec>(
  options: HttpClientOptions<Module>,
) =>
  makeFromModulePlan({
    plan: makeModulePlan(options.module),
    config: {
      uri: options.uri,
      databaseName: options.databaseName,
      token: options.token,
      callDurationMax: options.callDurationMax,
    },
  })

export const tagFromModulePlan = <Module extends AnyModuleSpec>(
  plan: ModulePlan<Module>,
) => httpTagForModule(plan.module)

export const layerFromModulePlan = <Module extends AnyModuleSpec>(options: {
  readonly plan: ModulePlan<Module>
  readonly config: HttpClientConfig
}) =>
  Layer.merge(
    Layer.succeed(tagFromModulePlan(options.plan), makeFromModulePlan(options)),
    FetchHttpClient.layer,
  )
