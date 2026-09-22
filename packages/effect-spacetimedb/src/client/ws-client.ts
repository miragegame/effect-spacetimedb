import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import type {
  ProcedureCallableDescriptor,
  ReducerCallableDescriptor,
} from "../callable-protocol.ts"
import type { AnyModuleSpec } from "../contract/module.ts"
import type { ProcedureSpec } from "../contract/procedure.ts"
import type { ReducerSpec } from "../contract/reducer.ts"
import { rowType, type TableRow } from "../contract/table.ts"
import type { AnyValueType } from "../contract/type.ts"
import * as Type from "../contract/type.ts"
import type { ModulePlan } from "../module-plan.ts"
import { makeModulePlan } from "../module-plan.ts"
import type {
  PublicViewKeys,
  ViewRowOf,
  WsViewRowOf,
} from "../module-projection.ts"
import type { ClientQueryRoot } from "../query/types.ts"
import {
  type EventTableSubscriptionTarget,
  type PublicEventTableKeys,
  type PublicPersistentTableKeys,
  type SubscriptionTarget,
  type TableSubscriptionTarget,
} from "../subscription-target.ts"
import { typedEntries, typedFromEntries } from "../utils.ts"
import { StdbDecodeError } from "./call-errors.ts"
import {
  callProcedure,
  callProcedureRaw,
  callReducer,
  callReducerRaw,
} from "./call-runtime.ts"
import { connectionStateFor } from "./connection-state.ts"
import { decodeStdbEventContext } from "./event-context.ts"
import { type InsertEvent, type RelationHandle } from "./relation.ts"
import { make as makeRpc, type ParamsOf } from "./rpc.ts"
import {
  streamEventTable,
  streamTableChanges,
  streamTableChangesWithContext,
  streamTableGroupChanges,
  streamTableSnapshotSignals,
  type TableChange,
  type TableChangeWithContext,
} from "./session-stream.ts"
import * as ValueCodec from "./value-codec.ts"
import {
  type WaitUntil,
  type WaitUntilOptions,
  WaitUntilTimeoutError,
} from "./wait-until.ts"
import {
  ensureWsParamsObject,
  eventTableStreamOptions,
  hasWsCallableTransport,
  missingWsRpcTransport,
  type PublicCache,
  type PublicViewCache,
  type StdbTableChangeEvent,
  subscriptionErrorMessage,
  subscriptionTargetLabel,
  type TableGroup,
  type TableGroupSnapshot,
  targetToQuerySource,
  type ViewGroup,
  type ViewGroupSnapshot,
  type WsCallableTransport,
  type WsClientOptions,
  type WsConnectionLike,
  type WsEventTableStreamOptions,
  type WsStreamOptions,
} from "./websocket-contract.ts"
import { makePublicTableCache } from "./ws-cache.ts"
import { makeWsConnectionAwareCalls } from "./ws-call-liveness.ts"
import {
  SubscriptionInvalidatedError,
  type SubscriptionFailure,
} from "./ws-subscription.ts"
import {
  type SubscriptionHandleLike,
  type SubscriptionQuerySource,
  fromBuilder as subscriptionAdapterFromBuilder,
  unsubscribeHandle,
  unsubscribeThen,
} from "./ws-subscription-adapter.ts"
import { makeTableRefAccess } from "./ws-table-ref.ts"

export type {
  NativeSubscriptionHandleLike,
  SubscriptionBuilderLike,
  SubscriptionHandleLike,
} from "./ws-subscription-adapter.ts"
export { unsubscribeThen }
export { type WaitUntilOptions, WaitUntilTimeoutError } from "./wait-until.ts"
export type {
  PublicCache,
  PublicTableCache,
  PublicViewCache,
  StdbTableChangeEvent,
  TableGroup,
  TableGroupSnapshot,
  ViewGroup,
  ViewGroupSnapshot,
  WsCallableTransport,
  WsClientOptions,
  WsConnectionLike,
  WsDbShape,
  WsEventTableStreamOptions,
  WsStreamOptions,
} from "./websocket-contract.ts"
export type { WsTableRow } from "./ws-row.ts"

export const makeFromModulePlan = <
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext,
>(options: {
  readonly plan: ModulePlan<Module>
  readonly connection: WsConnectionLike<Module, ErrorContext, RelationContext>
  readonly transport?: WsCallableTransport | undefined
}) => {
  const module = options.plan.module
  const connectionState = connectionStateFor(options.connection)
  const rpcTransport =
    options.transport ??
    (hasWsCallableTransport(options.connection)
      ? options.connection
      : undefined)
  const tableRowTypes = typedFromEntries(
    typedEntries(module.tables).map(([key, tableSpec]) => [
      key,
      rowType(tableSpec) as AnyValueType,
    ]),
  ) as Record<string, AnyValueType>
  const tableRowDecoders = typedFromEntries(
    typedEntries(module.tables).map(([key]) => {
      const decode = Type.dbCodec(tableRowTypes[key]!).decodeUnknownSync

      return [
        key,
        (row: unknown) => {
          try {
            return decode(row)
          } catch (cause) {
            throw new StdbDecodeError({
              phase: "row",
              cause,
              table: key,
            })
          }
        },
      ] as const
    }),
  ) as Record<string, (row: unknown) => unknown>
  const viewRowTypes = typedFromEntries(
    typedEntries(options.plan.publicViews).map(([key, viewSpec]) => {
      const item =
        Type.arrayItem(viewSpec.returns) ?? Type.optionItem(viewSpec.returns)
      if (item === undefined) {
        throw new Error(`Public view ${key} does not return rows`)
      }
      return [key, item] as const
    }),
  ) as Record<string, AnyValueType>
  const viewRowDecoders = typedFromEntries(
    typedEntries(options.plan.publicViews).map(([key]) => {
      const decode = Type.dbCodec(viewRowTypes[key]!).decodeUnknownSync
      return [
        key,
        (row: unknown) => {
          try {
            return decode(row)
          } catch (cause) {
            throw new StdbDecodeError({
              phase: "row",
              cause,
              table: key,
            })
          }
        },
      ] as const
    }),
  ) as Record<string, (row: unknown) => unknown>
  const viewRelation = <Key extends PublicViewKeys<Module>>(key: Key) =>
    Reflect.get(options.connection.db, key) as RelationHandle<
      WsViewRowOf<Module["views"][Key]>,
      RelationContext
    >
  const subscriptionAdapter = subscriptionAdapterFromBuilder({
    build: () => options.connection.subscriptionBuilder(),
    messageFromError: subscriptionErrorMessage,
  })

  const connectionAwareCalls = makeWsConnectionAwareCalls({
    connectionState,
    transport: rpcTransport,
  })

  const decodeTableRow = <Key extends keyof Module["tables"] & string>(
    key: Key,
    row: unknown,
  ): TableRow<Module["tables"][Key]> =>
    tableRowDecoders[key]!(row) as TableRow<Module["tables"][Key]>

  const decodeViewRow = <Key extends PublicViewKeys<Module>>(
    key: Key,
    row: unknown,
  ): ViewRowOf<Module["views"][Key]> =>
    viewRowDecoders[key]!(row) as ViewRowOf<Module["views"][Key]>

  const subscribeQuerySource = (
    query: SubscriptionQuerySource<ClientQueryRoot<Module>>,
    telemetryTarget = "query",
    onAppliedError?: (failure: SubscriptionFailure) => void,
  ): Effect.Effect<
    SubscriptionHandleLike,
    SubscriptionFailure,
    Scope.Scope
  > => {
    const attributes = {
      "spacetimedb.module": module.name,
      "spacetimedb.subscription.targets": telemetryTarget,
      "spacetimedb.transport": "ws",
    }

    const invalidated = connectionState.awaitInvalidation().pipe(
      Effect.flatMap((invalidation) =>
        Effect.fail(
          new SubscriptionInvalidatedError({
            raw: invalidation.message,
          }),
        ),
      ),
    )

    return connectionState.assertActive().pipe(
      Effect.withSpan("spacetimedb.ws.subscription.assert_active", {
        attributes,
      }),
      Effect.andThen(
        Effect.acquireRelease(
          subscriptionAdapter.subscribe(query, onAppliedError).pipe(
            Effect.withSpan("spacetimedb.ws.subscription.request", {
              attributes,
            }),
            Effect.raceFirst(invalidated),
            Effect.interruptible,
          ),
          unsubscribeHandle,
        ),
      ),
      Effect.withSpan("spacetimedb.ws.subscription", {
        attributes,
      }),
    )
  }

  const subscribe = (
    target: SubscriptionTarget<Module>,
    onAppliedError?: (failure: SubscriptionFailure) => void,
  ): Effect.Effect<SubscriptionHandleLike, SubscriptionFailure, Scope.Scope> =>
    subscribeQuerySource(
      targetToQuerySource(target),
      subscriptionTargetLabel(options.plan, target),
      onAppliedError,
    )

  const subscribeTableTarget = <Key extends PublicPersistentTableKeys<Module>>(
    key: Key,
    onAppliedError?: (failure: SubscriptionFailure) => void,
  ) => subscribe(options.plan.targets.tables[key], onAppliedError)

  const subscribeViewTarget = <Key extends PublicViewKeys<Module>>(
    key: Key,
    onAppliedError?: (failure: SubscriptionFailure) => void,
  ) => subscribe(options.plan.targets.views[key], onAppliedError)

  const rpc = makeRpc({
    reducers: options.plan.publicReducers,
    procedures: options.plan.publicProcedures,
    httpHandlers: {} as never,
    reducerCallables: options.plan.reducerCallables,
    procedureCallables: options.plan.procedureCallables,
    httpHandlerCallables: {} as never,
    callReducer: <Spec extends ReducerSpec>(
      callable: ReducerCallableDescriptor<Spec>,
      payload: ParamsOf<Spec>,
    ) =>
      callReducer({
        moduleName: module.name,
        transport: "ws",
        callable,
        payload,
        runtime: {
          prepareArgs: (spec, value) =>
            ValueCodec.ws
              .encode(spec.params, value)
              .pipe(Effect.flatMap(ensureWsParamsObject)),
          invoke: (name, _spec, params) =>
            connectionAwareCalls.invokeReducer(name, params),
        },
      }),
    callReducerRaw: <Spec extends ReducerSpec>(
      callable: ReducerCallableDescriptor<Spec>,
      payload: ParamsOf<Spec>,
    ) =>
      callReducerRaw({
        moduleName: module.name,
        transport: "ws",
        callable,
        payload,
        runtime: {
          prepareArgs: (spec, value) =>
            ValueCodec.ws
              .encode(spec.params, value)
              .pipe(Effect.flatMap(ensureWsParamsObject)),
          invoke: (name, _spec, params) =>
            connectionAwareCalls.invokeReducer(name, params),
        },
      }),
    callProcedure: <Spec extends ProcedureSpec>(
      callable: ProcedureCallableDescriptor<Spec>,
      payload: ParamsOf<Spec>,
    ) =>
      callProcedure({
        moduleName: module.name,
        transport: "ws",
        callable,
        payload,
        runtime: {
          prepareArgs: (spec, value) =>
            ValueCodec.ws
              .encode(spec.params, value)
              .pipe(Effect.flatMap(ensureWsParamsObject)),
          invoke: (name, _spec, params) =>
            connectionAwareCalls.invokeProcedure(name, params),
          decodeValue: <A>(type: AnyValueType, value: unknown) =>
            ValueCodec.ws.decode<A>(type, value),
        },
      }),
    callProcedureRaw: <Spec extends ProcedureSpec>(
      callable: ProcedureCallableDescriptor<Spec>,
      payload: ParamsOf<Spec>,
    ) =>
      callProcedureRaw({
        moduleName: module.name,
        transport: "ws",
        callable,
        payload,
        runtime: {
          prepareArgs: (spec, value) =>
            ValueCodec.ws
              .encode(spec.params, value)
              .pipe(Effect.flatMap(ensureWsParamsObject)),
          invoke: (name, _spec, params) =>
            connectionAwareCalls.invokeProcedure(name, params),
          decodeValue: <A>(type: AnyValueType, value: unknown) =>
            ValueCodec.ws.decode<A>(type, value),
        },
      }),
    callHttpHandler: () => missingWsRpcTransport as never,
  })

  const tables = makePublicTableCache({
    plan: options.plan,
    connection: options.connection,
    tableRowTypes,
    decodeTableRow,
  })
  const views = typedFromEntries(
    typedEntries(options.plan.publicViews).map(([key]) => {
      const relation = viewRelation(key)
      const decodeRows = (): ReadonlyArray<
        ViewRowOf<Module["views"][typeof key]>
      > => Array.from(relation.iter(), (row) => decodeViewRow(key, row))
      return [
        key,
        {
          count: () => relation.count(),
          toArray: () =>
            Effect.try({
              try: decodeRows,
              catch: (cause) =>
                StdbDecodeError.is(cause)
                  ? cause
                  : new StdbDecodeError({
                      phase: "row",
                      cause,
                      table: key,
                    }),
            }),
          unsafe: { rows: decodeRows },
        },
      ] as const
    }),
  ) as unknown as PublicViewCache<Module>

  function streamTable<Key extends PublicPersistentTableKeys<Module>>(
    key: Key,
    streamOptions?: WsStreamOptions,
  ): Stream.Stream<
    TableChange<TableRow<Module["tables"][Key]>>,
    SubscriptionFailure,
    Scope.Scope
  > {
    const relation = options.connection.db[key]

    return streamTableChanges(
      connectionState,
      relation,
      (onFailure) => subscribeTableTarget(key, onFailure),
      (row) => decodeTableRow(key, row),
      streamOptions?.buffer,
    )
  }

  function streamRows<Key extends PublicPersistentTableKeys<Module>>(
    key: Key,
  ): Stream.Stream<
    ReadonlyArray<TableRow<Module["tables"][Key]>>,
    SubscriptionFailure | StdbDecodeError,
    Scope.Scope
  > {
    const read = tables[key].toArray()

    return streamTableSnapshotSignals(
      connectionState,
      options.connection.db[key],
      (onFailure) => subscribeTableTarget(key, onFailure),
    ).pipe(
      // Future yielding SDKs may emit extra snapshots here, never stale state.
      Stream.chunks,
      Stream.mapEffect(() => read),
    )
  }

  function streamViewRows<Key extends PublicViewKeys<Module>>(
    key: Key,
  ): Stream.Stream<
    ReadonlyArray<ViewRowOf<Module["views"][Key]>>,
    SubscriptionFailure | StdbDecodeError,
    Scope.Scope
  > {
    const read = views[key].toArray()
    return streamTableSnapshotSignals(
      connectionState,
      viewRelation(key),
      (onFailure) => subscribeViewTarget(key, onFailure),
    ).pipe(
      Stream.chunks,
      Stream.mapEffect(() => read),
    )
  }

  function streamTableWithContext<
    Key extends PublicPersistentTableKeys<Module>,
  >(
    key: Key,
    streamOptions?: WsStreamOptions,
  ): Stream.Stream<
    TableChangeWithContext<TableRow<Module["tables"][Key]>, RelationContext>,
    SubscriptionFailure,
    Scope.Scope
  > {
    const relation = options.connection.db[key]

    return streamTableChangesWithContext(
      connectionState,
      relation,
      (onFailure) => subscribeTableTarget(key, onFailure),
      (row) => decodeTableRow(key, row),
      streamOptions?.buffer,
    )
  }

  function streamTableEvents<Key extends PublicPersistentTableKeys<Module>>(
    key: Key,
    streamOptions?: WsStreamOptions,
  ): Stream.Stream<
    StdbTableChangeEvent<TableRow<Module["tables"][Key]>>,
    SubscriptionFailure,
    Scope.Scope
  > {
    return streamTableWithContext(key, streamOptions).pipe(
      Stream.mapEffect((change) =>
        decodeStdbEventContext(change.context, { table: key }).pipe(
          Effect.map((context) => ({ ...change, context })),
        ),
      ),
    )
  }

  function tableGroup<
    const Keys extends ReadonlyArray<PublicPersistentTableKeys<Module>>,
  >(keys: Keys, streamOptions?: WsStreamOptions): TableGroup<Module, Keys> {
    const readSnapshot = Effect.forEach(keys, (key) =>
      tables[key].toArray().pipe(Effect.map((rows) => [key, rows] as const)),
    ).pipe(
      Effect.map(
        (entries) =>
          typedFromEntries(entries) as unknown as TableGroupSnapshot<
            Module,
            Keys
          >,
      ),
    )
    const groupSubscribe = Effect.forEach(
      keys,
      function subscribeWithoutFailureSink(key) {
        return subscribeTableTarget(key)
      },
      { discard: true },
    )
    const changes = streamTableGroupChanges(
      connectionState,
      keys.map(
        (key) => options.connection.db[key] as RelationHandle<unknown, unknown>,
      ),
      (onFailure) =>
        Effect.forEach(keys, (key) => subscribeTableTarget(key, onFailure), {
          discard: true,
        }),
      streamOptions?.buffer,
    ).pipe(
      // Future yielding SDKs may emit extra snapshots here, never stale state.
      Stream.chunks,
      Stream.mapEffect(() => readSnapshot),
    )

    return {
      keys,
      subscribe: groupSubscribe,
      readSnapshot,
      changes,
    }
  }

  function viewGroup<const Keys extends ReadonlyArray<PublicViewKeys<Module>>>(
    keys: Keys,
    streamOptions?: WsStreamOptions,
  ): ViewGroup<Module, Keys> {
    const readSnapshot = Effect.forEach(keys, (key) =>
      views[key].toArray().pipe(Effect.map((rows) => [key, rows] as const)),
    ).pipe(
      Effect.map(
        (entries) =>
          typedFromEntries(entries) as unknown as ViewGroupSnapshot<
            Module,
            Keys
          >,
      ),
    )
    const groupSubscribe = Effect.forEach(
      keys,
      function subscribeViewWithoutFailureSink(key) {
        return subscribeViewTarget(key)
      },
      { discard: true },
    )
    const changes = streamTableGroupChanges(
      connectionState,
      keys.map((key) => viewRelation(key)),
      (onFailure) =>
        Effect.forEach(keys, (key) => subscribeViewTarget(key, onFailure), {
          discard: true,
        }),
      streamOptions?.buffer,
    ).pipe(
      Stream.chunks,
      Stream.mapEffect(() => readSnapshot),
    )

    return {
      keys,
      subscribe: groupSubscribe,
      readSnapshot,
      changes,
    }
  }

  function streamEventTableForKey<Key extends PublicEventTableKeys<Module>>(
    key: Key,
    streamOptions?: WsEventTableStreamOptions,
  ): Stream.Stream<
    InsertEvent<TableRow<Module["tables"][Key]>, RelationContext>,
    SubscriptionFailure,
    Scope.Scope
  > {
    const relation = options.connection.db[key]

    return streamEventTable(
      connectionState,
      relation,
      (onFailure) =>
        subscribe(options.plan.targets.eventTables[key], onFailure),
      (row) => decodeTableRow(key, row),
      streamOptions?.buffer,
    )
  }

  function streamTarget<Key extends PublicPersistentTableKeys<Module>>(
    target: TableSubscriptionTarget<Module, Key>,
    streamOptions?: WsStreamOptions,
  ): Stream.Stream<
    TableChange<TableRow<Module["tables"][Key]>>,
    SubscriptionFailure,
    Scope.Scope
  >
  function streamTarget<Key extends PublicEventTableKeys<Module>>(
    target: EventTableSubscriptionTarget<Module, Key>,
    streamOptions?: WsEventTableStreamOptions,
  ): Stream.Stream<
    InsertEvent<TableRow<Module["tables"][Key]>, RelationContext>,
    SubscriptionFailure,
    Scope.Scope
  >
  function streamTarget(
    target:
      | TableSubscriptionTarget<Module>
      | EventTableSubscriptionTarget<Module>,
    streamOptions?: WsStreamOptions,
  ): Stream.Stream<unknown, SubscriptionFailure, Scope.Scope> {
    return Match.value(target).pipe(
      Match.discriminatorsExhaustive("kind")({
        table: (t) => streamTable(t.key, streamOptions),
        eventTable: (t) =>
          streamEventTableForKey(t.key, eventTableStreamOptions(streamOptions)),
      }),
    )
  }

  const cache = {
    tables,
    views,
  } as PublicCache<Module>
  const tableRefAccess = makeTableRefAccess({
    module,
    connection: options.connection,
    connectionState,
    tables,
    subscribeTable: subscribeTableTarget,
  })

  const waitUntil: WaitUntil<Module> = (key, predicate, waitOptions) => {
    let snapshotSizeLast = 0
    const timeout = waitOptions?.timeout ?? "10 seconds"
    const matching = tableGroup([key] as const).changes.pipe(
      Stream.map((snapshot) => snapshot[key]),
      Stream.map((rows) => {
        snapshotSizeLast = rows.length
        return rows.filter(predicate)
      }),
      Stream.filter((rows) => rows.length > 0),
      Stream.runHead,
      Effect.flatMap((rows) =>
        rows.pipe(
          Match.value,
          Match.when({ _tag: "Some" }, (some) => Effect.succeed(some.value)),
          Match.orElse(() =>
            Effect.fail(
              new WaitUntilTimeoutError({
                table: key,
                timeoutMillis: Duration.toMillis(timeout),
                snapshotSizeLast,
              }),
            ),
          ),
        ),
      ),
    )
    return matching.pipe(
      Effect.timeoutOrElse({
        duration: timeout,
        orElse: () =>
          Effect.fail(
            new WaitUntilTimeoutError({
              table: key,
              timeoutMillis: Duration.toMillis(timeout),
              snapshotSizeLast,
            }),
          ),
      }),
    )
  }

  function waitUntilView<Key extends PublicViewKeys<Module>>(
    key: Key,
    predicate: (row: ViewRowOf<Module["views"][Key]>) => boolean,
    waitOptions?: WaitUntilOptions,
  ): Effect.Effect<
    ReadonlyArray<ViewRowOf<Module["views"][Key]>>,
    SubscriptionFailure | StdbDecodeError | WaitUntilTimeoutError,
    Scope.Scope
  > {
    let snapshotSizeLast = 0
    const timeout = waitOptions?.timeout ?? "10 seconds"
    const matching = viewGroup([key] as const).changes.pipe(
      Stream.map((snapshot) => snapshot[key]),
      Stream.map((rows) => {
        snapshotSizeLast = rows.length
        return rows.filter(predicate)
      }),
      Stream.filter((rows) => rows.length > 0),
      Stream.runHead,
      Effect.flatMap((rows) =>
        rows.pipe(
          Match.value,
          Match.when({ _tag: "Some" }, (some) => Effect.succeed(some.value)),
          Match.orElse(() =>
            Effect.fail(
              new WaitUntilTimeoutError({
                table: key,
                timeoutMillis: Duration.toMillis(timeout),
                snapshotSizeLast,
              }),
            ),
          ),
        ),
      ),
    )
    return matching.pipe(
      Effect.timeoutOrElse({
        duration: timeout,
        orElse: () =>
          Effect.fail(
            new WaitUntilTimeoutError({
              table: key,
              timeoutMillis: Duration.toMillis(timeout),
              snapshotSizeLast,
            }),
          ),
      }),
    )
  }

  return {
    moduleName: module.name,
    cache,
    procedures: rpc.procedures,
    reducers: rpc.reducers,
    awaitInvalidation: connectionState.awaitInvalidation,
    isInvalidated: connectionState.isInvalidated,
    observeInvalidation: connectionState.observeInvalidation,
    isActive: () =>
      options.connection.isActive ?? !connectionState.isInvalidated(),
    subscribe,
    subscribeTableRef: tableRefAccess.subscribeTableRef,
    subscribeRowRef: tableRefAccess.subscribeRowRef,
    subscribeTableGroupRef: tableRefAccess.subscribeTableGroupRef,
    rowMatchesPrimaryKey: tableRefAccess.rowMatchesPrimaryKey,
    streamEventTable: streamEventTableForKey,
    streamRows,
    streamViewRows,
    tableGroup,
    viewGroup,
    streamTableEvents,
    streamTable,
    streamTableWithContext,
    streamTarget,
    waitUntil,
    waitUntilView,
  }
}

export const make = <
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext,
>(
  options: WsClientOptions<Module, ErrorContext, RelationContext>,
) =>
  makeFromModulePlan<Module, ErrorContext, RelationContext>({
    plan: makeModulePlan(options.module),
    connection: options.connection,
    transport: options.transport,
  })
