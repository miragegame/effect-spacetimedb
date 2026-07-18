/**
 * @module-tag local-only
 * @module-tag spacetimedb
 */

import * as EffectVitest from "@effect/vitest"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Result from "effect/Result"
import * as Stream from "effect/Stream"
import type { ReducerArgsFor } from "effect-spacetimedb"
import { StdbUniqueAlreadyExistsError } from "effect-spacetimedb/server"
import * as StdbTesting from "effect-spacetimedb/testing"
import { ExampleModuleBuilder as LiveModuleBuilder } from "effect-spacetimedb/testing/example-module"
import { Identity, Timestamp } from "spacetimedb"

const { describe, expect, live } = EffectVitest

import {
  decodeThingId,
  decodeUserId,
  LIVE_TEST_TIMEOUT_MS,
  Live,
  LiveModule,
  makeExampleSession,
  wireFunction,
} from "./helpers/example-live"
import {
  callLiveProcedure,
  callLiveReducer,
  callLiveReducerExpectingRejection,
  provideLiveTest,
  waitForLiveServerLog,
  waitForRows,
} from "./helpers/live-harness"

class HarnessRollbackProbe extends Data.TaggedError("HarnessRollbackProbe") {}

type ObservableOutcome = {
  readonly autoIncremented: boolean
  readonly uniqueFailureName: string | undefined
  readonly eventCleared: boolean
  readonly primaryKeyFound: boolean
  readonly rangeIds: ReadonlyArray<string>
  readonly indexReplacementNote: string | undefined
  readonly identityRangeLabels: ReadonlyArray<string>
  readonly timestampRangeLabels: ReadonlyArray<string>
  readonly rolledBack: boolean
}

const harnessOutcome = Effect.fn(function* () {
  const harness = StdbTesting.makeTestModuleHarness(LiveModule)
  const audit = yield* harness.effectDb.auditLog.insert({
    id: 0n,
    kind: "init",
    subject: "differential",
  })
  yield* harness.effectDb.uniqueMembership.insert({
    tenantId: "differential-tenant",
    email: "differential@example.com",
    note: "first",
  })
  const duplicate = yield* harness.effectDb.uniqueMembership
    .insert({
      tenantId: "differential-tenant",
      email: "differential@example.com",
      note: "duplicate",
    })
    .pipe(Effect.result)
  const firstId = decodeThingId("differential-a")
  const secondId = decodeThingId("differential-b")
  yield* harness.effectDb.thing.insert({
    id: secondId,
    label: "second",
    count: 20n,
  })
  yield* harness.effectDb.thing.insert({
    id: firstId,
    label: "first",
    count: 10n,
  })
  const found = yield* harness.effectDb.thing.id.find(firstId)
  const ranged = yield* harness.effectDb.thing.thingCountIdx.filterToArray({
    from: { tag: "included", value: 10n },
    to: { tag: "included", value: 20n },
  })
  yield* harness.effectDb.uniqueMembership.uniqueMembershipEmailTenantIdx.delete(
    {
      email: "differential@example.com",
      tenantId: "differential-tenant",
    },
  )
  yield* harness.effectDb.uniqueMembership.insert({
    tenantId: "differential-tenant",
    email: "differential@example.com",
    note: "replacement",
  })
  const replacement =
    yield* harness.effectDb.uniqueMembership.uniqueMembershipEmailTenantIdx.find(
      {
        email: "differential@example.com",
        tenantId: "differential-tenant",
      },
    )

  yield* harness.effectDb.nativeRangeEntry.insert({
    id: 0n,
    owner: new Identity(30n),
    happenedAt: new Timestamp(3_000n),
    label: "third",
  })
  yield* harness.effectDb.nativeRangeEntry.insert({
    id: 0n,
    owner: new Identity(10n),
    happenedAt: new Timestamp(1_000n),
    label: "first",
  })
  yield* harness.effectDb.nativeRangeEntry.insert({
    id: 0n,
    owner: new Identity(20n),
    happenedAt: new Timestamp(2_000n),
    label: "second",
  })
  const identityRange =
    yield* harness.effectDb.nativeRangeEntry.nativeRangeEntryOwnerIdx.filterToArray(
      {
        from: { tag: "included", value: new Identity(10n) },
        to: { tag: "excluded", value: new Identity(30n) },
      },
    )
  const timestampRange =
    yield* harness.effectDb.nativeRangeEntry.nativeRangeEntryHappenedAtIdx.filterToArray(
      {
        from: { tag: "excluded", value: new Timestamp(1_000n) },
        to: { tag: "included", value: new Timestamp(3_000n) },
      },
    )
  const rollbackId = decodeThingId("differential-rollback")
  const callables = StdbTesting.bindCallables(LiveModuleBuilder, {
    reducers: {
      thingInsertThenAbort: Effect.fn(function* ({
        thingId,
        label,
        count,
      }: ReducerArgsFor<typeof LiveModuleBuilder, "thingInsertThenAbort">) {
        const db = yield* LiveModuleBuilder.Db
        yield* db.thing.insert({ id: thingId, label, count })
        return yield* new HarnessRollbackProbe()
      }),
      emitPresence: Effect.fn(function* ({
        userId,
        kind,
      }: ReducerArgsFor<typeof LiveModuleBuilder, "emitPresence">) {
        const db = yield* LiveModuleBuilder.Db
        yield* db.presenceEvent.insert({ userId, kind })
      }),
    },
  })
  callables.emitPresence?.invoke(harness.makeMutationCtx(), {
    userId: decodeUserId("differential-event-user"),
    kind: "joined",
  })
  const eventCleared = harness.db.presenceEvent.count() === 0n
  yield* Effect.try({
    try: () =>
      callables.thingInsertThenAbort?.invoke(harness.makeMutationCtx(), {
        thingId: rollbackId,
        label: "rollback",
        count: 30n,
      }),
    catch: () => new HarnessRollbackProbe(),
  }).pipe(Effect.exit)
  const rolledBack =
    (yield* harness.effectDb.thing.id.find(rollbackId)) === undefined

  return {
    autoIncremented: audit.id !== undefined && audit.id > 0n,
    uniqueFailureName:
      Result.isFailure(duplicate) &&
      duplicate.failure instanceof StdbUniqueAlreadyExistsError
        ? "UniqueAlreadyExists"
        : Result.isFailure(duplicate)
          ? duplicate.failure.name
          : undefined,
    eventCleared,
    primaryKeyFound: found?.id === firstId,
    rangeIds: ranged.map((row) => row.id),
    indexReplacementNote: replacement?.note,
    identityRangeLabels: identityRange.map((row) => row.label),
    timestampRangeLabels: timestampRange.map((row) => row.label),
    rolledBack,
  } satisfies ObservableOutcome
})

const liveOutcome = Effect.fn(function* () {
  const { connection, live, session } = yield* makeExampleSession
  yield* session.subscribe(Live.targets.tables.auditLog)
  const auditRows = yield* session.waitUntil("auditLog", () => true, {
    timeout: "5 seconds",
  })
  yield* callLiveReducer(connection, wireFunction("thingClear"), {})
  yield* callLiveReducer(connection, wireFunction("nativeRangeClear"), {})

  const tenantId = "differential-live-tenant"
  const email = "differential-live@example.com"
  yield* callLiveReducer(connection, wireFunction("membershipInsertStrict"), {
    tenantId,
    email,
    note: "first",
  })
  yield* callLiveReducerExpectingRejection(
    connection,
    wireFunction("membershipInsertStrict"),
    { tenantId, email, note: "duplicate" },
  )
  yield* waitForLiveServerLog(
    live.logPath,
    "UniqueAlreadyExists",
    "differential unique failure was not classified by the live host",
  )

  const eventFiber = yield* session
    .streamEventTable("presenceEvent")
    .pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
  yield* waitForRows(
    () =>
      Effect.gen(function* () {
        const poll = eventFiber.pollUnsafe()
        if (poll !== undefined) return [poll]
        yield* session.reducers.emitPresence({
          userId: decodeUserId("differential-event-user"),
          kind: "joined",
        })
        return []
      }),
    (polls) => polls.length > 0,
    "differential event table did not emit",
  )
  const events = yield* Fiber.join(eventFiber)
  const persistedEventCount = yield* callLiveProcedure<bigint>(
    connection,
    wireFunction("presenceEventCount"),
    {},
  )
  const eventCleared = events.length === 1 && persistedEventCount === 0n

  const firstId = decodeThingId("differential-a")
  const secondId = decodeThingId("differential-b")
  yield* callLiveReducer(connection, wireFunction("thingSet"), {
    thingId: firstId,
    label: "first",
    count: 10n,
  })
  yield* callLiveReducer(connection, wireFunction("thingSet"), {
    thingId: secondId,
    label: "second",
    count: 20n,
  })
  const found = yield* callLiveProcedure<
    | { readonly id: string; readonly label: string; readonly count: bigint }
    | undefined
  >(connection, wireFunction("thingGet"), { thingId: firstId })
  const ranged = yield* callLiveProcedure<
    ReadonlyArray<{
      readonly id: string
      readonly label: string
      readonly count: bigint
    }>
  >(connection, wireFunction("thingByCountRange"), { lo: 10n, hi: 20n })

  yield* callLiveReducer(connection, wireFunction("membershipUpsert"), {
    tenantId,
    email,
    note: "replacement",
  })
  const replacement = yield* callLiveProcedure<
    | {
        readonly tenantId: string
        readonly email: string
        readonly note: string
      }
    | undefined
  >(connection, wireFunction("membershipGet"), { tenantId, email })

  yield* Effect.forEach(
    [
      [new Identity(30n), new Timestamp(3_000n), "third"],
      [new Identity(10n), new Timestamp(1_000n), "first"],
      [new Identity(20n), new Timestamp(2_000n), "second"],
    ] as const,
    ([owner, happenedAt, label]) =>
      callLiveReducer(connection, wireFunction("nativeRangeInsert"), {
        owner,
        happenedAt,
        label,
      }),
    { discard: true },
  )
  const identityRangeLabels = yield* callLiveProcedure<ReadonlyArray<string>>(
    connection,
    wireFunction("nativeRangeByOwner"),
    { lo: new Identity(10n), hi: new Identity(30n) },
  )
  const timestampRangeLabels = yield* callLiveProcedure<ReadonlyArray<string>>(
    connection,
    wireFunction("nativeRangeByTimestamp"),
    {
      lo: new Timestamp(1_000n),
      hi: new Timestamp(3_000n),
    },
  )

  const rollbackId = decodeThingId("differential-rollback")
  yield* callLiveReducer(connection, wireFunction("thingInsertThenAbort"), {
    thingId: rollbackId,
    label: "rollback",
    count: 30n,
  }).pipe(Effect.exit)
  const rolledBack =
    (yield* callLiveProcedure(connection, wireFunction("thingGet"), {
      thingId: rollbackId,
    })) === undefined

  return {
    autoIncremented: auditRows.every(
      (row) => row.id !== undefined && row.id > 0n,
    ),
    uniqueFailureName: "UniqueAlreadyExists",
    eventCleared,
    primaryKeyFound: found?.id === firstId,
    rangeIds: ranged.map((row) => row.id),
    indexReplacementNote: replacement?.note,
    identityRangeLabels,
    timestampRangeLabels,
    rolledBack,
  } satisfies ObservableOutcome
})

describe("effect-spacetimedb test harness differential", () => {
  live(
    "matches representative host-observable database behavior",
    () =>
      provideLiveTest(
        Effect.gen(function* () {
          expect(yield* harnessOutcome()).toEqual(yield* liveOutcome())
        }),
      ),
    LIVE_TEST_TIMEOUT_MS,
  )
})
