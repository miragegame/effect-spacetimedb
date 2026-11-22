import {
  lazyGroups,
  groupMembers,
  type ReducerKeysInGroup,
  type ProcedureKeysInGroup,
} from "./group-clients.ts"
import { tableRelation } from "./websocket-contract.ts"
import {
  generatedMemberPath,
  nestMembers,
  readMember,
  type MembersByPath,
} from "../member-path.ts"
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
import { boundedCallDurationMax } from "./call-duration.ts"
import { StdbDecodeError, type WsConnectionFailure } from "./call-errors.ts"
import {
  callProcedure,
  callProcedureRaw,
  callReducer,
  callReducerRaw,
} from "./call-runtime.ts"
import {
  connectionStateFor,
  subscriptionInvalidated,
} from "./connection-state.ts"
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
import { type WaitUntil, WaitUntilTimeoutError } from "./wait-until.ts"
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
  targetQuerySource,
  type WsCallableTransport,
  type WsClientOptions,
  type WsConnectionLike,
  type WsEventTableStreamOptions,
  type WsStreamOptions,
} from "./websocket-contract.ts"
import { makePublicTableCache } from "./ws-cache.ts"
import { makeWsConnectionAwareCalls } from "./ws-call-liveness.ts"
import type { SubscriptionFailure } from "./ws-subscription.ts"
import {
  bindHandleToConnection,
  type SubscriptionHandleLike,
  type SubscriptionQuerySource,
  fromBuilder as subscriptionAdapterFromBuilder,
  unsubscribeHandle,
  unsubscribeThen,
} from "./ws-subscription-adapter.ts"
import { makeTableRefAccess } from "./ws-table-ref.ts"
import { makeWsViewReads } from "./ws-view-reads.ts"

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
  ViewGroupArgs,
  ViewGroupOptionsParam,
  ViewGroupSnapshot,
  ViewRowsOptionsParam,
  WaitUntilViewOptionsParam,
  WsCallableTransport,
  WsClientOptions,
  WsConnectionLike,
  WsDbShape,
  WsEventTableStreamOptions,
  WsStreamOptions,
} from "./websocket-contract.ts"
export type { WsTableRow } from "./ws-row.ts"

const sinklessSubscriptionEndedMessage =
  "A subscription with no failure sink of its own ended after it applied"

export type WsGroupClients<
  Module extends AnyModuleSpec,
  Flat extends { reducers: object; procedures: object },
> = {
  readonly [Group in
    | (Module["reducerGroups"][keyof Module["reducerGroups"]] & string)
    | (Module["procedureGroups"][keyof Module["procedureGroups"]] & string)]: {
    readonly reducers: Pick<
      Flat["reducers"],
      ReducerKeysInGroup<Module, Group> & keyof Flat["reducers"]
    >
    readonly procedures: Pick<
      Flat["procedures"],
      ProcedureKeysInGroup<Module, Group> & keyof Flat["procedures"]
    >
  }
}

export const makeFromModulePlan = <
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext,
>(options: {
  readonly plan: ModulePlan<Module>
  readonly connection: WsConnectionLike<Module, ErrorContext, RelationContext>
  readonly transport?: WsCallableTransport | undefined
  readonly callDurationMax?: Duration.Input | undefined
  /**
   * How a connection ends when a call overruns its bound, for an owner that can
   * close it. A connection nobody here owns is only invalidated.
   */
  readonly endConnection?:
    | ((message: string) => Effect.Effect<void>)
    | undefined
}) => {
  const module = options.plan.module
  const connectionState = connectionStateFor(options.connection)
  const rpcTransport =
    options.transport ??
    (hasWsCallableTransport(options.connection)
      ? options.connection
      : undefined)
  const tableRowTypes = typedFromEntries(
    typedEntries(options.plan.tables).map(([key, tableSpec]) => [
      key,
      rowType(tableSpec) as AnyValueType,
    ]),
  ) as Record<string, AnyValueType>
  const tableRowDecoders = typedFromEntries(
    typedEntries(options.plan.tables).map(([key]) => {
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
    readMember(
      options.connection.db,
      generatedMemberPath(key),
    ) as RelationHandle<
      WsViewRowOf<MembersByPath<Module, "views">[Key]>,
      RelationContext
    >
  const subscriptionAdapter = subscriptionAdapterFromBuilder({
    build: () => options.connection.subscriptionBuilder(),
    messageFromError: subscriptionErrorMessage,
  })

  // How the library ends this connection: an owner that can close it also
  // disconnects; one nobody here owns is only invalidated.
  const endConnection =
    options.endConnection ??
    ((message: string) =>
      Effect.suspend(() => {
        connectionState.invalidateFromTransport(message)
        return Effect.void
      }))

  const connectionAwareCalls = makeWsConnectionAwareCalls({
    connectionState,
    transport: rpcTransport,
    callDurationMax: boundedCallDurationMax(
      "WebSocket",
      options.callDurationMax,
    ),
    endConnection,
  })

  const decodeTableRow = <
    Key extends keyof MembersByPath<Module, "tables"> & string,
  >(
    key: Key,
    row: unknown,
  ): TableRow<MembersByPath<Module, "tables">[Key]> =>
    tableRowDecoders[key]!(row) as TableRow<
      MembersByPath<Module, "tables">[Key]
    >

  const decodeViewRow = <Key extends PublicViewKeys<Module>>(
    key: Key,
    row: unknown,
  ): ViewRowOf<MembersByPath<Module, "views">[Key]> =>
    viewRowDecoders[key]!(row) as ViewRowOf<MembersByPath<Module, "views">[Key]>

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

    const invalidated = connectionState
      .awaitInvalidation()
      .pipe(
        Effect.flatMap((invalidation) =>
          Effect.fail(subscriptionInvalidated(invalidation)),
        ),
      )

    // A subscription the server ends after it applied (an automatic
    // reconnect's replay refused it) has already lost its rows from the
    // cache. A caller that passed no sink of its own would hear nothing: the
    // connection would stay live over a cache missing that data. Ending the
    // connection, as a call overrun does, is the signal every owner already
    // watches.
    const appliedFailureSink =
      onAppliedError ??
      (() => {
        // The SDK's callback is the boundary: nothing awaits this end.
        Effect.runFork(endConnection(sinklessSubscriptionEndedMessage))
      })

    return connectionState.assertActive().pipe(
      Effect.withSpan("spacetimedb.ws.subscription.assert_active", {
        attributes,
      }),
      Effect.andThen(
        Effect.acquireRelease(
          subscriptionAdapter.subscribe(query, appliedFailureSink).pipe(
            Effect.withSpan("spacetimedb.ws.subscription.request", {
              attributes,
            }),
            Effect.raceFirst(invalidated),
            Effect.tap((handle) =>
              Effect.suspend(() => {
                bindHandleToConnection(handle, connectionState)
                return Effect.void
              }),
            ),
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
    targetQuerySource(target).pipe(
      Effect.flatMap((query) =>
        subscribeQuerySource(
          query,
          subscriptionTargetLabel(options.plan, target),
          onAppliedError,
        ),
      ),
    )

  const subscribeTableTarget = <Key extends PublicPersistentTableKeys<Module>>(
    key: Key,
    onAppliedError?: (failure: SubscriptionFailure) => void,
  ) => subscribe(options.plan.flatTargets.tables[key], onAppliedError)

  const rpc = makeRpc<Module, never, WsConnectionFailure>({
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
        ViewRowOf<MembersByPath<Module, "views">[typeof key]>
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

  const viewReads = makeWsViewReads<Module, RelationContext>({
    connectionState,
    targets: options.plan.flatTargets.views,
    views,
    viewRelation,
    subscribe,
  })

  function streamTable<Key extends PublicPersistentTableKeys<Module>>(
    key: Key,
    streamOptions?: WsStreamOptions,
  ): Stream.Stream<
    TableChange<TableRow<MembersByPath<Module, "tables">[Key]>>,
    SubscriptionFailure,
    Scope.Scope
  > {
    const relation = tableRelation(options.connection, key)

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
    ReadonlyArray<TableRow<MembersByPath<Module, "tables">[Key]>>,
    SubscriptionFailure | StdbDecodeError,
    Scope.Scope
  > {
    const read = tables[key].toArray()

    return streamTableSnapshotSignals(
      connectionState,
      tableRelation(options.connection, key),
      (onFailure) => subscribeTableTarget(key, onFailure),
    ).pipe(
      // Future yielding SDKs may emit extra snapshots here, never stale state.
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
    TableChangeWithContext<
      TableRow<MembersByPath<Module, "tables">[Key]>,
      RelationContext
    >,
    SubscriptionFailure,
    Scope.Scope
  > {
    const relation = tableRelation(options.connection, key)

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
    StdbTableChangeEvent<TableRow<MembersByPath<Module, "tables">[Key]>>,
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
        (key) =>
          tableRelation(options.connection, key) as RelationHandle<
            unknown,
            unknown
          >,
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

  function streamEventTableForKey<Key extends PublicEventTableKeys<Module>>(
    key: Key,
    streamOptions?: WsEventTableStreamOptions,
  ): Stream.Stream<
    InsertEvent<
      TableRow<MembersByPath<Module, "tables">[Key]>,
      RelationContext
    >,
    SubscriptionFailure,
    Scope.Scope
  > {
    const relation = tableRelation(options.connection, key)

    return streamEventTable(
      connectionState,
      relation,
      (onFailure) =>
        subscribe(options.plan.flatTargets.eventTables[key], onFailure),
      (row) => decodeTableRow(key, row),
      streamOptions?.buffer,
    )
  }

  function streamTarget<Key extends PublicPersistentTableKeys<Module>>(
    target: TableSubscriptionTarget<Module, Key>,
    streamOptions?: WsStreamOptions,
  ): Stream.Stream<
    TableChange<TableRow<MembersByPath<Module, "tables">[Key]>>,
    SubscriptionFailure,
    Scope.Scope
  >
  function streamTarget<Key extends PublicEventTableKeys<Module>>(
    target: EventTableSubscriptionTarget<Module, Key>,
    streamOptions?: WsEventTableStreamOptions,
  ): Stream.Stream<
    InsertEvent<
      TableRow<MembersByPath<Module, "tables">[Key]>,
      RelationContext
    >,
    SubscriptionFailure,
    Scope.Scope
  >
  function streamTarget(
    target:
      | Pick<TableSubscriptionTarget<Module>, "key" | "kind">
      | Pick<EventTableSubscriptionTarget<Module>, "key" | "kind">,
    streamOptions?: WsStreamOptions,
  ): Stream.Stream<unknown, SubscriptionFailure, Scope.Scope> {
    return target.kind === "table"
      ? streamTable(target.key, streamOptions)
      : streamEventTableForKey(
          target.key,
          eventTableStreamOptions(streamOptions),
        )
  }

  const cache = {
    tables: nestMembers(tables),
    views: nestMembers(views),
  } as PublicCache<Module>
  const tableRefAccess = makeTableRefAccess({
    plan: options.plan,
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

  return {
    moduleName: module.name,
    groups: lazyGroups(
      [
        ...Object.values(module.reducerGroups),
        ...Object.values(module.procedureGroups),
      ],
      (id) => ({
        reducers: groupMembers(rpc.reducers, module.reducerGroups, id),
        procedures: groupMembers(rpc.procedures, module.procedureGroups, id),
      }),
    ) as WsGroupClients<Module, Pick<typeof rpc, "reducers" | "procedures">>,
    cache,
    procedures: rpc.procedures,
    reducers: rpc.reducers,
    awaitInvalidation: connectionState.awaitInvalidation,
    isInvalidated: connectionState.isInvalidated,
    isRevoked: connectionState.isRevoked,
    // Read when asked, because a supervisor joins a connection to the sessions it
    // replaces after building it. Typed `object` to keep the lineage internal.
    rowsOwner: (): object => connectionState.rowLineage(),
    observeInvalidation: connectionState.observeInvalidation,
    // The library's own end comes first: a call overrun on a caller-owned
    // connection only invalidates it, so the SDK still reports it active
    // while every call fails `ConnectionLostError`.
    isActive: () =>
      !connectionState.isInvalidated() && (options.connection.isActive ?? true),
    subscribe,
    subscribeTableRef: tableRefAccess.subscribeTableRef,
    subscribeRowRef: tableRefAccess.subscribeRowRef,
    subscribeTableGroupRef: tableRefAccess.subscribeTableGroupRef,
    rowMatchesPrimaryKey: tableRefAccess.rowMatchesPrimaryKey,
    streamEventTable: streamEventTableForKey,
    streamRows,
    streamViewRows: viewReads.streamViewRows,
    tableGroup,
    viewGroup: viewReads.viewGroup,
    streamTableEvents,
    streamTable,
    streamTableWithContext,
    streamTarget,
    waitUntil,
    waitUntilView: viewReads.waitUntilView,
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
    callDurationMax: options.callDurationMax,
  })
