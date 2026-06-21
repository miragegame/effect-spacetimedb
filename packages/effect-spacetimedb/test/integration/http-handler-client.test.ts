import * as Effect from "effect/Effect"
import * as EffectVitest from "@effect/vitest"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as Schema from "effect/Schema"
const { expect } = EffectVitest
import * as StdbTesting from "effect-spacetimedb/testing"
import { FullModule } from "../fixtures/full-module"
import {
  moduleFromSections,
  rawHttpHandlerSpec,
} from "../helpers/module-builders"
import { makeMockHttpClientLayer } from "../helpers/mock-http-client"
import { TestLayer } from "../helpers/test-layer"

const describe = EffectVitest.layer(TestLayer)

const AnyModule = moduleFromSections({
  name: "any_http",
  httpHandlers: {
    pingAny: rawHttpHandlerSpec({
      method: "any",
      path: "/ping",
      request: Schema.Struct({ value: Schema.String }),
      response: Schema.Struct({ ok: Schema.Boolean }),
    }),
  },
})

const AnyRawModule = moduleFromSections({
  name: "any_raw_http",
  httpHandlers: {
    healthAny: rawHttpHandlerSpec({
      method: "any",
      path: "/health",
    }),
  },
})

const EmptyBodyModule = moduleFromSections({
  name: "empty_body_http",
  httpHandlers: {
    undefinedRoundTrip: rawHttpHandlerSpec({
      method: "post",
      path: "/undefined",
      request: Schema.Undefined,
      response: Schema.Undefined,
    }),
    voidResponse: rawHttpHandlerSpec({
      method: "post",
      path: "/void-response",
      request: Schema.Void,
      response: Schema.Void,
    }),
  },
})

const runHttp = <A, E>(
  effect: Effect.Effect<A, E, HttpClient.HttpClient>,
  handler: Parameters<typeof makeMockHttpClientLayer>[0],
) => effect.pipe(Effect.provide(makeMockHttpClientLayer(handler)))

describe("HTTP handler client", (it) => {
  it.effect(
    "builds typed route requests with normalized URL and bearer token",
    () =>
      Effect.gen(function* () {
        const client = StdbTesting.ClientHttp.make({
          module: FullModule,
          uri: "http://stdb.test/",
          databaseName: "full",
          token: "secret-token",
        })

        const result = yield* runHttp(
          client.httpHandlers.rotateToken({
            userId: "user-1" as never,
          }),
          (request) =>
            Effect.succeed({
              body: (() => {
                expect(request.method).toBe("POST")
                expect(request.url.href).toBe(
                  "http://stdb.test/v1/database/full/route/server-tokens/rotate",
                )
                expect(request.headers).toEqual(
                  expect.objectContaining({
                    authorization: "Bearer secret-token",
                  }),
                )
                expect(request.body).toEqual({ userId: "user-1" })
                expect(request.bodyText).toBe(`{"userId":"user-1"}`)
                return `{"token":"rotated"}`
              })(),
            }),
        )

        expect(result).toEqual({ token: "rotated" })
      }),
  )

  it.effect("requires an explicit concrete method for any handlers", () =>
    Effect.gen(function* () {
      const client = StdbTesting.ClientHttp.make({
        module: AnyModule,
        uri: "http://stdb.test",
        databaseName: "any",
      })

      const result = yield* runHttp(
        client.httpHandlers.pingAny("patch", { value: "ok" }),
        (request) =>
          Effect.succeed({
            body: (() => {
              expect(request.method).toBe("PATCH")
              expect(request.url.href).toBe(
                "http://stdb.test/v1/database/any/route/ping",
              )
              expect(request.body).toEqual({ value: "ok" })
              return `{"ok":true}`
            })(),
          }),
      )

      expect(result).toEqual({ ok: true })
    }),
  )

  it.effect(
    "passes raw route request bodies and options without JSON coercion",
    () =>
      Effect.gen(function* () {
        const client = StdbTesting.ClientHttp.make({
          module: FullModule,
          uri: "http://stdb.test",
          databaseName: "full",
        })

        const result = yield* runHttp(
          client.httpHandlers.stripeWebhook("event=invoice.paid", {
            contentType: "application/x-www-form-urlencoded",
            headers: {
              "stripe-signature": "sig-1",
            },
          }),
          (request) =>
            Effect.succeed({
              body: (() => {
                expect(request.method).toBe("POST")
                expect(request.url.href).toBe(
                  "http://stdb.test/v1/database/full/route/webhooks/stripe",
                )
                expect(request.headers).toEqual(
                  expect.objectContaining({
                    "stripe-signature": "sig-1",
                  }),
                )
                expect(request.body).toBe("event=invoice.paid")
                expect(request.bodyText).toBe("event=invoice.paid")
                return "accepted"
              })(),
            }),
        )

        expect(result).toBe("accepted")
      }),
  )

  it.effect("allows any raw handlers to omit the body", () =>
    Effect.gen(function* () {
      const client = StdbTesting.ClientHttp.make({
        module: AnyRawModule,
        uri: "http://stdb.test",
        databaseName: "any-raw",
      })

      const result = yield* runHttp(
        client.httpHandlers.healthAny("get"),
        (request) =>
          Effect.succeed({
            body: (() => {
              expect(request.method).toBe("GET")
              expect(request.url.href).toBe(
                "http://stdb.test/v1/database/any-raw/route/health",
              )
              expect(request.body).toBeUndefined()
              return "ok"
            })(),
          }),
      )

      expect(result).toBe("ok")
    }),
  )

  it.effect("sends and accepts undefined typed route bodies as empty", () =>
    Effect.gen(function* () {
      const client = StdbTesting.ClientHttp.make({
        module: EmptyBodyModule,
        uri: "http://stdb.test",
        databaseName: "empty",
      })

      const result = yield* runHttp(
        client.httpHandlers.undefinedRoundTrip(),
        (request) =>
          Effect.succeed({
            body: (() => {
              expect(request.method).toBe("POST")
              expect(request.url.href).toBe(
                "http://stdb.test/v1/database/empty/route/undefined",
              )
              expect(request.body).toBeUndefined()
              expect(request.bodyText).toBeUndefined()
              return ""
            })(),
          }),
      )

      expect(result).toBeUndefined()
    }),
  )

  it.effect("validates non-empty void route responses", () =>
    Effect.gen(function* () {
      const client = StdbTesting.ClientHttp.make({
        module: EmptyBodyModule,
        uri: "http://stdb.test",
        databaseName: "empty",
      })

      const failure = yield* Effect.flip(
        runHttp(client.httpHandlers.voidResponse(), () =>
          Effect.succeed({
            body: "{}",
          }),
        ),
      )

      expect(failure).toBeInstanceOf(StdbTesting.StdbDecodeError)
    }),
  )

  it.effect("surfaces non-2xx route responses as opaque bodies", () =>
    Effect.gen(function* () {
      const client = StdbTesting.ClientHttp.make({
        module: FullModule,
        uri: "http://stdb.test",
        databaseName: "full",
      })

      const failure = yield* Effect.flip(
        runHttp(
          client.httpHandlers.rotateToken({
            userId: "missing" as never,
          }),
          () =>
            Effect.succeed({
              status: 404,
              body: "missing",
            }),
        ),
      )

      expect(failure).toBeInstanceOf(StdbTesting.RemoteRejectedBody)
      expect(failure).toMatchObject({ raw: "missing" })
    }),
  )
})
