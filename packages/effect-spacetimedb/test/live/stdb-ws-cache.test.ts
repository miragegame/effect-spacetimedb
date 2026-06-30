import * as EffectVitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"

const { describe, expect, live } = EffectVitest

import {
  decodeUserId,
  decodeUserName,
  LIVE_TEST_TIMEOUT_MS,
  makeExampleSession,
  wireFunction,
} from "./helpers/example-live"
import {
  callLiveReducer,
  provideLiveTest,
  waitForRows,
} from "./helpers/live-harness"

describe("effect-spacetimedb live ws cache", () => {
  live(
    "keeps row ownership on the connection cache and populates it only after subscription",
    () =>
      provideLiveTest(
        Effect.gen(function* () {
          const { live, session, connection } = yield* makeExampleSession
          expect(session.token).toBe(live.token)
          expect(session.identity).toBeDefined()
          yield* callLiveReducer(connection, wireFunction("userUpsert"), {
            userId: decodeUserId("cache-user-1"),
            name: decodeUserName("Ada"),
          })
          expect(yield* session.cache.tables.user.toArray()).toEqual([])
          yield* session
            .streamTable("user")
            .pipe(Stream.runDrain, Effect.forkScoped)
          const initialRows = yield* waitForRows(
            () => session.cache.tables.user.toArray(),
            (rows) => rows.length === 1,
          )
          expect(initialRows).toEqual([
            {
              id: decodeUserId("cache-user-1"),
              name: decodeUserName("Ada"),
            },
          ])
          yield* callLiveReducer(connection, wireFunction("userUpsert"), {
            userId: decodeUserId("cache-user-2"),
            name: decodeUserName("Grace"),
          })
          const updatedRows = yield* waitForRows(
            () => session.cache.tables.user.toArray(),
            (rows) => rows.length === 2,
          )
          expect(
            updatedRows.some(
              (row) =>
                row.id === decodeUserId("cache-user-2") &&
                row.name === decodeUserName("Grace"),
            ),
          ).toBe(true)
        }),
      ),
    { timeout: LIVE_TEST_TIMEOUT_MS },
  )
  live(
    "exposes live table snapshots through subscription refs",
    () =>
      provideLiveTest(
        Effect.gen(function* () {
          const { session, connection } = yield* makeExampleSession

          yield* callLiveReducer(connection, wireFunction("userUpsert"), {
            userId: decodeUserId("cache-ref-user-1"),
            name: decodeUserName("Margaret"),
          })
          const ref = yield* session.subscribeTableRef("user")
          const firstRows = yield* waitForRows(
            () =>
              SubscriptionRef.get(ref).pipe(
                Effect.map((result) =>
                  AsyncResult.isSuccess(result) ? result.value : [],
                ),
              ),
            (rows) =>
              rows.some(
                (row) =>
                  row.id === decodeUserId("cache-ref-user-1") &&
                  row.name === decodeUserName("Margaret"),
              ),
          )
          expect(
            firstRows.some(
              (row) =>
                row.id === decodeUserId("cache-ref-user-1") &&
                row.name === decodeUserName("Margaret"),
            ),
          ).toBe(true)

          yield* callLiveReducer(connection, wireFunction("userUpsert"), {
            userId: decodeUserId("cache-ref-user-2"),
            name: decodeUserName("Evelyn"),
          })
          const updatedRows = yield* waitForRows(
            () =>
              SubscriptionRef.get(ref).pipe(
                Effect.map((result) =>
                  AsyncResult.isSuccess(result) ? result.value : [],
                ),
              ),
            (rows) =>
              rows.some(
                (row) =>
                  row.id === decodeUserId("cache-ref-user-2") &&
                  row.name === decodeUserName("Evelyn"),
              ),
          )
          expect(
            updatedRows.some(
              (row) =>
                row.id === decodeUserId("cache-ref-user-2") &&
                row.name === decodeUserName("Evelyn"),
            ),
          ).toBe(true)
        }),
      ),
    { timeout: LIVE_TEST_TIMEOUT_MS },
  )
})
