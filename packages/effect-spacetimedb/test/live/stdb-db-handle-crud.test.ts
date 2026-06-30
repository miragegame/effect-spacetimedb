/**
 * @module-tag local-only
 * @module-tag spacetimedb
 */

import * as EffectVitest from "@effect/vitest"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"

const { describe, expect, live } = EffectVitest

import type { SubscriptionHandleLike } from "effect-spacetimedb/testing"
import {
  decodeThingId,
  decodeUserId,
  decodeUserName,
  LIVE_TEST_TIMEOUT_MS,
  LiveModule,
  makeExampleSession,
  type UserRow,
  wireFunction,
} from "./helpers/example-live"
import {
  callLiveProcedure,
  callLiveReducer,
  type LiveConnection,
  provideLiveTest,
  waitForRows,
} from "./helpers/live-harness"

type ThingRow = {
  readonly id: string
  readonly label: string
  readonly count: bigint
}

type Relation<Row> = {
  readonly iter: () => Iterable<Row>
}

class LiveCrudRelationMissing extends Data.TaggedError(
  "LiveCrudRelationMissing",
)<{
  readonly key: string
}> {}

class LiveCrudRelationError extends Data.TaggedError("LiveCrudRelationError")<{
  readonly cause: unknown
}> {}

class LiveCrudSubscriptionError extends Data.TaggedError(
  "LiveCrudSubscriptionError",
)<{
  readonly cause: unknown
}> {}

const relationFor = <Row>(
  connection: LiveConnection<typeof LiveModule>,
  key: string,
) =>
  Effect.gen(function* () {
    const relation = (
      connection.db as Record<string, Relation<Row> | undefined>
    )[key]
    if (relation === undefined) {
      return yield* new LiveCrudRelationMissing({ key })
    }
    return relation
  })

const relationRows = <Row>(
  connection: LiveConnection<typeof LiveModule>,
  key: string,
) =>
  relationFor<Row>(connection, key).pipe(
    Effect.flatMap((relation) =>
      Effect.try({
        try: () => Array.from(relation.iter()),
        catch: (cause) => new LiveCrudRelationError({ cause }),
      }),
    ),
  )

const subscribeSql = (
  connection: LiveConnection<typeof LiveModule>,
  sql: string,
) =>
  Effect.try({
    try: (): SubscriptionHandleLike =>
      connection
        .subscriptionBuilder()
        .onError(() => undefined)
        .subscribe(sql as never),
    catch: (cause) => new LiveCrudSubscriptionError({ cause }),
  })

describe("effect-spacetimedb live db-handle CRUD", () => {
  live(
    "exercises table CRUD, count, iter, clear, indexes, and unique happy path against a live host",
    () =>
      provideLiveTest(
        Effect.gen(function* () {
          const { connection, session } = yield* makeExampleSession
          const thingSubscription = yield* subscribeSql(
            connection,
            "SELECT * FROM thing",
          )
          const allThingsSubscription = yield* subscribeSql(
            connection,
            "SELECT * FROM all_things",
          )

          yield* callLiveReducer(connection, wireFunction("thingClear"), {})
          yield* waitForRows(
            () => relationRows<ThingRow>(connection, "thing"),
            (rows) => rows.length === 0,
            "thing table did not clear before CRUD assertions",
          )

          const thingId = decodeThingId("crud-thing")
          yield* callLiveReducer(connection, wireFunction("thingSet"), {
            thingId,
            label: "inserted",
            count: 10n,
          })
          yield* waitForRows(
            () => relationRows<ThingRow>(connection, "thing"),
            (rows) =>
              rows.some(
                (row) =>
                  row.id === thingId &&
                  row.label === "inserted" &&
                  row.count === 10n,
              ),
            "thing insert did not converge through the table cache",
          )

          yield* callLiveReducer(connection, wireFunction("thingSet"), {
            thingId,
            label: "updated",
            count: 15n,
          })
          yield* waitForRows(
            () => relationRows<ThingRow>(connection, "thing"),
            (rows) =>
              rows.some(
                (row) =>
                  row.id === thingId &&
                  row.label === "updated" &&
                  row.count === 15n,
              ),
            "thing update did not converge through the table cache",
          )

          const secondThingId = decodeThingId("crud-thing-second")
          yield* callLiveReducer(connection, wireFunction("thingSet"), {
            thingId: secondThingId,
            label: "second",
            count: 20n,
          })
          const found = yield* callLiveProcedure<ThingRow | undefined>(
            connection,
            wireFunction("thingGet"),
            {
              thingId,
            },
          )
          expect(found).toEqual({
            id: thingId,
            label: "updated",
            count: 15n,
          })

          const userId = decodeUserId("crud-user")
          yield* callLiveReducer(connection, wireFunction("userUpsert"), {
            userId,
            name: decodeUserName("Crud User"),
          })
          yield* session.reducers.userRequire({ userId })
          const users = yield* session.procedures.userGet({ userId })
          expect(users).toEqual({
            id: userId,
            name: decodeUserName("Crud User"),
          } satisfies UserRow)

          const count = yield* callLiveProcedure<bigint>(
            connection,
            wireFunction("thingCount"),
            {},
          )
          expect(count).toBe(2n)
          const listed = yield* callLiveProcedure<ReadonlyArray<ThingRow>>(
            connection,
            wireFunction("thingList"),
            {},
          )
          expect(listed.map((row) => row.id).sort()).toEqual(
            [secondThingId, thingId].sort(),
          )

          const exact = yield* callLiveProcedure<ReadonlyArray<ThingRow>>(
            connection,
            wireFunction("thingByCountExact"),
            {
              count: 15n,
            },
          )
          expect(exact.map((row) => row.id)).toEqual([thingId])
          const ranged = yield* callLiveProcedure<ReadonlyArray<ThingRow>>(
            connection,
            wireFunction("thingByCountRange"),
            {
              lo: 10n,
              hi: 20n,
            },
          )
          expect(ranged.map((row) => row.id).sort()).toEqual(
            [secondThingId, thingId].sort(),
          )

          yield* waitForRows(
            () => relationRows<ThingRow>(connection, "all_things"),
            (rows) =>
              rows.some((row) => row.id === thingId) &&
              rows.some((row) => row.id === secondThingId),
            "allThings view did not converge with iterated thing rows",
          )

          yield* callLiveReducer(connection, wireFunction("membershipUpsert"), {
            tenantId: "crud-tenant",
            email: "crud@example.com",
            note: "first",
          })
          yield* callLiveReducer(connection, wireFunction("membershipUpsert"), {
            tenantId: "crud-tenant",
            email: "crud@example.com",
            note: "second",
          })
          const membership = yield* callLiveProcedure<
            | {
                readonly tenantId: string
                readonly email: string
                readonly note: string
              }
            | undefined
          >(connection, wireFunction("membershipGet"), {
            tenantId: "crud-tenant",
            email: "crud@example.com",
          })
          expect(membership).toEqual({
            tenantId: "crud-tenant",
            email: "crud@example.com",
            note: "second",
          })

          yield* callLiveReducer(connection, wireFunction("thingDelete"), {
            thingId,
          })
          yield* waitForRows(
            () => relationRows<ThingRow>(connection, "thing"),
            (rows) => !rows.some((row) => row.id === thingId),
            "thing delete did not converge through the table cache",
          )
          yield* callLiveReducer(connection, wireFunction("thingClear"), {})
          yield* waitForRows(
            () => relationRows<ThingRow>(connection, "thing"),
            (rows) => rows.length === 0,
            "thing clear did not converge through the table cache",
          )

          thingSubscription.unsubscribe()
          allThingsSubscription.unsubscribe()
        }),
      ),
    { timeout: LIVE_TEST_TIMEOUT_MS },
  )
})
