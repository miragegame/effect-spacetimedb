// Sanctioned SpacetimeDB protocol-client layer: generated/typed SDK calls
// assemble STDB REST URLs here so downstream consumers do not build them.

import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Match from "effect/Match"
import * as Schema from "effect/Schema"
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient"
import * as HttpBody from "effect/unstable/http/HttpBody"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as HttpApi from "effect/unstable/httpapi/HttpApi"
import * as HttpApiClient from "effect/unstable/httpapi/HttpApiClient"
import * as HttpApiEndpoint from "effect/unstable/httpapi/HttpApiEndpoint"
import * as HttpApiGroup from "effect/unstable/httpapi/HttpApiGroup"
import * as HttpApiSchema from "effect/unstable/httpapi/HttpApiSchema"
import type {
  HttpHandlerCallableDescriptor,
  ProcedureCallableDescriptor,
  ReducerCallableDescriptor,
} from "../callable-protocol.ts"
import type { HttpHandlerSpec } from "../contract/http-handler.ts"
import * as ErrorCodec from "../contract/error.ts"
import { isTypedHttpHandlerSpec } from "../contract/http-handler.ts"
import type { AnyModuleSpec } from "../contract/module.ts"
import type { ProcedureSpec } from "../contract/procedure.ts"
import type { ReducerSpec } from "../contract/reducer.ts"
import { type AnyValueType, isUnitValueType } from "../contract/type.ts"
import { addDecodeContext } from "../decode-error.ts"
import { readTaggedErrorTag } from "../error-identity.ts"
import {
  decodeEmptyHttpBody,
  httpWireCodec,
  isHttpEmptySchema,
} from "../http-wire-codec.ts"
import type { ModulePlan } from "../module-plan.ts"
import { makeModulePlan } from "../module-plan.ts"
import { prefixId } from "../utils.ts"
import {
  encodeArgsArray,
  type CallFailure,
  remoteRejectedFromRaw,
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
  DeclaredErrorsOf,
  HttpHandlerKeys,
  HttpHandlerCallOptions,
  HttpHandlerConcreteMethod,
  HttpHandlerRequestOf,
  HttpHandlerResponseOf,
  PublicProcedureKeys,
  PublicReducerKeys,
} from "./rpc.ts"
import { make as makeRpc, type ParamsOf } from "./rpc.ts"
import * as ValueCodec from "./value-codec.ts"

export type HttpClientConfig = {
  readonly uri: string
  readonly databaseName: string
  readonly token?: string | undefined
}

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

const readResponseText = <E>(response: {
  readonly status: number
  readonly text: Effect.Effect<string, E>
}): Effect.Effect<string, TransportError> =>
  response.text.pipe(Effect.mapError((cause) => new TransportError({ cause })))

const transportErrorFrom = (cause: unknown): TransportError =>
  TransportError.is(cause) ? cause : new TransportError({ cause })

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

const failHttpHandlerRejection = <Spec extends HttpHandlerSpec>(
  spec: Spec,
  status: number,
  body: string,
): Effect.Effect<never, CallFailure<DeclaredErrorsOf<Spec>>> => {
  const errors = spec.errors
  if (errors == null) {
    return Effect.fail(remoteRejectedFromRaw(body, status))
  }

  return Schema.decodeUnknownEffect(httpWireCodec(errors.schema))(body).pipe(
    // HttpHandlerSpec's runtime-erased error definition loses the concrete
    // union, while DeclaredErrorsOf retains it for the public client type.
    Effect.map((error) => error as DeclaredErrorsOf<Spec>),
    Effect.matchEffect({
      onFailure: () => Effect.fail(remoteRejectedFromRaw(body, status)),
      onSuccess: (error) => {
        const tag = readTaggedErrorTag(error)
        const matchesStatus = errors.errors.some(
          (errorClass) =>
            ErrorCodec.tagOf(errorClass) === tag &&
            ErrorCodec.statusOf(errorClass) === status,
        )
        return matchesStatus
          ? Effect.fail(error)
          : Effect.fail(remoteRejectedFromRaw(body, status))
      },
    }),
  )
}

export const normalizeBaseUri = (uri: string): string =>
  uri.replace(/\/+$/u, "")

const httpRouteUrl = (config: HttpClientConfig, path: string): string =>
  `${normalizeBaseUri(config.uri)}/v1/database/${config.databaseName}/route${path}`

const toHttpClientMethod = (
  method: HttpHandlerConcreteMethod,
): "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS" =>
  Match.value(method).pipe(
    Match.when("get", () => "GET" as const),
    Match.when("post", () => "POST" as const),
    Match.when("put", () => "PUT" as const),
    Match.when("delete", () => "DELETE" as const),
    Match.when("patch", () => "PATCH" as const),
    Match.when("head", () => "HEAD" as const),
    Match.when("options", () => "OPTIONS" as const),
    Match.exhaustive,
  )

const encodeHttpHandlerRequest = <Spec extends HttpHandlerSpec>(
  spec: Spec,
  payload: HttpHandlerRequestOf<Spec> | undefined,
): Effect.Effect<
  { readonly body?: string; readonly contentType?: string },
  StdbDecodeError
> => {
  if (!isTypedHttpHandlerSpec(spec)) {
    return Effect.succeed(
      payload === undefined ? {} : { body: payload as string },
    )
  }

  if (isHttpEmptySchema(spec.request)) {
    return Effect.succeed({})
  }

  return Schema.encodeEffect(httpWireCodec(spec.request))(
    payload as HttpHandlerRequestOf<Spec>,
  ).pipe(
    Effect.map((body) => ({
      body,
      contentType: "application/json" as const,
    })),
    Effect.mapError(
      (cause) =>
        new StdbDecodeError({
          phase: "args",
          cause,
        }),
    ),
  )
}

const decodeHttpHandlerResponse = <Spec extends HttpHandlerSpec>(
  spec: Spec,
  body: string,
): Effect.Effect<HttpHandlerResponseOf<Spec>, StdbDecodeError> => {
  if (spec.response === undefined) {
    return Effect.succeed(
      (body.length === 0 ? undefined : body) as HttpHandlerResponseOf<Spec>,
    )
  }

  if (body.length === 0) {
    return decodeEmptyHttpBody(spec.response).pipe(
      Effect.map((decoded) => decoded as HttpHandlerResponseOf<Spec>),
      Effect.mapError(
        (cause) =>
          new StdbDecodeError({
            phase: "ok",
            cause,
          }),
      ),
    )
  }

  return Schema.decodeUnknownEffect(httpWireCodec(spec.response))(body).pipe(
    Effect.map((decoded) => decoded as HttpHandlerResponseOf<Spec>),
    Effect.mapError(
      (cause) =>
        new StdbDecodeError({
          phase: "ok",
          cause,
        }),
    ),
  )
}

const buildHttpHandlerRequest = <Spec extends HttpHandlerSpec>(
  config: HttpClientConfig,
  method: HttpHandlerConcreteMethod,
  callable: HttpHandlerCallableDescriptor<Spec>,
  body: string | undefined,
  contentType: string | undefined,
  options: HttpHandlerCallOptions | undefined,
): Effect.Effect<HttpClientRequest.HttpClientRequest, TransportError> =>
  Effect.try({
    try: () => {
      const request = HttpClientRequest.make(toHttpClientMethod(method))(
        httpRouteUrl(config, callable.path),
      )
      const authed =
        config.token != null
          ? HttpClientRequest.bearerToken(config.token)(request)
          : request
      const withHeaders =
        options?.headers === undefined
          ? authed
          : HttpClientRequest.setHeaders(options.headers)(authed)

      return body === undefined
        ? withHeaders
        : HttpClientRequest.setBody(
            withHeaders,
            HttpBody.text(body, contentType ?? options?.contentType),
          )
    },
    catch: (cause) => new TransportError({ cause }),
  })

const executeHttpHandlerCall = <Spec extends HttpHandlerSpec>(
  config: HttpClientConfig,
  method: HttpHandlerConcreteMethod,
  callable: HttpHandlerCallableDescriptor<Spec>,
  payload: HttpHandlerRequestOf<Spec> | undefined,
  options?: HttpHandlerCallOptions,
): Effect.Effect<
  HttpHandlerResponseOf<Spec>,
  CallFailure<DeclaredErrorsOf<Spec>>,
  HttpClient.HttpClient
> =>
  Effect.flatMap(HttpClient.HttpClient, (http) =>
    encodeHttpHandlerRequest(callable.spec, payload).pipe(
      Effect.mapError((error) =>
        addDecodeContext(error, {
          callable: callable.name,
          op: "encodeHttpRequest",
        }),
      ),
      Effect.flatMap((encoded) =>
        buildHttpHandlerRequest(
          config,
          method,
          callable,
          encoded.body,
          encoded.contentType,
          options,
        ),
      ),
      Effect.flatMap((request) =>
        http.execute(request).pipe(
          Effect.mapError(transportErrorFrom),
          Effect.flatMap(
            (
              response,
            ): Effect.Effect<
              HttpHandlerResponseOf<Spec>,
              CallFailure<DeclaredErrorsOf<Spec>>
            > =>
              response.status >= 200 && response.status < 300
                ? readResponseText(response).pipe(
                    Effect.flatMap((body) =>
                      decodeHttpHandlerResponse(callable.spec, body).pipe(
                        Effect.mapError((error) =>
                          addDecodeContext(error, {
                            callable: callable.name,
                            op: "decodeHttpResponse",
                          }),
                        ),
                      ),
                    ),
                  )
                : readResponseText(response).pipe(
                    Effect.flatMap((body) =>
                      failHttpHandlerRejection(
                        callable.spec,
                        response.status,
                        body,
                      ),
                    ),
                  ),
          ),
          Effect.scoped,
        ),
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
