import * as EffectVitest from "@effect/vitest"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import * as Atom from "effect/unstable/reactivity/Atom"
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"
import * as Stdb from "effect-spacetimedb"
import type {
  RowRefValue,
  TableGroupRef,
  TableGroupRefValue,
  TableGroupSnapshot,
  TableRef,
  TableRefFailure,
  TableRefValue,
} from "effect-spacetimedb/client"
import {
  rowAtomFamily,
  type TableAtomSession,
  tableAtomFamily,
  tableGroupAtomFamily,
  tableGroupSnapshotAtom,
} from "effect-spacetimedb/client/atom"
import { SubscriptionTransportError } from "effect-spacetimedb/testing"
import type { TableRow } from "../../src/contract/table.ts"
import {
  CapturedTransportModule,
  ThingId,
} from "../fixtures/captured-transport-module"
import { MinimalModule } from "../fixtures/minimal-module"
import { TestLayer } from "../helpers/test-layer"

const CommaTable = Stdb.table("a,b", {
  public: true,
  columns: { id: Stdb.string(ThingId) },
})
const ATable = Stdb.table("a", {
  public: true,
  columns: { id: Stdb.string(ThingId) },
})
const BTable = Stdb.table("b", {
  public: true,
  columns: { id: Stdb.string(ThingId) },
})
const CacheKeyCollisionModule = Stdb.StdbModule.make(
  "snapshot_cache_key_collision",
  {},
).addTables(CommaTable, ATable, BTable).spec

const { expect } = EffectVitest
const describe = EffectVitest.layer(TestLayer)

type ThingRow = TableRow<(typeof MinimalModule)["tables"]["thing"]>
type ThingRef = TableRef<ThingRow, TableRefFailure>
type ThingValue = TableRefValue<ThingRow, TableRefFailure>
type ThingRowValue = RowRefValue<ThingRow, TableRefFailure>
type ThingGroupSnapshot = TableGroupSnapshot<
  typeof MinimalModule,
  readonly ["thing"]
>
type ThingGroupRef = TableGroupRef<ThingGroupSnapshot, TableRefFailure>

const decodeThingId = Schema.decodeUnknownSync(ThingId)

const flushRegistry = Effect.promise(() => Promise.resolve())

const waitFor = (predicate: () => boolean, message: string) =>
  Effect.suspend(() => {
    const poll = (attempt: number): Effect.Effect<void> => {
      if (predicate()) {
        return Effect.void
      }
      if (attempt >= 50) {
        expect(predicate(), message).toBe(true)
        return Effect.void
      }
      return flushRegistry.pipe(Effect.andThen(() => poll(attempt + 1)))
    }
    return poll(0)
  })

const thing = (id: bigint): ThingRow => ({ id })

const successRows = (rows: ReadonlyArray<ThingRow>): ThingValue =>
  AsyncResult.success(rows)

const hasThingId = (value: ThingValue, id: bigint): boolean =>
  AsyncResult.isSuccess(value) && value.value.some((row) => row.id === id)

const hasRowThingId = (value: ThingRowValue, id: bigint): boolean =>
  AsyncResult.isSuccess(value) &&
  Option.match(value.value, {
    onNone: () => false,
    onSome: (row) => row.id === id,
  })

const hasNoRow = (value: ThingRowValue): boolean =>
  AsyncResult.isSuccess(value) && Option.isNone(value.value)

const valueAt = <A>(values: ReadonlyArray<A>, index: number): A => {
  const value = values[index]
  expect(value).not.toBeUndefined()
  return value!
}

const latestValue = <A>(values: ReadonlyArray<A>): A =>
  valueAt(values, values.length - 1)

const makeRegistry = Effect.acquireRelease(
  Effect.suspend(() =>
    Effect.succeed(
      AtomRegistry.make({
        scheduleTask: (task) => {
          let canceled = false
          queueMicrotask(() => {
            if (!canceled) {
              task()
            }
          })
          return () => {
            canceled = true
          }
        },
      }),
    ),
  ),
  (registry) =>
    Effect.suspend(() => {
      registry.dispose()
      return Effect.void
    }),
)

const makeThingSession = (
  acquire: () => Effect.Effect<ThingRef, never, Scope.Scope>,
): TableAtomSession<typeof MinimalModule> => ({
  moduleName: MinimalModule.name,
  subscribeTableRef: (key) => {
    expect(key).toBe("thing")
    return acquire() as Effect.Effect<
      TableRef<
        TableRow<(typeof MinimalModule)["tables"][typeof key]>,
        TableRefFailure
      >,
      never,
      Scope.Scope
    >
  },
  subscribeRowRef: () => Effect.die("row refs are not used by atom families"),
  subscribeTableGroupRef: () =>
    Effect.die("table group refs are not used by these tests"),
  rowMatchesPrimaryKey: (_key, row, primaryKey) => row.id === primaryKey,
})

const makeCapturedSession = (): TableAtomSession<
  typeof CapturedTransportModule
> => ({
  moduleName: CapturedTransportModule.name,
  subscribeTableRef: () => Effect.die("table ref was unexpectedly evaluated"),
  subscribeRowRef: () => Effect.die("row ref was unexpectedly evaluated"),
  subscribeTableGroupRef: () =>
    Effect.die("table group ref was unexpectedly evaluated"),
  rowMatchesPrimaryKey: () => false,
})

const makeCacheKeyCollisionSession = (): TableAtomSession<
  typeof CacheKeyCollisionModule
> => ({
  moduleName: CacheKeyCollisionModule.name,
  subscribeTableRef: () => Effect.die("table ref was unexpectedly evaluated"),
  subscribeRowRef: () => Effect.die("row ref was unexpectedly evaluated"),
  subscribeTableGroupRef: () =>
    Effect.die("table group ref was unexpectedly evaluated"),
  rowMatchesPrimaryKey: () => false,
})

const makeThingGroupSession = (options: {
  readonly ref: ThingGroupRef
  readonly onAcquire: () => void
  readonly onRelease: () => void
}): TableAtomSession<typeof MinimalModule> => ({
  moduleName: MinimalModule.name,
  subscribeTableRef: () => Effect.die("table refs are not used by this test"),
  subscribeRowRef: () => Effect.die("row refs are not used by this test"),
  subscribeTableGroupRef: (keys) => {
    expect(keys).toEqual(["thing"])
    return Effect.acquireRelease(
      Effect.suspend(() => {
        options.onAcquire()
        return Effect.succeed(options.ref)
      }),
      () =>
        Effect.suspend(() => {
          options.onRelease()
          return Effect.void
        }),
    ) as unknown as Effect.Effect<
      TableGroupRef<
        TableGroupSnapshot<typeof MinimalModule, typeof keys>,
        TableRefFailure
      >,
      never,
      Scope.Scope
    >
  },
  rowMatchesPrimaryKey: () => false,
})

// Effect exposes no public subscriber-count API for SubscriptionRef. These
// helpers are intentionally coupled to the pinned Effect beta for lifecycle
// invariants and should be revisited when the Effect substrate moves.
const activeSubscriberCount = <A>(
  ref: SubscriptionRef.SubscriptionRef<A>,
): number => {
  const atomic = ref.pubsub.pubsub as unknown as {
    readonly publisherTail: { readonly subscribers: number }
  }
  return atomic.publisherTail.subscribers
}

const dependencyAtomFor = (
  registry: AtomRegistry.AtomRegistry,
  root: Atom.Atom<unknown>,
): Atom.Atom<unknown> => {
  const atoms = Array.from(registry.getNodes().keys()).filter(
    (key): key is Atom.Atom<unknown> =>
      typeof key !== "string" && Atom.isAtom(key) && key !== root,
  )
  expect(atoms).toHaveLength(1)
  return atoms[0]!
}

describe("client atom families", (it) => {
  it.effect(
    "read table refs synchronously without marking successes waiting",
    () =>
      Effect.gen(function* () {
        const initial = thing(1n)
        const updated = thing(2n)
        const ref = yield* SubscriptionRef.make(successRows([initial]))
        const session = makeThingSession(() => Effect.succeed(ref))
        const atom = tableAtomFamily(session)("thing")
        const registry = yield* makeRegistry
        const values: Array<ThingValue> = []

        expect(Atom.isWritable(atom)).toBe(false)
        const unsubscribe = registry.subscribe(
          atom,
          (value) => {
            values.push(value)
          },
          { immediate: true },
        )

        expect(values).toHaveLength(1)
        expect(AsyncResult.isSuccess(valueAt(values, 0))).toBe(true)
        expect(valueAt(values, 0).waiting).toBe(false)
        expect(hasThingId(valueAt(values, 0), 1n)).toBe(true)

        yield* SubscriptionRef.set(ref, successRows([updated]))
        yield* waitFor(
          () => values.some((value) => hasThingId(value, 2n)),
          "table atom did not receive the ref update",
        )

        const latest = latestValue(values)
        expect(hasThingId(latest, 2n)).toBe(true)
        expect(latest.waiting).toBe(false)

        unsubscribe()
      }),
  )

  it.effect(
    "settles delayed table ref acquisition to non-waiting updates",
    () =>
      Effect.gen(function* () {
        const ref = yield* SubscriptionRef.make(successRows([thing(1n)]))
        const releaseRef = yield* Deferred.make<void>()
        const session = makeThingSession(() =>
          Effect.gen(function* () {
            yield* Deferred.await(releaseRef)
            return ref
          }),
        )
        const atom = tableAtomFamily(session)("thing")
        const registry = yield* makeRegistry
        const values: Array<ThingValue> = []
        const unsubscribe = registry.subscribe(
          atom,
          (value) => {
            values.push(value)
          },
          { immediate: true },
        )

        expect(AsyncResult.isInitial(valueAt(values, 0))).toBe(true)
        expect(valueAt(values, 0).waiting).toBe(true)

        yield* Deferred.succeed(releaseRef, void 0)
        yield* waitFor(
          () =>
            values.some(
              (value) => hasThingId(value, 1n) && value.waiting === false,
            ),
          "delayed table atom did not settle to a non-waiting success",
        )

        yield* SubscriptionRef.set(ref, successRows([thing(2n)]))
        yield* waitFor(
          () =>
            values.some(
              (value) => hasThingId(value, 2n) && value.waiting === false,
            ),
          "delayed table atom did not receive a non-waiting update",
        )

        unsubscribe()
      }),
  )

  it.effect(
    "preserves the previous ref value as waiting while reacquiring",
    () =>
      Effect.gen(function* () {
        const oldRef = yield* SubscriptionRef.make(successRows([thing(1n)]))
        const newRef = yield* SubscriptionRef.make(successRows([thing(2n)]))
        const releaseNewRef = yield* Deferred.make<void>()
        let acquisitions = 0
        const session = makeThingSession(() =>
          Effect.gen(function* () {
            acquisitions += 1
            if (acquisitions === 1) {
              return oldRef
            }
            yield* Deferred.await(releaseNewRef)
            return newRef
          }),
        )
        const atom = tableAtomFamily(session)("thing")
        const registry = yield* makeRegistry
        const values: Array<ThingValue> = []
        const unsubscribe = registry.subscribe(
          atom,
          (value) => {
            values.push(value)
          },
          { immediate: true },
        )

        expect(hasThingId(valueAt(values, 0), 1n)).toBe(true)
        expect(valueAt(values, 0).waiting).toBe(false)

        registry.refresh(dependencyAtomFor(registry, atom))

        yield* waitFor(
          () =>
            values.some(
              (value) => hasThingId(value, 1n) && value.waiting === true,
            ),
          "table atom did not preserve the old ref value as waiting",
        )
        yield* Deferred.succeed(releaseNewRef, void 0)
        yield* waitFor(
          () =>
            values.some(
              (value) => hasThingId(value, 2n) && value.waiting === false,
            ),
          "table atom did not converge to the reacquired ref",
        )

        unsubscribe()
      }),
  )

  it.effect(
    "distinguishes acquisition defects from interrupt-only failures",
    () =>
      Effect.gen(function* () {
        const registry = yield* makeRegistry
        const failing = tableAtomFamily(
          makeThingSession(() => Effect.die("acquire defect")),
        )("thing")
        const interrupted = tableAtomFamily(
          makeThingSession(() => Effect.interrupt),
        )("thing")

        const defect = registry.get(failing)
        expect(AsyncResult.isFailure(defect)).toBe(true)
        expect(AsyncResult.isInterrupted(defect)).toBe(false)

        const interruptedValue = registry.get(interrupted)
        expect(AsyncResult.isFailure(interruptedValue)).toBe(false)
        expect(AsyncResult.isInitial(interruptedValue)).toBe(true)
        expect(interruptedValue.waiting).toBe(true)
      }),
  )

  it.effect(
    "keeps one live table ref acquisition and changes subscription",
    () =>
      Effect.gen(function* () {
        const ref = yield* SubscriptionRef.make(successRows([thing(1n)]))
        let acquisitions = 0
        let finalizers = 0
        const session = makeThingSession(() =>
          Effect.gen(function* () {
            acquisitions += 1
            yield* Effect.addFinalizer(() =>
              Effect.suspend(() => {
                finalizers += 1
                return Effect.void
              }),
            )
            return ref
          }),
        )
        const atom = tableAtomFamily(session)("thing")
        const registry = yield* makeRegistry
        const values: Array<ThingValue> = []

        const firstUnsubscribe = registry.subscribe(
          atom,
          (value) => {
            values.push(value)
          },
          { immediate: true },
        )
        expect(acquisitions).toBe(1)
        expect(activeSubscriberCount(ref)).toBe(1)

        registry.refresh(atom)
        registry.refresh(atom)
        registry.refresh(atom)
        yield* flushRegistry
        expect(activeSubscriberCount(ref)).toBe(1)

        yield* SubscriptionRef.set(ref, successRows([thing(2n)]))
        yield* waitFor(
          () => values.some((value) => hasThingId(value, 2n)),
          "table atom did not receive the post-refresh update",
        )

        firstUnsubscribe()
        yield* waitFor(
          () => finalizers === 1 && activeSubscriberCount(ref) === 0,
          "table atom did not release the first acquisition",
        )

        const secondUnsubscribe = registry.subscribe(atom, () => {}, {
          immediate: true,
        })
        expect(acquisitions).toBe(2)
        expect(activeSubscriberCount(ref)).toBe(1)

        secondUnsubscribe()
        yield* waitFor(
          () => finalizers === 2 && activeSubscriberCount(ref) === 0,
          "table atom did not release the second acquisition",
        )
      }),
  )

  it.effect(
    "derives row atoms from table refs without making them writable",
    () =>
      Effect.gen(function* () {
        const ref = yield* SubscriptionRef.make(
          successRows([thing(1n), thing(2n)]),
        )
        const session = makeThingSession(() => Effect.succeed(ref))
        const atom = rowAtomFamily(session)("thing", 2n)
        const registry = yield* makeRegistry
        const values: Array<ThingRowValue> = []

        expect(Atom.isWritable(atom)).toBe(false)
        const unsubscribe = registry.subscribe(
          atom,
          (value) => {
            values.push(value)
          },
          { immediate: true },
        )

        expect(hasRowThingId(valueAt(values, 0), 2n)).toBe(true)
        expect(valueAt(values, 0).waiting).toBe(false)

        yield* SubscriptionRef.set(ref, successRows([thing(1n)]))
        yield* waitFor(
          () => values.some(hasNoRow),
          "row atom did not update when its matching table row disappeared",
        )

        const latest = latestValue(values)
        expect(hasNoRow(latest)).toBe(true)
        expect(latest.waiting).toBe(false)

        unsubscribe()
      }),
  )

  it.effect("keys atom families by structural table row and group inputs", () =>
    Effect.gen(function* () {
      const session = makeCapturedSession()
      const tables = tableAtomFamily(session)
      const rows = rowAtomFamily(session)
      const groups = tableGroupAtomFamily(session)

      expect(tables("user")).toBe(tables("user"))
      expect(tables("user")).not.toBe(tables("thing"))

      const thingOne = rows("thing", decodeThingId("thing-1"))
      expect(Atom.isWritable(thingOne)).toBe(false)
      expect(thingOne).toBe(rows("thing", decodeThingId("thing-1")))
      expect(thingOne).not.toBe(rows("thing", decodeThingId("thing-2")))

      const userThing = groups(["user", "thing"] as const)
      expect(Atom.isWritable(userThing)).toBe(false)
      expect(userThing).toBe(groups(["thing", "user", "thing"] as const))
      expect(userThing).not.toBe(groups(["user"] as const))
    }),
  )

  it.effect("memoizes snapshot atoms and propagates connection failures", () =>
    Effect.gen(function* () {
      const connectionAtom = Atom.make(
        AsyncResult.fail<string, TableAtomSession<typeof MinimalModule>>(
          "connect failed",
        ),
      )
      const first = tableGroupSnapshotAtom(connectionAtom, ["thing"] as const)
      const second = tableGroupSnapshotAtom(connectionAtom, ["thing"] as const)
      const registry = yield* makeRegistry

      expect(first).toBe(second)
      const result = registry.get(first)
      expect(AsyncResult.error(result)).toEqual(Option.some("connect failed"))
    }),
  )

  it.effect("memoizes snapshot atoms across equivalent table-key sets", () =>
    Effect.gen(function* () {
      const connectionAtom = Atom.make(
        AsyncResult.success(makeCapturedSession()),
      )
      const first = tableGroupSnapshotAtom(connectionAtom, [
        "user",
        "thing",
      ] as const)
      const reordered = tableGroupSnapshotAtom(connectionAtom, [
        "thing",
        "user",
        "thing",
      ] as const)

      expect(first).toBe(reordered)
    }),
  )

  it.effect("does not collide delimiter-like table-key sets", () =>
    Effect.gen(function* () {
      const connectionAtom = Atom.make(
        AsyncResult.success(makeCacheKeyCollisionSession()),
      )
      const commaKey = tableGroupSnapshotAtom(connectionAtom, ["a,b"] as const)
      const splitKeys = tableGroupSnapshotAtom(connectionAtom, [
        "a",
        "b",
      ] as const)

      expect(commaKey).not.toBe(splitKeys)
    }),
  )

  it.effect(
    "switches snapshot sessions without duplicate acquisition and preserves failures",
    () =>
      Effect.gen(function* () {
        const firstSuccess = AsyncResult.success<
          ThingGroupSnapshot,
          TableRefFailure
        >({ thing: [thing(1n)] })
        const secondSuccess = AsyncResult.success<
          ThingGroupSnapshot,
          TableRefFailure
        >({ thing: [thing(2n)] })
        const firstRef =
          yield* SubscriptionRef.make<
            TableGroupRefValue<ThingGroupSnapshot, TableRefFailure>
          >(firstSuccess)
        const secondRef =
          yield* SubscriptionRef.make<
            TableGroupRefValue<ThingGroupSnapshot, TableRefFailure>
          >(secondSuccess)
        let firstAcquires = 0
        let firstReleases = 0
        let secondAcquires = 0
        let secondReleases = 0
        const firstSession = makeThingGroupSession({
          ref: firstRef,
          onAcquire: () => {
            firstAcquires = firstAcquires + 1
          },
          onRelease: () => {
            firstReleases = firstReleases + 1
          },
        })
        const secondSession = makeThingGroupSession({
          ref: secondRef,
          onAcquire: () => {
            secondAcquires = secondAcquires + 1
          },
          onRelease: () => {
            secondReleases = secondReleases + 1
          },
        })
        const connectionAtom = Atom.make<
          AsyncResult.AsyncResult<
            TableAtomSession<typeof MinimalModule>,
            string
          >
        >(AsyncResult.success(firstSession))
        const snapshotAtom = tableGroupSnapshotAtom(connectionAtom, [
          "thing",
        ] as const)
        const registry = yield* makeRegistry
        const values: Array<
          AsyncResult.AsyncResult<ThingGroupSnapshot, string | TableRefFailure>
        > = []
        const unsubscribe = registry.subscribe(
          snapshotAtom,
          (value) => {
            values.push(value)
          },
          { immediate: true },
        )

        yield* waitFor(
          () => firstAcquires === 1 && values.some(AsyncResult.isSuccess),
          "first group was not acquired exactly once",
        )
        registry.set(
          connectionAtom,
          AsyncResult.waiting(AsyncResult.success(firstSession)),
        )
        yield* waitFor(
          () => latestValue(values).waiting,
          "connection waiting state was not propagated",
        )

        const tableFailure = new SubscriptionTransportError({
          cause: new Error("group failed"),
        })
        yield* SubscriptionRef.set(
          firstRef,
          AsyncResult.failWithPrevious(tableFailure, {
            previous: Option.some(firstSuccess),
          }),
        )
        yield* waitFor(
          () => latestValue(values).pipe(AsyncResult.error, Option.isSome),
          "table ref failure was not propagated",
        )
        expect(AsyncResult.value(latestValue(values))).toEqual(
          Option.some(firstSuccess.value),
        )

        registry.set(connectionAtom, AsyncResult.success(secondSession))
        yield* waitFor(
          () =>
            secondAcquires === 1 &&
            firstReleases === 1 &&
            AsyncResult.value(latestValue(values)).pipe(
              Option.exists((snapshot) => snapshot.thing[0]?.id === 2n),
            ),
          "session switch did not release the prior group",
        )
        expect(firstAcquires).toBe(1)
        expect(secondAcquires).toBe(1)

        unsubscribe()
        yield* waitFor(
          () => secondReleases === 1,
          "second group was not released",
        )
      }),
  )
})
