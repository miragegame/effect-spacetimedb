/**
 * @module-tag local-only
 * @module-tag spacetimedb
 */

import * as EffectVitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient"
import * as HttpBody from "effect/unstable/http/HttpBody"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"

const { describe, expect, live } = EffectVitest

import * as StdbTesting from "effect-spacetimedb/testing"
import {
  decodeThingId,
  decodeUserId,
  decodeUserName,
  firstFailure,
  LIVE_TEST_TIMEOUT_MS,
  Live,
  makeExampleSession,
  UserMissingError,
  wireFunction,
} from "./helpers/example-live"
import {
  callLiveReducer,
  liveHarness,
  provideLiveTest,
  waitForRows,
} from "./helpers/live-harness"

const decodeRawJson = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Unknown),
)
const isUserMissingError = Schema.is(UserMissingError)

type RawRouteTarget = {
  readonly baseUrl: string
  readonly databaseName: string
  readonly token: string
}

const rawRouteUrl = (target: RawRouteTarget, path: string): string =>
  `${target.baseUrl.replace(/\/+$/u, "")}/v1/database/${
    target.databaseName
  }/route${path}`

const postRawRoute = (
  target: RawRouteTarget,
  path: string,
  options: {
    readonly body: string
    readonly contentType: string
    readonly headers?: Record<string, string>
  },
) =>
  Effect.flatMap(HttpClient.HttpClient, (http) => {
    const baseRequest = HttpClientRequest.post(rawRouteUrl(target, path))
    const authed = HttpClientRequest.bearerToken(target.token)(baseRequest)
    const withHeaders =
      options.headers === undefined
        ? authed
        : HttpClientRequest.setHeaders(options.headers)(authed)
    const request = HttpClientRequest.setBody(
      withHeaders,
      HttpBody.text(options.body, options.contentType),
    )

    return http.execute(request).pipe(
      Effect.flatMap((response) =>
        response.text.pipe(
          Effect.map((body) => ({ status: response.status, body })),
        ),
      ),
      Effect.scoped,
    )
  }).pipe(Effect.provide(FetchHttpClient.layer))

describe("effect-spacetimedb live HTTP routes", () => {
  live(
    "round-trips thingPing through the published route handler",
    () =>
      provideLiveTest(
        Effect.gen(function* () {
          const live = yield* liveHarness
          const httpLayer = Live.client.http.layer({
            uri: live.baseUrl,
            databaseName: live.databaseName,
            token: live.token,
          })

          yield* Effect.gen(function* () {
            const client = yield* Live.client.http.Tag
            const thingId = decodeThingId("http-route-thing")
            const ping = yield* client.httpHandlers.thingPing({
              thingId,
            })

            expect(ping).toEqual({
              thingId,
              status: "ok",
            })
          }).pipe(Effect.provide(httpLayer))
        }),
      ),
    { timeout: LIVE_TEST_TIMEOUT_MS },
  )

  live(
    "rotates a token for an existing user through the published route handler",
    () =>
      provideLiveTest(
        Effect.gen(function* () {
          const { live, session, connection } = yield* makeExampleSession
          const httpLayer = Live.client.http.layer({
            uri: live.baseUrl,
            databaseName: live.databaseName,
            token: live.token,
          })

          yield* Effect.gen(function* () {
            const client = yield* Live.client.http.Tag
            yield* session
              .streamTable("user")
              .pipe(Stream.runDrain, Effect.forkScoped)
            const userId = decodeUserId("http-route-user")
            const name = decodeUserName("Ada")
            yield* callLiveReducer(connection, wireFunction("userUpsert"), {
              userId,
              name,
            })
            yield* waitForRows(
              () => session.cache.tables.user.toArray(),
              (rows) =>
                rows.some((row) => row.id === userId && row.name === name),
            )

            const rotated = yield* client.httpHandlers.rotateToken({
              userId,
            })
            expect(rotated.token.length).toBeGreaterThan(0)
          }).pipe(Effect.provide(httpLayer))
        }),
      ),
    { timeout: LIVE_TEST_TIMEOUT_MS },
  )

  live(
    "surfaces missing-user route rejection from rotateToken",
    () =>
      provideLiveTest(
        Effect.gen(function* () {
          const live = yield* liveHarness
          const httpLayer = Live.client.http.layer({
            uri: live.baseUrl,
            databaseName: live.databaseName,
            token: live.token,
          })

          yield* Effect.gen(function* () {
            const client = yield* Live.client.http.Tag
            const missingUserId = decodeUserId("http-route-missing-user")
            const rawMissing = yield* postRawRoute(
              live,
              "/server-tokens/rotate",
              {
                body: `{"userId":"${missingUserId}"}`,
                contentType: "application/json",
              },
            )

            expect(rawMissing.status).toBe(404)
            expect(decodeRawJson(rawMissing.body)).toMatchObject({
              _tag: expect.stringContaining("UserMissingError"),
              userId: missingUserId,
            })

            const missingExit = yield* client.httpHandlers
              .rotateToken({
                userId: missingUserId,
              })
              .pipe(Effect.exit)
            expect(Exit.isFailure(missingExit)).toBe(true)
            const failure = firstFailure(missingExit)
            if (isUserMissingError(failure)) {
              expect(failure).toMatchObject({ userId: missingUserId })
            } else {
              expect(failure).toBeInstanceOf(StdbTesting.RemoteRejectedBody)
              if (failure instanceof StdbTesting.RemoteRejectedBody) {
                expect(failure.raw).toBe(rawMissing.body)
              }
            }
          }).pipe(Effect.provide(httpLayer))
        }),
      ),
    { timeout: LIVE_TEST_TIMEOUT_MS },
  )

  live(
    "passes raw stripeWebhook bodies to the published route handler",
    () =>
      provideLiveTest(
        Effect.gen(function* () {
          const live = yield* liveHarness
          const httpLayer = Live.client.http.layer({
            uri: live.baseUrl,
            databaseName: live.databaseName,
            token: live.token,
          })

          yield* Effect.gen(function* () {
            const client = yield* Live.client.http.Tag
            const rawWebhook = yield* postRawRoute(live, "/webhooks/stripe", {
              body: "event=invoice.paid",
              contentType: "application/x-www-form-urlencoded",
              headers: {
                "stripe-signature": "sig-1",
              },
            })
            expect(rawWebhook).toEqual({
              status: 202,
              body: "event=invoice.paid",
            })

            const webhook = yield* client.httpHandlers.stripeWebhook(
              "event=invoice.paid",
              {
                contentType: "application/x-www-form-urlencoded",
                headers: {
                  "stripe-signature": "sig-1",
                },
              },
            )
            expect(webhook).toBe("event=invoice.paid")
          }).pipe(Effect.provide(httpLayer))
        }),
      ),
    { timeout: LIVE_TEST_TIMEOUT_MS },
  )
})
