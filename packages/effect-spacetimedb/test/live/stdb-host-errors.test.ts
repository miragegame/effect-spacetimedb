/**
 * @module-tag local-only
 * @module-tag spacetimedb
 */

import * as EffectVitest from "@effect/vitest"
import * as Effect from "effect/Effect"

const { describe, expect, live } = EffectVitest

import {
  decodeThingId,
  LIVE_TEST_TIMEOUT_MS,
  makeExampleSession,
  wireFunction,
} from "./helpers/example-live"
import {
  callLiveReducer,
  callLiveReducerExpectingRejection,
  liveCallErrorName,
  provideLiveTest,
  waitForLiveServerLog,
} from "./helpers/live-harness"

const callReducerForLoggedHostFailure = (
  connection: Parameters<typeof callLiveReducer>[0],
  name: string,
  args: object,
) =>
  Effect.gen(function* () {
    const cause = yield* callLiveReducerExpectingRejection(
      connection,
      name,
      args,
    )
    expect(liveCallErrorName(cause)).toBe("InternalError")
    return cause
  })

describe("effect-spacetimedb live host errors", () => {
  live(
    "surfaces real storage-engine and scheduler failures from a live host",
    () =>
      provideLiveTest(
        Effect.gen(function* () {
          const unique = yield* makeExampleSession

          yield* callLiveReducer(
            unique.connection,
            wireFunction("membershipInsertStrict"),
            {
              tenantId: "host-error-tenant",
              email: "host-error@example.com",
              note: "first",
            },
          )
          yield* callReducerForLoggedHostFailure(
            unique.connection,
            wireFunction("membershipInsertStrict"),
            {
              tenantId: "host-error-tenant",
              email: "host-error@example.com",
              note: "second",
            },
          )
          yield* waitForLiveServerLog(
            unique.live.logPath,
            "UniqueAlreadyExists",
            "SpaceTimeDB standalone log did not include UniqueAlreadyExists",
          )

          const noSuchRow = yield* makeExampleSession
          yield* callReducerForLoggedHostFailure(
            noSuchRow.connection,
            wireFunction("thingForceUpdate"),
            {
              thingId: decodeThingId("missing-host-error-thing"),
              label: "missing",
              count: 1n,
            },
          )
          yield* waitForLiveServerLog(
            noSuchRow.live.logPath,
            "NoSuchRow",
            "SpaceTimeDB standalone log did not include NoSuchRow",
          )

          // The pinned host accepts explicit max-id rows without advancing the
          // ordinary table auto-increment sequence, so AutoIncOverflow remains
          // covered at the host-classification unit boundary.

          const schedule = yield* makeExampleSession
          yield* callReducerForLoggedHostFailure(
            schedule.connection,
            wireFunction("scheduleTooFar"),
            {
              note: "too far",
            },
          )
          yield* waitForLiveServerLog(
            schedule.live.logPath,
            "ScheduleAtDelayTooLong",
            "SpaceTimeDB standalone log did not include ScheduleAtDelayTooLong",
          )
        }),
      ),
    { timeout: LIVE_TEST_TIMEOUT_MS },
  )
})
