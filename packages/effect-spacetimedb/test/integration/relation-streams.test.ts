
import * as EffectVitest from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Queue from "effect/Queue"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as TestClock from "effect/testing/TestClock"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"
import { Identity } from "spacetimedb"

const { describe, expect, it } = EffectVitest

import * as Stdb from "effect-spacetimedb"
import {
  canonicalRowKey,
  canonicalTableGroupKey,
  canonicalTableKey,
  canonicalValueKey,
  connectAndSubscribe,
  subscribeRowRef as subscribeRawRowRef,
  type RowRefValue,
} from "effect-spacetimedb/client"
import {
  rowAtomFamily,
  tableAtomFamily,
  tableGroupAtomFamily,
} from "effect-spacetimedb/client/atom"
import * as StdbTesting from "effect-spacetimedb/testing"
import { FullModule, UserId, UserName } from "../fixtures/full-module"
import type { SdkEventContext } from "../helpers/sdk-event-oracle"
import {
  errorContext,
  reducerErr,
  reducerInfo,
  reducerInternalError,
  reducerOk,
  reducerOkEmpty,
  StableTimestamp,
  reducerContext as sdkReducerContext,
  subscribeAppliedContext,
  transactionContext,
  unsubscribeAppliedContext,
} from "../helpers/sdk-event-oracle"
import { makeFullModuleWsDb } from "../helpers/ws-fixtures"

const Full = Stdb.project(FullModule)

type UnknownEventContext = {
  readonly event: {
    readonly tag: "UnknownNativeEvent"
  }
}
type EventContext = SdkEventContext | UnknownEventContext
type UserRow = StdbTesting.TableRow<typeof FullModule.tables.user>
type PresenceRow = StdbTesting.TableRow<typeof FullModule.tables.presenceEvent>
type RawUserRow = StdbTesting.ClientWs.WsTableRow<typeof FullModule.tables.user>
type RawPresenceRow = StdbTesting.ClientWs.WsTableRow<
  typeof FullModule.tables.presenceEvent
>
const decodeUserId = Schema.decodeUnknownSync(UserId)
const decodeUserName = Schema.decodeUnknownSync(UserName)
const reducerContext = (name: string): EventContext =>
  sdkReducerContext({
    outcome: reducerOk(),
    reducer: reducerInfo(name),
  })
const rawUserRow = (id: string, name: string): RawUserRow => ({
  id: decodeUserId(id),
  name: decodeUserName(name),
})
const rawPresenceRow = (
  userId: string,
  kind: "joined" | "left",
): RawPresenceRow => ({
  userId: decodeUserId(userId),
  kind: {
    tag: kind,
  },
})
const groupUser = Stdb.table("groupUser", {
  public: true,
  columns: {
    id: Stdb.string(UserId).primaryKey(),
    name: Stdb.string(UserName),
  },
})
const groupFriend = Stdb.table("groupFriend", {
  public: true,
  columns: {
    id: Stdb.string(UserId).primaryKey(),
    name: Stdb.string(UserName),
  },
})
const GroupModule = Stdb.StdbModule.make("grouped", {}).addTables(
  groupUser,
  groupFriend,
).spec
type RawGroupUserRow = StdbTesting.ClientWs.WsTableRow<
  typeof GroupModule.tables.groupUser
>
type RawGroupFriendRow = StdbTesting.ClientWs.WsTableRow<
  typeof GroupModule.tables.groupFriend
>
const rawGroupUserRow = (id: string, name: string): RawGroupUserRow =>
  rawUserRow(id, name) as unknown as RawGroupUserRow
const rawGroupFriendRow = (id: string, name: string): RawGroupFriendRow =>
  rawUserRow(id, name) as unknown as RawGroupFriendRow
const makeRelation = <Row, Ctx>() => {
  let insertCallback: ((ctx: Ctx, row: Row) => void) | undefined
  let deleteCallback: ((ctx: Ctx, row: Row) => void) | undefined
  let updateCallback: ((ctx: Ctx, oldRow: Row, newRow: Row) => void) | undefined
  const emptyRows: Array<Row> = []
  return {
    handle: {
      onInsert: (callback: (ctx: Ctx, row: Row) => void) => {
        insertCallback = callback
      },
      removeOnInsert: (callback: (ctx: Ctx, row: Row) => void) => {
        if (insertCallback === callback) {
          insertCallback = undefined
        }
      },
      onDelete: (callback: (ctx: Ctx, row: Row) => void) => {
        deleteCallback = callback
      },
      removeOnDelete: (callback: (ctx: Ctx, row: Row) => void) => {
        if (deleteCallback === callback) {
          deleteCallback = undefined
        }
      },
      onUpdate: (callback: (ctx: Ctx, oldRow: Row, newRow: Row) => void) => {
        updateCallback = callback
      },
      removeOnUpdate: (
        callback: (ctx: Ctx, oldRow: Row, newRow: Row) => void,
      ) => {
        if (updateCallback === callback) {
          updateCallback = undefined
        }
      },
      iter: () => emptyRows.values(),
      count: () => BigInt(emptyRows.length),
    },
    emitInsert: (ctx: Ctx, row: Row) => {
      insertCallback?.(ctx, row)
    },
    emitDelete: (ctx: Ctx, row: Row) => {
      deleteCallback?.(ctx, row)
    },
    emitUpdate: (ctx: Ctx, oldRow: Row, newRow: Row) => {
      updateCallback?.(ctx, oldRow, newRow)
    },
  }
}
const makeSnapshotRelation = <Row, Ctx>(initialRows: ReadonlyArray<Row>) => {
  const relation = makeRelation<Row, Ctx>()
  let rows = Array.from(initialRows)

  return {
    ...relation,
    handle: {
      ...relation.handle,
      iter: () => rows.values(),
      count: () => BigInt(rows.length),
    },
    replaceRows: (nextRows: ReadonlyArray<Row>) => {
      rows = Array.from(nextRows)
    },
  }
}
const awaitRefState = <A>(
  ref: SubscriptionRef.SubscriptionRef<A>,
  predicate: (value: A) => boolean,
) =>
  SubscriptionRef.changes(ref).pipe(
    Stream.filter(predicate),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
  )
const takeFromQueueUntil = <A>(
  queue: Queue.Queue<A>,
  predicate: (value: A) => boolean,
): Effect.Effect<A> =>
  Effect.suspend(function loop(): Effect.Effect<A> {
    return Queue.take(queue).pipe(
      Effect.flatMap((value) =>
        predicate(value) ? Effect.succeed(value) : loop(),
      ),
    )
  })
const makeConnection = (
  userRelation: ReturnType<
    typeof makeRelation<RawUserRow, EventContext>
  >["handle"],
  eventRelation: ReturnType<
    typeof makeRelation<RawPresenceRow, EventContext>
  >["handle"],
) => {
  let onApplied: (() => void) | undefined
  let onError: ((context: unknown, error?: Error) => void) | undefined
  let subscribeCalls = 0
  let unsubscribed = false
  const firstSubscribeStarted = Deferred.makeUnsafe<void>()
  const builder = {
    onApplied: (callback: () => void) => {
      onApplied = callback
      return builder
    },
    onError: (callback: (context: unknown, error?: Error) => void) => {
      onError = callback
      return builder
    },
    subscribe: (_query: unknown) => {
      subscribeCalls = subscribeCalls + 1
      if (subscribeCalls === 1) {
        Deferred.doneUnsafe(firstSubscribeStarted, Effect.void)
      }
      return {
        isEnded: () => unsubscribed,
        unsubscribe: () => {
          unsubscribed = true
        },
      }
    },
  }
  return {
    connection: {
      db: makeFullModuleWsDb<EventContext>({
        user: userRelation,
        presenceEvent: eventRelation,
      }),
      subscriptionBuilder: () => builder,
    },
    applySubscription: () => {
      onApplied?.()
    },
    failSubscription: (context: unknown, error?: Error) => {
      onError?.(context, error)
    },
    awaitSubscribeCalls: Effect.fn(function* (count: 1) {
      yield* Deferred.await(firstSubscribeStarted)
      yield* Effect.yieldNow
      expect(subscribeCalls).toBe(count)
    }),
    subscribeCalls: () => subscribeCalls,
    unsubscribed: () => unsubscribed,
  }
}
const makeClient = (
  userRelation: ReturnType<
    typeof makeRelation<RawUserRow, EventContext>
  >["handle"],
  eventRelation: ReturnType<
    typeof makeRelation<RawPresenceRow, EventContext>
  >["handle"],
) => {
  const connection = makeConnection(userRelation, eventRelation)
  return {
    ...connection,
    client: StdbTesting.ClientWs.make({
      module: FullModule,
      connection: connection.connection,
    }),
  }
}
const collectBlockedUserInsertIds = Effect.fn(function* (params: {
  readonly client: ReturnType<typeof makeClient>["client"]
  readonly userRelation: ReturnType<
    typeof makeRelation<RawUserRow, EventContext>
  >
  readonly applySubscription: () => void
  readonly awaitSubscribeCalls: (count: 1) => Effect.Effect<void>
  readonly streamOptions?: StdbTesting.ClientWs.WsStreamOptions
  readonly rows: ReadonlyArray<{
    readonly id: string
    readonly name: string
  }>
  readonly subscriptionMessage: string
  readonly take: number
}) {
  const firstChangeSeen = yield* Deferred.make<void>()
  const releaseFirstChange = yield* Deferred.make<void>()
  let firstChangeBlocked = false
  const stream =
    params.streamOptions === undefined
      ? params.client.streamTable("user")
      : params.client.streamTable("user", params.streamOptions)
  const changesFiber = yield* stream.pipe(
    Stream.tap(() => {
      if (firstChangeBlocked) {
        return Effect.void
      }
      firstChangeBlocked = true
      return Deferred.succeed(firstChangeSeen, undefined).pipe(
        Effect.andThen(Deferred.await(releaseFirstChange)),
      )
    }),
    Stream.take(params.take),
    Stream.runCollect,
    Effect.forkScoped,
  )
  yield* params.awaitSubscribeCalls(1)
  params.applySubscription()
  const [firstRow, ...queuedRows] = params.rows
  if (firstRow != null) {
    params.userRelation.emitInsert(
      reducerContext("userUpsert"),
      rawUserRow(firstRow.id, firstRow.name),
    )
  }
  yield* Deferred.await(firstChangeSeen)
  yield* Effect.forEach(queuedRows, (row) =>
    Effect.try({
      try: () =>
        params.userRelation.emitInsert(
          reducerContext("userUpsert"),
          rawUserRow(row.id, row.name),
        ),
      catch: (cause) => new StdbTesting.SubscriptionTransportError({ cause }),
    }),
  )
  yield* Deferred.succeed(releaseFirstChange, undefined)
  const changes = Array.from(yield* Fiber.join(changesFiber))
  return changes.map((change) =>
    Predicate.isTagged(change, "Insert") ? change.row.id : undefined,
  )
})

const collectBlockedUserOverflowExit = Effect.fn(function* (params: {
  readonly client: ReturnType<typeof makeClient>["client"]
  readonly userRelation: ReturnType<
    typeof makeRelation<RawUserRow, EventContext>
  >
  readonly applySubscription: () => void
  readonly awaitSubscribeCalls: (count: 1) => Effect.Effect<void>
  readonly streamOptions?: StdbTesting.ClientWs.WsStreamOptions
  readonly eventCount: number
}) {
  const firstChangeSeen = yield* Deferred.make<void>()
  const releaseFirstChange = yield* Deferred.make<void>()
  let firstChangeBlocked = false
  const stream =
    params.streamOptions === undefined
      ? params.client.streamTable("user")
      : params.client.streamTable("user", params.streamOptions)
  const fiber = yield* stream.pipe(
    Stream.tap(() => {
      if (firstChangeBlocked) {
        return Effect.void
      }
      firstChangeBlocked = true
      return Deferred.succeed(firstChangeSeen, undefined).pipe(
        Effect.andThen(Deferred.await(releaseFirstChange)),
      )
    }),
    Stream.runDrain,
    Effect.exit,
    Effect.forkScoped,
  )
  yield* params.awaitSubscribeCalls(1)
  params.applySubscription()
  params.userRelation.emitInsert(
    reducerContext("userUpsert"),
    rawUserRow("user-0", "Seed"),
  )
  yield* Deferred.await(firstChangeSeen)
  for (let index = 1; index <= params.eventCount; index = index + 1) {
    params.userRelation.emitInsert(
      reducerContext("userUpsert"),
      rawUserRow(`user-${index.toString()}`, `User ${index.toString()}`),
    )
  }
  yield* Deferred.succeed(releaseFirstChange, undefined)
  return yield* Fiber.join(fiber)
})
const collectBlockedPresenceEventOverflowExit = Effect.fn(function* (params: {
  readonly client: ReturnType<typeof makeClient>["client"]
  readonly eventRelation: ReturnType<
    typeof makeRelation<RawPresenceRow, EventContext>
  >
  readonly applySubscription: () => void
  readonly awaitSubscribeCalls: (count: 1) => Effect.Effect<void>
  readonly rows: ReadonlyArray<{
    readonly userId: string
    readonly kind: "joined" | "left"
  }>
  readonly streamOptions?: StdbTesting.ClientWs.WsStreamOptions
  readonly subscriptionMessage?: string
}) {
  const firstEventSeen = yield* Deferred.make<void>()
  const releaseFirstEvent = yield* Deferred.make<void>()
  let firstEventBlocked = false
  const stream =
    params.streamOptions === undefined
      ? params.client.streamEventTable("presenceEvent")
      : params.client.streamEventTable("presenceEvent", params.streamOptions)
  const eventsFiber = yield* stream.pipe(
    Stream.tap(() => {
      if (firstEventBlocked) {
        return Effect.void
      }
      firstEventBlocked = true
      return Deferred.succeed(firstEventSeen, undefined).pipe(
        Effect.andThen(Deferred.await(releaseFirstEvent)),
      )
    }),
    Stream.runCollect,
    Effect.exit,
    Effect.forkScoped,
  )
  yield* params.awaitSubscribeCalls(1)
  params.applySubscription()
  const [firstRow, ...queuedRows] = params.rows
  if (firstRow != null) {
    params.eventRelation.emitInsert(
      reducerContext("presenceEmit"),
      rawPresenceRow(firstRow.userId, firstRow.kind),
    )
  }
  yield* Deferred.await(firstEventSeen)
  yield* Effect.forEach(queuedRows, (row) =>
    Effect.try({
      try: () =>
        params.eventRelation.emitInsert(
          reducerContext("presenceEmit"),
          rawPresenceRow(row.userId, row.kind),
        ),
      catch: (cause) => new StdbTesting.SubscriptionTransportError({ cause }),
    }),
  )
  yield* Deferred.succeed(releaseFirstEvent, undefined)
  return yield* Fiber.join(eventsFiber)
})

const expectEventTableOverflowFailure = (
  exit: Exit.Exit<unknown, unknown>,
  bufferSize: number,
) => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (!Exit.isFailure(exit)) {
    throw new Error("Expected event-table overflow failure")
  }

  const failure = exit.cause.pipe(Cause.findErrorOption, Option.getOrUndefined)
  expect(failure).toBeInstanceOf(StdbTesting.SubscriptionTransportError)
  if (failure instanceof StdbTesting.SubscriptionTransportError) {
    expect(failure.cause).toBeInstanceOf(
      StdbTesting.EventTableStreamOverflowError,
    )
    if (failure.cause instanceof StdbTesting.EventTableStreamOverflowError) {
      expect(failure.cause.bufferSize).toBe(bufferSize)
    }
  }
}

const expectTableOverflowFailure = (
  exit: Exit.Exit<unknown, unknown>,
  bufferSize: number,
) => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (!Exit.isFailure(exit)) {
    throw new Error("Expected table overflow failure")
  }
  const failure = exit.cause.pipe(Cause.findErrorOption, Option.getOrUndefined)
  expect(failure).toBeInstanceOf(StdbTesting.SubscriptionTransportError)
  if (failure instanceof StdbTesting.SubscriptionTransportError) {
    expect(failure.cause).toBeInstanceOf(StdbTesting.TableStreamOverflowError)
    if (failure.cause instanceof StdbTesting.TableStreamOverflowError) {
      expect(failure.cause.bufferSize).toBe(bufferSize)
    }
  }
}
describe("relation streams", () => {
  it.effect(
    "streamRows emits the initial decoded snapshot and re-reads after deltas",
    () =>
      Effect.gen(function* () {
        const initialUser = rawUserRow("user-0", "Seed")
        const userRelation = makeSnapshotRelation<RawUserRow, EventContext>([
          rawUserRow("stale", "Pre-subscription"),
        ])
        const eventRelation = makeRelation<RawPresenceRow, EventContext>()
        const { client, applySubscription, awaitSubscribeCalls } = makeClient(
          userRelation.handle,
          eventRelation.handle,
        )
        const snapshotsFiber = yield* client
          .streamRows("user")
          .pipe(Stream.take(2), Stream.runCollect, Effect.forkScoped)

        yield* awaitSubscribeCalls(1)
        yield* Effect.yieldNow
        expect(snapshotsFiber.pollUnsafe()).toBeUndefined()
        userRelation.replaceRows([initialUser])
        applySubscription()
        yield* Effect.yieldNow
        userRelation.replaceRows([
          initialUser,
          rawUserRow("user-1", "Ada Lovelace"),
        ])
        userRelation.emitInsert(
          reducerContext("userUpsert"),
          rawUserRow("user-1", "Ada"),
        )

        expect(Array.from(yield* Fiber.join(snapshotsFiber))).toEqual([
          [
            {
              id: "user-0",
              name: "Seed",
            },
          ],
          [
            {
              id: "user-0",
              name: "Seed",
            },
            {
              id: "user-1",
              name: "Ada Lovelace",
            },
          ],
        ])
      }).pipe(Effect.scoped),
  )
  it.effect(
    "subscribeTableRef seeds from the applied snapshot instead of the pre-applied cache",
    () =>
      Effect.gen(function* () {
        const userRelation = makeSnapshotRelation<RawUserRow, EventContext>([])
        const eventRelation = makeRelation<RawPresenceRow, EventContext>()
        const { client, applySubscription, awaitSubscribeCalls } = makeClient(
          userRelation.handle,
          eventRelation.handle,
        )
        const ref = yield* client.subscribeTableRef("user")
        const valuesFiber = yield* SubscriptionRef.changes(ref).pipe(
          Stream.take(2),
          Stream.runCollect,
          Effect.forkScoped,
        )

        yield* awaitSubscribeCalls(1)
        userRelation.emitInsert(
          reducerContext("userUpsert"),
          rawUserRow("user-pre-applied", "Ignored"),
        )
        yield* Effect.yieldNow
        userRelation.replaceRows([rawUserRow("user-1", "Ada Lovelace")])
        applySubscription()

        const values = Array.from(yield* Fiber.join(valuesFiber))
        expect(AsyncResult.isInitial(values[0]!)).toBe(true)
        expect(values[1]).toMatchObject({
          _tag: "Success",
          value: [{ id: "user-1", name: "Ada Lovelace" }],
        })
      }).pipe(Effect.scoped),
  )
  it.effect(
    "subscribeTableRef stores post-applied failures in the ref value",
    () =>
      Effect.gen(function* () {
        const userRelation = makeSnapshotRelation<RawUserRow, EventContext>([])
        const eventRelation = makeRelation<RawPresenceRow, EventContext>()
        const {
          client,
          applySubscription,
          failSubscription,
          awaitSubscribeCalls,
        } = makeClient(userRelation.handle, eventRelation.handle)
        const ref = yield* client.subscribeTableRef("user")

        yield* awaitSubscribeCalls(1)
        applySubscription()
        failSubscription("connection lost", new Error("connection lost"))
        yield* awaitRefState(ref, AsyncResult.isFailure)

        expect(AsyncResult.isFailure(SubscriptionRef.getUnsafe(ref))).toBe(true)
      }).pipe(Effect.scoped),
  )
  it.effect("row refs publish predicate defects as failures", () =>
    Effect.gen(function* () {
      const tableRef = yield* SubscriptionRef.make<
        AsyncResult.AsyncResult<ReadonlyArray<{ readonly id: string }>, never>
      >(AsyncResult.initial())
      const rowRef = yield* subscribeRawRowRef({
        table: Effect.succeed(tableRef),
        predicate: () => {
          throw new Error("predicate defect")
        },
      })

      yield* SubscriptionRef.set(
        tableRef,
        AsyncResult.success([{ id: "user-1" }]),
      )
      const failure = yield* awaitRefState(rowRef, AsyncResult.isFailure)
      expect(AsyncResult.isFailure(failure)).toBe(true)
    }).pipe(Effect.scoped),
  )

  it.effect("table-group refs publish aggregation defects as failures", () =>
    Effect.gen(function* () {
      const userRelation = makeSnapshotRelation<RawUserRow, EventContext>([])
      const eventRelation = makeRelation<RawPresenceRow, EventContext>()
      const { client, applySubscription, awaitSubscribeCalls } = makeClient(
        userRelation.handle,
        eventRelation.handle,
      )
      const tableRef = yield* client.subscribeTableRef("user")
      const groupRef = yield* client.subscribeTableGroupRef(["user"] as const)

      yield* awaitSubscribeCalls(1)
      applySubscription()
      yield* Effect.all([
        awaitRefState(tableRef, AsyncResult.isSuccess),
        awaitRefState(groupRef, AsyncResult.isSuccess),
      ])

      const malicious = AsyncResult.success<ReadonlyArray<UserRow>, never>([])
      Object.defineProperty(malicious, "value", {
        configurable: true,
        get: () => {
          throw new Error("group aggregation defect")
        },
      })
      yield* SubscriptionRef.set(tableRef, malicious)

      const failure = yield* awaitRefState(groupRef, AsyncResult.isFailure)
      expect(AsyncResult.isFailure(failure)).toBe(true)
    }).pipe(Effect.scoped),
  )
  it.effect("same-table row refs share one table subscription", () =>
    Effect.gen(function* () {
      const userRelation = makeSnapshotRelation<RawUserRow, EventContext>([])
      const eventRelation = makeRelation<RawPresenceRow, EventContext>()
      const { client, applySubscription, awaitSubscribeCalls, subscribeCalls } =
        makeClient(userRelation.handle, eventRelation.handle)
      const adaRef = yield* client.subscribeRowRef(
        "user",
        decodeUserId("user-1"),
      )
      const graceRef = yield* client.subscribeRowRef(
        "user",
        decodeUserId("user-2"),
      )

      yield* awaitSubscribeCalls(1)
      userRelation.replaceRows([
        rawUserRow("user-1", "Ada"),
        rawUserRow("user-2", "Grace"),
      ])
      applySubscription()
      yield* Effect.all([
        awaitRefState(adaRef, AsyncResult.isSuccess),
        awaitRefState(graceRef, AsyncResult.isSuccess),
      ])
      expect(subscribeCalls()).toBe(1)

      const ada = adaRef.pipe(SubscriptionRef.getUnsafe)
      const grace = graceRef.pipe(SubscriptionRef.getUnsafe)
      expect(AsyncResult.isSuccess(ada)).toBe(true)
      expect(AsyncResult.isSuccess(grace)).toBe(true)
      if (AsyncResult.isSuccess(ada)) {
        expect(Option.getOrUndefined(ada.value)).toEqual({
          id: "user-1",
          name: "Ada",
        })
      }
      if (AsyncResult.isSuccess(grace)) {
        expect(Option.getOrUndefined(grace.value)).toEqual({
          id: "user-2",
          name: "Grace",
        })
      }
    }).pipe(Effect.scoped),
  )
  it.effect("table refs and table group refs share table subscriptions", () =>
    Effect.gen(function* () {
      const userRelation = makeSnapshotRelation<RawUserRow, EventContext>([])
      const eventRelation = makeRelation<RawPresenceRow, EventContext>()
      const { client, applySubscription, awaitSubscribeCalls, subscribeCalls } =
        makeClient(userRelation.handle, eventRelation.handle)
      const tableRef = yield* client.subscribeTableRef("user")
      const groupRef = yield* client.subscribeTableGroupRef(["user"] as const)

      yield* awaitSubscribeCalls(1)
      userRelation.replaceRows([rawUserRow("user-1", "Ada")])
      applySubscription()
      yield* Effect.all([
        awaitRefState(tableRef, AsyncResult.isSuccess),
        awaitRefState(groupRef, AsyncResult.isSuccess),
      ])
      expect(subscribeCalls()).toBe(1)

      const table = tableRef.pipe(SubscriptionRef.getUnsafe)
      const group = groupRef.pipe(SubscriptionRef.getUnsafe)
      expect(AsyncResult.isSuccess(table)).toBe(true)
      expect(AsyncResult.isSuccess(group)).toBe(true)
      if (AsyncResult.isSuccess(table)) {
        expect(table.value).toEqual([
          {
            id: "user-1",
            name: "Ada",
          },
        ])
      }
      if (AsyncResult.isSuccess(group)) {
        expect(group.value).toEqual({
          user: [
            {
              id: "user-1",
              name: "Ada",
            },
          ],
        })
      }
    }).pipe(Effect.scoped),
  )
  it("canonical subscription keys distinguish structured values", () => {
    expect(canonicalValueKey(["x", "y"])).not.toBe(
      canonicalValueKey(["x,string:y"]),
    )
    expect(canonicalValueKey({ b: [2], a: 1 })).toBe(
      canonicalValueKey({ a: 1, b: [2] }),
    )
    expect(canonicalTableKey("module:table", "key")).not.toBe(
      canonicalTableKey("module", "table:key"),
    )
    expect(canonicalRowKey("module", "row:key", "value")).not.toBe(
      canonicalRowKey("module:row", "key", "value"),
    )
    expect(canonicalTableGroupKey("module", ["a|b", "c"])).not.toBe(
      canonicalTableGroupKey("module", ["a", "b|c"]),
    )
    expect(() => canonicalValueKey(Symbol("unsupported"))).toThrow(TypeError)
  })
  it("atom families dedupe canonical binary row and sorted group keys", () => {
    const userRelation = makeSnapshotRelation<RawUserRow, EventContext>([])
    const eventRelation = makeRelation<RawPresenceRow, EventContext>()
    const { client } = makeClient(userRelation.handle, eventRelation.handle)
    const rows = rowAtomFamily<typeof FullModule>(client)
    const tables = tableAtomFamily<typeof FullModule>(client)
    const groupClient = StdbTesting.ClientWs.make({
      module: GroupModule,
      connection: {
        db: {
          groupUser: makeRelation<RawGroupUserRow, EventContext>().handle,
          groupFriend: makeRelation<RawGroupFriendRow, EventContext>().handle,
        },
        subscriptionBuilder: () => ({
          onApplied: () => {
            throw new Error("unexpected atom-family subscription")
          },
          onError: () => {
            throw new Error("unexpected atom-family subscription")
          },
          subscribe: () => {
            throw new Error("unexpected atom-family subscription")
          },
        }),
      },
    })
    const groups = tableGroupAtomFamily<typeof GroupModule>(groupClient)

    expect(rows("user", decodeUserId("user-1"))).toBe(
      rows("user", decodeUserId("user-1")),
    )
    expect(tables("user")).toBe(
      tableAtomFamily<typeof FullModule>(client)("user"),
    )
    expect(groups(["groupFriend", "groupUser"] as const)).toBe(
      tableGroupAtomFamily<typeof GroupModule>(groupClient)([
        "groupUser",
        "groupFriend",
        "groupUser",
      ] as const),
    )
  })
  it.effect("row atoms preserve identity when a sibling row changes", () =>
    Effect.gen(function* () {
      const userRelation = makeSnapshotRelation<RawUserRow, EventContext>([])
      const eventRelation = makeRelation<RawPresenceRow, EventContext>()
      const { client, applySubscription, awaitSubscribeCalls } = makeClient(
        userRelation.handle,
        eventRelation.handle,
      )
      const registry = AtomRegistry.make()
      yield* Effect.addFinalizer(() => Effect.succeed(registry.dispose()))
      const rows = rowAtomFamily<typeof FullModule>(client)
      const rowAValues: Array<RowRefValue<UserRow>> = []
      const rowBValues: Array<RowRefValue<UserRow>> = []
      const rowAQueue = yield* Queue.unbounded<RowRefValue<UserRow>>()
      const rowBQueue = yield* Queue.unbounded<RowRefValue<UserRow>>()
      const unsubscribeA = registry.subscribe(
        rows("user", decodeUserId("user-1")),
        (value) => {
          rowAValues.push(value)
          Queue.offerUnsafe(rowAQueue, value)
        },
        { immediate: true },
      )
      yield* Effect.addFinalizer(() => Effect.succeed(unsubscribeA()))
      const unsubscribeB = registry.subscribe(
        rows("user", decodeUserId("user-2")),
        (value) => {
          rowBValues.push(value)
          Queue.offerUnsafe(rowBQueue, value)
        },
        { immediate: true },
      )
      yield* Effect.addFinalizer(() => Effect.succeed(unsubscribeB()))

      yield* awaitSubscribeCalls(1)
      userRelation.replaceRows([
        rawUserRow("user-1", "Ada"),
        rawUserRow("user-2", "Grace"),
      ])
      applySubscription()
      const rowBSuccess = yield* takeFromQueueUntil(
        rowBQueue,
        AsyncResult.isSuccess,
      )

      userRelation.replaceRows([
        rawUserRow("user-1", "Ada Updated"),
        rawUserRow("user-2", "Grace"),
      ])
      userRelation.emitUpdate(
        reducerContext("userUpsert"),
        rawUserRow("user-1", "Ada"),
        rawUserRow("user-1", "Ada Updated"),
      )
      yield* takeFromQueueUntil(
        rowAQueue,
        (rowAUpdated) =>
          AsyncResult.isSuccess(rowAUpdated) &&
          Option.getOrUndefined(rowAUpdated.value)?.name === "Ada Updated",
      )

      expect(rowBValues.at(-1)).toBe(rowBSuccess)
    }).pipe(Effect.scoped),
  )
  it.effect(
    "streamRows emits one snapshot for a synchronous callback burst",
    () =>
      Effect.gen(function* () {
        const initialUser = rawUserRow("user-0", "Seed")
        const userRelation = makeSnapshotRelation<RawUserRow, EventContext>([
          rawUserRow("stale", "Pre-subscription"),
        ])
        const eventRelation = makeRelation<RawPresenceRow, EventContext>()
        const { client, applySubscription, awaitSubscribeCalls } = makeClient(
          userRelation.handle,
          eventRelation.handle,
        )
        const snapshots: Array<unknown> = []
        const secondSnapshotSeen = yield* Deferred.make<void>()
        const snapshotsFiber = yield* client.streamRows("user").pipe(
          Stream.runForEach((snapshot) => {
            snapshots.push(snapshot)
            return snapshots.length === 2
              ? Deferred.succeed(secondSnapshotSeen, undefined).pipe(
                  Effect.asVoid,
                )
              : Effect.void
          }),
          Effect.forkScoped,
        )

        yield* awaitSubscribeCalls(1)
        yield* Effect.yieldNow
        expect(snapshotsFiber.pollUnsafe()).toBeUndefined()
        userRelation.replaceRows([initialUser])
        applySubscription()
        yield* Effect.yieldNow
        userRelation.replaceRows([
          initialUser,
          rawUserRow("user-1", "Ada Lovelace"),
          rawUserRow("user-2", "Grace Hopper"),
          rawUserRow("user-3", "Katherine Johnson"),
        ])
        userRelation.emitInsert(
          reducerContext("userUpsert"),
          rawUserRow("user-1", "Ada"),
        )
        userRelation.emitInsert(
          reducerContext("userUpsert"),
          rawUserRow("user-2", "Grace"),
        )
        userRelation.emitInsert(
          reducerContext("userUpsert"),
          rawUserRow("user-3", "Katherine"),
        )

        yield* Deferred.await(secondSnapshotSeen)
        yield* Effect.yieldNow
        expect(snapshots).toHaveLength(2)
        yield* Fiber.interrupt(snapshotsFiber)

        expect(snapshots).toEqual([
          [{ id: "user-0", name: "Seed" }],
          [
            { id: "user-0", name: "Seed" },
            { id: "user-1", name: "Ada Lovelace" },
            { id: "user-2", name: "Grace Hopper" },
            { id: "user-3", name: "Katherine Johnson" },
          ],
        ])
      }).pipe(Effect.scoped),
  )
  it.effect("tableGroup reads typed snapshots", () =>
    Effect.gen(function* () {
      const initialUser = rawUserRow("user-0", "Seed")
      const userRelation = makeSnapshotRelation<RawUserRow, EventContext>([
        initialUser,
      ])
      const eventRelation = makeRelation<RawPresenceRow, EventContext>()
      const { client } = makeClient(userRelation.handle, eventRelation.handle)
      const group = client.tableGroup(["user"] as const)
      const snapshot = yield* group.readSnapshot
      const users: ReadonlyArray<UserRow> = snapshot.user

      expect(users).toEqual([
        {
          id: "user-0",
          name: "Seed",
        },
      ])
    }),
  )
  it.effect("waitUntil resolves from an event-driven cache snapshot", () =>
    Effect.gen(function* () {
      const userRelation = makeSnapshotRelation<RawUserRow, EventContext>([])
      const eventRelation = makeRelation<RawPresenceRow, EventContext>()
      const { client, applySubscription, awaitSubscribeCalls } = makeClient(
        userRelation.handle,
        eventRelation.handle,
      )
      const waiting = yield* client
        .waitUntil("user", (row) => row.id === "user-2", {
          timeout: "1 second",
          interval: "1 millis",
        })
        .pipe(Effect.forkScoped)

      yield* awaitSubscribeCalls(1)
      applySubscription()
      userRelation.replaceRows([
        rawUserRow("user-1", "Ada"),
        rawUserRow("user-2", "Grace"),
      ])
      userRelation.emitInsert(
        reducerContext("userUpsert"),
        rawUserRow("user-2", "Grace"),
      )

      expect(yield* Fiber.join(waiting)).toEqual([
        { id: "user-2", name: "Grace" },
      ])
    }).pipe(Effect.scoped),
  )
  it.effect("waitUntil timeout reports the last snapshot size", () =>
    Effect.gen(function* () {
      const userRelation = makeSnapshotRelation<RawUserRow, EventContext>([
        rawUserRow("user-1", "Ada"),
        rawUserRow("user-2", "Grace"),
      ])
      const eventRelation = makeRelation<RawPresenceRow, EventContext>()
      const { client, applySubscription, awaitSubscribeCalls } = makeClient(
        userRelation.handle,
        eventRelation.handle,
      )
      const waiting = yield* client
        .waitUntil("user", (row) => row.id === "missing", {
          timeout: "20 millis",
        })
        .pipe(Effect.forkScoped)

      yield* awaitSubscribeCalls(1)
      applySubscription()
      yield* TestClock.adjust("20 millis")
      const error = yield* Fiber.join(waiting).pipe(Effect.flip)

      expect(error).toBeInstanceOf(StdbTesting.WaitUntilTimeoutError)
      if (error instanceof StdbTesting.WaitUntilTimeoutError) {
        expect(error.lastSnapshotSize).toBe(2)
        expect(error.table).toBe("user")
      }
    }).pipe(Effect.scoped),
  )
  it.effect("connectAndSubscribe acquires each target before returning", () =>
    Effect.gen(function* () {
      const userRelation = makeSnapshotRelation<RawUserRow, EventContext>([])
      const eventRelation = makeRelation<RawPresenceRow, EventContext>()
      let subscribeCalls = 0
      let onApplied: (() => void) | undefined
      const builder = {
        onApplied: (callback: () => void) => {
          onApplied = callback
          return builder
        },
        onError: () => builder,
        subscribe: () => {
          subscribeCalls = subscribeCalls + 1
          queueMicrotask(() => onApplied?.())
          return {
            isEnded: () => false,
            unsubscribe: () => undefined,
          }
        },
      }
      const connection = {
        db: makeFullModuleWsDb<EventContext>({
          user: userRelation.handle,
          presenceEvent: eventRelation.handle,
        }),
        disconnect: () => undefined,
        subscriptionBuilder: () => builder,
      }
      const client = StdbTesting.ClientWs.make({
        module: FullModule,
        connection,
      })
      const session = {
        ...client,
        connection,
        identity: Identity.zero(),
        token: "token",
      }

      const connected = yield* connectAndSubscribe(Effect.succeed(session), [
        Full.targets.tables.user,
      ])

      expect(connected).toBe(session)
      expect(subscribeCalls).toBe(1)
    }).pipe(Effect.scoped),
  )
  it.effect(
    "tableGroup emits an initial snapshot and re-reads after table changes",
    () =>
      Effect.gen(function* () {
        const initialUser = rawUserRow("user-0", "Seed")
        const userRelation = makeSnapshotRelation<RawUserRow, EventContext>([
          rawUserRow("stale", "Pre-subscription"),
        ])
        const eventRelation = makeRelation<RawPresenceRow, EventContext>()
        const { client, applySubscription, awaitSubscribeCalls } = makeClient(
          userRelation.handle,
          eventRelation.handle,
        )
        const group = client.tableGroup(["user"] as const)
        const snapshotsFiber = yield* group.changes.pipe(
          Stream.take(2),
          Stream.runCollect,
          Effect.forkScoped,
        )

        yield* awaitSubscribeCalls(1)
        yield* Effect.yieldNow
        expect(snapshotsFiber.pollUnsafe()).toBeUndefined()
        userRelation.replaceRows([initialUser])
        applySubscription()
        yield* Effect.yieldNow
        userRelation.replaceRows([
          initialUser,
          rawUserRow("user-1", "Ada Lovelace"),
        ])
        userRelation.emitInsert(
          reducerContext("userUpsert"),
          rawUserRow("user-1", "Ada"),
        )

        expect(Array.from(yield* Fiber.join(snapshotsFiber))).toEqual([
          {
            user: [
              {
                id: "user-0",
                name: "Seed",
              },
            ],
          },
          {
            user: [
              {
                id: "user-0",
                name: "Seed",
              },
              {
                id: "user-1",
                name: "Ada Lovelace",
              },
            ],
          },
        ])
      }).pipe(Effect.scoped),
  )
  it.effect(
    "tableGroup emits one snapshot for a synchronous callback burst",
    () =>
      Effect.gen(function* () {
        const initialUser = rawUserRow("user-0", "Seed")
        const userRelation = makeSnapshotRelation<RawUserRow, EventContext>([
          initialUser,
        ])
        const eventRelation = makeRelation<RawPresenceRow, EventContext>()
        const { client, applySubscription, awaitSubscribeCalls } = makeClient(
          userRelation.handle,
          eventRelation.handle,
        )
        const snapshots: Array<unknown> = []
        const secondSnapshotSeen = yield* Deferred.make<void>()
        const group = client.tableGroup(["user"] as const)
        const snapshotsFiber = yield* group.changes.pipe(
          Stream.runForEach((snapshot) => {
            snapshots.push(snapshot)
            return snapshots.length === 2
              ? Deferred.succeed(secondSnapshotSeen, undefined).pipe(
                  Effect.asVoid,
                )
              : Effect.void
          }),
          Effect.forkScoped,
        )

        yield* awaitSubscribeCalls(1)
        applySubscription()
        yield* Effect.yieldNow
        userRelation.replaceRows([
          initialUser,
          rawUserRow("user-1", "Ada Lovelace"),
          rawUserRow("user-2", "Grace Hopper"),
          rawUserRow("user-3", "Katherine Johnson"),
        ])
        userRelation.emitInsert(
          reducerContext("userUpsert"),
          rawUserRow("user-1", "Ada"),
        )
        userRelation.emitInsert(
          reducerContext("userUpsert"),
          rawUserRow("user-2", "Grace"),
        )
        userRelation.emitInsert(
          reducerContext("userUpsert"),
          rawUserRow("user-3", "Katherine"),
        )

        yield* Deferred.await(secondSnapshotSeen)
        yield* Effect.yieldNow
        expect(snapshots).toHaveLength(2)
        yield* Fiber.interrupt(snapshotsFiber)

        expect(snapshots).toEqual([
          {
            user: [
              {
                id: "user-0",
                name: "Seed",
              },
            ],
          },
          {
            user: [
              {
                id: "user-0",
                name: "Seed",
              },
              {
                id: "user-1",
                name: "Ada Lovelace",
              },
              {
                id: "user-2",
                name: "Grace Hopper",
              },
              {
                id: "user-3",
                name: "Katherine Johnson",
              },
            ],
          },
        ])
      }).pipe(Effect.scoped),
  )
  it.effect(
    "tableGroup emits one snapshot for a synchronous burst across tables",
    () =>
      Effect.gen(function* () {
        const userRelation = makeSnapshotRelation<
          RawGroupUserRow,
          EventContext
        >([])
        const friendRelation = makeSnapshotRelation<
          RawGroupFriendRow,
          EventContext
        >([])
        const onAppliedCallbacks = yield* Queue.unbounded<() => void>()
        const subscribeStarted = yield* Queue.unbounded<void>()
        const builder = {
          onApplied: (callback: () => void) => {
            Queue.offerUnsafe(onAppliedCallbacks, callback)
            return builder
          },
          onError: () => builder,
          subscribe: () => {
            Queue.offerUnsafe(subscribeStarted, undefined)
            return {
              isEnded: () => false,
              unsubscribe: () => undefined,
            }
          },
        }
        const client = StdbTesting.ClientWs.make({
          module: GroupModule,
          connection: {
            db: {
              groupUser: userRelation.handle,
              groupFriend: friendRelation.handle,
            },
            subscriptionBuilder: () => builder,
          },
        })
        const snapshots: Array<unknown> = []
        const secondSnapshotSeen = yield* Deferred.make<void>()
        const group = client.tableGroup(["groupUser", "groupFriend"] as const)
        const snapshotsFiber = yield* group.changes.pipe(
          Stream.runForEach((snapshot) => {
            snapshots.push(snapshot)
            return snapshots.length === 2
              ? Deferred.succeed(secondSnapshotSeen, undefined).pipe(
                  Effect.asVoid,
                )
              : Effect.void
          }),
          Effect.forkScoped,
        )

        const applyFirstSubscription = yield* Queue.take(onAppliedCallbacks)
        yield* Queue.take(subscribeStarted)
        yield* Effect.yieldNow
        applyFirstSubscription()
        const applySecondSubscription = yield* Queue.take(onAppliedCallbacks)
        yield* Queue.take(subscribeStarted)
        yield* Effect.yieldNow
        applySecondSubscription()
        yield* Effect.yieldNow
        userRelation.replaceRows([rawGroupUserRow("user-1", "Ada")])
        friendRelation.replaceRows([rawGroupFriendRow("user-2", "Grace")])
        userRelation.emitInsert(
          reducerContext("userUpsert"),
          rawGroupUserRow("user-1", "Ada"),
        )
        friendRelation.emitInsert(
          reducerContext("userUpsert"),
          rawGroupFriendRow("user-2", "Grace"),
        )

        yield* Deferred.await(secondSnapshotSeen)
        yield* Effect.yieldNow
        expect(snapshots).toHaveLength(2)
        yield* Fiber.interrupt(snapshotsFiber)

        expect(snapshots).toEqual([
          {
            groupUser: [],
            groupFriend: [],
          },
          {
            groupUser: [
              {
                id: "user-1",
                name: "Ada",
              },
            ],
            groupFriend: [
              {
                id: "user-2",
                name: "Grace",
              },
            ],
          },
        ])
      }).pipe(Effect.scoped),
  )
  it.effect(
    "tableGroup coalesces queued dispatches while the consumer is behind",
    () =>
      Effect.gen(function* () {
        const userRelation = makeSnapshotRelation<RawUserRow, EventContext>([])
        const eventRelation = makeRelation<RawPresenceRow, EventContext>()
        const { client, applySubscription, awaitSubscribeCalls } = makeClient(
          userRelation.handle,
          eventRelation.handle,
        )
        const snapshots: Array<unknown> = []
        const firstChangeSeen = yield* Deferred.make<void>()
        const releaseFirstChange = yield* Deferred.make<void>()
        const finalSnapshotSeen = yield* Deferred.make<void>()
        const group = client.tableGroup(["user"] as const)
        const snapshotsFiber = yield* group.changes.pipe(
          Stream.runForEach((snapshot) => {
            snapshots.push(snapshot)
            if (snapshots.length === 2) {
              return Deferred.succeed(firstChangeSeen, undefined).pipe(
                Effect.andThen(Deferred.await(releaseFirstChange)),
                Effect.asVoid,
              )
            }
            if (snapshots.length === 3) {
              return Deferred.succeed(finalSnapshotSeen, undefined).pipe(
                Effect.asVoid,
              )
            }
            return Effect.void
          }),
          Effect.forkScoped,
        )

        yield* awaitSubscribeCalls(1)
        applySubscription()
        yield* Effect.yieldNow
        userRelation.replaceRows([rawUserRow("user-1", "Ada")])
        userRelation.emitInsert(
          reducerContext("userUpsert"),
          rawUserRow("user-1", "Ada"),
        )
        yield* Deferred.await(firstChangeSeen)

        userRelation.replaceRows([
          rawUserRow("user-1", "Ada"),
          rawUserRow("user-2", "Grace"),
          rawUserRow("user-3", "Katherine"),
        ])
        userRelation.emitInsert(
          reducerContext("userUpsert"),
          rawUserRow("user-2", "Grace"),
        )
        userRelation.emitInsert(
          reducerContext("userUpsert"),
          rawUserRow("user-3", "Katherine"),
        )
        yield* Deferred.succeed(releaseFirstChange, undefined)
        yield* Deferred.await(finalSnapshotSeen)
        yield* Fiber.interrupt(snapshotsFiber)

        expect(snapshots).toEqual([
          { user: [] },
          {
            user: [
              {
                id: "user-1",
                name: "Ada",
              },
            ],
          },
          {
            user: [
              {
                id: "user-1",
                name: "Ada",
              },
              {
                id: "user-2",
                name: "Grace",
              },
              {
                id: "user-3",
                name: "Katherine",
              },
            ],
          },
        ])
      }).pipe(Effect.scoped),
  )
  it.effect(
    "tableGroup converges after more queued events than the stream buffer keeps",
    () =>
      Effect.gen(function* () {
        const userRelation = makeSnapshotRelation<RawUserRow, EventContext>([])
        const eventRelation = makeRelation<RawPresenceRow, EventContext>()
        const { client, applySubscription, awaitSubscribeCalls } = makeClient(
          userRelation.handle,
          eventRelation.handle,
        )
        const snapshots: Array<unknown> = []
        const secondSnapshotSeen = yield* Deferred.make<void>()
        const group = client.tableGroup(["user"] as const, {
          buffer: { bufferSize: 2, strategy: "sliding" },
        })
        const snapshotsFiber = yield* group.changes.pipe(
          Stream.runForEach((snapshot) => {
            snapshots.push(snapshot)
            return snapshots.length === 2
              ? Deferred.succeed(secondSnapshotSeen, undefined).pipe(
                  Effect.asVoid,
                )
              : Effect.void
          }),
          Effect.forkScoped,
        )

        yield* awaitSubscribeCalls(1)
        applySubscription()
        yield* Effect.yieldNow
        const rows = Array.from({ length: 5 }, (_, index) =>
          rawUserRow(`user-${index}`, `User ${index}`),
        )
        userRelation.replaceRows(rows)
        yield* Effect.try({
          try: () => {
            rows.forEach((row) => {
              userRelation.emitInsert(reducerContext("userUpsert"), row)
            })
          },
          catch: (cause) =>
            new StdbTesting.SubscriptionTransportError({ cause }),
        })

        yield* Deferred.await(secondSnapshotSeen)
        yield* Fiber.interrupt(snapshotsFiber)

        expect(snapshots.at(-1)).toEqual({
          user: rows.map((row) => ({
            id: row.id,
            name: row.name,
          })),
        })
      }).pipe(Effect.scoped),
  )
  it.effect("tableGroup subscribe propagates subscription failures", () =>
    Effect.gen(function* () {
      const userRelation = makeRelation<RawUserRow, EventContext>()
      const eventRelation = makeRelation<RawPresenceRow, EventContext>()
      const connection = {
        db: makeFullModuleWsDb<EventContext>({
          user: userRelation.handle,
          presenceEvent: eventRelation.handle,
        }),
        subscriptionBuilder: () => ({
          onApplied: () => {
            throw new Error("unexpected tableGroup onApplied")
          },
          onError: () => {
            throw new Error("unexpected tableGroup onError")
          },
          subscribe: () => {
            throw new Error("tableGroup subscribe exploded")
          },
        }),
      }
      const client = StdbTesting.ClientWs.make({
        module: FullModule,
        connection,
      })
      const exit = yield* Effect.exit(
        client.tableGroup(["user"] as const).subscribe,
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const failure = exit.cause.pipe(
          Cause.findErrorOption,
          Option.getOrUndefined,
        )
        expect(failure).toBeInstanceOf(StdbTesting.SubscriptionTransportError)
      }
    }).pipe(Effect.scoped),
  )
  it.effect(
    "streamTable auto-subscribes and drops relation context by default",
    () =>
      Effect.gen(function* () {
        const userRelation = makeRelation<RawUserRow, EventContext>()
        const eventRelation = makeRelation<RawPresenceRow, EventContext>()
        const { client, applySubscription, awaitSubscribeCalls } = makeClient(
          userRelation.handle,
          eventRelation.handle,
        )
        const changeDeferred =
          yield* Deferred.make<StdbTesting.TableChange<UserRow>>()
        yield* client.streamTable("user").pipe(
          Stream.runForEach((change) =>
            Deferred.succeed(changeDeferred, change).pipe(Effect.asVoid),
          ),
          Effect.forkScoped,
        )
        yield* awaitSubscribeCalls(1)
        applySubscription()
        const context = reducerContext("userUpsert")
        userRelation.emitInsert(context, {
          id: decodeUserId("user-1"),
          name: decodeUserName("Ada"),
        })
        expect(yield* Deferred.await(changeDeferred)).toEqual({
          _tag: "Insert",
          row: {
            id: "user-1",
            name: "Ada",
          },
        })
      }).pipe(Effect.scoped),
  )
  it.effect("same-target streams open independent native subscriptions", () =>
    Effect.gen(function* () {
      const onAppliedCallbacks = yield* Queue.unbounded<() => void>()
      const subscribeStarted = yield* Queue.unbounded<void>()
      const unsubscribed = new Set<number>()
      let subscribeCalls = 0
      const client = StdbTesting.ClientWs.make({
        module: FullModule,
        connection: {
          db: makeFullModuleWsDb<EventContext>(),
          subscriptionBuilder: () => {
            const builder = {
              onApplied: (callback: () => void) => {
                Queue.offerUnsafe(onAppliedCallbacks, callback)
                return builder
              },
              onError: () => builder,
              subscribe: () => {
                subscribeCalls = subscribeCalls + 1
                Queue.offerUnsafe(subscribeStarted, undefined)
                const handleId = subscribeCalls
                return {
                  isEnded: () => unsubscribed.has(handleId),
                  unsubscribe: () => {
                    unsubscribed.add(handleId)
                  },
                }
              },
            }
            return builder
          },
        },
      })

      const exit = yield* Effect.exit(
        Effect.gen(function* () {
          yield* client
            .streamTable("user")
            .pipe(Stream.runDrain, Effect.forkScoped)
          yield* client
            .streamTable("user")
            .pipe(Stream.runDrain, Effect.forkScoped)
          const applyCallbacks = yield* Queue.takeN(onAppliedCallbacks, 2)
          yield* Queue.takeN(subscribeStarted, 2)
          yield* Effect.yieldNow
          yield* Effect.forEach(applyCallbacks, (apply) =>
            Effect.succeed(apply()),
          )
          yield* Effect.yieldNow
          expect(unsubscribed.size).toBe(0)
        }).pipe(Effect.scoped),
      )

      expect(Exit.isSuccess(exit)).toBe(true)
      expect(unsubscribed.size).toBe(2)
    }),
  )
  it.effect(
    "stream subscriptions use the latest connection subscription builder",
    () =>
      Effect.gen(function* () {
        const staleBuilder = {
          onApplied: () => {
            throw new Error("stale subscription builder used")
          },
          onError: () => staleBuilder,
          subscribe: () => {
            throw new Error("stale subscription builder used")
          },
        }
        const onAppliedCallbacks = yield* Queue.unbounded<() => void>()
        const subscribeStarted = yield* Queue.unbounded<void>()
        const activeBuilder = {
          onApplied: (callback: () => void) => {
            Queue.offerUnsafe(onAppliedCallbacks, callback)
            return activeBuilder
          },
          onError: () => activeBuilder,
          subscribe: () => {
            Queue.offerUnsafe(subscribeStarted, undefined)
            return {
              isEnded: () => false,
              unsubscribe: () => undefined,
            }
          },
        }
        const connection: StdbTesting.WsConnectionLike<
          typeof FullModule,
          unknown,
          EventContext
        > = {
          db: makeFullModuleWsDb<EventContext>(),
          subscriptionBuilder: () => staleBuilder,
        }
        const client = StdbTesting.ClientWs.make({
          module: FullModule,
          connection,
        })

        Object.defineProperty(connection, "subscriptionBuilder", {
          configurable: true,
          value: () => activeBuilder,
        })

        const exit = yield* Effect.exit(
          Effect.gen(function* () {
            yield* client
              .streamTable("user")
              .pipe(Stream.runDrain, Effect.forkScoped)
            const applySubscription = yield* Queue.take(onAppliedCallbacks)
            yield* Queue.take(subscribeStarted)
            yield* Effect.yieldNow
            applySubscription()
            yield* Effect.yieldNow
          }).pipe(Effect.scoped),
        )

        expect(Exit.isSuccess(exit)).toBe(true)
      }),
  )
  it.effect("streamTable emits delete and update changes", () =>
    Effect.gen(function* () {
      const userRelation = makeRelation<RawUserRow, EventContext>()
      const eventRelation = makeRelation<RawPresenceRow, EventContext>()
      const { client, applySubscription, awaitSubscribeCalls } = makeClient(
        userRelation.handle,
        eventRelation.handle,
      )
      const changesFiber = yield* client
        .streamTable("user")
        .pipe(Stream.take(2), Stream.runCollect, Effect.forkScoped)
      yield* awaitSubscribeCalls(1)
      applySubscription()
      userRelation.emitDelete(reducerContext("user_delete"), {
        id: decodeUserId("user-3"),
        name: decodeUserName("Grace"),
      })
      userRelation.emitUpdate(
        reducerContext("userUpsert"),
        {
          id: decodeUserId("user-4"),
          name: decodeUserName("Ada"),
        },
        {
          id: decodeUserId("user-4"),
          name: decodeUserName("Lovelace"),
        },
      )
      expect(yield* Fiber.join(changesFiber)).toEqual([
        {
          _tag: "Delete",
          row: {
            id: "user-3",
            name: "Grace",
          },
        },
        {
          _tag: "Update",
          oldRow: {
            id: "user-4",
            name: "Ada",
          },
          newRow: {
            id: "user-4",
            name: "Lovelace",
          },
        },
      ])
    }).pipe(Effect.scoped),
  )
  it.effect("keeps queued table changes within a custom stream buffer", () =>
    Effect.gen(function* () {
      const userRelation = makeRelation<RawUserRow, EventContext>()
      const eventRelation = makeRelation<RawPresenceRow, EventContext>()
      const { client, applySubscription, awaitSubscribeCalls } = makeClient(
        userRelation.handle,
        eventRelation.handle,
      )
      expect(
        yield* collectBlockedUserInsertIds({
          client,
          userRelation,
          applySubscription,
          awaitSubscribeCalls,
          streamOptions: {
            buffer: { bufferSize: 4, strategy: "sliding" },
          },
          rows: [
            { id: "user-0", name: "Seed" },
            { id: "user-1", name: "Ada" },
            { id: "user-2", name: "Grace" },
          ],
          subscriptionMessage:
            "custom-buffer streamTable did not start subscription",
          take: 3,
        }),
      ).toEqual(["user-0", "user-1", "user-2"])
    }).pipe(Effect.scoped),
  )
  it.effect(
    "drops the oldest queued table changes when the sliding stream buffer overflows",
    () =>
      Effect.gen(function* () {
        const userRelation = makeRelation<RawUserRow, EventContext>()
        const eventRelation = makeRelation<RawPresenceRow, EventContext>()
        const { client, applySubscription, awaitSubscribeCalls } = makeClient(
          userRelation.handle,
          eventRelation.handle,
        )
        expect(
          yield* collectBlockedUserInsertIds({
            client,
            userRelation,
            applySubscription,
            awaitSubscribeCalls,
            streamOptions: {
              buffer: { bufferSize: 2, strategy: "sliding" },
            },
            rows: [
              { id: "user-0", name: "Seed" },
              { id: "user-1", name: "Ada" },
              { id: "user-2", name: "Grace" },
              { id: "user-3", name: "Lin" },
              { id: "user-4", name: "Katherine" },
            ],
            subscriptionMessage:
              "sliding-buffer streamTable did not start subscription",
            take: 3,
          }),
        ).toEqual(["user-0", "user-3", "user-4"])
      }).pipe(Effect.scoped),
  )
  it.effect(
    "defaults a missing table stream strategy to overflow failure",
    () =>
      Effect.gen(function* () {
        const userRelation = makeRelation<RawUserRow, EventContext>()
        const eventRelation = makeRelation<RawPresenceRow, EventContext>()
        const { client, applySubscription, awaitSubscribeCalls } = makeClient(
          userRelation.handle,
          eventRelation.handle,
        )
        expectTableOverflowFailure(
          yield* collectBlockedUserOverflowExit({
            client,
            userRelation,
            applySubscription,
            awaitSubscribeCalls,
            streamOptions: {
              buffer: { bufferSize: 2 },
            },
            eventCount: 4,
          }),
          2,
        )
      }).pipe(Effect.scoped),
  )
  it.effect(
    "keeps the oldest queued table changes when the dropping stream buffer overflows",
    () =>
      Effect.gen(function* () {
        const userRelation = makeRelation<RawUserRow, EventContext>()
        const eventRelation = makeRelation<RawPresenceRow, EventContext>()
        const { client, applySubscription, awaitSubscribeCalls } = makeClient(
          userRelation.handle,
          eventRelation.handle,
        )
        expect(
          yield* collectBlockedUserInsertIds({
            client,
            userRelation,
            applySubscription,
            awaitSubscribeCalls,
            streamOptions: {
              buffer: { bufferSize: 2, strategy: "dropping" },
            },
            rows: [
              { id: "user-0", name: "Seed" },
              { id: "user-1", name: "Ada" },
              { id: "user-2", name: "Grace" },
              { id: "user-3", name: "Lin" },
              { id: "user-4", name: "Katherine" },
            ],
            subscriptionMessage:
              "dropping-buffer streamTable did not start subscription",
            take: 3,
          }),
        ).toEqual(["user-0", "user-1", "user-2"])
      }).pipe(Effect.scoped),
  )
  it.effect("fails on overflow when no custom table buffer is supplied", () =>
    Effect.gen(function* () {
      const userRelation = makeRelation<RawUserRow, EventContext>()
      const eventRelation = makeRelation<RawPresenceRow, EventContext>()
      const { client, applySubscription, awaitSubscribeCalls } = makeClient(
        userRelation.handle,
        eventRelation.handle,
      )
      expectTableOverflowFailure(
        yield* collectBlockedUserOverflowExit({
          client,
          userRelation,
          applySubscription,
          awaitSubscribeCalls,
          eventCount: 1026,
        }),
        1024,
      )
    }).pipe(Effect.scoped),
  )
  it.effect(
    "streamEventTable fails fast when the default event buffer overflows",
    () =>
      Effect.gen(function* () {
        const userRelation = makeRelation<RawUserRow, EventContext>()
        const eventRelation = makeRelation<RawPresenceRow, EventContext>()
        const { client, applySubscription, awaitSubscribeCalls } = makeClient(
          userRelation.handle,
          eventRelation.handle,
        )
        const rows = Array.from({ length: 1027 }, (_, index) => ({
          userId: `user-${index}`,
          kind: index % 2 === 0 ? ("joined" as const) : ("left" as const),
        }))

        expectEventTableOverflowFailure(
          yield* collectBlockedPresenceEventOverflowExit({
            client,
            eventRelation,
            applySubscription,
            awaitSubscribeCalls,
            rows,
          }),
          1024,
        )
      }).pipe(Effect.scoped),
  )
  it.effect("uses capacity-only fail-fast buffering for event streams", () =>
    Effect.gen(function* () {
      const userRelation = makeRelation<RawUserRow, EventContext>()
      const eventRelation = makeRelation<RawPresenceRow, EventContext>()
      const { client, applySubscription, awaitSubscribeCalls } = makeClient(
        userRelation.handle,
        eventRelation.handle,
      )
      const rows = Array.from({ length: 1027 }, (_, index) => ({
        userId: `user-${index}`,
        kind: index % 2 === 0 ? ("joined" as const) : ("left" as const),
      }))

      expectEventTableOverflowFailure(
        yield* collectBlockedPresenceEventOverflowExit({
          client,
          eventRelation,
          applySubscription,
          awaitSubscribeCalls,
          streamOptions: {
            buffer: { bufferSize: 2 },
          },
          rows,
          subscriptionMessage:
            "partial-buffer streamEventTable did not start subscription",
        }),
        2,
      )
    }).pipe(Effect.scoped),
  )
  it.effect(
    "streamTableWithContext preserves relation context when requested",
    () =>
      Effect.gen(function* () {
        const userRelation = makeRelation<RawUserRow, EventContext>()
        const eventRelation = makeRelation<RawPresenceRow, EventContext>()
        const { client, applySubscription, awaitSubscribeCalls } = makeClient(
          userRelation.handle,
          eventRelation.handle,
        )
        const changeDeferred =
          yield* Deferred.make<
            StdbTesting.TableChangeWithContext<UserRow, EventContext>
          >()
        yield* client.streamTableWithContext("user").pipe(
          Stream.runForEach((change) =>
            Deferred.succeed(changeDeferred, change).pipe(Effect.asVoid),
          ),
          Effect.forkScoped,
        )
        yield* awaitSubscribeCalls(1)
        applySubscription()
        const context = reducerContext("userUpsert")
        userRelation.emitInsert(context, {
          id: decodeUserId("user-2"),
          name: decodeUserName("Grace"),
        })
        expect(yield* Deferred.await(changeDeferred)).toEqual({
          _tag: "Insert",
          row: {
            id: "user-2",
            name: "Grace",
          },
          context,
        })
      }).pipe(Effect.scoped),
  )
  it("decodes generated event context variants", () => {
    const timestamp = StableTimestamp
    const error = new Error("subscription failed")
    const reducerErrorBytes = new Uint8Array([1, 2, 3])
    const decodedReducerOk = StdbTesting.decodeStdbEventContextSync(
      sdkReducerContext({
        outcome: reducerOk(new Uint8Array([9])),
        reducer: reducerInfo("userUpsert"),
        timestamp,
      }),
    )
    const decodedReducerErr = StdbTesting.decodeStdbEventContextSync(
      sdkReducerContext({
        outcome: reducerErr(reducerErrorBytes),
        reducer: reducerInfo("userUpsert"),
        timestamp,
      }),
    )
    const decodedReducerInternalError = StdbTesting.decodeStdbEventContextSync(
      sdkReducerContext({
        outcome: reducerInternalError("reducer rejected"),
        reducer: reducerInfo("userUpsert"),
        timestamp,
      }),
    )
    const decodedReducerOkEmpty = StdbTesting.decodeStdbEventContextSync(
      sdkReducerContext({
        outcome: reducerOkEmpty(),
        reducer: reducerInfo("userUpsert"),
        timestamp,
      }),
    )

    expect(decodedReducerOk).toEqual(
      StdbTesting.StdbEventContext.Reducer({
        reducer: "userUpsert",
        timestamp,
        outcome: StdbTesting.StdbReducerOutcome.Ok(),
      }),
    )
    expect(decodedReducerErr).toEqual(
      StdbTesting.StdbEventContext.Reducer({
        reducer: "userUpsert",
        timestamp,
        outcome: StdbTesting.StdbReducerOutcome.Err({
          error: reducerErrorBytes,
        }),
      }),
    )
    expect(decodedReducerInternalError).toEqual(
      StdbTesting.StdbEventContext.Reducer({
        reducer: "userUpsert",
        timestamp,
        outcome: StdbTesting.StdbReducerOutcome.InternalError({
          message: "reducer rejected",
        }),
      }),
    )
    expect(decodedReducerOkEmpty).toEqual(
      StdbTesting.StdbEventContext.Reducer({
        reducer: "userUpsert",
        timestamp,
        outcome: StdbTesting.StdbReducerOutcome.OkEmpty(),
      }),
    )
    expect(
      StdbTesting.decodeStdbEventContextSync(subscribeAppliedContext()),
    ).toEqual(StdbTesting.StdbEventContext.SubscribeApplied())
    expect(
      StdbTesting.decodeStdbEventContextSync(unsubscribeAppliedContext()),
    ).toEqual(StdbTesting.StdbEventContext.UnsubscribeApplied())
    expect(
      StdbTesting.decodeStdbEventContextSync(transactionContext()),
    ).toEqual(StdbTesting.StdbEventContext.Transaction())
    expect(StdbTesting.decodeStdbEventContextSync(errorContext(error))).toEqual(
      StdbTesting.StdbEventContext.Error({ error }),
    )
  })
  it.effect("streamTableEvents decodes generated reducer context", () =>
    Effect.gen(function* () {
      const userRelation = makeRelation<RawUserRow, EventContext>()
      const eventRelation = makeRelation<RawPresenceRow, EventContext>()
      const { client, applySubscription, awaitSubscribeCalls } = makeClient(
        userRelation.handle,
        eventRelation.handle,
      )
      const changeDeferred =
        yield* Deferred.make<StdbTesting.StdbTableChangeEvent<UserRow>>()

      yield* client.streamTableEvents("user").pipe(
        Stream.runForEach((change) =>
          Deferred.succeed(changeDeferred, change).pipe(Effect.asVoid),
        ),
        Effect.forkScoped,
      )
      yield* awaitSubscribeCalls(1)
      applySubscription()
      userRelation.emitInsert(
        sdkReducerContext({
          outcome: reducerOk(),
          reducer: reducerInfo("userUpsert"),
          timestamp: StableTimestamp,
        }),
        {
          id: decodeUserId("user-3"),
          name: decodeUserName("Katherine"),
        },
      )

      const change = yield* Deferred.await(changeDeferred)
      expect(change).toEqual({
        _tag: "Insert",
        row: {
          id: "user-3",
          name: "Katherine",
        },
        context: StdbTesting.StdbEventContext.Reducer({
          reducer: "userUpsert",
          timestamp: StableTimestamp,
          outcome: StdbTesting.StdbReducerOutcome.Ok(),
        }),
      })
    }).pipe(Effect.scoped),
  )
  it.effect(
    "streamTableEvents fails malformed generated contexts as decode errors",
    () =>
      Effect.gen(function* () {
        const userRelation = makeRelation<RawUserRow, EventContext>()
        const eventRelation = makeRelation<RawPresenceRow, EventContext>()
        const { client, applySubscription, awaitSubscribeCalls } = makeClient(
          userRelation.handle,
          eventRelation.handle,
        )
        const streamExitFiber = yield* client
          .streamTableEvents("user")
          .pipe(Stream.runDrain, Effect.exit, Effect.forkScoped)

        yield* awaitSubscribeCalls(1)
        applySubscription()
        userRelation.emitInsert(
          {
            event: {
              tag: "UnknownNativeEvent",
            },
          },
          {
            id: decodeUserId("user-4"),
            name: decodeUserName("Lin"),
          },
        )

        const exit = yield* Fiber.join(streamExitFiber)
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          const failure = exit.cause.pipe(
            Cause.findErrorOption,
            Option.getOrUndefined,
          )
          expect(failure).toBeInstanceOf(StdbTesting.StdbDecodeError)
          if (failure instanceof StdbTesting.StdbDecodeError) {
            expect(failure.table).toBe("user")
            expect(failure.op).toBe("eventContext")
          }
        }
      }).pipe(Effect.scoped),
  )
  it.effect("streamEventTable preserves insert context", () =>
    Effect.gen(function* () {
      const userRelation = makeRelation<RawUserRow, EventContext>()
      const eventRelation = makeRelation<RawPresenceRow, EventContext>()
      const { client, applySubscription, awaitSubscribeCalls } = makeClient(
        userRelation.handle,
        eventRelation.handle,
      )
      const eventDeferred =
        yield* Deferred.make<
          StdbTesting.InsertEvent<PresenceRow, EventContext>
        >()
      yield* client.streamEventTable("presenceEvent").pipe(
        Stream.runForEach((event) =>
          Deferred.succeed(eventDeferred, event).pipe(Effect.asVoid),
        ),
        Effect.forkScoped,
      )
      yield* awaitSubscribeCalls(1)
      applySubscription()
      const context = reducerContext("emit_presence")
      eventRelation.emitInsert(context, {
        userId: decodeUserId("user-3"),
        kind: {
          tag: "joined",
        },
      })
      expect(yield* Deferred.await(eventDeferred)).toEqual({
        row: {
          userId: "user-3",
          kind: "joined",
        },
        context,
      })
    }).pipe(Effect.scoped),
  )
  it.effect("streamTarget auto-subscribes event tables", () =>
    Effect.gen(function* () {
      const userRelation = makeRelation<RawUserRow, EventContext>()
      const eventRelation = makeRelation<RawPresenceRow, EventContext>()
      const { client, applySubscription, awaitSubscribeCalls } = makeClient(
        userRelation.handle,
        eventRelation.handle,
      )
      const eventDeferred =
        yield* Deferred.make<
          StdbTesting.InsertEvent<PresenceRow, EventContext>
        >()
      yield* client.streamTarget(Full.targets.eventTables.presenceEvent).pipe(
        Stream.runForEach((event) =>
          Deferred.succeed(eventDeferred, event).pipe(Effect.asVoid),
        ),
        Effect.forkScoped,
      )
      yield* awaitSubscribeCalls(1)
      applySubscription()
      const context = reducerContext("emit_presence")
      eventRelation.emitInsert(context, {
        userId: decodeUserId("user-4"),
        kind: {
          tag: "left",
        },
      })
      expect(yield* Deferred.await(eventDeferred)).toEqual({
        row: {
          userId: "user-4",
          kind: "left",
        },
        context,
      })
    }).pipe(Effect.scoped),
  )
  it.effect(
    "fails only the active table stream on subscription rejection",
    () =>
      Effect.gen(function* () {
        const userRelation = makeRelation<RawUserRow, EventContext>()
        const eventRelation = makeRelation<RawPresenceRow, EventContext>()
        const {
          client,
          applySubscription,
          failSubscription,
          awaitSubscribeCalls,
        } = makeClient(userRelation.handle, eventRelation.handle)
        const fiber = yield* client
          .streamTable("user")
          .pipe(Stream.runDrain, Effect.forkScoped)
        yield* awaitSubscribeCalls(1)
        applySubscription()
        failSubscription(
          {
            event: new Error("context lost"),
          },
          new Error("connection lost"),
        )
        const exit = yield* fiber.pipe(Fiber.join, Effect.exit)
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          expect(
            Option.getOrUndefined(Cause.findErrorOption(exit.cause)),
          ).toBeInstanceOf(StdbTesting.SubscriptionRejectedError)
        }
        expect(client.isInvalidated()).toBe(false)
      }).pipe(Effect.scoped),
  )
  it.effect(
    "surfaces relation registration failures as SubscriptionTransportError",
    () =>
      Effect.gen(function* () {
        const client = StdbTesting.ClientWs.make({
          module: FullModule,
          connection: {
            db: makeFullModuleWsDb<EventContext>({
              user: {
                onInsert: () => {
                  throw new Error("register boom")
                },
                removeOnInsert: () => undefined,
                onDelete: () => undefined,
                removeOnDelete: () => undefined,
                onUpdate: () => undefined,
                removeOnUpdate: () => undefined,
                iter: () => [].values(),
                count: () => 0n,
              },
            }),
            subscriptionBuilder: () => ({
              onApplied: () => {
                throw new Error("unexpected subscriptionBuilder.onApplied")
              },
              onError: () => {
                throw new Error("unexpected subscriptionBuilder.onError")
              },
              subscribe: () => {
                throw new Error("unexpected subscriptionBuilder.subscribe")
              },
            }),
          },
        })
        const exit = yield* Effect.exit(
          client.streamTable("user").pipe(Stream.runDrain, Effect.scoped),
        )
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          expect(
            Option.getOrUndefined(Cause.findErrorOption(exit.cause)),
          ).toBeInstanceOf(StdbTesting.SubscriptionTransportError)
        }
      }),
  )
  it.effect(
    "keeps best-effort callback cleanup from hanging when removal throws",
    () =>
      Effect.gen(function* () {
        const appliedRegistered = Deferred.makeUnsafe<() => void>()
        const client = StdbTesting.ClientWs.make({
          module: FullModule,
          connection: {
            db: makeFullModuleWsDb<EventContext>({
              user: {
                onInsert: () => undefined,
                removeOnInsert: () => {
                  throw new Error("remove boom")
                },
                onDelete: () => undefined,
                removeOnDelete: () => undefined,
                onUpdate: () => undefined,
                removeOnUpdate: () => undefined,
                iter: () => [].values(),
                count: () => 0n,
              },
            }),
            subscriptionBuilder: () => {
              const builder = {
                onApplied: (callback: () => void) => {
                  Deferred.doneUnsafe(
                    appliedRegistered,
                    Effect.succeed(callback),
                  )
                  return builder
                },
                onError: () => builder,
                subscribe: () => ({
                  isEnded: () => false,
                  unsubscribe: () => undefined,
                }),
              }
              return builder
            },
          },
        })
        const exit = yield* Effect.exit(
          Effect.gen(function* () {
            yield* client
              .streamTable("user")
              .pipe(Stream.runDrain, Effect.forkScoped)
            const applied = yield* Deferred.await(appliedRegistered)
            yield* Effect.yieldNow
            applied()
          }).pipe(Effect.scoped),
        )
        expect(Exit.isSuccess(exit)).toBe(true)
      }),
  )
  it.effect("unsubscribes when the surrounding stream scope closes", () =>
    Effect.gen(function* () {
      const appliedRegistered = Deferred.makeUnsafe<() => void>()
      let unsubscribed = false
      const client = StdbTesting.ClientWs.make({
        module: FullModule,
        connection: {
          db: makeFullModuleWsDb<EventContext>(),
          subscriptionBuilder: () => {
            const builder = {
              onApplied: (callback: () => void) => {
                Deferred.doneUnsafe(appliedRegistered, Effect.succeed(callback))
                return builder
              },
              onError: () => builder,
              subscribe: () => ({
                isEnded: () => unsubscribed,
                unsubscribe: () => {
                  unsubscribed = true
                },
              }),
            }
            return builder
          },
        },
      })
      const exit = yield* Effect.exit(
        Effect.gen(function* () {
          yield* client
            .streamTable("user")
            .pipe(Stream.runDrain, Effect.forkScoped)
          const applied = yield* Deferred.await(appliedRegistered)
          yield* Effect.yieldNow
          applied()
          yield* Effect.yieldNow
        }).pipe(Effect.scoped),
      )
      expect(Exit.isSuccess(exit)).toBe(true)
      expect(unsubscribed).toBe(true)
    }),
  )
})
