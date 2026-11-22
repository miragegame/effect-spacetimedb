export type {
  ReducerKeysInGroup,
  ProcedureKeysInGroup,
} from "../group-clients.ts"
export type { WsGroupClients } from "../ws-client.ts"
import type { MembersByPath } from "../../member-path.ts"
import * as Effect from "effect/Effect"
import * as Equal from "effect/Equal"
import * as Hash from "effect/Hash"
import * as Option from "effect/Option"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import * as Atom from "effect/reactivity/Atom"
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
  /** Whether what this session read may no longer be shown. */
  readonly isRevoked: () => boolean
  /**
   * Opaque, and compared by reference: a session may show what another read only
   * if both answer with the same value.
   */
  readonly rowsOwner: () => object
  readonly subscribeTableRef: <Key extends PublicPersistentTableKeys<Module>>(
    key: Key,
    options?: WsStreamOptions,
  ) => Effect.Effect<
    TableRef<TableRow<MembersByPath<Module, "tables">[Key]>, TableRefFailure>,
    never,
    Scope.Scope
  >
  readonly subscribeRowRef: <Key extends PublicPersistentTableKeys<Module>>(
    key: Key,
    primaryKey: SinglePrimaryKeyValue<MembersByPath<Module, "tables">[Key]>,
    options?: WsStreamOptions,
  ) => Effect.Effect<
    RowRef<TableRow<MembersByPath<Module, "tables">[Key]>, TableRefFailure>,
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
    row: TableRow<MembersByPath<Module, "tables">[Key]>,
    primaryKey: SinglePrimaryKeyValue<MembersByPath<Module, "tables">[Key]>,
  ) => boolean
}

export type SupervisedSessionSource<Session, Failure> = {
  readonly session: SubscriptionRef.SubscriptionRef<
    AsyncResult.AsyncResult<Session, Failure>
  >
}

export const wsSupervisedSessionAtom = <Session, Failure>(
  acquire: Effect.Effect<
    SupervisedSessionSource<Session, Failure>,
    never,
    Scope.Scope
  >,
): Atom.Atom<AsyncResult.AsyncResult<Session, Failure>> => {
  const source = Atom.subscriptionRef(
    acquire.pipe(Effect.map((supervisor) => supervisor.session)),
  )
  return Atom.readable((get) =>
    AsyncResult.flatMap(get(source), (current) => current),
  )
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
    TableRefValue<
      TableRow<MembersByPath<Module, "tables">[Key]>,
      TableRefFailure
    >
  > => {
    const cacheKey = canonicalTableKey(session.moduleName, key)
    return family(new AtomFamilyKey("table", key, cacheKey))
  }
}

export const wsTableAtomFamily = <Module extends AnyModuleSpec>(
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
  readonly primaryKey: SinglePrimaryKeyValue<
    MembersByPath<Module, "tables">[Key]
  >
}

const makeRowAtomFamily = <Module extends AnyModuleSpec>(
  session: TableAtomSession<Module>,
) => {
  const tableAtoms = wsTableAtomFamily(session)
  const makeRowAtom = <Key extends PublicPersistentTableKeys<Module>>(
    input: AtomFamilyKey<RowAtomInput<Module, Key>>,
  ): Atom.Atom<
    RowRefValue<TableRow<MembersByPath<Module, "tables">[Key]>, TableRefFailure>
  > => {
    const { key, primaryKey } = input.payload
    const select = rowResultMemo<
      TableRow<MembersByPath<Module, "tables">[Key]>,
      TableRefFailure
    >((row: TableRow<MembersByPath<Module, "tables">[Key]>) =>
      session.rowMatchesPrimaryKey(key, row, primaryKey),
    )
    return Atom.readable((get) => select(get(tableAtoms(key))))
  }
  const family: typeof makeRowAtom = Atom.family(makeRowAtom)

  return <Key extends PublicPersistentTableKeys<Module>>(
    key: Key,
    primaryKey: SinglePrimaryKeyValue<MembersByPath<Module, "tables">[Key]>,
  ): Atom.Atom<
    RowRefValue<TableRow<MembersByPath<Module, "tables">[Key]>, TableRefFailure>
  > => {
    const cacheKey = canonicalRowKey(session.moduleName, key, primaryKey)
    return family(new AtomFamilyKey("row", { key, primaryKey }, cacheKey))
  }
}

export const wsRowAtomFamily = <Module extends AnyModuleSpec>(
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

export const wsTableGroupAtomFamily = <Module extends AnyModuleSpec>(
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

/**
 * A snapshot and the session its rows came from, which outlives the session
 * showing them while a replacement has none of its own. Compared by reference,
 * because a registry compares an atom's values and that would walk the session.
 */
type SourcedSnapshot<Session, Snapshot> = {
  readonly source: Option.Option<Session>
  readonly snapshot: Snapshot
}

const sourcedSnapshot = <Session, Snapshot>(
  source: Option.Option<Session>,
  snapshot: Snapshot,
): SourcedSnapshot<Session, Snapshot> =>
  Equal.byReferenceUnsafe({ source, snapshot })

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
> => {
  type Snapshot = AsyncResult.AsyncResult<
    TableGroupSnapshot<Module, Keys>,
    E | TableRefFailure
  >
  type Sourced = SourcedSnapshot<TableAtomSession<Module>, Snapshot>

  // Asking the source alone is not enough: nothing revokes the rows of a
  // connection atom that moved to another supervisor, or to no session at all, so
  // they would go on to the next user, or outlive a sign-out.
  const mayCarry = (
    previous: Sourced,
    current: Option.Option<TableAtomSession<Module>>,
  ) =>
    previous.snapshot.pipe(AsyncResult.value, Option.isSome) &&
    Option.exists(
      previous.source,
      (source) =>
        !source.isRevoked() &&
        Option.exists(
          current,
          (session) => session.rowsOwner() === source.rowsOwner(),
        ),
    )

  const sourced = Atom.readable((get): Sourced => {
    const connection = get(connectionAtom)
    const groupOf = (session: TableAtomSession<Module>) =>
      get(wsTableGroupAtomFamily(session)(keys))
    // `AsyncResult.flatMap` would keep a failure's previous value only if the
    // mapped result were a success, and the group of a session that ended is
    // itself a failure holding the rows.
    const snapshot: Snapshot = AsyncResult.isFailure(connection)
      ? AsyncResult.failureWithPrevious<
          TableGroupSnapshot<Module, Keys>,
          E | TableRefFailure
        >(connection.cause, {
          previous: Option.map(connection.previousSuccess, (retained) =>
            groupOf(retained.value),
          ),
          waiting: connection.waiting,
        })
      : AsyncResult.flatMap(connection, (session) => {
          const result = groupOf(session)
          return connection.waiting ? AsyncResult.waiting(result) : result
        })
    const source = AsyncResult.value(connection)
    if (snapshot.pipe(AsyncResult.value, Option.isSome)) {
      return sourcedSnapshot(source, snapshot)
    }

    // A read can skip the failure that ended the previous session, so the
    // previous value alone does not say whether its rows may still be shown. A
    // failure goes over carried rows, and they keep naming the session they came
    // from, so that a later replacement finds them and a revocation still reaches
    // them.
    return Option.match(
      Option.filter(get.self<Sourced>(), (previous) =>
        mayCarry(previous, source),
      ),
      {
        onNone: () => sourcedSnapshot(source, snapshot),
        onSome: (previous) =>
          sourcedSnapshot(
            previous.source,
            AsyncResult.isFailure(snapshot)
              ? AsyncResult.failureWithPrevious(snapshot.cause, {
                  previous: Option.some(previous.snapshot),
                  waiting: snapshot.waiting,
                })
              : AsyncResult.waiting(previous.snapshot),
          ),
      },
    )
  })

  return Atom.map(sourced, ({ snapshot }) => snapshot)
}

export const wsTableGroupSnapshotAtom = <
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
export {
  type SessionStreamBufferOptions,
  TableStreamOverflowError,
} from "../session-stream.ts"
export type {
  RowRef,
  RowRefValue,
  TableGroupRef,
  TableGroupRefValue,
  TableRef,
  TableRefFailure,
  TableRefValue,
} from "../table-ref.ts"
export type {
  TableGroupSnapshot,
  WsStreamOptions,
} from "../websocket-contract.ts"
export {
  type ConnectionInvalidationKind,
  type SubscriptionFailure,
  SubscriptionInvalidatedError,
  SubscriptionRejectedError,
  SubscriptionTransportError,
} from "../ws-subscription.ts"
export type {
  ConstraintSpec,
  UniqueConstraintSpec,
} from "../../contract/constraint.ts"
export type {
  Diagnostic,
  DiagnosticCode,
  DiagnosticSeverity,
} from "../../contract/diagnostic.ts"
export type {
  Declaration,
  Declarations,
  LiteralDeclaration,
  LiteralValues,
  SecretDeclaration,
  StringDeclaration,
} from "../../contract/environment.ts"
export type {
  AnyErrorDefinition,
  ProcedureDeclaredErrorType,
  TaggedErrorClass,
} from "../../contract/error.ts"
export type {
  AnyFieldType,
  AnyNormalizedFieldOptions,
  FieldOptions,
  FieldOptionsOf,
  FieldType,
  FieldValue,
  NormalizedFieldOptions,
} from "../../contract/field.ts"
export type {
  HttpHandlerMethod,
  HttpHandlerSpec,
  RawHttpHandlerSpec,
  TypedHttpHandlerSpec,
} from "../../contract/http-handler.ts"
export type {
  LifecycleName,
  LifecycleSpec,
  LifecycleSpecs,
} from "../../contract/lifecycle.ts"
export type {
  AnyModuleSpec,
  ModuleSpec,
  ModuleWireNames,
} from "../../contract/module.ts"
export type {
  ModuleMount,
  MountRecord,
  MountsOf,
  NativeMount,
} from "../../contract/mount.ts"
export type { ProcedureSpec } from "../../contract/procedure.ts"
export type { ReducerSpec } from "../../contract/reducer.ts"
export type {
  CaseConversionPolicy,
  ModuleSettings,
} from "../../contract/settings.ts"
export type { TableCachePolicy } from "../../contract/table-cache-policy.ts"
export type {
  IndexAlgorithm,
  IndexSpec,
} from "../../contract/table-index.ts"
export type {
  ColumnKey,
  PrimaryKeyNames,
  SinglePrimaryKeyName,
  SinglePrimaryKeyValue,
  SingleUnionMember,
} from "../../contract/table-keys.ts"
export type {
  AnyTableSpec,
  TableRow,
  TableSpec,
} from "../../contract/table.ts"
export {
  type AnyValueType,
  type Encoded,
  type EncodedOf,
  type HostOf,
  type HostStruct,
  type HostValue,
  type MergeTableFieldOptions,
  type NormalizedStructFieldOptions,
  StdbValueCodecError,
  type StringValueType,
  type StructFieldOptions,
  type StructFields,
  type StructFieldType,
  type StructLikeValueType,
  type StructValueType,
  type TableFieldOptionsOfValue,
  type Type,
  type TypeKind,
  type TypeOf,
  type ValueType,
} from "../../contract/type/core.ts"
export type {
  OptionalKeys,
  OptionalStructField,
  RequiredKeys,
  StructType,
} from "../../contract/type/shapes.ts"
export type {
  AnyViewSpec,
  BaseViewSpec,
} from "../../contract/view.ts"
export {
  StdbDecodeError,
  type StdbDecodePhase,
} from "../../decode-error.ts"
export type {
  Entries,
  MembersByPath,
  MountedEntries,
} from "../../member-path.ts"
export type { PlanSection } from "../../module-plan.ts"
export type { PublicPersistentTables } from "../../module-projection.ts"
export type { PublicPersistentTableKeys } from "../../subscription-target.ts"
export {
  ConnectionIdentityChangedError,
  ConnectionLostError,
} from "../call-errors.ts"
export {
  WsConnectError,
  WsConnectTimeoutError,
  WsProtocolError,
} from "../ws-resource-lifecycle.ts"
