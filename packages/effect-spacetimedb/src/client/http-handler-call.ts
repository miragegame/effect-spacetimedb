// Calls to a module's typed HTTP handlers: encode the request with the
// handler's wire codec, route it to the database's `/route` surface, and
// decode the response or the handler's declared rejection.

import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Schema from "effect/Schema"
import * as HttpBody from "effect/http/HttpBody"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import type { HttpHandlerCallableDescriptor } from "../callable-protocol.ts"
import * as ErrorCodec from "../contract/error.ts"
import {
  type HttpHandlerSpec,
  isTypedHttpHandlerSpec,
} from "../contract/http-handler.ts"
import { addDecodeContext } from "../decode-error.ts"
import { readTaggedErrorTag } from "../error-identity.ts"
import {
  decodeEmptyHttpBody,
  httpWireCodec,
  isHttpEmptySchema,
} from "../http-wire-codec.ts"
import {
  type CallFailure,
  remoteRejectedFromRaw,
  StdbDecodeError,
  TransportError,
} from "./call-errors.ts"
import {
  boundCallDuration,
  type HttpClientConfig,
  normalizeBaseUri,
  readResponseText,
  transportErrorFrom,
} from "./http-transport.ts"
import type {
  DeclaredErrorsOf,
  HttpHandlerCallOptions,
  HttpHandlerConcreteMethod,
  HttpHandlerRequestOf,
  HttpHandlerResponseOf,
} from "./rpc.ts"

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

export const executeHttpHandlerCall = <Spec extends HttpHandlerSpec>(
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
      boundCallDuration(config, callable.name),
    ),
  )
