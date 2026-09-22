import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import type * as Scope from "effect/Scope"
import type * as Stream from "effect/Stream"
import type { AnyModuleSpec } from "../contract/module.ts"
import type { AnyTableSpec, TableRow } from "../contract/table.ts"
import type { AnyViewSpec } from "../contract/view.ts"
import type { ModulePlan } from "../module-plan.ts"
import type {
  PublicViewKeys,
  ViewRowOf,
  WsViewRowOf,
} from "../module-projection.ts"
import type {
  ClientQueryRoot,
  ClientTableQueryRoot,
  ClientViewQueryRoot,
  TypedQuery,
} from "../query/types.ts"
import type {
  MatchableSubscriptionTarget,
  PublicEventTableKeys,
  PublicPersistentTableKeys,
  SubscriptionTarget,
} from "../subscription-target.ts"
import {
  messageFromUnknown,
  StdbDecodeError,
  TransportError,
} from "./call-errors.ts"
import type { ClientTableIndexAccessors } from "./client-index.ts"
import type { StdbEventContext } from "./event-context.ts"
import type { RelationHandle } from "./relation.ts"
import type {
  EventTableStreamBufferOptions,
  SessionStreamBufferOptions,
  TableChangeWithContext,
} from "./session-stream.ts"
import type { WsTableRow } from "./ws-row.ts"
import type { SubscriptionFailure } from "./ws-subscription.ts"
import type {
  SubscriptionBuilderLike,
  SubscriptionQuerySource,
} from "./ws-subscription-adapter.ts"

export type WsDbShape<
  Module extends AnyModuleSpec,
  RelationContext = unknown,
> = {
  readonly [Key in
    | PublicPersistentTableKeys<Module>
    | PublicEventTableKeys<Module>]: RelationHandle<
    WsTableRow<Module["tables"][Key]>,
    RelationContext
  >
} & WsViewDbShape<Module, RelationContext>

/**
 * Views on the generated client's `db`, keyed the same way tables are: by
 * contract key. See `isCamelCaseCanonical` in `../contract/canonical-name.ts`
 * for why the contract key *is* the generated accessor key under every name
 * policy.
 */
type WsViewDbShape<Module extends AnyModuleSpec, RelationContext> = {
  readonly [Key in PublicViewKeys<Module>]: RelationHandle<
    WsViewRowOf<Module["views"][Key]>,
    RelationContext
  >
}

export type WsConnectionLike<
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext = unknown,
> = {
  readonly isActive?: boolean | undefined
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
  readonly transport?: WsCallableTransport | undefined
}

export type WsStreamOptions = {
  readonly buffer?: SessionStreamBufferOptions | undefined
}

export type WsEventTableStreamOptions = {
  readonly buffer?: EventTableStreamBufferOptions | undefined
}

export const eventTableStreamOptions = (
  streamOptions: WsStreamOptions | undefined,
): WsEventTableStreamOptions | undefined => {
  if (streamOptions?.buffer === undefined) return undefined
  const { bufferSize } = streamOptions.buffer
  return bufferSize === undefined ? { buffer: {} } : { buffer: { bufferSize } }
}

type TableCacheClient<Table extends AnyTableSpec> = {
  readonly count: () => bigint
  readonly toArray: () => Effect.Effect<
    ReadonlyArray<TableRow<Table>>,
    StdbDecodeError
  >
  readonly unsafe: {
    /** Throws StdbDecodeError on decode failure; prefer toArray for typed failures. */
    readonly rows: () => ReadonlyArray<TableRow<Table>>
  }
} & ClientTableIndexAccessors<Table>

export type PublicTableCache<Module extends AnyModuleSpec> = {
  readonly [Key in PublicPersistentTableKeys<Module>]: TableCacheClient<
    Module["tables"][Key]
  >
}

type ViewCacheClient<View extends AnyViewSpec> = {
  readonly count: () => bigint
  readonly toArray: () => Effect.Effect<
    ReadonlyArray<ViewRowOf<View>>,
    StdbDecodeError
  >
  readonly unsafe: {
    /** Throws StdbDecodeError on decode failure; prefer toArray for typed failures. */
    readonly rows: () => ReadonlyArray<ViewRowOf<View>>
  }
}

export type PublicViewCache<Module extends AnyModuleSpec> = {
  readonly [Key in PublicViewKeys<Module>]: ViewCacheClient<
    Module["views"][Key]
  >
}

export type PublicCache<Module extends AnyModuleSpec> = {
  readonly tables: PublicTableCache<Module>
  readonly views: PublicViewCache<Module>
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

export type ViewGroupSnapshot<
  Module extends AnyModuleSpec,
  Keys extends ReadonlyArray<PublicViewKeys<Module>>,
> = {
  readonly [Key in Keys[number]]: ReadonlyArray<ViewRowOf<Module["views"][Key]>>
}

export type ViewGroup<
  Module extends AnyModuleSpec,
  Keys extends ReadonlyArray<PublicViewKeys<Module>>,
> = {
  readonly keys: Keys
  readonly subscribe: Effect.Effect<void, SubscriptionFailure, Scope.Scope>
  readonly readSnapshot: Effect.Effect<
    ViewGroupSnapshot<Module, Keys>,
    StdbDecodeError
  >
  readonly changes: Stream.Stream<
    ViewGroupSnapshot<Module, Keys>,
    SubscriptionFailure | StdbDecodeError,
    Scope.Scope
  >
}

export type StdbTableChangeEvent<Row> = TableChangeWithContext<
  Row,
  StdbEventContext
>

export const hasWsCallableTransport = (
  connection: WsConnectionLike<AnyModuleSpec, unknown, unknown>,
): connection is WsConnectionLike<AnyModuleSpec, unknown, unknown> &
  WsCallableConnectionLike =>
  "callReducerWithParams" in connection &&
  "callProcedureWithParams" in connection

export const subscriptionErrorMessage = (
  context: unknown,
  error?: Error,
): string => {
  const fromError =
    error != null && error.message.length > 0 ? error.message : undefined
  const fromContext = messageFromUnknown(context) ?? String(context)
  return fromError ?? fromContext
}

export const ensureWsParamsObject = (
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

export const missingWsRpcTransport: Effect.Effect<never, TransportError> =
  Effect.fail(
    new TransportError({
      cause: new Error("WebSocket callable transport unavailable"),
    }),
  )

export const subscriptionTargetLabel = <Module extends AnyModuleSpec>(
  plan: ModulePlan<Module>,
  target: SubscriptionTarget<Module>,
): string => {
  const matchableTarget: MatchableSubscriptionTarget<Module> = target
  return Match.value(matchableTarget).pipe(
    Match.discriminatorsExhaustive("kind")({
      table: (value) => `table:${value.key}`,
      eventTable: (value) => `eventTable:${value.key}`,
      query: (value) => `query:${value.key}`,
      view: (value) => `view:${value.key}`,
      allPublicTables: (value) =>
        value.keys
          .map((key) =>
            key in plan.publicEventTables
              ? `eventTable:${key}`
              : `table:${key}`,
          )
          .join(","),
    }),
  )
}

export const targetToQuerySource = <Module extends AnyModuleSpec>(
  target: SubscriptionTarget<Module>,
): SubscriptionQuerySource<ClientQueryRoot<Module>> => {
  const matchableTarget: MatchableSubscriptionTarget<Module> = target
  const sourceForKey =
    (
      key: PublicPersistentTableKeys<Module> | PublicEventTableKeys<Module>,
    ): SubscriptionQuerySource<ClientQueryRoot<Module>> =>
    (tables: ClientTableQueryRoot<Module>) =>
      tables[key]
  const sourceForView =
    (
      key: PublicViewKeys<Module>,
    ): SubscriptionQuerySource<ClientQueryRoot<Module>> =>
    (relations: ClientViewQueryRoot<Module>) =>
      viewQueryForKey(relations, key)

  return Match.value(matchableTarget).pipe(
    Match.discriminatorsExhaustive("kind")({
      table: (value) => sourceForKey(value.key),
      eventTable: (value) => sourceForKey(value.key),
      query: (value) => (tables: ClientTableQueryRoot<Module>) =>
        tables[value.key].where(value.predicate),
      view: (value) => sourceForView(value.key),
      allPublicTables: (value) => (tables: ClientTableQueryRoot<Module>) =>
        value.keys.map((key) => tables[key]),
    }),
  )
}

const viewQueryForKey = (relations: object, key: string): TypedQuery =>
  Reflect.get(relations, key)
