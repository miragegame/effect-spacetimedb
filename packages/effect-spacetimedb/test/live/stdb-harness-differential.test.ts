/**
 * @module-tag local-only
 * @module-tag spacetimedb
 */

import * as EffectVitest from "@effect/vitest"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Match from "effect/Match"
import * as Ref from "effect/Ref"
import * as Result from "effect/Result"
import * as Stream from "effect/Stream"
import * as Stdb from "effect-spacetimedb"
import type { ReducerArgsFor } from "effect-spacetimedb"
import { StdbUniqueAlreadyExistsError } from "effect-spacetimedb/server"
import * as StdbTesting from "effect-spacetimedb/testing"
import { ExampleModuleBuilder as LiveModuleBuilder } from "effect-spacetimedb/testing/example-module"
import { Identity, Timestamp } from "spacetimedb"

const { describe, expect, live } = EffectVitest

import {
  decodeThingId,
  decodeUserId,
  CONVERGENCE_TIMEOUT_MS,
  LIVE_TEST_TIMEOUT_MS,
  Live,
  LiveModule,
  makeExampleSession,
  type ExampleLiveSession,
  wireFunction,
} from "./helpers/example-live"
import {
  callLiveProcedure,
  callLiveReducer,
  callLiveReducerExpectingRejection,
  liveCallErrorName,
  provideLiveTest,
  readLiveServerLog,
  sendLiveReducer,
  waitForLiveServerLog,
  waitForRows,
} from "./helpers/live-harness"

class HarnessRollbackProbe extends Data.TaggedError("HarnessRollbackProbe") {}

class HarnessCallableMissing extends Data.TaggedError(
  "HarnessCallableMissing",
) {}

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
  const idFirst = decodeThingId("differential-a")
  const idSecond = decodeThingId("differential-b")
  yield* harness.effectDb.thing.insert({
    id: idSecond,
    label: "second",
    count: 20n,
  })
  yield* harness.effectDb.thing.insert({
    id: idFirst,
    label: "first",
    count: 10n,
  })
  const found = yield* harness.effectDb.thing.id.find(idFirst)
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
    primaryKeyFound: found?.id === idFirst,
    rangeIds: ranged.map((row) => row.id),
    indexReplacementNote: replacement?.note,
    identityRangeLabels: identityRange.map((row) => row.label),
    timestampRangeLabels: timestampRange.map((row) => row.label),
    rolledBack,
  } satisfies ObservableOutcome
})

const liveOutcome = Effect.fn(function* ({
  connection,
  live,
  session,
}: ExampleLiveSession) {
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

  const idFirst = decodeThingId("differential-a")
  const idSecond = decodeThingId("differential-b")
  yield* callLiveReducer(connection, wireFunction("thingSet"), {
    thingId: idFirst,
    label: "first",
    count: 10n,
  })
  yield* callLiveReducer(connection, wireFunction("thingSet"), {
    thingId: idSecond,
    label: "second",
    count: 20n,
  })
  const found = yield* callLiveProcedure<
    | { readonly id: string; readonly label: string; readonly count: bigint }
    | undefined
  >(connection, wireFunction("thingGet"), { thingId: idFirst })
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
    primaryKeyFound: found?.id === idFirst,
    rangeIds: ranged.map((row) => row.id),
    indexReplacementNote: replacement?.note,
    identityRangeLabels,
    timestampRangeLabels,
    rolledBack,
  } satisfies ObservableOutcome
})

const harnessOptionalRangeOutcome = Effect.fn(function* () {
  const harness = StdbTesting.makeTestModuleHarness(LiveModule)
  yield* harness.effectDb.optionalRangeEntry.insert({
    id: 0n,
    rank: undefined,
    label: "unset",
  })
  yield* harness.effectDb.optionalRangeEntry.insert({
    id: 0n,
    rank: 1n,
    label: "set",
  })
  const rows =
    yield* harness.effectDb.optionalRangeEntry.optionalRangeEntryRankIdx.filterToArray(
      {
        from: { tag: "excluded", value: undefined },
        to: { tag: "unbounded" },
      },
    )
  return rows.map((row) => row.label)
})

const liveOptionalRangeOutcome = Effect.fn(function* ({
  connection,
}: ExampleLiveSession) {
  yield* callLiveReducer(connection, wireFunction("optionalRangeClear"), {})
  yield* callLiveReducer(connection, wireFunction("optionalRangeInsert"), {
    rank: undefined,
    label: "unset",
  })
  yield* callLiveReducer(connection, wireFunction("optionalRangeInsert"), {
    rank: 1n,
    label: "set",
  })
  return yield* callLiveProcedure<ReadonlyArray<string>>(
    connection,
    wireFunction("optionalRangeAfterUnset"),
    {},
  )
})

type ConstraintEntryRow = {
  readonly id: string
  readonly slug: string
  readonly tenantId: string
  readonly email: string
  readonly note: string
}

type ConstraintOutcome = {
  readonly singleColumnUpdateFailure: string
  readonly multiColumnUpdateFailure: string
  readonly failedUpdatesPreservedRow: boolean
  readonly caughtViolationCommittedMarker: boolean
}

const constraintEntryA: ConstraintEntryRow = {
  id: "constraint-a",
  slug: "shared-slug",
  tenantId: "shared-tenant",
  email: "shared@example.com",
  note: "first",
}

const constraintEntryB: ConstraintEntryRow = {
  id: "constraint-b",
  slug: "second-slug",
  tenantId: "second-tenant",
  email: "second@example.com",
  note: "second",
}

const harnessFailureName = (result: Result.Result<unknown, unknown>): string =>
  Result.match(result, {
    onFailure: (failure) =>
      StdbUniqueAlreadyExistsError.is(failure)
        ? "UniqueAlreadyExists"
        : failure instanceof Error
          ? failure.name
          : "UnknownFailure",
    onSuccess: () => "Success",
  })

const harnessConstraintOutcome = Effect.fn(function* () {
  const harness = StdbTesting.makeTestModuleHarness(LiveModule)
  yield* harness.effectDb.constraintEntry.insert(constraintEntryA)
  yield* harness.effectDb.constraintEntry.insert(constraintEntryB)

  const singleFailure = yield* harness.effectDb.constraintEntry.id
    .update({ ...constraintEntryB, slug: constraintEntryA.slug })
    .pipe(Effect.result)
  const multiFailure = yield* harness.effectDb.constraintEntry.id
    .update({
      ...constraintEntryB,
      tenantId: constraintEntryA.tenantId,
      email: constraintEntryA.email,
    })
    .pipe(Effect.result)

  const markerThingId = decodeThingId("constraint-partial-commit")
  const callables = StdbTesting.bindCallables(LiveModuleBuilder, {
    procedures: {
      constraintEntryConflictThenCommit: Effect.fn(function* ({
        id,
        slug,
        tenantId,
        email,
        note,
        markerThingId,
        markerLabel,
        markerCount,
      }: ReducerArgsFor<
        typeof LiveModuleBuilder,
        "constraintEntryConflictThenCommit"
      >) {
        const tx = yield* LiveModuleBuilder.Tx
        return yield* tx.run(
          Effect.gen(function* () {
            const db = yield* LiveModuleBuilder.Db
            yield* db.constraintEntry.id
              .update({ id, slug, tenantId, email, note })
              .pipe(
                Effect.catchTag("StdbUniqueAlreadyExistsError", () =>
                  db.thing
                    .insert({
                      id: markerThingId,
                      label: markerLabel,
                      count: markerCount,
                    })
                    .pipe(Effect.asVoid),
                ),
              )
          }),
        )
      }),
    },
  })
  callables.constraintEntryConflictThenCommit?.invoke(
    harness.makeProcedureCtx(),
    {
      ...constraintEntryB,
      slug: constraintEntryA.slug,
      markerThingId,
      markerLabel: "constraint conflict caught",
      markerCount: 1n,
    },
  )

  const after = yield* harness.effectDb.constraintEntry.id.find(
    constraintEntryB.id,
  )
  const committedMarker = yield* harness.effectDb.thing.id.find(markerThingId)
  return {
    singleColumnUpdateFailure: harnessFailureName(singleFailure),
    multiColumnUpdateFailure: harnessFailureName(multiFailure),
    failedUpdatesPreservedRow: after?.note === constraintEntryB.note,
    caughtViolationCommittedMarker: committedMarker !== undefined,
  } satisfies ConstraintOutcome
})

const classifyLiveUniqueUpdate = Effect.fn(function* (
  session: ExampleLiveSession,
  entry: ConstraintEntryRow,
) {
  const logOffset = (yield* readLiveServerLog(session.live.logPath)).length
  const cause = yield* callLiveReducerExpectingRejection(
    session.connection,
    wireFunction("constraintEntryUpdate"),
    entry,
  )
  expect(liveCallErrorName(cause)).toBe("InternalError")
  yield* waitForLiveServerLog(
    session.live.logPath,
    "UniqueAlreadyExists",
    "constraint update did not surface UniqueAlreadyExists in the live host error channel",
    { afterOffset: logOffset },
  )
  return "UniqueAlreadyExists" as const
})

const liveConstraintOutcome = Effect.fn(function* (
  session: ExampleLiveSession,
) {
  yield* callLiveReducer(
    session.connection,
    wireFunction("constraintEntryInsert"),
    constraintEntryA,
  )
  yield* callLiveReducer(
    session.connection,
    wireFunction("constraintEntryInsert"),
    constraintEntryB,
  )
  const singleColumnUpdateFailure = yield* classifyLiveUniqueUpdate(session, {
    ...constraintEntryB,
    slug: constraintEntryA.slug,
  })
  const multiColumnUpdateFailure = yield* classifyLiveUniqueUpdate(session, {
    ...constraintEntryB,
    tenantId: constraintEntryA.tenantId,
    email: constraintEntryA.email,
  })

  const markerThingId = decodeThingId("constraint-partial-commit")
  yield* callLiveProcedure(
    session.connection,
    wireFunction("constraintEntryConflictThenCommit"),
    {
      ...constraintEntryB,
      slug: constraintEntryA.slug,
      markerThingId,
      markerLabel: "constraint conflict caught",
      markerCount: 1n,
    },
  )
  const after = yield* callLiveProcedure<ConstraintEntryRow | undefined>(
    session.connection,
    wireFunction("constraintEntryGet"),
    { id: constraintEntryB.id },
  )
  const marker = yield* callLiveProcedure<
    | { readonly id: string; readonly label: string; readonly count: bigint }
    | undefined
  >(session.connection, wireFunction("thingGet"), { thingId: markerThingId })

  return {
    singleColumnUpdateFailure,
    multiColumnUpdateFailure,
    failedUpdatesPreservedRow: after?.note === constraintEntryB.note,
    caughtViolationCommittedMarker: marker !== undefined,
  } satisfies ConstraintOutcome
})

type RangeOutcome = {
  readonly emptyRangeLabels: ReadonlyArray<string>
  readonly exclusiveRangeLabels: ReadonlyArray<string>
  readonly prefixRangeNotes: ReadonlyArray<string>
  readonly reinsertedRangeLabels: ReadonlyArray<string>
  readonly extremeRangeLabels: ReadonlyArray<string>
}

const U64_MAX = (1n << 64n) - 1n

const harnessRangeOutcome = Effect.fn(function* () {
  const harness = StdbTesting.makeTestModuleHarness(LiveModule)
  const rows = [
    { id: decodeThingId("range-zero"), label: "zero", count: 0n },
    { id: decodeThingId("range-one"), label: "one", count: 1n },
    { id: decodeThingId("range-two"), label: "two", count: 2n },
    { id: decodeThingId("range-max"), label: "max", count: U64_MAX },
  ] as const
  yield* Effect.forEach(rows, harness.effectDb.thing.insert, {
    discard: true,
  })

  const emptyRange = yield* harness.effectDb.thing.thingCountIdx.filterToArray({
    from: { tag: "included", value: 2n },
    to: { tag: "included", value: 1n },
  })
  const exclusiveRange =
    yield* harness.effectDb.thing.thingCountIdx.filterToArray({
      from: { tag: "excluded", value: 0n },
      to: { tag: "excluded", value: 2n },
    })

  const tenantId = "range-tenant"
  yield* Effect.forEach(
    ["a", "b", "c", "d"],
    (suffix) =>
      harness.effectDb.uniqueMembership.insert({
        tenantId,
        email: `${suffix}@example.com`,
        note: suffix,
      }),
    { discard: true },
  )
  const prefixRange =
    yield* harness.effectDb.uniqueMembership.uniqueMembershipTenantEmailNoteIdx.filterToArray(
      {
        tenantId,
        email: {
          from: { tag: "excluded", value: "a@example.com" },
          to: { tag: "excluded", value: "d@example.com" },
        },
      },
    )

  yield* harness.effectDb.thing.id.delete(rows[1].id)
  yield* harness.effectDb.thing.insert({ ...rows[1], label: "one-reinserted" })
  const reinsertedRange =
    yield* harness.effectDb.thing.thingCountIdx.filterToArray(1n)
  const extremeRange =
    yield* harness.effectDb.thing.thingCountIdx.filterToArray({
      from: { tag: "included", value: 0n },
      to: { tag: "included", value: U64_MAX },
    })

  return {
    emptyRangeLabels: emptyRange.map((row) => row.label),
    exclusiveRangeLabels: exclusiveRange.map((row) => row.label),
    prefixRangeNotes: prefixRange.map((row) => row.note),
    reinsertedRangeLabels: reinsertedRange.map((row) => row.label),
    extremeRangeLabels: extremeRange.map((row) => row.label),
  } satisfies RangeOutcome
})

const liveRangeOutcome = Effect.fn(function* (session: ExampleLiveSession) {
  const rows = [
    { thingId: decodeThingId("range-zero"), label: "zero", count: 0n },
    { thingId: decodeThingId("range-one"), label: "one", count: 1n },
    { thingId: decodeThingId("range-two"), label: "two", count: 2n },
    { thingId: decodeThingId("range-max"), label: "max", count: U64_MAX },
  ] as const
  yield* callLiveReducer(session.connection, wireFunction("thingClear"), {})
  yield* Effect.forEach(
    rows,
    (row) => callLiveReducer(session.connection, wireFunction("thingSet"), row),
    { discard: true },
  )

  const emptyRange = yield* callLiveProcedure<
    ReadonlyArray<{ readonly label: string }>
  >(session.connection, wireFunction("thingByCountRange"), {
    lo: 2n,
    hi: 1n,
  })
  const exclusiveRange = yield* callLiveProcedure<
    ReadonlyArray<{ readonly label: string }>
  >(session.connection, wireFunction("thingByCountRangeExclusive"), {
    lo: 0n,
    hi: 2n,
  })

  const tenantId = "range-live-tenant"
  yield* Effect.forEach(
    ["a", "b", "c", "d"],
    (suffix) =>
      callLiveReducer(
        session.connection,
        wireFunction("membershipInsertStrict"),
        {
          tenantId,
          email: `${suffix}@example.com`,
          note: suffix,
        },
      ),
    { discard: true },
  )
  const prefixRange = yield* callLiveProcedure<
    ReadonlyArray<{ readonly note: string }>
  >(session.connection, wireFunction("membershipByTenantEmailRange"), {
    tenantId,
    emailLo: "a@example.com",
    emailHi: "d@example.com",
  })

  yield* callLiveReducer(session.connection, wireFunction("thingDelete"), {
    thingId: rows[1].thingId,
  })
  yield* callLiveReducer(session.connection, wireFunction("thingSet"), {
    ...rows[1],
    label: "one-reinserted",
  })
  const reinsertedRange = yield* callLiveProcedure<
    ReadonlyArray<{ readonly label: string }>
  >(session.connection, wireFunction("thingByCountExact"), { count: 1n })
  const extremeRange = yield* callLiveProcedure<
    ReadonlyArray<{ readonly label: string }>
  >(session.connection, wireFunction("thingByCountRange"), {
    lo: 0n,
    hi: U64_MAX,
  })

  return {
    emptyRangeLabels: emptyRange.map((row) => row.label),
    exclusiveRangeLabels: exclusiveRange.map((row) => row.label),
    prefixRangeNotes: prefixRange.map((row) => row.note),
    reinsertedRangeLabels: reinsertedRange.map((row) => row.label),
    extremeRangeLabels: extremeRange.map((row) => row.label),
  } satisfies RangeOutcome
})

type TransactionOutcome = {
  readonly rolledBackInsertAbsent: boolean
  readonly firstTransactionCommitted: boolean
  readonly secondTransactionRolledBack: boolean
}

const harnessTransactionOutcome = Effect.fn(function* () {
  const harness = StdbTesting.makeTestModuleHarness(LiveModule)
  const callables = StdbTesting.bindCallables(LiveModuleBuilder, {
    procedures: {
      thingInsertInTxThenAbort: Effect.fn(function* ({
        thingId,
        label,
        count,
      }: ReducerArgsFor<typeof LiveModuleBuilder, "thingInsertInTxThenAbort">) {
        const tx = yield* LiveModuleBuilder.Tx
        return yield* tx.run(
          Effect.gen(function* () {
            const db = yield* LiveModuleBuilder.Db
            yield* db.thing.insert({ id: thingId, label, count })
            return yield* new HarnessRollbackProbe()
          }),
        )
      }),
      thingInsertTwiceInTx: Effect.fn(function* ({
        firstThingId,
        firstLabel,
        firstCount,
        secondThingId,
        secondLabel,
        secondCount,
      }: ReducerArgsFor<typeof LiveModuleBuilder, "thingInsertTwiceInTx">) {
        const tx = yield* LiveModuleBuilder.Tx
        return yield* tx.run(
          Effect.gen(function* () {
            const db = yield* LiveModuleBuilder.Db
            yield* db.thing.insert({
              id: firstThingId,
              label: firstLabel,
              count: firstCount,
            })
            yield* db.thing.insert({
              id: secondThingId,
              label: secondLabel,
              count: secondCount,
            })
          }),
        )
      }),
    },
  })
  const abortTransaction = callables.thingInsertInTxThenAbort
  if (abortTransaction === undefined) {
    return yield* new HarnessCallableMissing()
  }
  const rollbackId = decodeThingId("procedure-rollback")
  yield* Effect.try({
    try: () =>
      abortTransaction.invoke(harness.makeProcedureCtx(), {
        thingId: rollbackId,
        label: "rolled back",
        count: 1n,
      }),
    catch: () => new HarnessRollbackProbe(),
  }).pipe(Effect.result)

  const committedId = decodeThingId("procedure-committed")
  const committedSecondId = decodeThingId("procedure-committed-second")
  callables.thingInsertTwiceInTx?.invoke(harness.makeProcedureCtx(), {
    firstThingId: committedId,
    firstLabel: "committed",
    firstCount: 2n,
    secondThingId: committedSecondId,
    secondLabel: "committed second",
    secondCount: 3n,
  })
  const partialRollbackId = decodeThingId("procedure-partial-rollback")
  yield* Effect.try({
    try: () =>
      abortTransaction.invoke(harness.makeProcedureCtx(), {
        thingId: partialRollbackId,
        label: "partial rollback",
        count: 4n,
      }),
    catch: () => new HarnessRollbackProbe(),
  }).pipe(Effect.result)

  const rolledBack = yield* harness.effectDb.thing.id.find(rollbackId)
  const committed = yield* harness.effectDb.thing.id.find(committedId)
  const committedSecond =
    yield* harness.effectDb.thing.id.find(committedSecondId)
  const partialRollback =
    yield* harness.effectDb.thing.id.find(partialRollbackId)
  return {
    rolledBackInsertAbsent: rolledBack === undefined,
    firstTransactionCommitted:
      committed !== undefined && committedSecond !== undefined,
    secondTransactionRolledBack: partialRollback === undefined,
  } satisfies TransactionOutcome
})

const liveTransactionOutcome = Effect.fn(function* (
  session: ExampleLiveSession,
) {
  yield* callLiveReducer(session.connection, wireFunction("thingClear"), {})
  const rollbackId = decodeThingId("procedure-rollback")
  yield* callLiveProcedure(
    session.connection,
    wireFunction("thingInsertInTxThenAbort"),
    { thingId: rollbackId, label: "rolled back", count: 1n },
  ).pipe(Effect.result)

  const committedId = decodeThingId("procedure-committed")
  const committedSecondId = decodeThingId("procedure-committed-second")
  yield* callLiveProcedure(
    session.connection,
    wireFunction("thingInsertTwiceInTx"),
    {
      firstThingId: committedId,
      firstLabel: "committed",
      firstCount: 2n,
      secondThingId: committedSecondId,
      secondLabel: "committed second",
      secondCount: 3n,
    },
  )
  const partialRollbackId = decodeThingId("procedure-partial-rollback")
  yield* callLiveProcedure(
    session.connection,
    wireFunction("thingInsertInTxThenAbort"),
    { thingId: partialRollbackId, label: "partial rollback", count: 4n },
  ).pipe(Effect.result)

  const find = (thingId: ReturnType<typeof decodeThingId>) =>
    callLiveProcedure(session.connection, wireFunction("thingGet"), {
      thingId,
    })
  const rolledBack = yield* find(rollbackId)
  const committed = yield* find(committedId)
  const committedSecond = yield* find(committedSecondId)
  const partialRollback = yield* find(partialRollbackId)
  return {
    rolledBackInsertAbsent: rolledBack === undefined,
    firstTransactionCommitted:
      committed !== undefined && committedSecond !== undefined,
    secondTransactionRolledBack: partialRollback === undefined,
  } satisfies TransactionOutcome
})

const DIFFERENTIAL_SCHEDULE_FIRE_BUDGET_MS = CONVERGENCE_TIMEOUT_MS

type ScheduleOutcome = {
  readonly insertedTargets: ReadonlyArray<string>
  readonly deleteRescheduleObserved: boolean
  readonly firedNotes: ReadonlyArray<string>
}

const harnessScheduleOutcome = Effect.fn(function* () {
  const harness = StdbTesting.makeTestModuleHarness(LiveModule)
  const initialReducer = yield* harness.effectDb.reducerSchedule.schedule({
    scheduledAt: Stdb.ScheduleAt.after(new Timestamp(1_000n), "1 second"),
    note: "schedule-reducer",
  })
  const procedure = yield* harness.effectDb.procedureSchedule.schedule({
    scheduledAt: Stdb.ScheduleAt.after(new Timestamp(1_000n), "1 second"),
    note: "schedule-procedure",
  })
  const insertedTargets = [
    ...(yield* harness.effectDb.reducerSchedule.toArray()).map(() => "reducer"),
    ...(yield* harness.effectDb.procedureSchedule.toArray()).map(
      () => "procedure",
    ),
  ].sort()

  const callables = StdbTesting.bindCallables(LiveModuleBuilder, {
    reducers: {
      reminderFireReducer: Effect.fn(function* ({
        data,
      }: ReducerArgsFor<typeof LiveModuleBuilder, "reminderFireReducer">) {
        const db = yield* LiveModuleBuilder.Db
        const ctx = yield* LiveModuleBuilder.MutationCtx
        yield* db.scheduledResult.insert({
          id: 0n,
          target: "reducer",
          note: data.note,
          sender: ctx.sender.toHexString(),
          identity: ctx.identity.toHexString(),
          databaseIdentity: ctx.databaseIdentity.toHexString(),
        })
      }),
    },
    procedures: {
      reminderFireProcedure: Effect.fn(function* ({
        data,
      }: {
        readonly data: { readonly note: string }
      }) {
        const tx = yield* LiveModuleBuilder.Tx
        return yield* tx.run(
          Effect.gen(function* () {
            const db = yield* LiveModuleBuilder.Db
            const ctx = yield* LiveModuleBuilder.MutationCtx
            yield* db.scheduledResult.insert({
              id: 0n,
              target: "procedure",
              note: data.note,
              sender: ctx.sender.toHexString(),
              identity: ctx.identity.toHexString(),
              databaseIdentity: ctx.databaseIdentity.toHexString(),
            })
          }),
        )
      }),
    },
  })
  callables.reminderFireReducer?.invoke(harness.makeMutationCtx(), {
    data: initialReducer,
  })
  const deleteCandidate = yield* harness.effectDb.reducerSchedule.schedule({
    scheduledAt: Stdb.ScheduleAt.after(new Timestamp(2_000n), "1000000 days"),
    note: "schedule-reducer-delete-candidate",
  })
  yield* harness.effectDb.reducerSchedule.scheduledId.delete(
    deleteCandidate.scheduledId,
  )
  const replacement = yield* harness.effectDb.reducerSchedule.schedule({
    scheduledAt: Stdb.ScheduleAt.after(new Timestamp(3_000n), "1 second"),
    note: "schedule-reducer-rescheduled",
  })
  callables.reminderFireReducer?.invoke(harness.makeMutationCtx(), {
    data: replacement,
  })
  callables.reminderFireProcedure?.invoke(harness.makeProcedureCtx(), {
    data: procedure,
  })
  const results = yield* harness.effectDb.scheduledResult.toArray()
  const deletedCandidate =
    yield* harness.effectDb.reducerSchedule.scheduledId.find(
      deleteCandidate.scheduledId,
    )
  return {
    insertedTargets,
    deleteRescheduleObserved:
      deletedCandidate === undefined &&
      results.filter((row) => row.note === replacement.note).length === 1 &&
      results.every((row) => row.note !== deleteCandidate.note),
    firedNotes: results.map((row) => row.note).sort(),
  } satisfies ScheduleOutcome
})

const liveScheduleOutcome = Effect.fn(function* (session: ExampleLiveSession) {
  yield* session.session
    .streamTable("reducerSchedule")
    .pipe(Stream.runDrain, Effect.forkScoped)
  yield* session.session
    .streamTable("procedureSchedule")
    .pipe(Stream.runDrain, Effect.forkScoped)
  yield* session.session
    .streamTable("scheduledResult")
    .pipe(Stream.runDrain, Effect.forkScoped)

  yield* sendLiveReducer(
    session.connection,
    wireFunction("scheduleReducerNote"),
    { note: "schedule-reducer" },
  )
  yield* sendLiveReducer(
    session.connection,
    wireFunction("scheduleProcedureNote"),
    { note: "schedule-procedure" },
  )
  const insertedTargets = yield* waitForRows(
    () =>
      Effect.all({
        reducer: session.session.cache.tables.reducerSchedule.toArray(),
        procedure: session.session.cache.tables.procedureSchedule.toArray(),
      }).pipe(
        Effect.map(({ reducer, procedure }) => [
          ...reducer
            .filter((row) => row.note === "schedule-reducer")
            .map(() => "reducer"),
          ...procedure
            .filter((row) => row.note === "schedule-procedure")
            .map(() => "procedure"),
        ]),
      ),
    (targets) => targets.length === 2,
    `schedule data rows did not appear within differential schedule-fire budget ${DIFFERENTIAL_SCHEDULE_FIRE_BUDGET_MS}ms`,
  )
  yield* waitForRows(
    () => session.session.cache.tables.scheduledResult.toArray(),
    (rows) =>
      rows.some((row) => row.note === "schedule-reducer") &&
      rows.some((row) => row.note === "schedule-procedure"),
    `initial schedule rows did not fire within differential schedule-fire budget ${DIFFERENTIAL_SCHEDULE_FIRE_BUDGET_MS}ms`,
  )

  const deleteCandidateNote = "schedule-reducer-delete-candidate"
  const replacementNote = "schedule-reducer-rescheduled"
  yield* sendLiveReducer(
    session.connection,
    wireFunction("scheduleDeleteCandidate"),
    { note: deleteCandidateNote },
  )
  yield* waitForRows(
    () => session.session.cache.tables.reducerSchedule.toArray(),
    (rows) => rows.some((row) => row.note === deleteCandidateNote),
    `delete candidate did not appear within differential schedule-fire budget ${DIFFERENTIAL_SCHEDULE_FIRE_BUDGET_MS}ms`,
  )
  yield* sendLiveReducer(
    session.connection,
    wireFunction("replaceScheduledReducerNote"),
    {
      existingNote: deleteCandidateNote,
      replacementNote,
    },
  )
  const replacementSchedules = yield* waitForRows(
    () => session.session.cache.tables.reducerSchedule.toArray(),
    (rows) =>
      rows.every((row) => row.note !== deleteCandidateNote) &&
      rows.filter((row) => row.note === replacementNote).length === 1,
    `delete-and-reschedule mutation did not converge within differential schedule-fire budget ${DIFFERENTIAL_SCHEDULE_FIRE_BUDGET_MS}ms`,
  )
  yield* waitForRows(
    () => session.session.cache.tables.reducerSchedule.toArray(),
    (rows) => rows.every((row) => row.note !== replacementNote),
    `rescheduled row did not fire exactly once within differential schedule-fire budget ${DIFFERENTIAL_SCHEDULE_FIRE_BUDGET_MS}ms`,
  )
  const results = yield* waitForRows(
    () => session.session.cache.tables.scheduledResult.toArray(),
    (rows) =>
      rows.filter((row) => row.note === replacementNote).length === 1 &&
      rows.every((row) => row.note !== deleteCandidateNote),
    `rescheduled result did not converge exactly once within differential schedule-fire budget ${DIFFERENTIAL_SCHEDULE_FIRE_BUDGET_MS}ms`,
  )
  return {
    insertedTargets: [...insertedTargets].sort(),
    deleteRescheduleObserved:
      replacementSchedules.every((row) => row.note !== deleteCandidateNote) &&
      replacementSchedules.filter((row) => row.note === replacementNote)
        .length === 1 &&
      results.filter((row) => row.note === replacementNote).length === 1 &&
      results.every((row) => row.note !== deleteCandidateNote),
    firedNotes: results
      .filter((row) => row.note.startsWith("schedule-"))
      .map((row) => row.note)
      .sort(),
  } satisfies ScheduleOutcome
})

type GenerativeOperation =
  | {
      readonly type: "insert"
      readonly suffix: string
      readonly count: bigint
    }
  | { readonly type: "update"; readonly count: bigint }
  | { readonly type: "delete" }
  | { readonly type: "unique-violating-insert" }
  | { readonly type: "primary-key-find" }
  | { readonly type: "range-read"; readonly lo: bigint; readonly hi: bigint }

const GENERATIVE_SEEDS = [
  0x1601, 0x1602, 0x1603, 0x1604, 0x1605, 0x1606,
] as const
const GENERATIVE_SEQUENCE_LENGTH = 20

const generativeOperations = (
  seed: number,
): ReadonlyArray<GenerativeOperation> => {
  let state = seed >>> 0
  const next = (): number => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    return state
  }
  const required: ReadonlyArray<GenerativeOperation> = [
    { type: "insert", suffix: "required", count: 1n },
    { type: "update", count: 2n },
    { type: "delete" },
    { type: "unique-violating-insert" },
    { type: "primary-key-find" },
    { type: "range-read", lo: 0n, hi: 10n },
  ]
  return [
    ...required,
    ...Array.from(
      { length: GENERATIVE_SEQUENCE_LENGTH - required.length },
      (_, offset): GenerativeOperation => {
        const index = offset + required.length
        const choice = next() % 6
        const count = BigInt(next() % 11)
        return Match.value(choice).pipe(
          Match.when(0, () => ({
            type: "insert" as const,
            suffix: `generated-${index.toString()}`,
            count,
          })),
          Match.when(1, () => ({ type: "update" as const, count })),
          Match.when(2, () => ({ type: "delete" as const })),
          Match.when(3, () => ({
            type: "unique-violating-insert" as const,
          })),
          Match.when(4, () => ({ type: "primary-key-find" as const })),
          Match.orElse(() => {
            const other = BigInt(next() % 11)
            return {
              type: "range-read" as const,
              lo: count < other ? count : other,
              hi: count < other ? other : count,
            }
          }),
        )
      },
    ),
  ]
}

type GenerativeProjection = {
  readonly membershipNote: string | undefined
  readonly things: ReadonlyArray<{
    readonly id: string
    readonly label: string
    readonly count: bigint
  }>
}

const normalizeGenerativeThings = (
  namespace: string,
  rows: ReadonlyArray<{
    readonly id: string
    readonly label: string
    readonly count: bigint
  }>,
): GenerativeProjection["things"] =>
  rows
    .filter((row) => row.id.startsWith(namespace))
    .map((row) => ({ id: row.id, label: row.label, count: row.count }))
    .sort((left, right) => left.id.localeCompare(right.id))

const makeHarnessGenerativeWorld = Effect.fn(function* (namespace: string) {
  const harness = StdbTesting.makeTestModuleHarness(LiveModule)
  const baseThingId = decodeThingId(`${namespace}-base`)
  const tenantId = `${namespace}-tenant`
  const email = `${namespace}@example.com`
  yield* harness.effectDb.thing.insert({
    id: baseThingId,
    label: "base",
    count: 0n,
  })
  yield* harness.effectDb.uniqueMembership.insert({
    tenantId,
    email,
    note: "base",
  })

  const apply = Effect.fn(function* (operation: GenerativeOperation) {
    return yield* Match.value(operation).pipe(
      Match.discriminatorsExhaustive("type")({
        insert: ({ suffix, count }) =>
          harness.effectDb.thing
            .insert({
              id: decodeThingId(`${namespace}-${suffix}`),
              label: suffix,
              count,
            })
            .pipe(Effect.as("ok" as const)),
        update: Effect.fn(function* ({ count }) {
          const current = yield* harness.effectDb.thing.id.find(baseThingId)
          const next = { id: baseThingId, label: "updated", count }
          yield* current === undefined
            ? harness.effectDb.thing.insert(next)
            : harness.effectDb.thing.id.update(next)
          return "ok" as const
        }),
        delete: () =>
          harness.effectDb.thing.id
            .delete(baseThingId)
            .pipe(Effect.as("ok" as const)),
        "unique-violating-insert": () =>
          harness.effectDb.uniqueMembership
            .insert({ tenantId, email, note: "duplicate" })
            .pipe(Effect.result, Effect.map(harnessFailureName)),
        "primary-key-find": () => harness.effectDb.thing.id.find(baseThingId),
        "range-read": ({ lo, hi }) =>
          harness.effectDb.thing.thingCountIdx
            .filterToArray({
              from: { tag: "included", value: lo },
              to: { tag: "included", value: hi },
            })
            .pipe(
              Effect.map((rows) => normalizeGenerativeThings(namespace, rows)),
            ),
      }),
    )
  })
  const project = Effect.fn(function* () {
    const membership =
      yield* harness.effectDb.uniqueMembership.uniqueMembershipEmailTenantIdx.find(
        { email, tenantId },
      )
    const things = yield* harness.effectDb.thing.toArray()
    return {
      membershipNote: membership?.note,
      things: normalizeGenerativeThings(namespace, things),
    } satisfies GenerativeProjection
  })
  return { apply, project }
})

const makeLiveGenerativeWorld = Effect.fn(function* (
  session: ExampleLiveSession,
  namespace: string,
) {
  const baseThingId = decodeThingId(`${namespace}-base`)
  const tenantId = `${namespace}-tenant`
  const email = `${namespace}@example.com`
  yield* callLiveReducer(session.connection, wireFunction("thingSet"), {
    thingId: baseThingId,
    label: "base",
    count: 0n,
  })
  yield* callLiveReducer(
    session.connection,
    wireFunction("membershipInsertStrict"),
    { tenantId, email, note: "base" },
  )

  const apply = Effect.fn(function* (operation: GenerativeOperation) {
    return yield* Match.value(operation).pipe(
      Match.discriminatorsExhaustive("type")({
        insert: ({ suffix, count }) =>
          callLiveReducer(session.connection, wireFunction("thingSet"), {
            thingId: decodeThingId(`${namespace}-${suffix}`),
            label: suffix,
            count,
          }).pipe(Effect.as("ok" as const)),
        update: ({ count }) =>
          callLiveReducer(session.connection, wireFunction("thingSet"), {
            thingId: baseThingId,
            label: "updated",
            count,
          }).pipe(Effect.as("ok" as const)),
        delete: () =>
          callLiveReducer(session.connection, wireFunction("thingDelete"), {
            thingId: baseThingId,
          }).pipe(Effect.as("ok" as const)),
        "unique-violating-insert": Effect.fn(function* () {
          const cause = yield* callLiveReducerExpectingRejection(
            session.connection,
            wireFunction("membershipInsertStrict"),
            { tenantId, email, note: "duplicate" },
          )
          expect(liveCallErrorName(cause)).toBe("InternalError")
          return "UniqueAlreadyExists"
        }),
        "primary-key-find": () =>
          callLiveProcedure(session.connection, wireFunction("thingGet"), {
            thingId: baseThingId,
          }),
        "range-read": ({ lo, hi }) =>
          callLiveProcedure<
            ReadonlyArray<{
              readonly id: string
              readonly label: string
              readonly count: bigint
            }>
          >(session.connection, wireFunction("thingByCountRange"), {
            lo,
            hi,
          }).pipe(
            Effect.map((rows) => normalizeGenerativeThings(namespace, rows)),
          ),
      }),
    )
  })
  const project = Effect.fn(function* () {
    const membership = yield* callLiveProcedure<
      | {
          readonly tenantId: string
          readonly email: string
          readonly note: string
        }
      | undefined
    >(session.connection, wireFunction("membershipGet"), { tenantId, email })
    const things = yield* callLiveProcedure<
      ReadonlyArray<{
        readonly id: string
        readonly label: string
        readonly count: bigint
      }>
    >(session.connection, wireFunction("thingList"), {})
    return {
      membershipNote: membership?.note,
      things: normalizeGenerativeThings(namespace, things),
    } satisfies GenerativeProjection
  })
  return { apply, project }
})

const runGenerativeDifferential = Effect.fn(function* (
  session: ExampleLiveSession,
) {
  // Optional-key range bounds are excluded by construction because their SATS
  // ordering divergence is pinned separately above.
  yield* Effect.forEach(
    GENERATIVE_SEEDS,
    Effect.fn(function* (seed) {
      const namespace = `gen-${seed.toString(16)}`
      const harness = yield* makeHarnessGenerativeWorld(namespace)
      const liveWorld = yield* makeLiveGenerativeWorld(session, namespace)
      yield* Effect.forEach(
        generativeOperations(seed),
        Effect.fn(function* (operation, index) {
          expect(
            yield* liveWorld.apply(operation),
            `seed=${seed.toString()} op=${index.toString()} normalized operation result`,
          ).toEqual(yield* harness.apply(operation))
          expect(
            yield* liveWorld.project(),
            `seed=${seed.toString()} op=${index.toString()} observable state projection`,
          ).toEqual(yield* harness.project())
        }),
        { discard: true },
      )
    }),
    { discard: true },
  )
})

const makeMemoizedDifferentialSession = Effect.fn(function* () {
  const bootCount = yield* Ref.make(0)
  const session = yield* Effect.cached(
    makeExampleSession.pipe(
      Effect.tap(() => Ref.update(bootCount, (count) => count + 1)),
    ),
  )
  return { bootCount, session }
})

describe("effect-spacetimedb test harness differential", () => {
  live(
    "matches the live engine across the differential behavior matrix",
    () =>
      provideLiveTest(
        Effect.gen(function* () {
          const memoized = yield* makeMemoizedDifferentialSession()
          const session = yield* memoized.session

          expect(yield* harnessOutcome()).toEqual(yield* liveOutcome(session))
          expect(yield* harnessOptionalRangeOutcome()).toEqual(
            yield* liveOptionalRangeOutcome(session),
          )
          expect(yield* harnessConstraintOutcome()).toEqual(
            yield* liveConstraintOutcome(session),
          )
          expect(yield* harnessRangeOutcome()).toEqual(
            yield* liveRangeOutcome(session),
          )
          expect(yield* harnessTransactionOutcome()).toEqual(
            yield* liveTransactionOutcome(session),
          )
          expect(yield* harnessScheduleOutcome()).toEqual(
            yield* liveScheduleOutcome(session),
          )
          yield* runGenerativeDifferential(session)

          expect(yield* memoized.session).toBe(session)
          expect(yield* Ref.get(memoized.bootCount)).toBe(1)
        }).pipe(Effect.scoped),
      ),
    LIVE_TEST_TIMEOUT_MS,
  )
})
