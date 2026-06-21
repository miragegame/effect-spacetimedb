import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import type * as Stream from "effect/Stream"
import type { Bound } from "spacetimedb/server"
import type { FieldOptionsOf, FieldValue } from "../contract/field.ts"
import type { AnyModuleSpec } from "../contract/module.ts"
import type { AnyTableSpec, TableRow } from "../contract/table.ts"
import { StdbDecodeError } from "../decode-error.ts"

export class StdbHostCallError extends Data.TaggedError("StdbHostCallError")<{
  readonly op: string
  readonly cause: unknown
  readonly hostErrorName?: string
}> {}

export class StdbUniqueAlreadyExistsError extends Data.TaggedError(
  "StdbUniqueAlreadyExistsError",
)<{
  readonly op: string
  readonly cause: unknown
}> {}

export class StdbAutoIncOverflowError extends Data.TaggedError(
  "StdbAutoIncOverflowError",
)<{
  readonly op: string
  readonly cause: unknown
}> {}

export class StdbNoSuchRowError extends Data.TaggedError("StdbNoSuchRowError")<{
  readonly op: string
  readonly cause: unknown
}> {}

export class StdbScheduleDelayTooLongError extends Data.TaggedError(
  "StdbScheduleDelayTooLongError",
)<{
  readonly op: string
  readonly cause: unknown
}> {}

export type StdbHostFailure =
  | StdbHostCallError
  | StdbUniqueAlreadyExistsError
  | StdbAutoIncOverflowError
  | StdbNoSuchRowError
  | StdbScheduleDelayTooLongError

export const isStdbHostFailure = (error: unknown): error is StdbHostFailure =>
  error instanceof StdbHostCallError ||
  error instanceof StdbUniqueAlreadyExistsError ||
  error instanceof StdbAutoIncOverflowError ||
  error instanceof StdbNoSuchRowError ||
  error instanceof StdbScheduleDelayTooLongError

// Discriminates native SpaceTimeDB host errors by their pinned class name.
// `spacetimedb/server` cannot be value-imported here because it loads the
// spacetime:sys module; the native bindings pin each error class's `name`
// immutably in bindings-typescript/src/server/errors.ts.
export const toHostFailure = (op: string, cause: unknown): StdbHostFailure => {
  if (cause instanceof Error) {
    const hostErrorName = cause.name

    if (hostErrorName === "UniqueAlreadyExists") {
      return new StdbUniqueAlreadyExistsError({ op, cause })
    }
    if (hostErrorName === "AutoIncOverflow") {
      return new StdbAutoIncOverflowError({ op, cause })
    }
    if (hostErrorName === "NoSuchRow") {
      return new StdbNoSuchRowError({ op, cause })
    }
    if (hostErrorName === "ScheduleAtDelayTooLong") {
      return new StdbScheduleDelayTooLongError({ op, cause })
    }

    return new StdbHostCallError({ op, cause, hostErrorName })
  }

  return new StdbHostCallError({ op, cause })
}

export class ReducerAsyncNotAllowedError extends Data.TaggedError(
  "ReducerAsyncNotAllowedError",
) {}

export class ReducerGlobalRandomNotAllowedError extends Data.TaggedError(
  "ReducerGlobalRandomNotAllowedError",
) {
  override readonly message =
    "Global Math.random is not available in SpaceTimeDB reducers. Use Effect.Random or ctx.random instead." as const
}

export class ReducerWallClockNotAllowedError extends Data.TaggedError(
  "ReducerWallClockNotAllowedError",
) {
  override readonly message =
    "Wall-clock time (Date.now / new Date()) is not available in SpaceTimeDB reducers. Use ctx.timestamp, or Effect Clock/DateTime (wired to the transaction timestamp), instead." as const
}

export class StdbSenderFailure extends Data.TaggedError("StdbSenderFailure")<{
  readonly value: string
}> {}

export class StdbDeclaredErrorEncodingFailure extends Data.TaggedError(
  "StdbDeclaredErrorEncodingFailure",
)<{
  readonly callable: "reducer" | "procedure"
  readonly cause: unknown
}> {}

export type HttpResponseLike = {
  readonly text: () => string
  readonly json: () => unknown
  readonly bytes: () => Uint8Array
}

export type RawProcedureHttp = {
  readonly fetch: (url: string, init?: unknown) => HttpResponseLike
}

export type EffectHttpClient = {
  readonly fetch: (
    ...args: Parameters<RawProcedureHttp["fetch"]>
  ) => Effect.Effect<HttpResponseLike, StdbHostCallError>
  readonly text: (
    response: HttpResponseLike,
  ) => Effect.Effect<string, StdbHostCallError>
  readonly json: <A = unknown>(
    response: HttpResponseLike,
  ) => Effect.Effect<A, StdbHostCallError>
  readonly bytes: (
    response: HttpResponseLike,
  ) => Effect.Effect<Uint8Array, StdbHostCallError>
}

type DbFailure = StdbHostFailure | StdbDecodeError
type DbEffect<A> = Effect.Effect<A, DbFailure>
type DbStream<A> = Stream.Stream<A, DbFailure>
type ScheduledInsertRow<Table extends AnyTableSpec> = Omit<
  TableRow<Table>,
  "scheduledId"
>

// Keep index-scan range input structural; native Range<T> has private fields,
// while callers commonly pass plain { from, to } bounds.
type RangeLike<T> = {
  readonly from: Bound<T>
  readonly to: Bound<T>
}

type ColumnKey<Table extends AnyTableSpec> = keyof Table["columns"] & string

type PrimaryKeyNames<Table extends AnyTableSpec> = {
  readonly [K in ColumnKey<Table>]: FieldOptionsOf<
    Table["columns"][K]
  >["primaryKey"] extends true
    ? K
    : never
}[ColumnKey<Table>]

type SinglePrimaryKeyName<Table extends AnyTableSpec> =
  PrimaryKeyNames<Table> extends infer Key extends string
    ? Exclude<PrimaryKeyNames<Table>, Key> extends never
      ? Key
      : never
    : never

type UniqueConstraintSpec<Table extends AnyTableSpec> = Extract<
  Table["constraints"][number],
  { readonly kind: "unique" }
>

type ContainsAllColumns<
  Columns extends readonly string[],
  ConstraintColumns extends readonly string[],
> = Columns extends readonly [
  infer Head extends string,
  ...infer Tail extends readonly string[],
]
  ? Head extends ConstraintColumns[number]
    ? ContainsAllColumns<Tail, ConstraintColumns>
    : false
  : true

type IsSameColumnSet<
  Left extends readonly string[],
  Right extends readonly string[],
> = ContainsAllColumns<Left, Right> extends true
  ? ContainsAllColumns<Right, Left>
  : false

type HasExplicitUniqueConstraint<
  Table extends AnyTableSpec,
  Columns extends readonly string[],
> = true extends (
  UniqueConstraintSpec<Table> extends infer Constraint
    ? Constraint extends {
        readonly columns: infer ConstraintColumns extends readonly string[]
      }
      ? IsSameColumnSet<Columns, ConstraintColumns>
      : false
    : false
)
  ? true
  : false

type HasImplicitPrimaryKeyUniqueness<
  Table extends AnyTableSpec,
  Columns extends readonly string[],
> = Columns extends readonly [infer Only extends string]
  ? Only extends PrimaryKeyNames<Table>
    ? true
    : false
  : false

type IsUniqueIndexColumns<
  Table extends AnyTableSpec,
  Columns extends readonly string[],
> = HasImplicitPrimaryKeyUniqueness<Table, Columns> extends true
  ? true
  : HasExplicitUniqueConstraint<Table, Columns>

type IndexPointTuple<
  Table extends AnyTableSpec,
  Columns extends readonly ColumnKey<Table>[],
> = Columns extends readonly [
  infer Head extends ColumnKey<Table>,
  ...infer Tail extends readonly ColumnKey<Table>[],
]
  ? readonly [
      FieldValue<Table["columns"][Head]>,
      ...IndexPointTuple<Table, Tail>,
    ]
  : readonly []

type IndexPointObject<
  Table extends AnyTableSpec,
  Columns extends readonly ColumnKey<Table>[],
> = {
  readonly [Column in Columns[number]]: FieldValue<Table["columns"][Column]>
}

type CollapseIndexPoint<
  Table extends AnyTableSpec,
  Columns extends readonly ColumnKey<Table>[],
  Tuple extends readonly unknown[],
> = Tuple extends readonly [infer Only]
  ? Only
  : Tuple | IndexPointObject<Table, Columns>

type IndexPoint<
  Table extends AnyTableSpec,
  Columns extends readonly ColumnKey<Table>[],
> = CollapseIndexPoint<Table, Columns, IndexPointTuple<Table, Columns>>

type CompositeIndexRangeBounds<
  Tuple extends readonly unknown[],
  Prefix extends readonly unknown[] = readonly [],
> = Tuple extends readonly [infer Head, ...infer Tail]
  ?
      | readonly [...Prefix, Head | RangeLike<Head>]
      | (Tail extends readonly []
          ? never
          : CompositeIndexRangeBounds<Tail, readonly [...Prefix, Head]>)
  : never

type IndexRangeBounds<Tuple extends readonly unknown[]> =
  Tuple extends readonly [infer Term]
    ? Term | RangeLike<Term>
    : CompositeIndexRangeBounds<Tuple>

type Expand<T> = {
  readonly [K in keyof T]: T[K]
}

type CompositeIndexRangeObject<
  Table extends AnyTableSpec,
  Columns extends readonly ColumnKey<Table>[],
  Prefix extends Record<string, unknown> = {},
> = Columns extends readonly [
  infer Head extends ColumnKey<Table>,
  ...infer Tail extends readonly ColumnKey<Table>[],
]
  ?
      | Expand<
          Prefix & {
            readonly [Key in Head]:
              | FieldValue<Table["columns"][Head]>
              | RangeLike<FieldValue<Table["columns"][Head]>>
          }
        >
      | (Tail extends readonly []
          ? never
          : CompositeIndexRangeObject<
              Table,
              Tail,
              Prefix & {
                readonly [Key in Head]: FieldValue<Table["columns"][Head]>
              }
            >)
  : never

type IndexRange<
  Table extends AnyTableSpec,
  Columns extends readonly ColumnKey<Table>[],
> = Columns extends readonly [ColumnKey<Table>]
  ? IndexRangeBounds<IndexPointTuple<Table, Columns>>
  :
      | IndexRangeBounds<IndexPointTuple<Table, Columns>>
      | CompositeIndexRangeObject<Table, Columns>

type UniqueAccessorFromColumns<
  Table extends AnyTableSpec,
  Columns extends readonly ColumnKey<Table>[],
  Readonly extends boolean,
> = {
  readonly find: (
    value: IndexPoint<Table, Columns>,
  ) => DbEffect<TableRow<Table> | undefined>
  readonly exists: (value: IndexPoint<Table, Columns>) => DbEffect<boolean>
  readonly findOrFail: <E>(
    value: IndexPoint<Table, Columns>,
    makeError: (value: IndexPoint<Table, Columns>) => E,
  ) => Effect.Effect<TableRow<Table>, E | DbFailure>
} & (Readonly extends true
  ? {}
  : {
      readonly delete: (value: IndexPoint<Table, Columns>) => DbEffect<boolean>
    })

type PrimaryKeyAccessorFromColumns<
  Table extends AnyTableSpec,
  Columns extends readonly ColumnKey<Table>[],
  Readonly extends boolean,
> = UniqueAccessorFromColumns<Table, Columns, Readonly> &
  (Readonly extends true
    ? {}
    : {
        readonly replace: (row: TableRow<Table>) => DbEffect<TableRow<Table>>
        readonly update: (row: TableRow<Table>) => DbEffect<TableRow<Table>>
      })

type ImplicitPrimaryKeyAccessor<
  Table extends AnyTableSpec,
  Name extends PrimaryKeyNames<Table>,
  Readonly extends boolean,
> = Name extends SinglePrimaryKeyName<Table>
  ? PrimaryKeyAccessorFromColumns<Table, readonly [Name], Readonly>
  : UniqueAccessorFromColumns<Table, readonly [Name], Readonly>

type ExplicitIndexSpec<Table extends AnyTableSpec> = Table["indexes"][number]

type RangeAccessorFromColumns<
  Table extends AnyTableSpec,
  Columns extends readonly ColumnKey<Table>[],
  Readonly extends boolean,
> = {
  readonly filterToArray: (
    range: IndexRange<Table, Columns>,
  ) => DbEffect<ReadonlyArray<TableRow<Table>>>
  readonly filterStream: (
    range: IndexRange<Table, Columns>,
  ) => DbStream<TableRow<Table>>
  readonly unsafe: {
    readonly filter: (
      range: IndexRange<Table, Columns>,
    ) => DbEffect<Iterable<TableRow<Table>>>
  }
} & (Readonly extends true
  ? {}
  : {
      readonly delete: (range: IndexRange<Table, Columns>) => DbEffect<number>
      readonly deleteAll: (
        range: IndexRange<Table, Columns>,
      ) => DbEffect<number>
    })

type PointAccessorFromColumns<
  Table extends AnyTableSpec,
  Columns extends readonly ColumnKey<Table>[],
  Readonly extends boolean,
> = {
  readonly filterToArray: (
    value: IndexPoint<Table, Columns>,
  ) => DbEffect<ReadonlyArray<TableRow<Table>>>
  readonly filterStream: (
    value: IndexPoint<Table, Columns>,
  ) => DbStream<TableRow<Table>>
  readonly unsafe: {
    readonly filter: (
      value: IndexPoint<Table, Columns>,
    ) => DbEffect<Iterable<TableRow<Table>>>
  }
} & (Readonly extends true
  ? {}
  : {
      readonly delete: (value: IndexPoint<Table, Columns>) => DbEffect<number>
    })

type ExplicitIndexAccessor<
  Table extends AnyTableSpec,
  Index extends ExplicitIndexSpec<Table>,
  Readonly extends boolean,
> = Index extends {
  readonly columns: infer Columns extends readonly ColumnKey<Table>[]
  readonly algorithm: infer Algorithm
}
  ? IsUniqueIndexColumns<Table, Columns> extends true
    ? Columns extends readonly [SinglePrimaryKeyName<Table>]
      ? PrimaryKeyAccessorFromColumns<Table, Columns, Readonly>
      : UniqueAccessorFromColumns<Table, Columns, Readonly>
    : Algorithm extends "hash"
      ? PointAccessorFromColumns<Table, Columns, Readonly>
      : RangeAccessorFromColumns<Table, Columns, Readonly>
  : never

type TableAccessors<Table extends AnyTableSpec, Readonly extends boolean> = {
  readonly [Name in PrimaryKeyNames<Table>]: ImplicitPrimaryKeyAccessor<
    Table,
    Name,
    Readonly
  >
} & {
  readonly [Index in ExplicitIndexSpec<Table> as Index["name"] &
    string]: ExplicitIndexAccessor<Table, Index, Readonly>
}

export type EffectTableHandle<
  Table extends AnyTableSpec,
  Readonly extends boolean,
> = {
  readonly count: () => DbEffect<bigint>
  readonly first: () => DbEffect<TableRow<Table> | undefined>
  readonly toArray: () => DbEffect<ReadonlyArray<TableRow<Table>>>
  readonly stream: () => DbStream<TableRow<Table>>
  readonly unsafe: {
    readonly iter: () => DbEffect<Iterable<TableRow<Table>>>
  }
} & (Readonly extends true
  ? {}
  : {
      readonly insert: (row: TableRow<Table>) => DbEffect<TableRow<Table>>
    } & (Table["scheduled"] extends true
      ? {
          readonly schedule: (
            row: ScheduledInsertRow<Table>,
          ) => DbEffect<TableRow<Table>>
        }
      : {}) & {
        readonly insertAll: (
          rows: Iterable<TableRow<Table>>,
        ) => DbEffect<ReadonlyArray<TableRow<Table>>>
        readonly delete: (row: TableRow<Table>) => DbEffect<boolean>
        readonly clear: () => DbEffect<bigint>
      }) &
  TableAccessors<Table, Readonly>

export type EffectDbView<Module extends AnyModuleSpec> = {
  readonly [Key in keyof Module["tables"]]-?: EffectTableHandle<
    Module["tables"][Key],
    false
  >
}

export type ReadonlyEffectDbView<Module extends AnyModuleSpec> = {
  readonly [Key in keyof Module["tables"]]-?: EffectTableHandle<
    Module["tables"][Key],
    true
  >
}

export const wrapHttp = (ctx: unknown): EffectHttpClient => {
  const http = ctx as RawProcedureHttp

  return {
    fetch: (...args) =>
      Effect.try({
        try: () => http.fetch(...args),
        catch: (cause) => new StdbHostCallError({ op: "http.fetch", cause }),
      }),
    text: (response) =>
      Effect.try({
        try: () => response.text(),
        catch: (cause) => new StdbHostCallError({ op: "http.text", cause }),
      }),
    json: <A = unknown>(response: HttpResponseLike) =>
      Effect.try({
        try: () => response.json() as A,
        catch: (cause) => new StdbHostCallError({ op: "http.json", cause }),
      }),
    bytes: (response) =>
      Effect.try({
        try: () => response.bytes(),
        catch: (cause) => new StdbHostCallError({ op: "http.bytes", cause }),
      }),
  }
}
