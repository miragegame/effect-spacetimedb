import * as EffectVitest from "@effect/vitest"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as TestClock from "effect/testing/TestClock"
import type * as HttpClient from "effect/http/HttpClient"
import { HttpCallDurationExceeded } from "effect-spacetimedb/client"
import * as StdbTesting from "effect-spacetimedb/testing"
import { FullModule, UserId, UserName } from "../fixtures/full-module"
import { makeMockHttpClientLayer } from "../helpers/mock-http-client"
import { TestLayer } from "../helpers/test-layer"

const { expect } = EffectVitest
const describe = EffectVitest.layer(TestLayer)

const callDurationMaxMs = 10_000
const callDurationMax = Duration.millis(callDurationMaxMs)
const client = StdbTesting.ClientHttp.make({
  module: FullModule,
  uri: "http://stdb.test",
  databaseName: "full",
  callDurationMax,
})
const userId = UserId.make("user-1")

const neverAnswers = makeMockHttpClientLayer(() => Effect.never)
const answersAfter = (delay: Duration.Input, body: string) =>
  makeMockHttpClientLayer(() =>
    Effect.sleep(delay).pipe(Effect.as({ status: 200, body })),
  )

const expectTimesOutAtBound = <A, E>(
  call: Effect.Effect<A, E, HttpClient.HttpClient>,
) =>
  Effect.gen(function* () {
    const fiber = yield* call.pipe(
      Effect.provide(neverAnswers),
      Effect.flip,
      Effect.forkChild,
    )
    yield* TestClock.adjust(callDurationMaxMs - 1)
    expect(fiber.pollUnsafe()).toBeUndefined()
    yield* TestClock.adjust(1)
    const failure = yield* Fiber.join(fiber)
    expect(failure).toBeInstanceOf(StdbTesting.TransportError)
    expect(failure).toMatchObject({
      cause: expect.any(HttpCallDurationExceeded),
    })
  })

describe("HTTP call duration bound", (it) => {
  it.effect("fails an unanswered reducer call as a transport error", () =>
    expectTimesOutAtBound(
      client.reducers.userUpsert({ userId, name: UserName.make("Ada") }),
    ),
  )

  it.effect("fails an unanswered procedure call as a transport error", () =>
    expectTimesOutAtBound(client.procedures.userGet({ userId })),
  )

  it.effect("fails an unanswered HTTP handler call as a transport error", () =>
    expectTimesOutAtBound(client.httpHandlers.rotateToken({ userId })),
  )

  it.effect("completes a call answered inside the bound", () =>
    Effect.gen(function* () {
      const fiber = yield* client.reducers
        .userUpsert({ userId, name: UserName.make("Ada") })
        .pipe(
          Effect.provide(answersAfter(callDurationMaxMs - 1, "")),
          Effect.forkChild,
        )
      yield* TestClock.adjust(callDurationMaxMs - 1)
      expect(yield* Fiber.join(fiber)).toBeUndefined()
    }),
  )

  it("rejects a bound that bounds nothing when the client is built", () => {
    const unboundedDurations: ReadonlyArray<Duration.Input> = [
      Number.POSITIVE_INFINITY,
      "Infinity",
      Duration.infinity,
      0,
      -1,
    ]
    for (const unbounded of unboundedDurations) {
      expect(() =>
        StdbTesting.ClientHttp.make({
          module: FullModule,
          uri: "http://stdb.test",
          databaseName: "full",
          callDurationMax: unbounded,
        }),
      ).toThrow(TypeError)
    }
  })

  it("names a NaN bound as given rather than as the zero it parses to", () => {
    expect(() =>
      StdbTesting.ClientHttp.make({
        module: FullModule,
        uri: "http://stdb.test",
        databaseName: "full",
        callDurationMax: Number.NaN,
      }),
    ).toThrow(
      "HTTP client callDurationMax must be a positive, finite duration; received NaN",
    )
  })
})
