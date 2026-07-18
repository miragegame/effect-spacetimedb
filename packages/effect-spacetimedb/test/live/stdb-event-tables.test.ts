import * as EffectVitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Stream from "effect/Stream"

const { describe, expect, live } = EffectVitest

import {
  decodeUserId,
  LIVE_TEST_TIMEOUT_MS,
  makeExampleSession,
} from "./helpers/example-live"
import { provideLiveTest, waitForRows } from "./helpers/live-harness"

describe("effect-spacetimedb live event tables", () => {
  live(
    "treats event tables as insert-only streams instead of cached row relations",
    () =>
      provideLiveTest(
        Effect.gen(function* () {
          const { session } = yield* makeExampleSession
          expect("presenceEvent" in (session.cache.tables as object)).toBe(
            false,
          )
          expect("eventTables" in (session.cache as object)).toBe(false)
          const eventsFiber = yield* session
            .streamEventTable("presenceEvent")
            .pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
          yield* waitForRows(
            () =>
              Effect.gen(function* () {
                const poll = eventsFiber.pollUnsafe()
                if (poll !== undefined) {
                  return [poll]
                }
                yield* session.reducers.emitPresence({
                  userId: decodeUserId("event-user-1"),
                  kind: "joined",
                })
                return []
              }),
            (polls) => polls.length > 0,
            "live event table stream did not receive emitted event",
          )
          const events = yield* Fiber.join(eventsFiber)
          expect(events).toHaveLength(1)
          expect(events[0]).toMatchObject({
            row: {
              userId: decodeUserId("event-user-1"),
              kind: "joined",
            },
            context: {
              event: expect.anything(),
            },
          })
        }),
      ),
    { timeout: LIVE_TEST_TIMEOUT_MS },
  )
})
