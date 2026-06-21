import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Match from "effect/Match"
import * as Schema from "effect/Schema"
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient"
import * as HttpBody from "effect/unstable/http/HttpBody"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import type {
  HttpHandlerCallableDescriptor,
  ProcedureCallableDescriptor,
  ReducerCallableDescriptor,
} from "../callable-protocol.ts"
import type { HttpHandlerSpec } from "../contract/http-handler.ts"
import { isTypedHttpHandlerSpec } from "../contract/http-handler.ts"
import type { AnyModuleSpec } from "../contract/module.ts"
import type { ProcedureSpec } from "../contract/procedure.ts"
import type { ReducerSpec } from "../contract/reducer.ts"
import { type AnyValueType, isUnitValueType } from "../contract/type.ts"
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
  HttpHandlerCallOptions,
  HttpHandlerConcreteMethod,
  HttpHandlerRequestOf,
  HttpHandlerResponseOf,
} from "./rpc.ts"
import { make as makeRpc, type ParamsOf } from "./rpc.ts"
import * as TransportCodec from "./value-codec.ts"

export type HttpClientConfig = {
  readonly uri: string
  readonly databaseName: string
  readonly token?: string
}

export type HttpClientOptions<Module extends AnyModuleSpec> = {
  readonly module: Module
} & HttpClientConfig

export type ProjectedHttpClient<Module extends AnyModuleSpec> = ReturnType<
  typeof makeFromModulePlan<Module>
>

export declare const ProjectedHttpClientTagTypeId: unique symbol

export type ProjectedHttpClientTagIdentifier<Module extends AnyModuleSpec> = {
  readonly [ProjectedHttpClientTagTypeId]: Module["name"]
}

export type ProjectedHttpClientTag<Module extends AnyModuleSpec> = Context.Key<
  ProjectedHttpClientTagIdentifier<Module>,
  ProjectedHttpClient<Module>
>

const buildRequest = (
  config: HttpClientConfig,
  name: string,
  args: ReadonlyArray<unknown>,
): Effect.Effect<HttpClientRequest.HttpClientRequest, TransportError> =>
  Effect.try({
    try: () => {
      const request = HttpClientRequest.post(
        `${normalizeBaseUri(config.uri)}/v1/database/${config.databaseName}/call/${name}`,
      )

      return HttpClientRequest.setBody(
        config.token != null
          ? HttpClientRequest.bearerToken(config.token)(request)
          : request,
        HttpBody.text(
          TransportCodec.httpJson.encodeInput(args),
          "application/json",
        ),
      )
    },
    catch: (cause) => new TransportError({ cause }),
  })

const readResponseText = <E>(response: {
  readonly status: number
  readonly text: Effect.Effect<string, E>
}): Effect.Effect<string, TransportError> =>
  response.text.pipe(Effect.mapError((cause) => new TransportError({ cause })))

const transportErrorFrom = (cause: unknown): TransportError =>
  cause instanceof TransportError ? cause : new TransportError({ cause })

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

  return TransportCodec.httpJson.decodeOutput<A>(type, body)
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
        Effect.fail(new RemoteRejectedBody({ raw: body })),
    ),
  )

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
  RemoteRejectedBody | StdbDecodeError | TransportError,
  HttpClient.HttpClient
> =>
  Effect.flatMap(HttpClient.HttpClient, (http) =>
    encodeHttpHandlerRequest(callable.spec, payload).pipe(
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
              RemoteRejectedBody | StdbDecodeError | TransportError
            > =>
              response.status >= 200 && response.status < 300
                ? readResponseText(response).pipe(
                    Effect.flatMap((body) =>
                      decodeHttpHandlerResponse(callable.spec, body),
                    ),
                  )
                : failRemoteRejection(response),
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
  Effect.flatMap(HttpClient.HttpClient, (http) =>
    buildRequest(config, name, args).pipe(
      Effect.flatMap((request) =>
        http.execute(request).pipe(
          Effect.mapError(transportErrorFrom),
          Effect.flatMap(
            (
              response,
            ): Effect.Effect<void, RemoteRejectedBody | TransportError> =>
              response.status >= 200 && response.status < 300
                ? Effect.void
                : failRemoteRejection(response),
          ),
          Effect.scoped,
        ),
      ),
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
  Effect.flatMap(HttpClient.HttpClient, (http) =>
    buildRequest(config, name, args).pipe(
      Effect.flatMap((request) =>
        http.execute(request).pipe(
          Effect.mapError(transportErrorFrom),
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
          Effect.scoped,
        ),
      ),
    ),
  )

const httpTagForModule = <Module extends AnyModuleSpec>(
  module: Module,
): ProjectedHttpClientTag<Module> =>
  Context.Service<
    ProjectedHttpClientTagIdentifier<Module>,
    ProjectedHttpClient<Module>
  >(prefixId(`Client/Http/${module.name}`))

export const makeFromModulePlan = <Module extends AnyModuleSpec>(options: {
  readonly plan: ModulePlan<Module>
  readonly config: HttpClientConfig
}) =>
  makeRpc({
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

export const make = <Module extends AnyModuleSpec>(
  options: HttpClientOptions<Module>,
) =>
  makeFromModulePlan({
    plan: makeModulePlan(options.module),
    config: {
      uri: options.uri,
      databaseName: options.databaseName,
      ...(options.token != null ? { token: options.token } : {}),
    },
  })

export const tagFromModulePlan = <Module extends AnyModuleSpec>(
  plan: ModulePlan<Module>,
) => httpTagForModule(plan.module)

export const layerFromModulePlan = <Module extends AnyModuleSpec>(options: {
  readonly plan: ModulePlan<Module>
  readonly config: HttpClientConfig
}) =>
  Layer.succeed(tagFromModulePlan(options.plan), makeFromModulePlan(options))

export const layerFetchFromModulePlan = <
  Module extends AnyModuleSpec,
>(options: {
  readonly plan: ModulePlan<Module>
  readonly config: HttpClientConfig
}) => Layer.merge(layerFromModulePlan(options), FetchHttpClient.layer)
