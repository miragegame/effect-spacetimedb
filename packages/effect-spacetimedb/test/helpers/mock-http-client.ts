import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import type * as HttpBody from "effect/unstable/http/HttpBody"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"

const JsonUnknown = Schema.fromJsonString(Schema.Unknown)

class MockHttpClientBodyError extends Data.TaggedError(
  "MockHttpClientBodyError",
)<{
  readonly tag: string
  readonly cause?: unknown
}> {}

export type MockHttpRequest = {
  readonly method: string
  readonly url: URL
  readonly body: unknown
  readonly bodyText?: string
  readonly headers: unknown
}

export type MockHttpResponse = {
  readonly status?: number
  readonly body?: string
  readonly textError?: unknown
}

type MockHttpHandlerError = {} | null | undefined

type DecodedBody = {
  readonly body: unknown
  readonly bodyText?: string
}

const decodeBody = (
  body: HttpBody.HttpBody,
): Effect.Effect<DecodedBody, MockHttpClientBodyError> =>
  Match.value(body).pipe(
    Match.tag("Empty", () => Effect.succeed({ body: undefined })),
    Match.tag("Raw", (rawBody) => Effect.succeed({ body: rawBody.body })),
    Match.tag("Uint8Array", (uint8ArrayBody) =>
      (() => {
        const bodyText = new TextDecoder().decode(uint8ArrayBody.body)
        return Effect.succeed({
          body: Option.match(
            Schema.decodeUnknownOption(JsonUnknown)(bodyText),
            {
              onNone: () => bodyText,
              onSome: (value) => value,
            },
          ),
          bodyText,
        })
      })(),
    ),
    Match.orElse((unsupportedBody) =>
      Effect.fail(
        new MockHttpClientBodyError({
          tag: unsupportedBody._tag,
        }),
      ),
    ),
  )

export const makeMockHttpClientLayer = <E extends MockHttpHandlerError>(
  handler: (request: MockHttpRequest) => Effect.Effect<MockHttpResponse, E>,
) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request, url) =>
      decodeBody(request.body).pipe(
        Effect.flatMap((decodedBody) =>
          handler({
            method: request.method,
            url,
            body: decodedBody.body,
            ...(decodedBody.bodyText != null
              ? { bodyText: decodedBody.bodyText }
              : {}),
            headers: request.headers,
          }),
        ),
        Effect.map((response) =>
          HttpClientResponse.fromWeb(
            request,
            new Response(
              response.textError === undefined
                ? (response.body ?? "")
                : new ReadableStream({
                    start: (controller) => {
                      controller.error(response.textError)
                    },
                  }),
              {
                status: response.status ?? 200,
              },
            ),
          ),
        ),
        Effect.mapError((cause) => cause as never),
      ),
    ),
  )
