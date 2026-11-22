import {
  camelCaseName,
  type GeneratedAccessor,
} from "../contract/canonical-name.ts"
import {
  quotedIdentifier,
  generatedMemberPath,
  readMember,
  type NestedMembers,
  type MembersByPath,
} from "../member-path.ts"
import type * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import type * as Scope from "effect/Scope"
import type * as Stream from "effect/Stream"
import type { AnyModuleSpec } from "../contract/module.ts"
import type { AnyTableSpec, TableRow } from "../contract/table.ts"
import { type AnyViewSpec, viewTakesArgs } from "../contract/view.ts"
import type { ModulePlan } from "../module-plan.ts"
import type {
  PublicViewKeys,
  ViewCallArgsOf,
  ViewRowOf,
  ViewTakesArgs,
  WsViewRowOf,
} from "../module-projection.ts"
import type {
  ClientQueryRoot,
  ClientTableQueryRoot,
  TypedQuery,
} from "../query/types.ts"
import type {
  MatchableSubscriptionTarget,
  PublicEventTableKeys,
  PublicPersistentTableKeys,
  PublicTableKeys,
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
import type { WaitUntilOptions } from "./wait-until.ts"
import type { WsTableRow } from "./ws-row.ts"
import { viewCallSql } from "./view-call-sql.ts"
import type { SubscriptionFailure } from "./ws-subscription.ts"
import type {
  SubscriptionBuilderLike,
  SubscriptionQuerySource,
} from "./ws-subscription-adapter.ts"

export type GeneratedTables<
  Tables extends Readonly<Record<string, AnyTableSpec>>,
  C,
> = {
  readonly [Key in keyof Tables & string as Tables[Key]["public"] extends true
    ? GeneratedAccessor<Key>
    : never]: RelationHandle<WsTableRow<Tables[Key]>, C>
}

export type GeneratedViews<
  Views extends Readonly<Record<string, AnyViewSpec>>,
  C,
> = {
  readonly [Key in keyof Views &
    string as GeneratedAccessor<Key>]: RelationHandle<
    WsViewRowOf<Views[Key]>,
    C
  >
}

export type WsDbShape<M extends AnyModuleSpec, C = unknown> = NestedMembers<
  GeneratedTables<MembersByPath<M, "tables">, C> &
    GeneratedViews<MembersByPath<M, "views">, C>
>

export const tableRelation = <
  M extends AnyModuleSpec,
  E,
  C,
  K extends PublicPersistentTableKeys<M> | PublicEventTableKeys<M>,
>(
  connection: WsConnectionLike<M, E, C>,
  key: K,
): RelationHandle<WsTableRow<MembersByPath<M, "tables">[K]>, C> =>
  readMember(connection.db, generatedMemberPath(key)) as RelationHandle<
    WsTableRow<MembersByPath<M, "tables">[K]>,
    C
  >

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

export type WsCallableConnectionLike = {
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
  /**
   * The longest a call may wait for its answer. An overrun fails with
   * `ConnectionLostError` and invalidates the connection, which stays yours to
   * close. Defaults to `callDurationMaxDefault`, 30 seconds.
   * Use `Duration.infinity` to disable the call deadline.
   */
  readonly callDurationMax?: Duration.Input | undefined
}

export type WsStreamOptions = {
  readonly buffer?: SessionStreamBufferOptions | undefined
}

/** The arguments of every view in a group that takes them, by view key. */
export type ViewGroupArgs<
  Module extends AnyModuleSpec,
  Keys extends ReadonlyArray<PublicViewKeys<Module>>,
> = {
  readonly [Key in Keys[number] as ViewTakesArgs<
    MembersByPath<Module, "views">[Key]
  > extends true
    ? Key
    : never]: ViewCallArgsOf<MembersByPath<Module, "views">[Key]>
}

/**
 * A view group's options: `args` is required, and only allowed, when a view
 * in the group declares params.
 */
export type ViewGroupOptionsParam<
  Module extends AnyModuleSpec,
  Keys extends ReadonlyArray<PublicViewKeys<Module>>,
> = [keyof ViewGroupArgs<Module, Keys>] extends [never]
  ? readonly [options?: WsStreamOptions]
  : readonly [
      options: WsStreamOptions & {
        readonly args: ViewGroupArgs<Module, Keys>
      },
    ]

/**
 * Whether any view `Key` names declares params. A union key is checked view
 * by view, so a key that may name a view with params requires `args`.
 */
export type SomeViewTakesArgs<
  Module extends AnyModuleSpec,
  Key extends PublicViewKeys<Module>,
> = true extends (
  Key extends PublicViewKeys<Module>
    ? ViewTakesArgs<MembersByPath<Module, "views">[Key]>
    : never
)
  ? true
  : false

/**
 * The arguments a call through `Key` needs. A union key may name any of its
 * views, so its arguments satisfy every one: the intersection of theirs.
 */
export type ViewCallArgsForKey<
  Module extends AnyModuleSpec,
  Key extends PublicViewKeys<Module>,
> = (
  Key extends PublicViewKeys<Module>
    ? (args: ViewCallArgsOf<MembersByPath<Module, "views">[Key]>) => void
    : never
) extends (args: infer Args) => void
  ? Args
  : never

/** One view's options: `args` exactly when the view declares params. */
export type ViewRowsOptionsParam<
  Module extends AnyModuleSpec,
  Key extends PublicViewKeys<Module>,
> = SomeViewTakesArgs<Module, Key> extends true
  ? readonly [
      options: WsStreamOptions & {
        readonly args: ViewCallArgsForKey<Module, Key>
      },
    ]
  : readonly [options?: WsStreamOptions]

/** A view wait's options: `args` exactly when the view declares params. */
export type WaitUntilViewOptionsParam<
  Module extends AnyModuleSpec,
  Key extends PublicViewKeys<Module>,
> = SomeViewTakesArgs<Module, Key> extends true
  ? readonly [
      options: WaitUntilOptions & {
        readonly args: ViewCallArgsForKey<Module, Key>
      },
    ]
  : readonly [options?: WaitUntilOptions]

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

export type TableCacheClient<Table extends AnyTableSpec> = {
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
    MembersByPath<Module, "tables">[Key]
  >
}

export type ViewCacheClient<View extends AnyViewSpec> = {
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
    MembersByPath<Module, "views">[Key]
  >
}

export type PublicCache<Module extends AnyModuleSpec> = {
  readonly tables: NestedMembers<PublicTableCache<Module>>
  readonly views: NestedMembers<PublicViewCache<Module>>
}

export type TableGroupSnapshot<
  Module extends AnyModuleSpec,
  Keys extends ReadonlyArray<PublicPersistentTableKeys<Module>>,
> = {
  readonly [Key in Keys[number]]: ReadonlyArray<
    TableRow<MembersByPath<Module, "tables">[Key]>
  >
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
  readonly [Key in Keys[number]]: ReadonlyArray<
    ViewRowOf<MembersByPath<Module, "views">[Key]>
  >
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

export const hasWsCallableTransport = <T extends object>(
  connection: T,
): connection is T & WsCallableConnectionLike =>
  "callReducerWithParams" in connection &&
  "callProcedureWithParams" in connection

export const subscriptionErrorMessage = (
  context: unknown,
  error?: Error,
): string => {
  const fromError =
    error != null && error.message.length > 0 ? error.message : undefined
  return fromError ?? messageFromUnknown(context) ?? String(context)
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
  const matchableTarget = target as MatchableSubscriptionTarget<Module>
  if (matchableTarget.kind !== "allPublicTables")
    return `${matchableTarget.kind}:${matchableTarget.key}`
  return matchableTarget.keys
    .map((key) =>
      key in plan.publicEventTables ? `eventTable:${key}` : `table:${key}`,
    )
    .join(",")
}

/**
 * The query a target subscribes with. A call of a view with params is SQL,
 * since the SDK's query builder cannot call a view; encoding its arguments
 * can fail like any other argument encoding.
 */
export const targetQuerySource = <Module extends AnyModuleSpec>(
  target: SubscriptionTarget<Module>,
): Effect.Effect<
  SubscriptionQuerySource<ClientQueryRoot<Module>>,
  StdbDecodeError
> => {
  const matchableTarget = target as MatchableSubscriptionTarget<Module>
  return matchableTarget.kind === "view" &&
    viewTakesArgs(matchableTarget.params)
    ? viewCallSql(
        matchableTarget.name,
        matchableTarget.params,
        matchableTarget.args,
      )
    : Effect.succeed(targetToQuerySource(target))
}

const targetToQuerySource = <Module extends AnyModuleSpec>(
  target: SubscriptionTarget<Module>,
): SubscriptionQuerySource<ClientQueryRoot<Module>> => {
  const matchableTarget = target as MatchableSubscriptionTarget<Module>
  // The SDK groups subscription callbacks by the first canonical namespace.
  // The rest of the canonical name is a single key, including deeper mounts.
  const tableFor = (
    root: ClientTableQueryRoot<Module>,
    key: PublicTableKeys<Module>,
    name: string,
  ) => {
    const dot = name.indexOf(".")
    return (
      dot < 0
        ? Reflect.get(root, camelCaseName(key))
        : readMember(root, [name.slice(0, dot), name.slice(dot + 1)])
    ) as TypedQuery & {
      where(
        predicate: Extract<
          MatchableSubscriptionTarget<Module>,
          { kind: "query" }
        >["predicate"],
      ): TypedQuery
    }
  }
  const relationQuery = (value: {
    readonly key: string
    readonly name: string
  }) =>
    value.key.includes(".")
      ? "SELECT * FROM " + quotedIdentifier(value.name)
      : (relations: ClientQueryRoot<Module>): TypedQuery =>
          Reflect.get(relations, camelCaseName(value.key))
  switch (matchableTarget.kind) {
    case "table":
    case "eventTable":
    case "view":
      return relationQuery(matchableTarget)
    case "query":
      return (tables) =>
        tableFor(tables, matchableTarget.key, matchableTarget.name).where(
          (row) =>
            matchableTarget.predicate(
              new Proxy(row, {
                get: (target, column) =>
                  Reflect.get(
                    target,
                    typeof column === "string" ? camelCaseName(column) : column,
                  ),
              }),
            ),
        )
    case "allPublicTables":
      return (tables) =>
        matchableTarget.keys.map((key) =>
          tableFor(tables, key, matchableTarget.names?.[key] ?? key),
        )
  }
}
