import * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Scheduler from "effect/Scheduler"
import type * as Scope from "effect/Scope"
import * as ScopeRuntime from "effect/Scope"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import * as Atom from "effect/unstable/reactivity/Atom"
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"
import type { AnyModuleSpec } from "../../contract/module.ts"
import type { TableRow } from "../../contract/table.ts"
import type { PublicPersistentTableKeys } from "../subscription-target.ts"
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
    primaryKey: unknown,
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
    primaryKey: unknown,
  ) => boolean
}

const contextForAtom = (
  registry: AtomRegistry.AtomRegistry,
  scope: ScopeRuntime.Scope,
) => {
  const services = new Map<string, unknown>()
  services.set(ScopeRuntime.Scope.key, scope)
  services.set(AtomRegistry.AtomRegistry.key, registry)
  services.set(Scheduler.Scheduler.key, registry.scheduler)
  return Context.makeUnsafe<
    Scope.Scope | AtomRegistry.AtomRegistry | Scheduler.Scheduler
  >(services)
}

const refAtom = <A, E>(
  acquire: Effect.Effect<
    SubscriptionRef.SubscriptionRef<AsyncResult.AsyncResult<A, E>>,
    never,
    Scope.Scope
  >,
): Atom.Atom<AsyncResult.AsyncResult<A, E>> =>
  Atom.readable((get) => {
    const previous = get.self<AsyncResult.AsyncResult<A, E>>()
    const scope = ScopeRuntime.makeUnsafe()
    const services = contextForAtom(get.registry, scope)
    let syncValue: AsyncResult.AsyncResult<A, E> | undefined
    let isAsync = false
    const setValue = (value: AsyncResult.AsyncResult<A, E>) => {
      if (isAsync) {
        get.setSelf(value)
      } else {
        syncValue = value
      }
    }
    const publish = (value: AsyncResult.AsyncResult<A, E>) =>
      Effect.suspend(() => {
        setValue(value)
        return Effect.void
      })
    const run = Effect.gen(function* () {
      const ref = yield* acquire
      yield* SubscriptionRef.getUnsafe(ref).pipe(publish)
      yield* SubscriptionRef.changes(ref).pipe(Stream.runForEach(publish))
    })
    const cancel = Effect.runCallbackWith(services)(run, {
      onExit: (exit) => {
        if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)) {
          setValue(exit.cause.pipe((cause) => AsyncResult.failure<A, E>(cause)))
        }
      },
    })

    isAsync = true
    get.addFinalizer(() => {
      cancel()
      Effect.runForkWith(services)(ScopeRuntime.close(scope, Exit.void))
    })

    if (syncValue !== undefined) {
      return syncValue
    }
    if (Option.isSome(previous)) {
      return AsyncResult.waiting(previous.value)
    }
    return AsyncResult.initial<A, E>(true)
  })

const tableAtomFamilyCache = new WeakMap<object, unknown>()
const rowAtomFamilyCache = new WeakMap<object, unknown>()
const tableGroupAtomFamilyCache = new WeakMap<object, unknown>()

const makeTableAtomFamily = <Module extends AnyModuleSpec>(
  session: TableAtomSession<Module>,
) => {
  const tableInputs = new Map<string, string>()
  const family = Atom.family((cacheKey: string) => {
    const key = tableInputs.get(cacheKey) as
      | PublicPersistentTableKeys<Module>
      | undefined
    if (key === undefined) {
      throw new Error(`Missing table atom input for ${cacheKey}`)
    }
    return refAtom(session.subscribeTableRef(key)) as Atom.Atom<
      TableRefValue<TableRow<Module["tables"][typeof key]>, TableRefFailure>
    >
  })

  return <Key extends PublicPersistentTableKeys<Module>>(
    key: Key,
  ): Atom.Atom<
    TableRefValue<TableRow<Module["tables"][Key]>, TableRefFailure>
  > => {
    const cacheKey = canonicalTableKey(session.moduleName, key)
    tableInputs.set(cacheKey, key)
    return family(cacheKey) as Atom.Atom<
      TableRefValue<TableRow<Module["tables"][Key]>, TableRefFailure>
    >
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

const makeRowAtomFamily = <Module extends AnyModuleSpec>(
  session: TableAtomSession<Module>,
) => {
  const tableAtoms = tableAtomFamily(session)
  const rowInputs = new Map<
    string,
    { readonly key: string; readonly primaryKey: unknown }
  >()
  const family = Atom.family((cacheKey: string) => {
    const input = rowInputs.get(cacheKey)
    if (input === undefined) {
      throw new Error(`Missing row atom input for ${cacheKey}`)
    }
    const key = input.key as PublicPersistentTableKeys<Module>
    const select = rowResultMemo(
      (row: TableRow<Module["tables"][typeof key]>) =>
        session.rowMatchesPrimaryKey(key, row, input.primaryKey),
    )
    return Atom.readable((get) => select(get(tableAtoms(key)))) as Atom.Atom<
      RowRefValue<TableRow<Module["tables"][typeof key]>, TableRefFailure>
    >
  })

  return <Key extends PublicPersistentTableKeys<Module>>(
    key: Key,
    primaryKey: unknown,
  ): Atom.Atom<
    RowRefValue<TableRow<Module["tables"][Key]>, TableRefFailure>
  > => {
    const cacheKey = canonicalRowKey(session.moduleName, key, primaryKey)
    rowInputs.set(cacheKey, { key, primaryKey })
    return family(cacheKey) as Atom.Atom<
      RowRefValue<TableRow<Module["tables"][Key]>, TableRefFailure>
    >
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
  const groupInputs = new Map<string, ReadonlyArray<string>>()
  const family = Atom.family((cacheKey: string) => {
    const keys = groupInputs.get(cacheKey) as
      | ReadonlyArray<PublicPersistentTableKeys<Module>>
      | undefined
    if (keys === undefined) {
      throw new Error(`Missing table group atom input for ${cacheKey}`)
    }
    return refAtom(session.subscribeTableGroupRef(keys)) as Atom.Atom<
      TableGroupRefValue<
        TableGroupSnapshot<Module, typeof keys>,
        TableRefFailure
      >
    >
  })

  return <const Keys extends ReadonlyArray<PublicPersistentTableKeys<Module>>>(
    keys: Keys,
  ): Atom.Atom<
    TableGroupRefValue<TableGroupSnapshot<Module, Keys>, TableRefFailure>
  > => {
    const canonicalKeys = canonicalizeTableGroupKeys(keys)
    const cacheKey = canonicalTableGroupKey(session.moduleName, canonicalKeys)
    groupInputs.set(cacheKey, canonicalKeys)
    return family(cacheKey) as Atom.Atom<
      TableGroupRefValue<TableGroupSnapshot<Module, Keys>, TableRefFailure>
    >
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
