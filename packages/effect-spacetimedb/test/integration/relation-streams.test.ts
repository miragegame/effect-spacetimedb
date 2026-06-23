// lint-ignore: effect-no-throw-in-effect-callgraph - mock transports intentionally throw synchronously to test wrapper failure classification.

import * as EffectVitest from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"

const { describe, expect, it } = EffectVitest

import * as Stdb from "effect-spacetimedb"
import {
  canonicalRowKey,
  canonicalTableGroupKey,
  canonicalTableKey,
  canonicalValueKey,
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
import { waitForPredicate } from "../helpers/wait-for-predicate"
import { makeFullModuleWsDb } from "../helpers/ws-fixtures"

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
    },
    replaceRows: (nextRows: ReadonlyArray<Row>) => {
      rows = Array.from(nextRows)
    },
  }
}
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
  readonly subscribeCalls: () => number
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
  yield* waitForPredicate(
    () => params.subscribeCalls() === 1,
    params.subscriptionMessage,
  )
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
const collectBlockedPresenceEventOverflowExit = Effect.fn(function* (params: {
  readonly client: ReturnType<typeof makeClient>["client"]
  readonly eventRelation: ReturnType<
    typeof makeRelation<RawPresenceRow, EventContext>
  >
  readonly applySubscription: () => void
  readonly subscribeCalls: () => number
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
  yield* waitForPredicate(
    () => params.subscribeCalls() === 1,
    params.subscriptionMessage ??
      "event-table stream did not start subscription",
  )
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
describe("relation streams", () => {
  it.effect(
    "streamRows emits the initial decoded snapshot and re-reads after deltas",
    () =>
      Effect.gen(function* () {
        const initialUser = rawUserRow("user-0", "Seed")
        const userRelation = makeSnapshotRelation<RawUserRow, EventContext>([
          initialUser,
        ])
        const eventRelation = makeRelation<RawPresenceRow, EventContext>()
        const { client, applySubscription, subscribeCalls } = makeClient(
          userRelation.handle,
          eventRelation.handle,
        )
        const snapshotsFiber = yield* client
          .streamRows("user")
          .pipe(Stream.take(2), Stream.runCollect, Effect.forkScoped)

        yield* waitForPredicate(
          () => subscribeCalls() === 1,
          "streamRows did not start subscription after initial snapshot",
        )
        applySubscription()
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
        const { client, applySubscription, subscribeCalls } = makeClient(
          userRelation.handle,
          eventRelation.handle,
        )
        const ref = yield* client.subscribeTableRef("user")
        const valuesFiber = yield* SubscriptionRef.changes(ref).pipe(
          Stream.take(2),
          Stream.runCollect,
          Effect.forkScoped,
        )

        yield* waitForPredicate(
          () => subscribeCalls() === 1,
          "subscribeTableRef did not start subscription",
        )
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
        const { client, applySubscription, failSubscription, subscribeCalls } =
          makeClient(userRelation.handle, eventRelation.handle)
        const ref = yield* client.subscribeTableRef("user")

        yield* waitForPredicate(
          () => subscribeCalls() === 1,
          "failing subscribeTableRef did not start subscription",
        )
        applySubscription()
        failSubscription("connection lost", new Error("connection lost"))
        yield* waitForPredicate(
          () => ref.pipe(SubscriptionRef.getUnsafe, AsyncResult.isFailure),
          "subscribeTableRef did not publish post-applied failure",
        )

        expect(AsyncResult.isFailure(SubscriptionRef.getUnsafe(ref))).toBe(true)
      }).pipe(Effect.scoped),
  )
  it.effect("same-table row refs share one table subscription", () =>
    Effect.gen(function* () {
      const userRelation = makeSnapshotRelation<RawUserRow, EventContext>([])
      const eventRelation = makeRelation<RawPresenceRow, EventContext>()
      const { client, applySubscription, subscribeCalls } = makeClient(
        userRelation.handle,
        eventRelation.handle,
      )
      const adaRef = yield* client.subscribeRowRef("user", "user-1")
      const graceRef = yield* client.subscribeRowRef("user", "user-2")

      yield* waitForPredicate(
        () => subscribeCalls() === 1,
        "same-table row refs opened more than one subscription",
      )
      userRelation.replaceRows([
        rawUserRow("user-1", "Ada"),
        rawUserRow("user-2", "Grace"),
      ])
      applySubscription()
      yield* waitForPredicate(
        () =>
          adaRef.pipe(SubscriptionRef.getUnsafe, AsyncResult.isSuccess) &&
          graceRef.pipe(SubscriptionRef.getUnsafe, AsyncResult.isSuccess),
        "row refs did not receive the shared table snapshot",
      )

      const ada = adaRef.pipe(SubscriptionRef.getUnsafe)
      const grace = graceRef.pipe(SubscriptionRef.getUnsafe)
      expect(subscribeCalls()).toBe(1)
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
      const { client, applySubscription, subscribeCalls } = makeClient(
        userRelation.handle,
        eventRelation.handle,
      )
      const tableRef = yield* client.subscribeTableRef("user")
      const groupRef = yield* client.subscribeTableGroupRef(["user"] as const)

      yield* waitForPredicate(
        () => subscribeCalls() === 1,
        "table and table-group refs opened more than one subscription",
      )
      userRelation.replaceRows([rawUserRow("user-1", "Ada")])
      applySubscription()
      yield* waitForPredicate(
        () =>
          tableRef.pipe(SubscriptionRef.getUnsafe, AsyncResult.isSuccess) &&
          groupRef.pipe(SubscriptionRef.getUnsafe, AsyncResult.isSuccess),
        "table and table-group refs did not receive the shared snapshot",
      )

      const table = tableRef.pipe(SubscriptionRef.getUnsafe)
      const group = groupRef.pipe(SubscriptionRef.getUnsafe)
      expect(subscribeCalls()).toBe(1)
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

    expect(rows("user", new Uint8Array([1, 2, 3]))).toBe(
      rows("user", new Uint8Array([1, 2, 3])),
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
      const { client, applySubscription, subscribeCalls } = makeClient(
        userRelation.handle,
        eventRelation.handle,
      )
      const registry = AtomRegistry.make()
      yield* Effect.addFinalizer(() => Effect.succeed(registry.dispose()))
      const rows = rowAtomFamily<typeof FullModule>(client)
      const rowAValues: Array<RowRefValue<UserRow>> = []
      const rowBValues: Array<RowRefValue<UserRow>> = []
      const unsubscribeA = registry.subscribe(
        rows("user", "user-1"),
        (value) => {
          rowAValues.push(value)
        },
        { immediate: true },
      )
      yield* Effect.addFinalizer(() => Effect.succeed(unsubscribeA()))
      const unsubscribeB = registry.subscribe(
        rows("user", "user-2"),
        (value) => {
          rowBValues.push(value)
        },
        { immediate: true },
      )
      yield* Effect.addFinalizer(() => Effect.succeed(unsubscribeB()))

      yield* waitForPredicate(
        () => subscribeCalls() === 1,
        "row atom subscriptions did not share the table atom",
      )
      userRelation.replaceRows([
        rawUserRow("user-1", "Ada"),
        rawUserRow("user-2", "Grace"),
      ])
      applySubscription()
      yield* waitForPredicate(
        () => rowBValues.some((value) => AsyncResult.isSuccess(value)),
        "row B atom did not receive the initial success",
      )
      const rowBSuccess = rowBValues.find((value) =>
        AsyncResult.isSuccess(value),
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
      yield* waitForPredicate(
        () =>
          rowAValues.some(
            (value) =>
              AsyncResult.isSuccess(value) &&
              Option.getOrUndefined(value.value)?.name === "Ada Updated",
          ),
        "row A atom did not receive the sibling update",
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
          initialUser,
        ])
        const eventRelation = makeRelation<RawPresenceRow, EventContext>()
        const { client, applySubscription, subscribeCalls } = makeClient(
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

        yield* waitForPredicate(
          () => subscribeCalls() === 1,
          "streamRows coalescing stream did not start subscription",
        )
        applySubscription()
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
        const thirdSnapshotExit = yield* Effect.exit(
          waitForPredicate(
            () => snapshots.length > 2,
            "unexpected third streamRows snapshot",
            10,
          ),
        )
        expect(Exit.isFailure(thirdSnapshotExit)).toBe(true)
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
  it.effect(
    "tableGroup emits an initial snapshot and re-reads after table changes",
    () =>
      Effect.gen(function* () {
        const initialUser = rawUserRow("user-0", "Seed")
        const userRelation = makeSnapshotRelation<RawUserRow, EventContext>([
          initialUser,
        ])
        const eventRelation = makeRelation<RawPresenceRow, EventContext>()
        const { client, applySubscription, subscribeCalls } = makeClient(
          userRelation.handle,
          eventRelation.handle,
        )
        const group = client.tableGroup(["user"] as const)
        const snapshotsFiber = yield* group.changes.pipe(
          Stream.take(2),
          Stream.runCollect,
          Effect.forkScoped,
        )

        yield* waitForPredicate(
          () => subscribeCalls() === 1,
          "tableGroup changes did not start subscription after initial snapshot",
        )
        applySubscription()
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
        const { client, applySubscription, subscribeCalls } = makeClient(
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

        yield* waitForPredicate(
          () => subscribeCalls() === 1,
          "tableGroup coalescing stream did not start subscription",
        )
        applySubscription()
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
        const thirdSnapshotExit = yield* Effect.exit(
          waitForPredicate(
            () => snapshots.length > 2,
            "unexpected third tableGroup snapshot",
            10,
          ),
        )
        expect(Exit.isFailure(thirdSnapshotExit)).toBe(true)
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
        const onAppliedCallbacks: Array<() => void> = []
        let subscribeCalls = 0
        const builder = {
          onApplied: (callback: () => void) => {
            onAppliedCallbacks.push(callback)
            return builder
          },
          onError: () => builder,
          subscribe: () => {
            subscribeCalls = subscribeCalls + 1
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

        yield* waitForPredicate(
          () => onAppliedCallbacks.length === 1,
          "first grouped table subscription did not start",
        )
        onAppliedCallbacks.shift()?.()
        yield* waitForPredicate(
          () => onAppliedCallbacks.length === 1 && subscribeCalls === 2,
          "second grouped table subscription did not start",
        )
        onAppliedCallbacks.shift()?.()
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
        const thirdSnapshotExit = yield* Effect.exit(
          waitForPredicate(
            () => snapshots.length > 2,
            "unexpected third grouped table snapshot",
            10,
          ),
        )
        expect(Exit.isFailure(thirdSnapshotExit)).toBe(true)
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
        const { client, applySubscription, subscribeCalls } = makeClient(
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

        yield* waitForPredicate(
          () => subscribeCalls() === 1,
          "tableGroup queued-dispatch stream did not start subscription",
        )
        applySubscription()
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
        const { client, applySubscription, subscribeCalls } = makeClient(
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

        yield* waitForPredicate(
          () => subscribeCalls() === 1,
          "tableGroup buffer convergence stream did not start subscription",
        )
        applySubscription()
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
        const { client, applySubscription, subscribeCalls } = makeClient(
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
        yield* waitForPredicate(
          () => subscribeCalls() === 1,
          "streamTable did not start subscription",
        )
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
      const onAppliedCallbacks: Array<() => void> = []
      const unsubscribed = new Set<number>()
      let subscribeCalls = 0
      const client = StdbTesting.ClientWs.make({
        module: FullModule,
        connection: {
          db: makeFullModuleWsDb<EventContext>(),
          subscriptionBuilder: () => {
            const builder = {
              onApplied: (callback: () => void) => {
                onAppliedCallbacks.push(callback)
                return builder
              },
              onError: () => builder,
              subscribe: () => {
                subscribeCalls = subscribeCalls + 1
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
          yield* waitForPredicate(
            () => subscribeCalls === 2 && onAppliedCallbacks.length === 2,
            "same-target streams did not start independent subscriptions",
          )
          yield* Effect.forEach(onAppliedCallbacks, (apply) =>
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
        const onAppliedCallbacks: Array<() => void> = []
        let subscribeCalls = 0
        const activeBuilder = {
          onApplied: (callback: () => void) => {
            onAppliedCallbacks.push(callback)
            return activeBuilder
          },
          onError: () => activeBuilder,
          subscribe: () => {
            subscribeCalls = subscribeCalls + 1
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
            yield* waitForPredicate(
              () => subscribeCalls === 1 && onAppliedCallbacks.length === 1,
              "stream did not use the latest subscription builder",
            )
            onAppliedCallbacks.shift()?.()
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
      const { client, applySubscription, subscribeCalls } = makeClient(
        userRelation.handle,
        eventRelation.handle,
      )
      const changesFiber = yield* client
        .streamTable("user")
        .pipe(Stream.take(2), Stream.runCollect, Effect.forkScoped)
      yield* waitForPredicate(
        () => subscribeCalls() === 1,
        "streamTable did not start delete/update subscription",
      )
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
      const { client, applySubscription, subscribeCalls } = makeClient(
        userRelation.handle,
        eventRelation.handle,
      )
      expect(
        yield* collectBlockedUserInsertIds({
          client,
          userRelation,
          applySubscription,
          subscribeCalls,
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
        const { client, applySubscription, subscribeCalls } = makeClient(
          userRelation.handle,
          eventRelation.handle,
        )
        expect(
          yield* collectBlockedUserInsertIds({
            client,
            userRelation,
            applySubscription,
            subscribeCalls,
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
    "defaults missing table stream buffer fields before forwarding",
    () =>
      Effect.gen(function* () {
        const userRelation = makeRelation<RawUserRow, EventContext>()
        const eventRelation = makeRelation<RawPresenceRow, EventContext>()
        const { client, applySubscription, subscribeCalls } = makeClient(
          userRelation.handle,
          eventRelation.handle,
        )
        expect(
          yield* collectBlockedUserInsertIds({
            client,
            userRelation,
            applySubscription,
            subscribeCalls,
            streamOptions: {
              buffer: { bufferSize: 2 },
            },
            rows: [
              { id: "user-0", name: "Seed" },
              { id: "user-1", name: "Ada" },
              { id: "user-2", name: "Grace" },
              { id: "user-3", name: "Lin" },
              { id: "user-4", name: "Katherine" },
            ],
            subscriptionMessage:
              "partial-buffer streamTable did not start subscription",
            take: 3,
          }),
        ).toEqual(["user-0", "user-3", "user-4"])
      }).pipe(Effect.scoped),
  )
  it.effect(
    "keeps the oldest queued table changes when the dropping stream buffer overflows",
    () =>
      Effect.gen(function* () {
        const userRelation = makeRelation<RawUserRow, EventContext>()
        const eventRelation = makeRelation<RawPresenceRow, EventContext>()
        const { client, applySubscription, subscribeCalls } = makeClient(
          userRelation.handle,
          eventRelation.handle,
        )
        expect(
          yield* collectBlockedUserInsertIds({
            client,
            userRelation,
            applySubscription,
            subscribeCalls,
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
  it.effect(
    "uses a sliding stream buffer when no custom buffer is supplied",
    () =>
      Effect.gen(function* () {
        const userRelation = makeRelation<RawUserRow, EventContext>()
        const eventRelation = makeRelation<RawPresenceRow, EventContext>()
        const { client, applySubscription, subscribeCalls } = makeClient(
          userRelation.handle,
          eventRelation.handle,
        )
        const rows = Array.from({ length: 1027 }, (_, index) => ({
          id: `user-${index}`,
          name: `User ${index}`,
        }))
        expect(
          yield* collectBlockedUserInsertIds({
            client,
            userRelation,
            applySubscription,
            subscribeCalls,
            rows,
            subscriptionMessage:
              "default-buffer streamTable did not start subscription",
            take: 3,
          }),
        ).toEqual(["user-0", "user-3", "user-4"])
      }).pipe(Effect.scoped),
  )
  it.effect(
    "streamEventTable fails fast when the default event buffer overflows",
    () =>
      Effect.gen(function* () {
        const userRelation = makeRelation<RawUserRow, EventContext>()
        const eventRelation = makeRelation<RawPresenceRow, EventContext>()
        const { client, applySubscription, subscribeCalls } = makeClient(
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
            subscribeCalls,
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
      const { client, applySubscription, subscribeCalls } = makeClient(
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
          subscribeCalls,
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
        const { client, applySubscription, subscribeCalls } = makeClient(
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
        yield* waitForPredicate(
          () => subscribeCalls() === 1,
          "streamTableWithContext did not start subscription",
        )
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
      const { client, applySubscription, subscribeCalls } = makeClient(
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
      yield* waitForPredicate(
        () => subscribeCalls() === 1,
        "streamTableEvents did not start subscription",
      )
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
        const { client, applySubscription, subscribeCalls } = makeClient(
          userRelation.handle,
          eventRelation.handle,
        )
        const streamExitFiber = yield* client
          .streamTableEvents("user")
          .pipe(Stream.runDrain, Effect.exit, Effect.forkScoped)

        yield* waitForPredicate(
          () => subscribeCalls() === 1,
          "malformed streamTableEvents did not start subscription",
        )
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
      const { client, applySubscription, subscribeCalls } = makeClient(
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
      yield* waitForPredicate(
        () => subscribeCalls() === 1,
        "streamEventTable did not start subscription",
      )
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
      const { client, applySubscription, subscribeCalls } = makeClient(
        userRelation.handle,
        eventRelation.handle,
      )
      const eventDeferred =
        yield* Deferred.make<
          StdbTesting.InsertEvent<PresenceRow, EventContext>
        >()
      yield* client
        .streamTarget({
          kind: "eventTable",
          key: "presenceEvent",
          name: "presenceEvent",
        })
        .pipe(
          Stream.runForEach((event) =>
            Deferred.succeed(eventDeferred, event).pipe(Effect.asVoid),
          ),
          Effect.forkScoped,
        )
      yield* waitForPredicate(
        () => subscribeCalls() === 1,
        "streamTarget did not start subscription",
      )
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
  it.effect("fails active table streams when the session invalidates", () =>
    Effect.gen(function* () {
      const userRelation = makeRelation<RawUserRow, EventContext>()
      const eventRelation = makeRelation<RawPresenceRow, EventContext>()
      const { client, applySubscription, failSubscription, subscribeCalls } =
        makeClient(userRelation.handle, eventRelation.handle)
      const fiber = yield* client
        .streamTable("user")
        .pipe(Stream.runDrain, Effect.forkScoped)
      yield* waitForPredicate(
        () => subscribeCalls() === 1,
        "invalidating table stream did not start subscription",
      )
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
        ).toBeInstanceOf(StdbTesting.SubscriptionInvalidatedError)
      }
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
        let applied: (() => void) | undefined
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
              },
            }),
            subscriptionBuilder: () => {
              const builder = {
                onApplied: (callback: () => void) => {
                  applied = callback
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
            yield* waitForPredicate(
              () => typeof applied === "function",
              "cleanup test did not register apply callback",
            )
            applied?.()
          }).pipe(Effect.scoped),
        )
        expect(Exit.isSuccess(exit)).toBe(true)
      }),
  )
  it.effect("unsubscribes when the surrounding stream scope closes", () =>
    Effect.gen(function* () {
      let applied: (() => void) | undefined
      let unsubscribed = false
      const client = StdbTesting.ClientWs.make({
        module: FullModule,
        connection: {
          db: makeFullModuleWsDb<EventContext>(),
          subscriptionBuilder: () => {
            const builder = {
              onApplied: (callback: () => void) => {
                applied = callback
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
          yield* waitForPredicate(
            () => typeof applied === "function",
            "unsubscribe test did not register apply callback",
          )
          applied?.()
          yield* Effect.yieldNow
        }).pipe(Effect.scoped),
      )
      expect(Exit.isSuccess(exit)).toBe(true)
      expect(unsubscribed).toBe(true)
    }),
  )
})
