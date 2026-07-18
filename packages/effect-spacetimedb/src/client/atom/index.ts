import * as Effect from "effect/Effect"
import * as Equal from "effect/Equal"
import * as Hash from "effect/Hash"
import * as Option from "effect/Option"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import * as Atom from "effect/unstable/reactivity/Atom"
import type { AnyModuleSpec } from "../../contract/module.ts"
import type { TableRow } from "../../contract/table.ts"
import type { SinglePrimaryKeyValue } from "../../contract/table-keys.ts"
import type { PublicPersistentTableKeys } from "../../subscription-target.ts"
import {
  canonicalizeTableGroupKeys,
  canonicalRowKey,
  canonicalTableGroupKey,
  canonicalTableKey,
  canonicalValueKey,
  type RowRef,
  type RowRefValue,
  type TableGroupRef,
  type TableGroupRefValue,
  type TableRef,
  type TableRefFailure,
  type TableRefValue,
} from "../table-ref.ts"
import type { TableGroupSnapshot, WsStreamOptions } from "../ws-client.ts"

export type TableAtomSession<Module extends AnyModuleSpec> = {
  readonly moduleName: string
  readonly subscribeTableRef: <Key extends PublicPersistentTableKeys<Module>>(
    key: Key,
    options?: WsStreamOptions,
  ) => Effect.Effect<
    TableRef<TableRow<Module["tables"][Key]>, TableRefFailure>,
    never,
    Scope.Scope
  >
  readonly subscribeRowRef: <Key extends PublicPersistentTableKeys<Module>>(
    key: Key,
    primaryKey: SinglePrimaryKeyValue<Module["tables"][Key]>,
    options?: WsStreamOptions,
  ) => Effect.Effect<
    RowRef<TableRow<Module["tables"][Key]>, TableRefFailure>,
    never,
    Scope.Scope
  >
  readonly subscribeTableGroupRef: <
    const Keys extends ReadonlyArray<PublicPersistentTableKeys<Module>>,
  >(
    keys: Keys,
    options?: WsStreamOptions,
  ) => Effect.Effect<
    TableGroupRef<TableGroupSnapshot<Module, Keys>, TableRefFailure>,
    never,
    Scope.Scope
  >
  readonly rowMatchesPrimaryKey: <
    Key extends PublicPersistentTableKeys<Module>,
  >(
    key: Key,
    row: TableRow<Module["tables"][Key]>,
    primaryKey: SinglePrimaryKeyValue<Module["tables"][Key]>,
  ) => boolean
}

const refAtom = <A, E>(
  acquire: Effect.Effect<
    SubscriptionRef.SubscriptionRef<AsyncResult.AsyncResult<A, E>>,
    never,
    Scope.Scope
  >,
): Atom.Atom<AsyncResult.AsyncResult<A, E>> => {
  const refSource = Atom.make(acquire)
  return Atom.readable((get) => {
    const outer = get(refSource)
    if (AsyncResult.isSuccess(outer)) {
      const ref = outer.value
      // During reacquire, Atom.make keeps the old ref while marking the outer
      // result waiting; preserve that waiting state for replayed inner values.
      get.addFinalizer(
        SubscriptionRef.changes(ref).pipe(
          Stream.runForEachArray((values) => {
            for (const value of values) {
              get.setSelf(outer.waiting ? AsyncResult.waiting(value) : value)
            }
            return Effect.void
          }),
          Effect.runCallback,
        ),
      )
      const current = SubscriptionRef.getUnsafe(ref)
      return outer.waiting ? AsyncResult.waiting(current) : current
    }
    const outerCause = AsyncResult.cause(outer)
    if (Option.isSome(outerCause)) {
      if (!AsyncResult.isInterrupted(outer)) {
        return AsyncResult.failure(outerCause.value)
      }
    }
    const previous = get.self<AsyncResult.AsyncResult<A, E>>()
    if (Option.isSome(previous)) {
      return AsyncResult.waiting(previous.value)
    }
    return AsyncResult.initial<A, E>(true)
  })
}

type AtomFamilyKeyKind = "table" | "row" | "group"

class AtomFamilyKey<Payload> implements Equal.Equal {
  readonly canonical: string
  readonly #hash: number

  constructor(
    readonly kind: AtomFamilyKeyKind,
    readonly payload: Payload,
    canonical: string,
  ) {
    this.canonical = canonicalValueKey([kind, canonical])
    this.#hash = Hash.string(this.canonical)
  }

  [Hash.symbol](): number {
    return this.#hash
  }

  [Equal.symbol](that: Equal.Equal): boolean {
    return (
      that instanceof AtomFamilyKey &&
      this.kind === that.kind &&
      this.canonical === that.canonical
    )
  }
}

const tableAtomFamilyCache = new WeakMap<object, unknown>()
const rowAtomFamilyCache = new WeakMap<object, unknown>()
const tableGroupAtomFamilyCache = new WeakMap<object, unknown>()
const tableGroupSnapshotAtomCache = new WeakMap<
  object,
  Map<string, Atom.Atom<unknown>>
>()

const makeTableAtomFamily = <Module extends AnyModuleSpec>(
  session: TableAtomSession<Module>,
) => {
  const family = Atom.family(
    <Key extends PublicPersistentTableKeys<Module>>(
      input: AtomFamilyKey<Key>,
    ) => {
      const key = input.payload
      return refAtom(session.subscribeTableRef(key))
    },
  )

  return <Key extends PublicPersistentTableKeys<Module>>(
    key: Key,
  ): Atom.Atom<
    TableRefValue<TableRow<Module["tables"][Key]>, TableRefFailure>
  > => {
    const cacheKey = canonicalTableKey(session.moduleName, key)
    return family(new AtomFamilyKey("table", key, cacheKey))
  }
}

export const tableAtomFamily = <Module extends AnyModuleSpec>(
  session: TableAtomSession<Module>,
) => {
  const existing = tableAtomFamilyCache.get(session)
  if (existing !== undefined) {
    return existing as ReturnType<typeof makeTableAtomFamily<Module>>
  }
  const created = makeTableAtomFamily(session)
  tableAtomFamilyCache.set(session, created)
  return created
}

const rowResultMemo = <Row, E>(predicate: (row: Row) => boolean) => {
  const successByRow = new WeakMap<object, RowRefValue<Row, E>>()
  let previousSuccessKey: string | undefined
  let previousSuccess: RowRefValue<Row, E> | undefined
  const none = AsyncResult.success<Option.Option<Row>, E>(Option.none())
  return (result: TableRefValue<Row, E>): RowRefValue<Row, E> => {
    if (!AsyncResult.isSuccess(result)) {
      return AsyncResult.map(result, (rows) =>
        Option.fromUndefinedOr(rows.find(predicate)),
      )
    }
    const row = result.value.find(predicate)
    if (row === undefined) {
      previousSuccessKey = undefined
      previousSuccess = undefined
      return none
    }
    if (typeof row === "object" && row !== null) {
      const cached = successByRow.get(row)
      if (cached !== undefined) {
        return cached
      }
    }
    const rowKey = canonicalValueKey(row)
    if (previousSuccessKey === rowKey && previousSuccess !== undefined) {
      return previousSuccess
    }
    const next = AsyncResult.success<Option.Option<Row>, E>(Option.some(row))
    previousSuccessKey = rowKey
    previousSuccess = next
    if (typeof row === "object" && row !== null) {
      successByRow.set(row, next)
    }
    return next
  }
}

type RowAtomInput<
  Module extends AnyModuleSpec,
  Key extends PublicPersistentTableKeys<Module>,
> = {
  readonly key: Key
  readonly primaryKey: SinglePrimaryKeyValue<Module["tables"][Key]>
}

const makeRowAtomFamily = <Module extends AnyModuleSpec>(
  session: TableAtomSession<Module>,
) => {
  const tableAtoms = tableAtomFamily(session)
  const makeRowAtom = <Key extends PublicPersistentTableKeys<Module>>(
    input: AtomFamilyKey<RowAtomInput<Module, Key>>,
  ): Atom.Atom<
    RowRefValue<TableRow<Module["tables"][Key]>, TableRefFailure>
  > => {
    const { key, primaryKey } = input.payload
    const select = rowResultMemo<
      TableRow<Module["tables"][Key]>,
      TableRefFailure
    >((row: TableRow<Module["tables"][Key]>) =>
      session.rowMatchesPrimaryKey(key, row, primaryKey),
    )
    return Atom.readable((get) => select(get(tableAtoms(key))))
  }
  const family: typeof makeRowAtom = Atom.family(makeRowAtom)

  return <Key extends PublicPersistentTableKeys<Module>>(
    key: Key,
    primaryKey: SinglePrimaryKeyValue<Module["tables"][Key]>,
  ): Atom.Atom<
    RowRefValue<TableRow<Module["tables"][Key]>, TableRefFailure>
  > => {
    const cacheKey = canonicalRowKey(session.moduleName, key, primaryKey)
    return family(new AtomFamilyKey("row", { key, primaryKey }, cacheKey))
  }
}

export const rowAtomFamily = <Module extends AnyModuleSpec>(
  session: TableAtomSession<Module>,
) => {
  const existing = rowAtomFamilyCache.get(session)
  if (existing !== undefined) {
    return existing as ReturnType<typeof makeRowAtomFamily<Module>>
  }
  const created = makeRowAtomFamily(session)
  rowAtomFamilyCache.set(session, created)
  return created
}

const makeTableGroupAtomFamily = <Module extends AnyModuleSpec>(
  session: TableAtomSession<Module>,
) => {
  const family = Atom.family(
    <const Keys extends ReadonlyArray<PublicPersistentTableKeys<Module>>>(
      input: AtomFamilyKey<Keys>,
    ) => {
      const keys = input.payload
      return refAtom(session.subscribeTableGroupRef(keys))
    },
  )

  return <const Keys extends ReadonlyArray<PublicPersistentTableKeys<Module>>>(
    keys: Keys,
  ): Atom.Atom<
    TableGroupRefValue<TableGroupSnapshot<Module, Keys>, TableRefFailure>
  > => {
    const canonicalKeys = canonicalizeTableGroupKeys(keys)
    const cacheKey = canonicalTableGroupKey(session.moduleName, canonicalKeys)
    return family(new AtomFamilyKey("group", canonicalKeys, cacheKey))
  }
}

export const tableGroupAtomFamily = <Module extends AnyModuleSpec>(
  session: TableAtomSession<Module>,
) => {
  const existing = tableGroupAtomFamilyCache.get(session)
  if (existing !== undefined) {
    return existing as ReturnType<typeof makeTableGroupAtomFamily<Module>>
  }
  const created = makeTableGroupAtomFamily(session)
  tableGroupAtomFamilyCache.set(session, created)
  return created
}

const makeTableGroupSnapshotAtom = <
  Module extends AnyModuleSpec,
  E,
  const Keys extends ReadonlyArray<PublicPersistentTableKeys<Module>>,
>(
  connectionAtom: Atom.Atom<
    AsyncResult.AsyncResult<TableAtomSession<Module>, E>
  >,
  keys: Keys,
): Atom.Atom<
  AsyncResult.AsyncResult<TableGroupSnapshot<Module, Keys>, E | TableRefFailure>
> =>
  Atom.readable((get) => {
    const connection = get(connectionAtom)
    const snapshot = AsyncResult.flatMap(connection, (session) => {
      const result = get(tableGroupAtomFamily(session)(keys))
      return connection.waiting ? AsyncResult.waiting(result) : result
    })
    if (!AsyncResult.isInitial(snapshot)) {
      return snapshot
    }

    const previous =
      get.self<
        AsyncResult.AsyncResult<
          TableGroupSnapshot<Module, Keys>,
          E | TableRefFailure
        >
      >()
    return Option.match(previous, {
      onNone: () => snapshot,
      onSome: AsyncResult.waiting,
    })
  })

export const tableGroupSnapshotAtom = <
  Module extends AnyModuleSpec,
  E,
  const Keys extends ReadonlyArray<PublicPersistentTableKeys<Module>>,
>(
  connectionAtom: Atom.Atom<
    AsyncResult.AsyncResult<TableAtomSession<Module>, E>
  >,
  keys: Keys,
): Atom.Atom<
  AsyncResult.AsyncResult<TableGroupSnapshot<Module, Keys>, E | TableRefFailure>
> => {
  let cache = tableGroupSnapshotAtomCache.get(connectionAtom)
  if (cache === undefined) {
    cache = new Map()
    tableGroupSnapshotAtomCache.set(connectionAtom, cache)
  }

  const canonical = canonicalValueKey(canonicalizeTableGroupKeys(keys))
  const existing = cache.get(canonical)
  if (existing !== undefined) {
    return existing as Atom.Atom<
      AsyncResult.AsyncResult<
        TableGroupSnapshot<Module, Keys>,
        E | TableRefFailure
      >
    >
  }

  const created = makeTableGroupSnapshotAtom(connectionAtom, keys)
  cache.set(canonical, created)
  return created
}
