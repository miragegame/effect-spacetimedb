import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Duration from "effect/Duration"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as EffectVitest from "@effect/vitest"
const { describe, expect, live } = EffectVitest
import * as ExampleModuleFixture from "effect-spacetimedb/testing/example-module"
import { liveHarness, provideLiveTest } from "../helpers/live-harness"
import { waitForPredicate } from "../helpers/wait-for-predicate"
const {
  Example: Live,
  ExampleModule: LiveModule,
  UserId,
} = ExampleModuleFixture
const decodeUserId = Schema.decodeUnknownSync(UserId)
describe("effect-spacetimedb live event tables", () => {
  live(
    "treats event tables as insert-only streams instead of cached row relations",
    () =>
      provideLiveTest(
        Effect.gen(function* () {
          const live = yield* liveHarness
          const session = yield* Live.client.ws.scoped(
            live.makeWsConfig(LiveModule),
          )
          expect("presenceEvent" in (session.cache.tables as object)).toBe(
            false,
          )
          expect("eventTables" in (session.cache as object)).toBe(false)
          const eventsFiber = yield* session
            .streamEventTable("presenceEvent")
            .pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
          for (let attempt = 0; attempt < 100; attempt = attempt + 1) {
            if (eventsFiber.pollUnsafe() !== undefined) {
              break
            }
            yield* session.reducers.emitPresence({
              userId: decodeUserId("event-user-1"),
              kind: "joined",
            })
            yield* Effect.sleep(Duration.millis(100))
          }
          yield* waitForPredicate(
            () => eventsFiber.pollUnsafe() !== undefined,
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
    { timeout: 180_000 },
  )
})
