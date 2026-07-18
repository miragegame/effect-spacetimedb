import * as EffectVitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import { unsubscribeThen } from "effect-spacetimedb/client"
import { Identity, Timestamp } from "spacetimedb"

const { describe, expect, live } = EffectVitest

import {
  decodeThingId,
  decodeUserId,
  decodeUserName,
  LIVE_TEST_TIMEOUT_MS,
  Live,
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
          expect(session.cache.tables.user.count()).toBe(1n)
          expect(
            yield* session.cache.tables.user.id.find(
              decodeUserId("cache-user-1"),
            ),
          ).toEqual(initialRows[0])
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

          yield* session.subscribe(Live.targets.tables.thing)
          yield* callLiveReducer(connection, wireFunction("thingSet"), {
            thingId: decodeThingId("cache-range-a"),
            label: "range-a",
            count: 10n,
          })
          yield* callLiveReducer(connection, wireFunction("thingSet"), {
            thingId: decodeThingId("cache-range-b"),
            label: "range-b",
            count: 20n,
          })
          yield* session.waitUntil(
            "thing",
            (row) => row.id === decodeThingId("cache-range-b"),
          )
          const ranged = yield* session.cache.tables.thing.thingCountIdx.filter(
            {
              from: { tag: "included", value: 10n },
              to: { tag: "included", value: 20n },
            },
          )
          expect(ranged.map((row) => row.id).sort()).toEqual([
            decodeThingId("cache-range-a"),
            decodeThingId("cache-range-b"),
          ])

          yield* session.subscribe(Live.targets.tables.nativeRangeEntry)
          yield* callLiveReducer(
            connection,
            wireFunction("nativeRangeClear"),
            {},
          )
          yield* Effect.forEach(
            [
              [new Identity(10n), new Timestamp(1_000n), "native-first"],
              [new Identity(20n), new Timestamp(2_000n), "native-second"],
              [new Identity(30n), new Timestamp(3_000n), "native-third"],
            ] as const,
            ([owner, happenedAt, label]) =>
              callLiveReducer(connection, wireFunction("nativeRangeInsert"), {
                owner,
                happenedAt,
                label,
              }),
            { discard: true },
          )
          yield* session.waitUntil(
            "nativeRangeEntry",
            (row) => row.label === "native-third",
          )
          const timestampRows =
            yield* session.cache.tables.nativeRangeEntry.nativeRangeEntryHappenedAtIdx.filter(
              {
                from: { tag: "included", value: new Timestamp(1_000n) },
                to: { tag: "excluded", value: new Timestamp(3_000n) },
              },
            )
          expect(timestampRows.map((row) => row.label).sort()).toEqual([
            "native-first",
            "native-second",
          ])
          const identityRows =
            yield* session.cache.tables.nativeRangeEntry.nativeRangeEntryOwnerIdx.filter(
              {
                from: { tag: "excluded", value: new Identity(10n) },
                to: { tag: "included", value: new Identity(30n) },
              },
            )
          expect(identityRows.map((row) => row.label).sort()).toEqual([
            "native-second",
            "native-third",
          ])
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
  live(
    "awaits native unsubscribe completion and updates handle liveness",
    () =>
      provideLiveTest(
        Effect.gen(function* () {
          const { session } = yield* makeExampleSession
          const handle = yield* session.subscribe(Live.targets.tables.user)

          expect(handle.isActive()).toBe(true)
          expect(handle.isEnded()).toBe(false)
          yield* unsubscribeThen(handle)
          expect(handle.isActive()).toBe(false)
          expect(handle.isEnded()).toBe(true)
        }),
      ),
    { timeout: LIVE_TEST_TIMEOUT_MS },
  )
})
