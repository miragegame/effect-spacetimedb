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
  CONVERGENCE_TIMEOUT_MS,
  decodeThingId,
  decodeUserId,
  decodeUserName,
  LIVE_TEST_TIMEOUT_MS,
  LiveModule,
  makeExampleSession,
  wireFunction,
} from "./helpers/example-live"
import {
  callLiveReducer,
  type LiveConnection,
  liveHarness,
  provideLiveTest,
  type RelationHandle,
  waitForRows,
} from "./helpers/live-harness"
import { waitForPredicate } from "./helpers/wait-for-predicate"

class LiveViewRelationError extends Data.TaggedError("LiveViewRelationError")<{
  readonly cause: unknown
}> {}

class LiveViewSubscriptionError extends Data.TaggedError(
  "LiveViewSubscriptionError",
)<{
  readonly cause: unknown
}> {}

class LiveViewIdentityValueError extends Data.TaggedError(
  "LiveViewIdentityValueError",
)<{
  readonly value: unknown
}> {}

class LiveViewRelationMissing extends Data.TaggedError(
  "LiveViewRelationMissing",
)<{
  readonly key: string
}> {}

type ViewRow = Record<string, unknown>
type ViewRelation = RelationHandle<ViewRow, unknown>

type RawSqlSubscriptionBuilder = {
  readonly onApplied: (callback: () => void) => RawSqlSubscriptionBuilder
  readonly onError: (
    callback: (context: unknown, error?: Error) => void,
  ) => RawSqlSubscriptionBuilder
  readonly subscribe: (sql: string) => SubscriptionHandleLike
}

// SpaceTimeDB 2.5.0 includes this hint when rejecting private relation subscriptions.
const privateAuditLogPrivateViewHint = "it may be marked private"

const toHexString = Effect.fn(function* (value: unknown) {
  if (typeof value === "string") {
    return value
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "toHexString" in value &&
    typeof (value as { readonly toHexString: unknown }).toHexString ===
      "function"
  ) {
    return yield* Effect.try({
      try: () =>
        (value as { readonly toHexString: () => string }).toHexString(),
      catch: (cause) => new LiveViewRelationError({ cause }),
    })
  }

  return yield* new LiveViewIdentityValueError({ value })
})

const relationFor = Effect.fn(function* (
  connection: LiveConnection<typeof LiveModule>,
  key: string,
) {
  const relations = connection.db as Record<string, ViewRelation | undefined>
  const relation = relations[key]
  if (relation === undefined) {
    return yield* new LiveViewRelationMissing({ key })
  }
  return relation
})

const readViewRows = (
  connection: LiveConnection<typeof LiveModule>,
  key: string,
) =>
  relationFor(connection, key).pipe(
    Effect.flatMap((relation) =>
      Effect.try({
        try: () => Array.from(relation.iter()),
        catch: (cause) => new LiveViewRelationError({ cause }),
      }),
    ),
  )

const rawSqlSubscriptionBuilder = (
  connection: LiveConnection<typeof LiveModule>,
): RawSqlSubscriptionBuilder => {
  const builder = connection.subscriptionBuilder()
  const raw: RawSqlSubscriptionBuilder = {
    onApplied: (callback) => {
      builder.onApplied(callback)
      return raw
    },
    onError: (callback) => {
      builder.onError(callback)
      return raw
    },
    subscribe: (sql) => builder.subscribe(sql as never),
  }
  return raw
}

const subscribeViewSql = (
  connection: LiveConnection<typeof LiveModule>,
  sql: string,
) =>
  Effect.acquireRelease(
    Effect.try({
      try: () => {
        let applied = false
        let errorMessage: string | undefined
        const handle = rawSqlSubscriptionBuilder(connection)
          .onApplied(() => {
            applied = true
          })
          .onError((context, error) => {
            errorMessage = error?.message ?? String(context)
          })
          .subscribe(sql)
        return {
          applied: () => applied,
          errorMessage: () => errorMessage,
          handle,
        }
      },
      catch: (cause) => new LiveViewSubscriptionError({ cause }),
    }),
    ({ handle }) =>
      Effect.try({
        try: () => {
          handle.unsubscribe()
        },
        catch: (cause) => new LiveViewSubscriptionError({ cause }),
      }).pipe(Effect.orDie),
  )

describe("effect-spacetimedb live views", () => {
  live(
    "materializes allThings over a generated DbConnection SQL subscription",
    () =>
      provideLiveTest(
        Effect.gen(function* () {
          const live = yield* liveHarness
          const connection = yield* live.makeConnection(LiveModule)
          const thingId = decodeThingId("view-thing")
          yield* callLiveReducer(connection, wireFunction("thingSet"), {
            thingId,
            label: "View Thing",
            count: 11n,
          })
          const subscription = yield* subscribeViewSql(
            connection,
            "SELECT * FROM all_things",
          )
          const rows = yield* waitForRows(
            () => readViewRows(connection, "all_things"),
            (viewRows) => viewRows.some((row) => row.id === thingId),
          )

          expect(subscription.applied()).toBe(true)
          expect(subscription.errorMessage()).toBeUndefined()
          expect(rows).toContainEqual({
            id: thingId,
            label: "View Thing",
            count: 11n,
          })
        }),
      ),
    { timeout: LIVE_TEST_TIMEOUT_MS },
  )

  live(
    "materializes allUsers and allUsersQuery over generated view relations",
    () =>
      provideLiveTest(
        Effect.gen(function* () {
          const live = yield* liveHarness
          const connection = yield* live.makeConnection(LiveModule)
          const userId = decodeUserId("view-user")
          const name = decodeUserName("Grace")
          yield* callLiveReducer(connection, wireFunction("userUpsert"), {
            userId,
            name,
          })
          const allUsers = yield* subscribeViewSql(
            connection,
            "SELECT * FROM all_users",
          )
          const allUsersQuery = yield* subscribeViewSql(
            connection,
            "SELECT * FROM all_users_query",
          )
          const expected = {
            id: userId,
            name,
          }

          const rows = yield* waitForRows(
            () => readViewRows(connection, "all_users"),
            (viewRows) => viewRows.some((row) => row.id === userId),
          )
          const queryRows = yield* waitForRows(
            () => readViewRows(connection, "all_users_query"),
            (viewRows) => viewRows.some((row) => row.id === userId),
          )

          expect(allUsers.applied()).toBe(true)
          expect(allUsersQuery.applied()).toBe(true)
          expect(allUsers.errorMessage()).toBeUndefined()
          expect(allUsersQuery.errorMessage()).toBeUndefined()
          expect(rows).toContainEqual(expected)
          expect(queryRows).toContainEqual(expected)
        }),
      ),
    { timeout: LIVE_TEST_TIMEOUT_MS },
  )

  live(
    "materializes the sender-scoped selfUser view for the connection identity",
    () =>
      provideLiveTest(
        Effect.gen(function* () {
          const { session, connection } = yield* makeExampleSession
          const name = decodeUserName("Self View")
          yield* callLiveReducer(connection, wireFunction("seedSelfUser"), {
            name,
          })
          const subscription = yield* subscribeViewSql(
            connection,
            "SELECT * FROM self_user",
          )
          const rows = yield* waitForRows(
            () => readViewRows(connection, "self_user"),
            (viewRows) => viewRows.length === 1,
          )

          expect(subscription.applied()).toBe(true)
          expect(subscription.errorMessage()).toBeUndefined()
          const identityUserId = decodeUserId(
            yield* toHexString(session.identity),
          )
          expect(rows).toEqual([
            {
              id: identityUserId,
              name,
            },
          ])
        }),
      ),
    { timeout: LIVE_TEST_TIMEOUT_MS },
  )

  live(
    "does not anonymously populate the privateAuditLog view",
    () =>
      provideLiveTest(
        Effect.gen(function* () {
          const live = yield* liveHarness
          const connection = yield* live.makeAnonymousConnection(LiveModule)
          const subscription = yield* subscribeViewSql(
            connection,
            "SELECT * FROM private_audit_log",
          )

          yield* waitForPredicate(
            () =>
              subscription
                .errorMessage()
                ?.includes(privateAuditLogPrivateViewHint) === true,
            "private audit log view subscription was not rejected as private",
            CONVERGENCE_TIMEOUT_MS,
          )
          expect(yield* readViewRows(connection, "private_audit_log")).toEqual(
            [],
          )
        }),
      ),
    { timeout: LIVE_TEST_TIMEOUT_MS },
  )

  live(
    "allows the owner to subscribe to the privateAuditLog view",
    () =>
      provideLiveTest(
        Effect.gen(function* () {
          const live = yield* liveHarness
          const connection = yield* live.makeConnection(LiveModule)
          const subscription = yield* subscribeViewSql(
            connection,
            "SELECT * FROM private_audit_log",
          )

          yield* waitForPredicate(
            () => subscription.applied(),
            "private audit log owner subscription was not applied",
            CONVERGENCE_TIMEOUT_MS,
          )
          expect(subscription.applied()).toBe(true)
          expect(subscription.errorMessage()).toBeUndefined()
          expect(yield* readViewRows(connection, "private_audit_log")).toEqual(
            [],
          )
        }),
      ),
    { timeout: LIVE_TEST_TIMEOUT_MS },
  )
})
