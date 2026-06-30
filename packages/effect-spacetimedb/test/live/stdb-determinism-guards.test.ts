/**
 * @module-tag local-only
 * @module-tag spacetimedb
 */

import * as EffectVitest from "@effect/vitest"
import * as Effect from "effect/Effect"

const { describe, expect, live } = EffectVitest

import {
  LIVE_TEST_TIMEOUT_MS,
  makeExampleSession,
  wireFunction,
} from "./helpers/example-live"
import {
  callLiveReducerExpectingRejection,
  liveCallErrorName,
  provideLiveTest,
  waitForLiveServerLog,
} from "./helpers/live-harness"

const callProbe = (name: Parameters<typeof wireFunction>[0], token: string) =>
  Effect.gen(function* () {
    const { connection, live } = yield* makeExampleSession
    const cause = yield* callLiveReducerExpectingRejection(
      connection,
      wireFunction(name),
      {},
    )
    expect(liveCallErrorName(cause)).toBe("InternalError")
    yield* waitForLiveServerLog(
      live.logPath,
      token,
      `SpaceTimeDB standalone log did not include ${token}`,
    )
  })

describe("effect-spacetimedb live determinism guards", () => {
  live(
    "rejects async, wall-clock, and global-random reducer work at runtime",
    () =>
      provideLiveTest(
        Effect.gen(function* () {
          yield* callProbe("probeAsync", "ReducerAsyncNotAllowedError")

          yield* callProbe("probeWallClock", "ReducerWallClockNotAllowedError")

          yield* callProbe("probeRandom", "ReducerGlobalRandomNotAllowedError")
        }),
      ),
    { timeout: LIVE_TEST_TIMEOUT_MS },
  )
})
