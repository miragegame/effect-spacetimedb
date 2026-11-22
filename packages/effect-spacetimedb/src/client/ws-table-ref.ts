import { tableRelation } from "./websocket-contract.ts"
import type { ModulePlan } from "../module-plan.ts"
import type { MembersByPath } from "../member-path.ts"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Scope from "effect/Scope"
import * as Semaphore from "effect/Semaphore"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import { fieldOptions } from "../contract/field.ts"
import type { AnyModuleSpec } from "../contract/module.ts"
import type { TableRow } from "../contract/table.ts"
import type { SinglePrimaryKeyValue } from "../contract/table-keys.ts"
import type { PublicPersistentTableKeys } from "../subscription-target.ts"
import { typedEntries, typedFromEntries } from "../utils.ts"
import {
  subscriptionInvalidated,
  type WsConnectionState,
} from "./connection-state.ts"
import { streamTableSnapshotSignals } from "./session-stream.ts"
import {
  canonicalizeTableGroupKeys,
  canonicalValueKey,
  failureOver,
  subscribeRowRef as makeRowRef,
  subscribeTableRef as makeTableRef,
  type TableGroupRef,
  type TableRef,
  type TableRefFailure,
} from "./table-ref.ts"
import type {
  PublicTableCache,
  TableGroupSnapshot,
  WsConnectionLike,
  WsStreamOptions,
} from "./ws-client.ts"
import type { SubscriptionFailure } from "./ws-subscription.ts"

type SubscribeTable<Module extends AnyModuleSpec> = <
  Key extends PublicPersistentTableKeys<Module>,
>(
  key: Key,
  onAppliedError?: (failure: SubscriptionFailure) => void,
) => Effect.Effect<unknown, SubscriptionFailure, Scope.Scope>

type SharedTableRefEntry<Row> = {
  ref: TableRef<Row, TableRefFailure>
  refCount: number
  scope: Scope.Closeable
}

const widenSnapshotFailure = <A>(
  effect: Effect.Effect<A, TableRefFailure>,
): Effect.Effect<A, TableRefFailure> =>
  effect.pipe(Effect.mapError((error): TableRefFailure => error))

const widenSignalFailure = <A>(
  stream: Stream.Stream<A, SubscriptionFailure, Scope.Scope>,
): Stream.Stream<A, TableRefFailure, Scope.Scope> =>
  stream.pipe(Stream.mapError((error): TableRefFailure => error))

export const makeTableRefAccess = <
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext,
>(options: {
  readonly plan: ModulePlan<Module>
  readonly connection: WsConnectionLike<Module, ErrorContext, RelationContext>
  readonly connectionState: WsConnectionState
  readonly tables: PublicTableCache<Module>
  readonly subscribeTable: SubscribeTable<Module>
}) => {
  const sharedTableRefs = new Map<string, SharedTableRefEntry<unknown>>()
  const sharedTableRefSemaphore = Semaphore.makeUnsafe(1)
  const withSharedTableRefLock = Semaphore.withPermit(sharedTableRefSemaphore)
  const tablePrimaryKeyColumns = typedFromEntries(
    typedEntries(options.plan.tables).map(([key, tableSpec]) => [
      key,
      Object.entries(tableSpec.columns).find(
        ([, column]) => fieldOptions(column).primaryKey,
      )?.[0],
    ]),
  ) as Record<string, string | undefined>

  function rowMatchesPrimaryKey<Key extends PublicPersistentTableKeys<Module>>(
    key: Key,
    row: TableRow<MembersByPath<Module, "tables">[Key]>,
    primaryKey: SinglePrimaryKeyValue<MembersByPath<Module, "tables">[Key]>,
  ): boolean {
    const primaryKeyColumn = tablePrimaryKeyColumns[key]
    if (primaryKeyColumn === undefined) {
      return false
    }

    return (
      canonicalValueKey(
        row[
          primaryKeyColumn as keyof TableRow<
            MembersByPath<Module, "tables">[Key]
          >
        ],
      ) === canonicalValueKey(primaryKey)
    )
  }

  const tableRefCacheKey = <Key extends PublicPersistentTableKeys<Module>>(
    key: Key,
    streamOptions?: WsStreamOptions,
  ): string =>
    canonicalValueKey([
      "table-ref",
      options.plan.module.name,
      key,
      streamOptions?.buffer ?? null,
    ] as const)

  // A ref whose stream already ended keeps its rows, and has no stream left to
  // hear that the connection's end then revoked them: an end that came later, or
  // a `lost` end its supervisor later found it could not vouch for.
  const revokeRowsOnInvalidation = <Row>(ref: TableRef<Row, TableRefFailure>) =>
    options.connectionState.awaitRevocation().pipe(
      Effect.flatMap((invalidation) =>
        SubscriptionRef.update(ref, (current) =>
          current.pipe(AsyncResult.value, Option.isSome)
            ? failureOver(
                current,
                Cause.fail(subscriptionInvalidated(invalidation)),
              )
            : current,
        ),
      ),
      Effect.forkScoped,
    )

  function makeUnsharedTableRef<Key extends PublicPersistentTableKeys<Module>>(
    key: Key,
    streamOptions?: WsStreamOptions,
  ) {
    const relation = tableRelation(options.connection, key)

    return makeTableRef({
      readSnapshot: widenSnapshotFailure(options.tables[key].toArray()),
      signals: widenSignalFailure(
        streamTableSnapshotSignals(
          options.connectionState,
          relation,
          (onFailure) => options.subscribeTable(key, onFailure),
          streamOptions?.buffer,
        ),
      ),
    }).pipe(Effect.tap(revokeRowsOnInvalidation))
  }

  function subscribeTableRef<Key extends PublicPersistentTableKeys<Module>>(
    key: Key,
    streamOptions?: WsStreamOptions,
  ) {
    const cacheKey = tableRefCacheKey(key, streamOptions)

    return Effect.acquireRelease(
      Effect.gen(function* () {
        const existing = sharedTableRefs.get(cacheKey)
        if (existing !== undefined) {
          existing.refCount += 1
          return existing as SharedTableRefEntry<
            TableRow<MembersByPath<Module, "tables">[Key]>
          >
        }

        const scope = yield* Scope.make()
        const ref = yield* makeUnsharedTableRef(key, streamOptions).pipe(
          Effect.provideService(Scope.Scope, scope),
        )
        const entry = {
          ref,
          refCount: 1,
          scope,
        } satisfies SharedTableRefEntry<
          TableRow<MembersByPath<Module, "tables">[Key]>
        >
        sharedTableRefs.set(cacheKey, entry as SharedTableRefEntry<unknown>)
        return entry
      }).pipe(withSharedTableRefLock),
      (entry) =>
        Effect.suspend(() => {
          entry.refCount -= 1
          if (entry.refCount > 0) {
            return Effect.void
          }
          if (sharedTableRefs.get(cacheKey) === entry) {
            sharedTableRefs.delete(cacheKey)
          }
          return Scope.close(entry.scope, Exit.void)
        }).pipe(withSharedTableRefLock),
    ).pipe(Effect.map((entry) => entry.ref))
  }

  function subscribeRowRef<Key extends PublicPersistentTableKeys<Module>>(
    key: Key,
    primaryKey: SinglePrimaryKeyValue<MembersByPath<Module, "tables">[Key]>,
    streamOptions?: WsStreamOptions,
  ) {
    return makeRowRef({
      table: subscribeTableRef(key, streamOptions),
      predicate: (row) => rowMatchesPrimaryKey(key, row, primaryKey),
    })
  }

  function subscribeTableGroupRef<
    const Keys extends ReadonlyArray<PublicPersistentTableKeys<Module>>,
  >(keys: Keys, streamOptions?: WsStreamOptions) {
    const canonicalKeys = canonicalizeTableGroupKeys(keys)
    type GroupTableRefEntry = readonly [
      PublicPersistentTableKeys<Module>,
      TableRef<unknown, TableRefFailure>,
    ]
    const readGroupValue = (
      entries: ReadonlyArray<GroupTableRefEntry>,
    ): AsyncResult.AsyncResult<
      TableGroupSnapshot<Module, Keys>,
      TableRefFailure
    > => {
      const snapshotEntries: Array<readonly [string, ReadonlyArray<unknown>]> =
        []
      for (const [key, tableRef] of entries) {
        const tableValue = tableRef.pipe(SubscriptionRef.getUnsafe)
        if (AsyncResult.isFailure(tableValue)) {
          return AsyncResult.failure(tableValue.cause)
        }
        if (!AsyncResult.isSuccess(tableValue)) {
          return AsyncResult.initial(true)
        }
        snapshotEntries.push([key, tableValue.value] as const)
      }
      return AsyncResult.success(
        typedFromEntries(snapshotEntries) as unknown as TableGroupSnapshot<
          Module,
          Keys
        >,
      )
    }

    // A group's rows are only whole while every table is, so a table's failure
    // keeps the last whole snapshot rather than any one table's previous rows.
    const nextGroupValue = (
      current: AsyncResult.AsyncResult<
        TableGroupSnapshot<Module, Keys>,
        TableRefFailure
      >,
      entries: ReadonlyArray<GroupTableRefEntry>,
    ) => {
      const value = readGroupValue(entries)
      return AsyncResult.isFailure(value)
        ? failureOver(current, value.cause)
        : value
    }

    return Effect.gen(function* () {
      const tableRefs = yield* Effect.forEach(canonicalKeys, (key) =>
        subscribeTableRef(key, streamOptions).pipe(
          Effect.map(
            (ref) =>
              [
                key,
                ref as unknown as TableRef<unknown, TableRefFailure>,
              ] as const,
          ),
        ),
      )
      const ref = yield* SubscriptionRef.make(readGroupValue(tableRefs))
      const changes = tableRefs.map(([, tableRef]) =>
        SubscriptionRef.changes(tableRef),
      )

      yield* Stream.mergeAll(changes, { concurrency: "unbounded" }).pipe(
        Stream.runForEach(() =>
          SubscriptionRef.update(ref, (current) =>
            nextGroupValue(current, tableRefs),
          ),
        ),
        Effect.matchCauseEffect({
          onFailure: (cause) =>
            SubscriptionRef.update(ref, (current) =>
              failureOver(current, cause),
            ),
          onSuccess: () => Effect.void,
        }),
        Effect.forkScoped,
      )

      return ref as TableGroupRef<
        TableGroupSnapshot<Module, Keys>,
        TableRefFailure
      >
    })
  }

  return {
    subscribeTableRef,
    subscribeRowRef,
    subscribeTableGroupRef,
    rowMatchesPrimaryKey,
  }
}
