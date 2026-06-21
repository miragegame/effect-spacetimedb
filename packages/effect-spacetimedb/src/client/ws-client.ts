import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import type {
  ProcedureCallableDescriptor,
  ReducerCallableDescriptor,
} from "../callable-protocol.ts"
import type { AnyFieldType, FieldOptionsOf } from "../contract/field.ts"
import type { AnyModuleSpec } from "../contract/module.ts"
import type { ProcedureSpec } from "../contract/procedure.ts"
import type { ReducerSpec } from "../contract/reducer.ts"
import { type AnyTableSpec, rowType, type TableRow } from "../contract/table.ts"
import type { AnyValueType, EncodedOf } from "../contract/type.ts"
import * as Type from "../contract/type.ts"
import { addDecodeContext } from "../decode-error.ts"
import type { ModulePlan } from "../module-plan.ts"
import { makeModulePlan } from "../module-plan.ts"
import type { ClientQueryRoot } from "../query/types.ts"
import { typedEntries, typedFromEntries } from "../utils.ts"
import {
  messageFromUnknown,
  StdbDecodeError,
  TransportError,
  WsRpcInvokeError,
} from "./call-errors.ts"
import {
  callProcedure,
  callProcedureRaw,
  callReducer,
  callReducerRaw,
} from "./call-runtime.ts"
import { connectionStateFor } from "./connection-state.ts"
import {
  decodeStdbEventContext,
  type StdbEventContext,
} from "./event-context.ts"
import { type InsertEvent, type RelationHandle } from "./relation.ts"
import { make as makeRpc, type ParamsOf } from "./rpc.ts"
import {
  type EventTableStreamBufferOptions,
  type SessionStreamBufferOptions,
  streamEventTable,
  streamTableChanges,
  streamTableChangesWithContext,
  streamTableGroupChanges,
  type TableChange,
  type TableChangeWithContext,
} from "./session-stream.ts"
import {
  type EventTableSubscriptionTarget,
  type PublicEventTableKeys,
  type PublicPersistentTableKeys,
  type SubscriptionTarget,
  type TableSubscriptionTarget,
} from "./subscription-target.ts"
import * as TransportCodec from "./value-codec.ts"
import { type SubscriptionFailure } from "./ws-subscription.ts"
import {
  type SubscriptionBuilderLike,
  type SubscriptionHandleLike,
  type SubscriptionQuerySource,
  fromBuilder as subscriptionAdapterFromBuilder,
  unsubscribeHandle,
} from "./ws-subscription-adapter.ts"

export type {
  SubscriptionBuilderLike,
  SubscriptionHandleLike,
} from "./ws-subscription-adapter.ts"

type EncodedFieldValue<Field extends AnyFieldType> =
  FieldOptionsOf<Field>["optional"] extends true
    ? EncodedOf<Field> | undefined
    : EncodedOf<Field>

export type WsTableRow<Table extends AnyTableSpec> = {
  readonly [Key in keyof Table["columns"]]: EncodedFieldValue<
    Table["columns"][Key]
  >
}

export type WsDbShape<
  Module extends AnyModuleSpec,
  RelationContext = unknown,
> = {
  readonly [Key in PublicPersistentTableKeys<Module>]: RelationHandle<
    WsTableRow<Module["tables"][Key]>,
    RelationContext
  >
} & {
  readonly [Key in PublicEventTableKeys<Module>]: RelationHandle<
    WsTableRow<Module["tables"][Key]>,
    RelationContext
  >
}

export type WsConnectionLike<
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext = unknown,
> = {
  readonly db: WsDbShape<Module, RelationContext>
  readonly subscriptionBuilder: () => SubscriptionBuilderLike<
    ErrorContext,
    ClientQueryRoot<Module>
  >
}

type WsCallableConnectionLike = {
  readonly callReducerWithParams: (
    reducerName: string,
    paramsType: unknown,
    params: object,
  ) => Promise<void>
  readonly callProcedureWithParams: (
    procedureName: string,
    paramsType: unknown,
    params: object,
    returnType: unknown,
  ) => Promise<unknown>
}

export type WsCallableTransport = {
  readonly callReducerWithParams: WsCallableConnectionLike["callReducerWithParams"]
  readonly callProcedureWithParams: WsCallableConnectionLike["callProcedureWithParams"]
}

export type WsClientOptions<
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext = unknown,
> = {
  readonly module: Module
  readonly connection: WsConnectionLike<Module, ErrorContext, RelationContext>
  readonly transport?: WsCallableTransport
}

export type WsStreamOptions = {
  readonly buffer?: SessionStreamBufferOptions
}

export type WsEventTableStreamOptions = {
  readonly buffer?: EventTableStreamBufferOptions
}

const eventTableStreamOptions = (
  streamOptions: WsStreamOptions | undefined,
): WsEventTableStreamOptions | undefined => {
  if (streamOptions?.buffer === undefined) {
    return undefined
  }

  const { bufferSize } = streamOptions.buffer

  return bufferSize === undefined ? { buffer: {} } : { buffer: { bufferSize } }
}

type TableCacheClient<Row> = {
  readonly toArray: () => Effect.Effect<ReadonlyArray<Row>, StdbDecodeError>
  readonly unsafe: {
    /** Throws StdbDecodeError on decode failure; prefer toArray for typed failures. */
    readonly rows: () => ReadonlyArray<Row>
  }
}

type PublicTableCache<Module extends AnyModuleSpec> = {
  readonly [Key in PublicPersistentTableKeys<Module>]: TableCacheClient<
    TableRow<Module["tables"][Key]>
  >
}

export type PublicCache<Module extends AnyModuleSpec> = {
  readonly tables: PublicTableCache<Module>
}

export type TableGroupSnapshot<
  Module extends AnyModuleSpec,
  Keys extends ReadonlyArray<PublicPersistentTableKeys<Module>>,
> = {
  readonly [Key in Keys[number]]: ReadonlyArray<TableRow<Module["tables"][Key]>>
}

export type TableGroup<
  Module extends AnyModuleSpec,
  Keys extends ReadonlyArray<PublicPersistentTableKeys<Module>>,
> = {
  readonly keys: Keys
  readonly subscribe: Effect.Effect<void, SubscriptionFailure, Scope.Scope>
  readonly readSnapshot: Effect.Effect<
    TableGroupSnapshot<Module, Keys>,
    StdbDecodeError
  >
  readonly changes: Stream.Stream<
    TableGroupSnapshot<Module, Keys>,
    SubscriptionFailure | StdbDecodeError,
    Scope.Scope
  >
}

export type StdbTableChangeEvent<Row> = TableChangeWithContext<
  Row,
  StdbEventContext
>

const hasWsCallableTransport = (
  connection: WsConnectionLike<AnyModuleSpec, unknown, unknown>,
): connection is WsConnectionLike<AnyModuleSpec, unknown, unknown> &
  WsCallableConnectionLike =>
  "callReducerWithParams" in connection &&
  "callProcedureWithParams" in connection

const subscriptionErrorMessage = (context: unknown, error?: Error): string => {
  const fromError =
    error != null && error.message.length > 0 ? error.message : undefined
  const fromContext = messageFromUnknown(context) ?? String(context)

  return fromError ?? fromContext
}

const ensureWsParamsObject = (
  value: unknown,
): Effect.Effect<object, StdbDecodeError> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? Effect.succeed(value)
    : Effect.fail(
        new StdbDecodeError({
          phase: "args",
          cause: new Error(
            "WebSocket callable parameters must decode to an object payload",
          ),
        }),
      )

export const makeFromModulePlan = <
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext,
>(options: {
  readonly plan: ModulePlan<Module>
  readonly connection: WsConnectionLike<Module, ErrorContext, RelationContext>
  readonly transport?: WsCallableTransport
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
  const subscriptionAdapter = subscriptionAdapterFromBuilder({
    build: () => options.connection.subscriptionBuilder(),
    messageFromError: subscriptionErrorMessage,
    onAppliedError: (message) =>
      connectionState.invalidateFromTransport(message, true),
  })

  const missingRpcTransport = () =>
    Effect.fail(
      new TransportError({
        cause: new Error("WebSocket callable transport unavailable"),
      }),
    )

  const invokeReducerWithParams = (
    name: string,
    params: object,
  ): Effect.Effect<void, WsRpcInvokeError | TransportError> =>
    rpcTransport != null
      ? Effect.tryPromise({
          try: () =>
            rpcTransport.callReducerWithParams(name, undefined, params),
          catch: (cause) => new WsRpcInvokeError({ cause }),
        })
      : missingRpcTransport()

  const invokeProcedureWithParams = (
    name: string,
    params: object,
  ): Effect.Effect<unknown, WsRpcInvokeError | TransportError> =>
    rpcTransport != null
      ? Effect.tryPromise({
          try: () =>
            rpcTransport.callProcedureWithParams(
              name,
              undefined,
              params,
              undefined,
            ),
          catch: (cause) => new WsRpcInvokeError({ cause }),
        })
      : missingRpcTransport()

  const decodeTableRow = <Key extends keyof Module["tables"] & string>(
    key: Key,
    row: unknown,
  ): TableRow<Module["tables"][Key]> =>
    tableRowDecoders[key]!(row) as TableRow<Module["tables"][Key]>

  const subscribeQuerySource = (
    query: SubscriptionQuerySource<ClientQueryRoot<Module>>,
    telemetryTarget = "query",
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

    return connectionState.assertActive().pipe(
      Effect.withSpan("spacetimedb.ws.subscription.assert_active", {
        attributes,
      }),
      Effect.andThen(
        Effect.acquireRelease(
          subscriptionAdapter.subscribe(query).pipe(
            Effect.withSpan("spacetimedb.ws.subscription.request", {
              attributes,
            }),
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

  const subscriptionTargetLabel = (
    target: SubscriptionTarget<Module>,
  ): string =>
    Match.value(target).pipe(
      Match.discriminatorsExhaustive("kind")({
        table: (t) => `table:${t.key}`,
        eventTable: (t) => `eventTable:${t.key}`,
        allPublicTables: (t) =>
          t.keys
            .map((key) =>
              key in options.plan.publicEventTables
                ? `eventTable:${key}`
                : `table:${key}`,
            )
            .join(","),
      }),
    )

  const targetToQuerySource = (
    target: SubscriptionTarget<Module>,
  ): SubscriptionQuerySource<ClientQueryRoot<Module>> => {
    type PublicQueryRootKey = keyof ClientQueryRoot<Module> & string
    const sourceForKey =
      (
        key: PublicPersistentTableKeys<Module> | PublicEventTableKeys<Module>,
      ): SubscriptionQuerySource<ClientQueryRoot<Module>> =>
      (tables: ClientQueryRoot<Module>) =>
        tables[key as PublicQueryRootKey]

    return Match.value(target).pipe(
      Match.discriminatorsExhaustive("kind")({
        table: (t) => sourceForKey(t.key),
        eventTable: (t) => sourceForKey(t.key),
        allPublicTables: (t) => (tables: ClientQueryRoot<Module>) =>
          t.keys.map((key) => tables[key as PublicQueryRootKey]),
      }),
    )
  }

  const subscribe = (
    target: SubscriptionTarget<Module>,
  ): Effect.Effect<SubscriptionHandleLike, SubscriptionFailure, Scope.Scope> =>
    subscribeQuerySource(
      targetToQuerySource(target),
      subscriptionTargetLabel(target),
    )

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
            TransportCodec.ws
              .encode(spec.params, value)
              .pipe(Effect.flatMap(ensureWsParamsObject)),
          invoke: (name, _spec, params) =>
            invokeReducerWithParams(name, params),
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
            TransportCodec.ws
              .encode(spec.params, value)
              .pipe(Effect.flatMap(ensureWsParamsObject)),
          invoke: (name, _spec, params) =>
            invokeReducerWithParams(name, params),
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
            TransportCodec.ws
              .encode(spec.params, value)
              .pipe(Effect.flatMap(ensureWsParamsObject)),
          invoke: (name, _spec, params) =>
            invokeProcedureWithParams(name, params),
          decodeValue: <A>(type: AnyValueType, value: unknown) =>
            TransportCodec.ws.decode<A>(type, value),
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
            TransportCodec.ws
              .encode(spec.params, value)
              .pipe(Effect.flatMap(ensureWsParamsObject)),
          invoke: (name, _spec, params) =>
            invokeProcedureWithParams(name, params),
          decodeValue: <A>(type: AnyValueType, value: unknown) =>
            TransportCodec.ws.decode<A>(type, value),
        },
      }),
    callHttpHandler: () => missingRpcTransport() as never,
  })

  const tables = typedFromEntries(
    typedEntries(options.plan.publicTables).map(([key]) => {
      const relation = options.connection.db[key]
      const decodeRows = (): ReadonlyArray<
        TableRow<Module["tables"][typeof key]>
      > => Array.from(relation.iter(), (row) => decodeTableRow(key, row))
      const decodeRowsEffect = () =>
        Effect.try({
          try: () => Array.from(relation.iter()),
          catch: (cause) =>
            cause instanceof StdbDecodeError
              ? cause
              : new StdbDecodeError({
                  phase: "row",
                  cause,
                  table: key,
                }),
        }).pipe(
          Effect.flatMap((rows) =>
            Effect.forEach(rows, (row) =>
              TransportCodec.db
                .decode<TableRow<Module["tables"][typeof key]>>(
                  tableRowTypes[key]!,
                  row,
                )
                .pipe(
                  Effect.mapError((error) =>
                    addDecodeContext(error, { table: key }),
                  ),
                ),
            ),
          ),
        )
      return [
        key,
        {
          toArray: decodeRowsEffect,
          unsafe: Object.freeze({
            rows: decodeRows,
          }),
        },
      ] as const
    }),
  ) as unknown as PublicTableCache<Module>

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
      subscribe({
        kind: "table",
        key,
        name: module.tables[key]!.name,
      }),
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

    return Stream.concat(
      Stream.fromEffect(read),
      streamTable(key).pipe(
        // The native SDK applies a server message and dispatches its row
        // callbacks synchronously; one drained queue chunk therefore covers one
        // dispatch burst under normal pacing. If a future SDK yields between
        // callbacks this degrades to extra snapshots, not stale state.
        Stream.chunks,
        Stream.mapEffect(() => read),
      ),
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
      subscribe({
        kind: "table",
        key,
        name: module.tables[key]!.name,
      }),
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
      (key) =>
        subscribe({
          kind: "table",
          key,
          name: module.tables[key]!.name,
        }),
      { discard: true },
    )
    const changes = Stream.concat(
      Stream.fromEffect(readSnapshot),
      streamTableGroupChanges(
        connectionState,
        keys.map(
          (key) =>
            options.connection.db[key] as RelationHandle<unknown, unknown>,
        ),
        groupSubscribe,
        streamOptions?.buffer,
      ).pipe(
        // The native SDK applies a server message and dispatches its row
        // callbacks synchronously; one drained queue chunk therefore covers one
        // dispatch burst under normal pacing. If a future SDK yields between
        // callbacks this degrades to extra snapshots, not stale state.
        Stream.chunks,
        Stream.mapEffect(() => readSnapshot),
      ),
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
      subscribe({
        kind: "eventTable",
        key,
        name: module.tables[key]!.name,
      }),
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
  } as PublicCache<Module>

  return {
    cache,
    procedures: rpc.procedures,
    reducers: rpc.reducers,
    isInvalidated: connectionState.isInvalidated,
    subscribe,
    streamEventTable: streamEventTableForKey,
    streamRows,
    tableGroup,
    streamTableEvents,
    streamTable,
    streamTableWithContext,
    streamTarget,
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
    ...(options.transport != null ? { transport: options.transport } : {}),
  })
